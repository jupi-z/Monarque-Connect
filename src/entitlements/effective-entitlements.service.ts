import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { SubscriptionService } from './subscription.service.js';

export type EntitlementDecisionReason = 'CORE_MODULE' | 'PLAN_INCLUDED' | 'MODULE_NOT_INCLUDED' | 'NO_ACTIVE_SUBSCRIPTION' | 'SUBSCRIPTION_INACTIVE' | 'DEPENDENCY_NOT_ENTITLED' | 'MODULE_RETIRED';

export interface EffectiveModuleEntitlement {
  code: string;
  displayName: string;
  pillar: string;
  isCore: boolean;
  availability: string;
  dependencies: string[];
  allowed: boolean;
  reason: EntitlementDecisionReason;
  source: 'CORE' | 'PLAN' | 'NONE';
}

export interface EffectiveEntitlementsProjection {
  capabilitiesVersion: 1;
  organizationId: string;
  evaluatedAt: string;
  plan: { code: string; version: number } | null;
  subscription: { id: string; status: string; startsAt: string; endsAt: string | null } | null;
  modules: EffectiveModuleEntitlement[];
}

@Injectable()
export class EffectiveEntitlementsService {
  constructor(private readonly prisma: PrismaService, private readonly subscriptions: SubscriptionService) {}

  async resolve(organizationId: string, at: Date = new Date()): Promise<EffectiveEntitlementsProjection> {
    const [organization, catalog] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { status: true } }),
      this.prisma.moduleCatalog.findMany({ orderBy: { code: 'asc' } }),
    ]);
    const effectiveSubscription = organization.status === 'ACTIVE' ? await this.subscriptions.resolveEffective(organizationId, at) : null;
    const latestSubscription = effectiveSubscription ?? await this.prisma.subscription.findFirst({ where: { organizationId }, orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }], select: { status: true } });
    const planVersion = effectiveSubscription
      ? await this.prisma.planVersion.findUniqueOrThrow({ where: { id: effectiveSubscription.planVersionId }, select: { planCode: true, version: true, modules: { select: { moduleCode: true, defaultEnabled: true } } } })
      : null;
    const included = new Set((planVersion?.modules ?? []).filter((module) => module.defaultEnabled).map((module) => module.moduleCode));

    const catalogByCode = new Map(catalog.map((module) => [module.code, module]));
    const decisions = new Map<string, EffectiveModuleEntitlement>();
    const evaluating = new Set<string>();
    const evaluate = (moduleCode: string): EffectiveModuleEntitlement => {
      const cached = decisions.get(moduleCode);
      if (cached) return cached;
      const module = catalogByCode.get(moduleCode);
      if (!module) throw new Error(`Unknown module dependency: ${moduleCode}`);
      const dependencies = this.dependencies(module.dependenciesJson);
      let allowed = false;
      let reason: EntitlementDecisionReason = effectiveSubscription ? 'MODULE_NOT_INCLUDED' : latestSubscription ? 'SUBSCRIPTION_INACTIVE' : 'NO_ACTIVE_SUBSCRIPTION';
      let source: EffectiveModuleEntitlement['source'] = effectiveSubscription ? 'PLAN' : 'NONE';
      if (module.availability === 'RETIRED') reason = 'MODULE_RETIRED';
      else if (module.isCore) {
        allowed = organization.status === 'ACTIVE';
        reason = 'CORE_MODULE';
        source = 'CORE';
      } else if (effectiveSubscription && included.has(module.code)) {
        allowed = true;
        reason = 'PLAN_INCLUDED';
        source = 'PLAN';
      }
      evaluating.add(moduleCode);
      if (allowed && dependencies.some((dependency) => {
        if (evaluating.has(dependency)) return true;
        const dependencyDecision = catalogByCode.has(dependency) ? evaluate(dependency) : null;
        return !dependencyDecision?.allowed;
      })) {
        allowed = false;
        reason = 'DEPENDENCY_NOT_ENTITLED';
      }
      evaluating.delete(moduleCode);
      const decision = { code: module.code, displayName: module.displayName, pillar: module.pillar, isCore: module.isCore, availability: module.availability, dependencies, allowed, reason, source };
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

  private dependencies(value: unknown): string[] {
    return Array.isArray(value) && value.every((item): item is string => typeof item === 'string') ? value : [];
  }
}
