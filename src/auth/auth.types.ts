import type { TenantRole, ScopeMode } from '@prisma/client';
import type { ProductCode } from '../products/product-code.js';

export interface AuthPrincipal {
  userId: string;
  sessionId: string;
}

/** Authentication proves an internal user session; it does not assign a business actor category. */
export interface VerifiedUserPrincipal extends AuthPrincipal {
  identityType: 'INTERNAL_USER';
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
/** STAFF is assigned only after active membership has been resolved server-side. */
export interface StaffAuthorizationContext extends AuthorizationContext {
  actorType: 'STAFF';
  authorizationProvenance: { kind: 'ACTIVE_TENANT_MEMBERSHIP'; membershipId: string };
}

export interface PlatformActorPrincipal extends AuthPrincipal {
  actorType: 'PLATFORM';
  authorizationProvenance: { kind: 'SERVER_CONFIGURED_PLATFORM_ADMIN' };
}

export interface ProductAuthorizationContext extends StaffAuthorizationContext {
  productCode: ProductCode;
}
