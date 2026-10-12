import { Injectable, ForbiddenException } from '@nestjs/common';
import { type TenantRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthPrincipal, AuthorizationContext } from '../auth/auth.types.js';

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

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
  | 'inventory:write';

export const rolePermissions: Record<TenantRole, readonly Permission[]> = {
  OWNER: ['organization:read', 'organization:write', 'establishments:read', 'establishments:write', 'memberships:write', 'capabilities:read', 'parties:read', 'parties:write', 'catalog:read', 'catalog:write', 'inventory:read', 'inventory:write'],
  ADMIN: ['organization:read', 'organization:write', 'establishments:read', 'establishments:write', 'memberships:write', 'capabilities:read', 'parties:read', 'parties:write', 'catalog:read', 'catalog:write', 'inventory:read', 'inventory:write'],
  SALES: ['organization:read', 'establishments:read', 'capabilities:read', 'parties:read', 'parties:write', 'catalog:read', 'catalog:write', 'inventory:read'],
  FINANCE: ['organization:read', 'establishments:read', 'capabilities:read', 'parties:read', 'catalog:read', 'inventory:read'],
  OPERATIONS: ['organization:read', 'establishments:read', 'capabilities:read', 'parties:read', 'parties:write', 'catalog:read', 'catalog:write', 'inventory:read', 'inventory:write'],
  VIEWER: ['organization:read', 'establishments:read', 'capabilities:read', 'parties:read', 'catalog:read', 'inventory:read'],
};
