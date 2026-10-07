# 56 — Phase 1 Identity & Tenancy Status

## Current state

Phase 1 implementation is active on `feat/phase-1-identity-tenancy` and is intentionally delivered through a pull request. The completed implementation slice contains the identity, tenancy, establishment, membership, invitation, scope, audit, and client-critical capability foundations.

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
- `npm run build`: required before PR merge;
- `npm run openapi:validate`: 85 operations valid;
- migrations and seed verified from an empty PostgreSQL database.

## Explicit boundary

The capabilities endpoint currently exposes the identity/tenancy projection and an empty commercial-module list. Plans, module catalog, subscriptions, entitlements, quotas, and module activation remain the Phase 2 Control Plane work; they must be implemented before any commercial endpoint treats `modules` as authoritative.

Before Phase 1 is closed, the remaining delivery gate is contract-level RFC 9457 response verification plus CI/PR review and merge evidence.
