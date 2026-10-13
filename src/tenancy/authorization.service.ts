import { Injectable, ForbiddenException } from '@nestjs/common';
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
    if (!membership) throw new ForbiddenException('Organization access denied');
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
    if (!this.can(context, permission)) throw new ForbiddenException('Permission denied');
  }

  async requireModule(principal: AuthPrincipal, organizationId: string, moduleCode: string, permission: Permission): Promise<AuthorizationContext> {
    const context = await this.requireMembership(principal, organizationId);
    this.assertPermission(context, permission);
    const module = (await this.entitlements.resolve(organizationId)).modules.find((candidate) => candidate.code === moduleCode);
    if (!module?.allowed) throw new ForbiddenException('Module access denied');
    return context;
  }

  async assertEstablishment(context: AuthorizationContext, establishmentId: string): Promise<void> {
    const establishment = await this.prisma.establishment.findFirst({ where: { id: establishmentId, organizationId: context.organizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!establishment || (context.scopeMode === 'SELECTED_ESTABLISHMENTS' && !context.establishmentIds.includes(establishmentId))) {
      throw new ForbiddenException('Establishment access denied');
    }
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
  | 'purchases:receipts:write';

export const rolePermissions: Record<TenantRole, readonly Permission[]> = {
  OWNER: [
    'organization:read', 'organization:write', 'establishments:read', 'establishments:write', 'memberships:write', 'capabilities:read',
    'parties:read', 'parties:write', 'catalog:read', 'catalog:write', 'inventory:read', 'inventory:write',
    'crm:read', 'crm:write', 'network:discovery:read', 'network:connections:read', 'network:connections:write',
    'network:inquiries:read', 'network:inquiries:write', 'network:profile:read', 'network:profile:write', 'network:trust:read',
    'sales:quotes:read', 'sales:quotes:write', 'sales:orders:read', 'sales:orders:write',
    'sales:invoices:read', 'sales:invoices:write', 'sales:payments:read', 'sales:payments:write',
    'purchases:rfqs:read', 'purchases:rfqs:write', 'purchases:orders:read', 'purchases:orders:write', 'purchases:receipts:read', 'purchases:receipts:write',
  ],
  ADMIN: [
    'organization:read', 'organization:write', 'establishments:read', 'establishments:write', 'memberships:write', 'capabilities:read',
    'parties:read', 'parties:write', 'catalog:read', 'catalog:write', 'inventory:read', 'inventory:write',
    'crm:read', 'crm:write', 'network:discovery:read', 'network:connections:read', 'network:connections:write',
    'network:inquiries:read', 'network:inquiries:write', 'network:profile:read', 'network:profile:write', 'network:trust:read',
    'sales:quotes:read', 'sales:quotes:write', 'sales:orders:read', 'sales:orders:write',
    'sales:invoices:read', 'sales:invoices:write', 'sales:payments:read', 'sales:payments:write',
    'purchases:rfqs:read', 'purchases:rfqs:write', 'purchases:orders:read', 'purchases:orders:write', 'purchases:receipts:read', 'purchases:receipts:write',
  ],
  SALES: [
    'organization:read', 'establishments:read', 'capabilities:read', 'parties:read', 'parties:write', 'catalog:read', 'catalog:write', 'inventory:read',
    'crm:read', 'crm:write', 'network:discovery:read', 'network:connections:read', 'network:connections:write',
    'network:inquiries:read', 'network:inquiries:write', 'network:profile:read', 'network:trust:read',
    'sales:quotes:read', 'sales:quotes:write', 'sales:orders:read', 'sales:orders:write', 'sales:invoices:read', 'sales:payments:read',
  ],
  FINANCE: [
    'organization:read', 'establishments:read', 'capabilities:read', 'parties:read', 'catalog:read', 'inventory:read', 'crm:read',
    'sales:quotes:read', 'sales:orders:read', 'sales:invoices:read', 'sales:invoices:write', 'sales:payments:read', 'sales:payments:write',
    'purchases:rfqs:read', 'purchases:orders:read', 'purchases:receipts:read',
  ],
  OPERATIONS: [
    'organization:read', 'establishments:read', 'capabilities:read', 'parties:read', 'parties:write', 'catalog:read', 'catalog:write', 'inventory:read', 'inventory:write',
    'crm:read', 'network:discovery:read', 'network:connections:read', 'network:connections:write', 'network:inquiries:read', 'network:inquiries:write',
    'sales:quotes:read', 'sales:orders:read', 'sales:orders:write', 'sales:invoices:read', 'sales:payments:read',
    'purchases:rfqs:read', 'purchases:rfqs:write', 'purchases:orders:read', 'purchases:orders:write', 'purchases:receipts:read', 'purchases:receipts:write',
  ],
  VIEWER: [
    'organization:read', 'establishments:read', 'capabilities:read', 'parties:read', 'catalog:read', 'inventory:read', 'crm:read',
    'network:discovery:read', 'network:connections:read', 'network:inquiries:read',
    'sales:quotes:read', 'sales:orders:read', 'sales:invoices:read', 'sales:payments:read',
    'purchases:rfqs:read', 'purchases:orders:read', 'purchases:receipts:read',
  ],
};
