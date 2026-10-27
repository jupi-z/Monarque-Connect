/** Ephemeral proof that a password was verified for one active legacy session. */
export class PasswordReauthenticationProof {
  readonly userId: string;
  readonly sessionId: string;
  readonly verifiedAt: Date;
  readonly #passwordVerifierSnapshot: string;

  private constructor(input: { userId: string; sessionId: string; passwordVerifierSnapshot: string; verifiedAt: Date }) {
    this.userId = input.userId;
    this.sessionId = input.sessionId;
    this.#passwordVerifierSnapshot = input.passwordVerifierSnapshot;
    this.verifiedAt = new Date(input.verifiedAt);
    Object.freeze(this);
  }

  static issue(input: { userId: string; sessionId: string; passwordVerifierSnapshot: string; verifiedAt: Date }): PasswordReauthenticationProof {
    return new PasswordReauthenticationProof(input);
  }

  matchesPasswordVerifier(candidate: string): boolean {
    return this.#passwordVerifierSnapshot === candidate;
  }
}
