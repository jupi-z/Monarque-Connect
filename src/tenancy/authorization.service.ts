import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type TenantRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthPrincipal, AuthorizationContext } from '../auth/auth.types.js';
import { EffectiveEntitlementsService } from '../entitlements/effective-entitlements.service.js';

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService, private readonly entitlements: EffectiveEntitlementsService) {}

  async requireMembership(principal: AuthPrincipal, organizationId: string): Promise<AuthorizationContext> {
    const membership = await this.prisma.membership.findFirst({
      where: { organizationId, userId: principal.userId, status: 'ACTIVE', user: { status: 'ACTIVE' }, organization: { status: 'ACTIVE' } },
      include: { scopeLinks: { select: { establishmentId: true } } },
    });
    if (!membership) {
      await this.logMembershipDenial(principal, organizationId);
      throw new ForbiddenException('Organization access denied');
    }
    return {
      userId: principal.userId,
      sessionId: principal.sessionId,
      organizationId,
      membershipId: membership.id,
      role: membership.role,
      scopeMode: membership.scopeMode,
      establishmentIds: membership.scopeLinks.map((scope) => scope.establishmentId),
    };
  }

  can(context: AuthorizationContext, permission: Permission): boolean {
    return rolePermissions[context.role].includes(permission);
  }

  assertPermission(context: AuthorizationContext, permission: Permission): void {
    if (!this.can(context, permission)) {
      this.logTestDenial({ branch: 'permission', role: context.role, permission, scopeMode: context.scopeMode });
      throw new ForbiddenException('Permission denied');
    }
  }

  async requireModule(principal: AuthPrincipal, organizationId: string, moduleCode: string, permission: Permission): Promise<AuthorizationContext> {
    const context = await this.requireMembership(principal, organizationId);
    this.assertPermission(context, permission);
    const projection = await this.entitlements.resolve(organizationId);
    const module = projection.modules.find((candidate) => candidate.code === moduleCode);
    if (!module?.allowed) {
      const databaseState = process.env.NODE_ENV === 'test' ? await this.moduleDenialSnapshot(organizationId) : null;
      this.logTestDenial({
        branch: 'module', role: context.role, permission, moduleCode,
        decision: module ? { allowed: module.allowed, reason: module.reason, entitled: module.entitled, active: module.active, source: module.source } : null,
        plan: projection.plan, subscription: projection.subscription,
        evaluatedAt: projection.evaluatedAt,
        databaseState,
      });
      throw new ForbiddenException('Module access denied');
    }
    return context;
  }

  async requireModuleInTransaction(tx: Prisma.TransactionClient, principal: AuthPrincipal, organizationId: string, moduleCode: string, permission: Permission): Promise<AuthorizationContext> {
    const candidate = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId, userId: principal.userId } }, select: { id: true } });
    if (!candidate) {
      this.logTestDenial({ branch: 'transaction-membership-missing' });
      throw new ForbiddenException('Organization access denied');
    }
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "memberships" WHERE id = ${candidate.id}::uuid FOR UPDATE`);
    if (locked.length !== 1) {
      this.logTestDenial({ branch: 'transaction-membership-lock-missing' });
      throw new ForbiddenException('Organization access denied');
    }
    const membership = await tx.membership.findUnique({
      where: { id: candidate.id },
      include: { scopeLinks: { select: { establishmentId: true } }, user: { select: { status: true } }, organization: { select: { status: true } } },
    });
    if (!membership || membership.status !== 'ACTIVE' || membership.user.status !== 'ACTIVE' || membership.organization.status !== 'ACTIVE') {
      this.logTestDenial({
        branch: 'transaction-membership-inactive', role: membership?.role ?? null,
        membershipStatus: membership?.status ?? null, userStatus: membership?.user.status ?? null,
        organizationStatus: membership?.organization.status ?? null,
      });
      throw new ForbiddenException('Organization access denied');
    }
    const context: AuthorizationContext = {
      userId: principal.userId,
      sessionId: principal.sessionId,
      organizationId,
      membershipId: membership.id,
      role: membership.role,
      scopeMode: membership.scopeMode,
      establishmentIds: membership.scopeLinks.map((scope) => scope.establishmentId),
    };
    this.assertPermission(context, permission);
    const projection = await this.entitlements.resolve(organizationId, new Date(), tx);
    const module = projection.modules.find((candidateModule) => candidateModule.code === moduleCode);
    if (!module?.allowed) {
      this.logTestDenial({
        branch: 'transaction-module', role: context.role, permission, moduleCode,
        decision: module ? { allowed: module.allowed, reason: module.reason, entitled: module.entitled, active: module.active, source: module.source } : null,
        plan: projection.plan, subscription: projection.subscription,
      });
      throw new ForbiddenException('Module access denied');
    }
    return context;
  }

  async assertEstablishment(context: AuthorizationContext, establishmentId: string): Promise<void> {
    const establishment = await this.prisma.establishment.findFirst({ where: { id: establishmentId, organizationId: context.organizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!establishment || (context.scopeMode === 'SELECTED_ESTABLISHMENTS' && !context.establishmentIds.includes(establishmentId))) {
      this.logTestDenial({ branch: 'establishment-scope', role: context.role, scopeMode: context.scopeMode, establishmentActiveInOrganization: Boolean(establishment), scopeIncludesEstablishment: context.scopeMode === 'ALL_ESTABLISHMENTS' || context.establishmentIds.includes(establishmentId) });
      throw new ForbiddenException('Establishment access denied');
    }
  }

  private async logMembershipDenial(principal: AuthPrincipal, organizationId: string): Promise<void> {
    if (process.env.NODE_ENV !== 'test') return;
    try {
      const [organization, user, membership] = await Promise.all([
        this.prisma.organization.findUnique({ where: { id: organizationId }, select: { status: true } }),
        this.prisma.user.findUnique({ where: { id: principal.userId }, select: { status: true } }),
        this.prisma.membership.findUnique({
          where: { organizationId_userId: { organizationId, userId: principal.userId } },
          select: { status: true, role: true, scopeMode: true, organization: { select: { status: true } }, user: { select: { status: true } } },
        }),
      ]);
      this.logTestDenial({
        branch: 'membership', organizationStatus: organization?.status ?? null,
        userStatus: user?.status ?? null,
        membership: membership ? { status: membership.status, role: membership.role, scopeMode: membership.scopeMode, linkedOrganizationStatus: membership.organization.status, linkedUserStatus: membership.user.status } : null,
      });
    } catch {
      this.logTestDenial({ branch: 'membership', snapshotAvailable: false });
    }
  }

  private async moduleDenialSnapshot(organizationId: string): Promise<unknown> {
    try {
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          status: true,
          subscriptions: {
            orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
            take: 3,
            select: {
              status: true,
              startsAt: true,
              endsAt: true,
              planVersion: { select: { planCode: true, version: true, status: true } },
            },
          },
        },
      });
      return organization ?? { organization: null };
    } catch {
      return { available: false };
    }
  }

  private logTestDenial(details: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'test') console.error(`[authorization-test-diagnostic] ${JSON.stringify(details)}`);
  }
}

export type Permission =
  | 'organization:read'
  | 'organization:write'
  | 'establishments:read'
  | 'establishments:write'
  | 'memberships:write'
  | 'capabilities:read'
  | 'parties:read'
  | 'parties:write'
  | 'catalog:read'
  | 'catalog:write'
  | 'inventory:read'
  | 'inventory:write'
  | 'expenses:read'
  | 'expenses:write'
  | 'cash:read'
  | 'cash:write'
  | 'crm:read'
  | 'crm:write'
  | 'network:discovery:read'
  | 'network:connections:read'
  | 'network:connections:write'
  | 'network:inquiries:read'
  | 'network:inquiries:write'
  | 'network:profile:read'
  | 'network:profile:write'
  | 'network:trust:read'
  | 'sales:quotes:read'
  | 'sales:quotes:write'
  | 'sales:orders:read'
  | 'sales:orders:write'
  | 'sales:invoices:read'
  | 'sales:invoices:write'
  | 'sales:payments:read'
  | 'sales:payments:write'
  | 'purchases:rfqs:read'
  | 'purchases:rfqs:write'
  | 'purchases:orders:read'
  | 'purchases:orders:write'
  | 'purchases:receipts:read'
  | 'purchases:receipts:write'
  | 'projects:read'
  | 'projects:write'
  | 'documents:read'
  | 'documents:write'
  | 'billing:read'
  | 'billing:write'
  | 'intelligence:read'
  | 'messaging:read'
  | 'messaging:write'
  | 'messaging:participants:write'
  | 'messaging:block:write';

export const rolePermissions: Record<TenantRole, readonly Permission[]> = {
  OWNER: [
    'organization:read', 'organization:write', 'establishments:read', 'establishments:write', 'memberships:write', 'capabilities:read',
    'parties:read', 'parties:write', 'catalog:read', 'catalog:write', 'inventory:read', 'inventory:write',
    'expenses:read', 'expenses:write', 'cash:read', 'cash:write',
    'crm:read', 'crm:write', 'network:discovery:read', 'network:connections:read', 'network:connections:write',
    'network:inquiries:read', 'network:inquiries:write', 'network:profile:read', 'network:profile:write', 'network:trust:read',
    'sales:quotes:read', 'sales:quotes:write', 'sales:orders:read', 'sales:orders:write',
    'sales:invoices:read', 'sales:invoices:write', 'sales:payments:read', 'sales:payments:write',
    'purchases:rfqs:read', 'purchases:rfqs:write', 'purchases:orders:read', 'purchases:orders:write', 'purchases:receipts:read', 'purchases:receipts:write',
    'projects:read', 'projects:write', 'documents:read', 'documents:write', 'billing:read', 'billing:write', 'intelligence:read',
    'messaging:read', 'messaging:write', 'messaging:participants:write', 'messaging:block:write',
  ],
  ADMIN: [
    'organization:read', 'organization:write', 'establishments:read', 'establishments:write', 'memberships:write', 'capabilities:read',
    'parties:read', 'parties:write', 'catalog:read', 'catalog:write', 'inventory:read', 'inventory:write',
    'expenses:read', 'expenses:write', 'cash:read', 'cash:write',
    'crm:read', 'crm:write', 'network:discovery:read', 'network:connections:read', 'network:connections:write',
    'network:inquiries:read', 'network:inquiries:write', 'network:profile:read', 'network:profile:write', 'network:trust:read',
    'sales:quotes:read', 'sales:quotes:write', 'sales:orders:read', 'sales:orders:write',
    'sales:invoices:read', 'sales:invoices:write', 'sales:payments:read', 'sales:payments:write',
    'purchases:rfqs:read', 'purchases:rfqs:write', 'purchases:orders:read', 'purchases:orders:write', 'purchases:receipts:read', 'purchases:receipts:write',
    'projects:read', 'projects:write', 'documents:read', 'documents:write', 'billing:read', 'billing:write', 'intelligence:read',
    'messaging:read', 'messaging:write', 'messaging:participants:write', 'messaging:block:write',
  ],
  SALES: [
    'organization:read', 'establishments:read', 'capabilities:read', 'parties:read', 'parties:write', 'catalog:read', 'catalog:write',
    'crm:read', 'crm:write', 'network:discovery:read', 'network:connections:read', 'network:connections:write',
    'network:inquiries:read', 'network:inquiries:write', 'network:profile:read', 'network:trust:read',
    'sales:quotes:read', 'sales:quotes:write', 'sales:orders:read', 'sales:orders:write', 'sales:invoices:read', 'sales:payments:read',
    'projects:read', 'projects:write', 'documents:read', 'documents:write', 'billing:read', 'intelligence:read',
    'messaging:read', 'messaging:write',
  ],
  FINANCE: [
    'organization:read', 'establishments:read', 'capabilities:read', 'parties:read', 'catalog:read', 'inventory:read', 'crm:read',
    'expenses:read', 'expenses:write', 'cash:read', 'cash:write',
    'sales:quotes:read', 'sales:orders:read', 'sales:invoices:read', 'sales:invoices:write', 'sales:payments:read', 'sales:payments:write',
    'purchases:rfqs:read', 'purchases:orders:read', 'purchases:receipts:read',
    'projects:read', 'documents:read', 'billing:read', 'billing:write', 'intelligence:read', 'messaging:read',
  ],
  OPERATIONS: [
    'organization:read', 'establishments:read', 'capabilities:read', 'parties:read', 'parties:write', 'catalog:read', 'catalog:write', 'inventory:read', 'inventory:write',
    'expenses:read', 'expenses:write', 'cash:read',
    'crm:read', 'network:discovery:read', 'network:connections:read', 'network:connections:write', 'network:inquiries:read', 'network:inquiries:write',
    'sales:quotes:read', 'sales:orders:read', 'sales:orders:write', 'sales:invoices:read', 'sales:payments:read',
    'purchases:rfqs:read', 'purchases:rfqs:write', 'purchases:orders:read', 'purchases:orders:write', 'purchases:receipts:read', 'purchases:receipts:write',
    'projects:read', 'projects:write', 'documents:read', 'documents:write', 'intelligence:read',
    'messaging:read', 'messaging:write',
  ],
  VIEWER: [
    'organization:read', 'establishments:read', 'capabilities:read', 'parties:read', 'catalog:read', 'inventory:read', 'expenses:read', 'cash:read', 'crm:read',
    'network:discovery:read', 'network:connections:read', 'network:inquiries:read',
    'sales:quotes:read', 'sales:orders:read', 'sales:invoices:read', 'sales:payments:read',
    'purchases:rfqs:read', 'purchases:orders:read', 'purchases:receipts:read',
    'projects:read', 'documents:read', 'intelligence:read', 'messaging:read',
  ],
};
