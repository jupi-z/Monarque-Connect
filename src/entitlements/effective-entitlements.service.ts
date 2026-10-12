import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { SubscriptionService } from './subscription.service.js';

export type EntitlementDecisionReason =
  | 'CORE_MODULE'
  | 'PLAN_INCLUDED'
  | 'EXPLICIT_ALLOW'
  | 'EXPLICIT_DENY'
  | 'MODULE_NOT_INCLUDED'
  | 'NO_ACTIVE_SUBSCRIPTION'
  | 'SUBSCRIPTION_INACTIVE'
  | 'ORGANIZATION_SUSPENDED'
  | 'ORGANIZATION_INACTIVE'
  | 'DEPENDENCY_NOT_ENTITLED'
  | 'MODULE_REQUIRES_ACTIVE_MODULE'
  | 'MODULE_RETIRED'
  | 'MODULE_DEFAULT_DISABLED'
  | 'MODULE_DEACTIVATED';

export interface EffectiveModuleEntitlement {
  code: string;
  displayName: string;
  pillar: string;
  isCore: boolean;
  availability: string;
  dependencies: string[];
  recommended: boolean;
  limitOverrides: Record<string, string>;
  entitled: boolean;
  active: boolean;
  allowed: boolean;
  reason: EntitlementDecisionReason;
  source: 'CORE' | 'PLAN' | 'OVERRIDE' | 'NONE';
}

export interface EffectiveEntitlementsProjection {
  capabilitiesVersion: 1;
  organizationId: string;
  evaluatedAt: string;
  plan: { code: string; version: number } | null;
  subscription: { id: string; status: string; startsAt: string; endsAt: string | null } | null;
  modules: EffectiveModuleEntitlement[];
}

type ActiveOverride = {
  effect?: 'ALLOW' | 'DENY';
  limitsJson?: unknown;
};

@Injectable()
export class EffectiveEntitlementsService {
  constructor(private readonly prisma: PrismaService, private readonly subscriptions: SubscriptionService) {}

  async resolve(organizationId: string, at: Date = new Date()): Promise<EffectiveEntitlementsProjection> {
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { status: true, businessTypeCode: true } });
    const [catalog, activations, presets, overrides] = await Promise.all([
      this.prisma.moduleCatalog.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.organizationModuleActivation.findMany({ where: { organizationId }, select: { moduleCode: true, enabled: true } }),
      this.prisma.moduleBusinessTypePreset.findMany({ where: { businessTypeCode: organization.businessTypeCode }, select: { moduleCode: true, recommended: true } }),
      this.prisma.organizationEntitlement.findMany({ where: { organizationId, startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] }, orderBy: [{ createdAt: 'desc' }, { startsAt: 'desc' }], select: { moduleCode: true, effect: true, limitsJson: true, reason: true } }),
    ]);
    const effectiveSubscription = organization.status === 'ACTIVE' ? await this.subscriptions.resolveEffective(organizationId, at) : null;
    const latestSubscription = effectiveSubscription ?? await this.prisma.subscription.findFirst({ where: { organizationId }, orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }], select: { status: true } });
    const planVersion = effectiveSubscription
      ? await this.prisma.planVersion.findUniqueOrThrow({ where: { id: effectiveSubscription.planVersionId }, select: { planCode: true, version: true, modules: { select: { moduleCode: true, defaultEnabled: true } } } })
      : null;

    const included = new Set((planVersion?.modules ?? []).map((module) => module.moduleCode));
    const planModuleByCode = new Map((planVersion?.modules ?? []).map((module) => [module.moduleCode, module]));
    const catalogByCode = new Map(catalog.map((module) => [module.code, module]));
    const activationByCode = new Map(activations.map((activation) => [activation.moduleCode, activation.enabled]));
    const recommendedByCode = new Map(presets.filter((preset) => preset.recommended).map((preset) => [preset.moduleCode, true]));
    const overridesByCode = this.activeOverrides(overrides);
    const decisions = new Map<string, EffectiveModuleEntitlement>();
    const evaluating = new Set<string>();

    const evaluate = (moduleCode: string): EffectiveModuleEntitlement => {
      const cached = decisions.get(moduleCode);
      if (cached) return cached;
      const module = catalogByCode.get(moduleCode);
      if (!module) throw new Error(`Unknown module dependency: ${moduleCode}`);
      const dependencies = this.dependencies(module.dependenciesJson);
      const override = overridesByCode.get(moduleCode);
      let entitled = false;
      let reason: EntitlementDecisionReason = organization.status === 'SUSPENDED' ? 'ORGANIZATION_SUSPENDED' : organization.status !== 'ACTIVE' ? 'ORGANIZATION_INACTIVE' : effectiveSubscription ? 'MODULE_NOT_INCLUDED' : latestSubscription ? 'SUBSCRIPTION_INACTIVE' : 'NO_ACTIVE_SUBSCRIPTION';
      let source: EffectiveModuleEntitlement['source'] = effectiveSubscription ? 'PLAN' : 'NONE';

      if (module.availability === 'RETIRED') reason = 'MODULE_RETIRED';
      else if (organization.status !== 'ACTIVE') {
        entitled = false;
        source = 'NONE';
      } else if (override?.effect === 'DENY') {
        reason = 'EXPLICIT_DENY';
        source = 'OVERRIDE';
      } else if (module.isCore) {
        entitled = organization.status === 'ACTIVE';
        reason = 'CORE_MODULE';
        source = 'CORE';
      } else if (override?.effect === 'ALLOW') {
        entitled = true;
        reason = 'EXPLICIT_ALLOW';
        source = 'OVERRIDE';
      } else if (effectiveSubscription && included.has(module.code)) {
        entitled = true;
        reason = 'PLAN_INCLUDED';
        source = 'PLAN';
      }

      const defaultEnabled = planModuleByCode.get(module.code)?.defaultEnabled ?? true;
      const active = entitled && (module.isCore || (activationByCode.get(module.code) ?? defaultEnabled));
      let allowed = active;
      if (entitled && !active) reason = activationByCode.has(module.code) ? 'MODULE_DEACTIVATED' : 'MODULE_DEFAULT_DISABLED';

      evaluating.add(moduleCode);
      if (active && dependencies.some((dependency) => {
        if (evaluating.has(dependency)) return true;
        const dependencyDecision = catalogByCode.has(dependency) ? evaluate(dependency) : null;
        return !dependencyDecision?.allowed;
      })) {
        allowed = false;
        reason = 'DEPENDENCY_NOT_ENTITLED';
      }
      if (active && module.code === 'INTELLIGENCE_BASIC' && !catalog.some((candidate) => {
        if (candidate.code === module.code || candidate.isCore || candidate.pillar === 'Network' || candidate.pillar === 'Intelligence') return false;
        return evaluate(candidate.code).allowed;
      })) {
        allowed = false;
        reason = 'MODULE_REQUIRES_ACTIVE_MODULE';
      }
      evaluating.delete(moduleCode);

      const decision: EffectiveModuleEntitlement = {
        code: module.code,
        displayName: module.displayName,
        pillar: module.pillar,
        isCore: module.isCore,
        availability: module.availability,
        dependencies,
        recommended: recommendedByCode.get(module.code) ?? false,
        limitOverrides: this.limitOverrides(override?.limitsJson),
        entitled,
        active,
        allowed,
        reason,
        source,
      };
      decisions.set(module.code, decision);
      return decision;
    };

    for (const module of catalog) evaluate(module.code);

    return {
      capabilitiesVersion: 1,
      organizationId,
      evaluatedAt: at.toISOString(),
      plan: planVersion ? { code: planVersion.planCode, version: planVersion.version } : null,
      subscription: effectiveSubscription ? { id: effectiveSubscription.id, status: effectiveSubscription.status, startsAt: effectiveSubscription.startsAt.toISOString(), endsAt: effectiveSubscription.endsAt?.toISOString() ?? null } : null,
      modules: Array.from(decisions.values()),
    };
  }

  private activeOverrides(overrides: Array<{ moduleCode: string; effect: 'ALLOW' | 'DENY' | 'LIMIT_OVERRIDE'; limitsJson: unknown; reason: string }>): Map<string, ActiveOverride> {
    const selected = new Map<string, ActiveOverride>();
    const priority = { DENY: 3, ALLOW: 2, LIMIT_OVERRIDE: 1 } as const;
    for (const override of overrides) {
      const current = selected.get(override.moduleCode);
      if (override.effect === 'LIMIT_OVERRIDE') {
        selected.set(override.moduleCode, { ...current, limitsJson: current?.limitsJson ?? override.limitsJson });
      } else if (!current?.effect || priority[override.effect] > priority[current.effect]) {
        selected.set(override.moduleCode, { ...current, effect: override.effect });
      }
    }
    return selected;
  }

  private limitOverrides(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, item]) => (typeof item === 'string' && /^\d+$/.test(item)) || (typeof item === 'number' && Number.isSafeInteger(item) && item >= 0)).map(([key, item]) => [key, String(item)]));
  }

  private dependencies(value: unknown): string[] {
    return Array.isArray(value) && value.every((item): item is string => typeof item === 'string') ? value : [];
  }
}
