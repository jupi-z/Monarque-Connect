import type { TenantRole, ScopeMode } from '@prisma/client';

export interface AuthPrincipal {
  userId: string;
  sessionId: string;
}

export interface AuthorizationContext extends AuthPrincipal {
  organizationId: string;
  membershipId: string;
  role: TenantRole;
  scopeMode: ScopeMode;
  establishmentIds: readonly string[];
}
