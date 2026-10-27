import type { TenantRole, ScopeMode } from '@prisma/client';
import type { ProductCode } from '../products/product-code.js';

export interface AuthPrincipal {
  userId: string;
  sessionId: string;
}

/** Server-derived actor identity; request DTO fields never produce this value. */
export interface StaffActorPrincipal extends AuthPrincipal {
  actorType: 'STAFF';
  provenance: { kind: 'LEGACY_SESSION' };
}

export interface AuthorizationContext extends AuthPrincipal {
  organizationId: string;
  membershipId: string;
  role: TenantRole;
  scopeMode: ScopeMode;
  establishmentIds: readonly string[];
}

/** Product is attached only after the server resolves membership and entitlement. */
export interface ProductAuthorizationContext extends AuthorizationContext {
  productCode: ProductCode;
}
