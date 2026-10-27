# C2 Identity & Tenant Principals Implementation Plan

> **For agentic workers:** Execute the four C2 lots in order. Each lot ends in a dedicated PR and requires GitHub-hosted CI on the exact head SHA and post-merge `main` before continuing.

**Goal:** Add a safe external identity registry and explicit actor context while preserving every legacy user ID, session, membership, permission, and product boundary.

**Architecture:** Keep NestJS/Prisma/PostgreSQL as the only Core. Keep authentication facts separate from actor categories and authorization decisions. Add an internal identity-provider port and an additive immutable-owner external identity registry; do not deploy or require an OIDC provider in C2.

**Tech Stack:** NestJS 12, TypeScript, Prisma 7, PostgreSQL, Vitest, GitHub Actions hosted runners.

**Spec:** `Docs/119_C2_IDENTITY_TENANCY_CONTRACT.md`

## Global Constraints

- Preserve `User.id`, `AuthPrincipal`, JWT `sub/sid`, refresh sessions, memberships, legacy APIs and C1 product-scoped entitlements.
- Never link or merge users by email.
- Never trust client-supplied actor, tenant, establishment, product, role, or channel claims.
- Do not introduce a provider runtime, login endpoint, buyer application, agent runtime, C3–C8, ZAMUREK application, PSP or production integration.
- Every migration is additive, replay-safe, compatible with supported historical states, and CI-verified before merge.
- Do not run heavy local tests, Docker, migrations or builds on the workstation; use GitHub-hosted CI.

## Review Focus

- Revoked `(issuer, subject)` reclaimed by a different internal user: prove permanent ownership conflict in PostgreSQL.
- Same external email as an existing account: prove no implicit lookup or account merge.
- Client forges actor or `productCode`: prove the authenticated server principal and C1 resolver govern access.
- Legacy refresh session during new identity rollout: prove session/token behavior stays unchanged.
- Two concurrent link requests: prove one association, one audit/outbox transition, and deterministic conflict/idempotency.

---

### Task 1: C2.1 Normative contracts and compatibility baseline

**Files:**
- Create: `Docs/119_C2_IDENTITY_TENANCY_CONTRACT.md`
- Create: `Docs/superpowers/plans/2026-10-28-c2-identity-tenancy.md`
- Modify: `Docs/105_PHASE_10A5_CONVERGENCE_EXECUTION_SPEC.md`, `Docs/108_PHASE_10A5_PROGRESS_PLAN.md`, `Docs/114_PHASE_10A5_BOUNDARY_INVARIANTS.md`, `Docs/115_PHASE_10A5_C0_CODEBASE_AUDIT.md`
- Create/update: GitHub issue #163
- Modify: `README.md`, `Docs/21_EXECUTION_ROADMAP.md`

**Interfaces:**
- Consumes: `AuthPrincipal { userId: string; sessionId: string }`, `AuthorizationContext`, C1 `resolveEffectiveForProduct(organizationId, productCode, at?)`, `PlatformAuthorizationService`.
- Produces: normative principal provenance, identity-link lifecycle, SQL uniqueness/revocation policy, compatibility and test matrix for C2.2–C2.4.

- [x] Verify current `main`, C1 merges, CI #540, migrations and absence of open competing Monarque Connect PRs.
- [x] Synchronize phase documents and issue tracker; record `OIDC_RUNTIME = NOT_CONFIGURED / NOT_RUN`.
- [x] Review document contradictions and verify the linked document diff without running local validation workloads.

### Task 2: C2.2 Contract first, then additive external identity registry

**Files:**
- Modify: `prisma/schema.prisma` (new `ExternalIdentity`, `ExternalIdentityLinkChallenge` models and status enum)
- Create: `prisma/migrations/<timestamp>_c2_external_identity_registry/migration.sql`
- Create: `src/auth/external-identity.repository.ts`, `src/auth/external-identity.service.ts`
- Modify: `src/auth/auth.module.ts`
- Modify: `src/auth/auth.service.ts` only to expose server-side current-password reauthentication used by identity operations
- Create: `tests/auth/external-identity.service.test.ts`, `tests/auth/external-identity.integration.test.ts`
- Modify: `Docs/120_C2_EXECUTION_STATUS.md`

Before schema or migration changes, merge a short contract-only PR specifying exact SQL types, bounds, uniqueness, foreign-key deletion semantics, immutability, challenge replay, and transaction behavior. Then implement in a dedicated code PR, with PostgreSQL regression tests written first and CI run on GitHub-hosted runners.

**Interfaces:**
- Consumes: internal-only verified proof `{ linkRequestId, issuer, subject, verifiedAt }`, the authenticated `AuthPrincipal`, and a server-produced recent-reauthentication proof. Challenge state/nonce are random and stored only as hashes, expire quickly, and bind the legacy session.
- Produces: `linkVerifiedIdentity(userId, proof)`, `revokeIdentity(userId, identityId, reauthProof)`, and `resolveActiveIdentity(issuer, subject)`; these methods are internal services, not public HTTP endpoints in this lot.

- [ ] Write PostgreSQL tests for unique pair, permanent owner after revocation, same-owner reactivation, one-time challenge consumption and foreign-key preservation.
- [ ] Additive migration: unique `(issuer, subject)` across all states, challenge state/nonce hash uniqueness, `ON DELETE RESTRICT`; 10-minute challenge expiry; no user or session backfill.
- [ ] Implement transactional link/reactivate/revoke with audit and minimized Outbox in the same transaction; raw tokens and subject are excluded from generic audit/event payloads.
- [ ] Prove concurrent requests and idempotent identical replay; divergent owner/payload fails without partial writes.
- [ ] Run hosted migration proofs from empty DB and supported historical DB, then merge only after PR CI; verify post-merge CI.

### Task 3: C2.3 Principal context and provider boundary

**Files:**
- Create: `src/auth/principal.types.ts`, `src/auth/identity-provider.port.ts`
- Modify: `src/auth/auth.types.ts`, `src/auth/auth.guard.ts`, `src/auth/auth.decorators.ts` only additively
- Modify: `src/tenancy/authorization.service.ts` only where the typed context reduces ambiguity without changing legacy decisions
- Create: `tests/auth/principal-context.test.ts`, `tests/tenancy/principal-authorization.integration.test.ts`

**Interfaces:**
- Consumes: unchanged legacy `AuthPrincipal`, C2.2 identity service, existing membership/permission/scope and product resolver.
- Produces: a discriminated actor context for `STAFF | BUYER | AGENT | PLATFORM`, plus provenance separating `LEGACY_SESSION` from a future `OIDC_VERIFIED` proof.

- [ ] Classify existing routes without changing their authorization: organization-scoped staff routes resolve STAFF from server-side membership; unscoped auth/session and explicit platform routes retain their established policies.
- [ ] Keep BUYER and AGENT types non-authorizing until dedicated authenticators/resources exist; reject forged client category fields.
- [ ] Keep PLATFORM derived from the existing explicit platform authorization service and audit every platform action.
- [ ] Verify legacy endpoint JSON, JWT claims, refresh behavior, C1 product resolution and all tenant/establishment refusals.
- [ ] Do not register an OIDC HTTP route or fetch remote keys in this lot; the port stays unbound unless a complete provider is implemented in a separately approved change.

### Task 4: C2.4 Security hardening and closure

**Files:**
- Modify: relevant auth/tenancy integration and E2E tests
- Modify: `Docs/105` through `Docs/120` where C2 progress/evidence is recorded
- Modify: `Docs/21_EXECUTION_ROADMAP.md`
- Create: final C2 closure evidence document

- [ ] Run the complete hosted unit, PostgreSQL, E2E, Prisma, migration, OpenAPI, contract, lint, typecheck, build, smoke and security validations applicable to the touched code.
- [ ] Verify exact SHA and all PR/post-merge CI runs; close issue #163 only after all C2 gates pass.
- [ ] Record external limits and leave Monarque Auth runtime, buyer application, agent runtime and future lots accurately `PLANNED/NOT_RUN`.
- [ ] Stop after C2; do not start C3 or any later phase.
