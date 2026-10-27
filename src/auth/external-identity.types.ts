/**
 * Internal verifier output only. No HTTP DTO may construct this from client claims.
 * C2 persists and consumes this proof but does not ship an OIDC verifier or endpoint.
 */
export interface VerifiedExternalIdentityProof {
  readonly challengeId: string;
  readonly state: string;
  readonly nonce: string;
  readonly issuer: string;
  readonly subject: string;
  readonly verifiedAt: Date;
}

export interface ExternalIdentityLinkIntent {
  readonly challengeId: string;
  readonly state: string;
  readonly nonce: string;
  readonly expiresAt: Date;
}
