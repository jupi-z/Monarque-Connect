# 56 — Phase 1 Identity & Tenancy Status

## Current state

Phase 1 implementation slice is merged on `main` through PR #22 (`c2e5e383`). The feature branch and its worktree have been removed after merge. The delivered slice contains the identity, tenancy, establishment, membership, invitation, scope, audit, and client-critical capability foundations.

## Delivered

- Prisma transaction boundary and migrations from an empty PostgreSQL database;
- users, Argon2id passwords, asymmetric JWT access tokens, opaque rotating refresh sessions and replay-family revocation;
- persistent login rate limiting, logout, current-user and password-change session revocation;
- business types with idempotent seed data;
- atomic organization + primary establishment + owner membership creation;
- organization and establishment reads/writes with active-user, active-membership, role and establishment-scope checks;
- membership listing/update, invitation creation/acceptance, hashed single-use invitation tokens and last-owner protection;
- append-only audit rows and transactional identity/tenancy domain events;
- detailed OpenAPI schemas for register/login/refresh/me/organizations/establishments/capabilities/memberships/invitations;
- real PostgreSQL integration tests and HTTP E2E coverage proving the canonical client flow and cross-tenant denial.

## Verification snapshot

- `npm test`: 18 files, 48 tests passing;
- `npm run lint`: passing;
- `npm run typecheck`: passing;
- `npm run build`: passing locally and in GitHub Actions;
- `npm run openapi:validate`: 85 operations valid;
- migrations and seed verified from an empty PostgreSQL database.

## Explicit boundary

The capabilities endpoint currently exposes the identity/tenancy projection and an empty commercial-module list. Plans, module catalog, subscriptions, entitlements, quotas, and module activation remain the Phase 2 Control Plane work; they must be implemented before any commercial endpoint treats `modules` as authoritative.

The Phase 1 implementation slice is closed after contract-level RFC 9457 response verification, green CI, PR review gate, squash merge, and branch cleanup. Commercial module catalog, plans, entitlements, quotas and activations remain the explicitly documented Phase 2 boundary.
