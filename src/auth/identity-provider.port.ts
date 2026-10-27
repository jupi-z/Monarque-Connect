/**
 * Contract for a future trusted OIDC adapter. No provider is registered in C2,
 * so this port cannot authenticate requests or affect application startup.
 */
export const IDENTITY_PROVIDER_PORT = Symbol('IDENTITY_PROVIDER_PORT');

export interface OidcIdentityTokenRequest {
  readonly idToken: string;
  readonly expectedIssuer: string;
  readonly expectedClientId: string;
  readonly expectedNonce: string;
  readonly now?: Date;
}

/** Minimal verified output. Raw claims, email and tokens must not cross the port. */
export interface VerifiedOidcIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly audience: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly verifiedAt: Date;
  readonly algorithm: string;
  readonly nonceValidated: true;
}

/**
 * Implementations must verify signature/JWKS rotation, an allowlisted algorithm,
 * exact issuer, audience, exp/nbf/iat and nonce before returning an assertion.
 * Consumers must still resolve issuer+subject to an internal User id and must
 * never infer tenant roles or permissions from OIDC claims.
 */
export interface IdentityProviderPort {
  verifyIdentityToken(input: OidcIdentityTokenRequest): Promise<VerifiedOidcIdentity>;
}
