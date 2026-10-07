# Phase 1 Identity & Tenancy — Implementation Plan

> **Execution rule:** use `superpowers:executing-plans` and `superpowers:test-driven-development` for implementation slices. Work only from the feature worktree, commit each coherent slice, and integrate through a pull request.

## 0. Baseline and test determinism

- [x] Create isolated worktree and feature branch.
- [x] Read Phase 1 specification, schema, auth, tenancy, authorization, API, test, and DoD documents.
- [ ] Make the PostgreSQL integration suite deterministic when all files run together; retain the explicit test-database guard.
- [ ] Re-run the pre-Phase-1 baseline and record the result.

## 1. Database and transaction foundation

- [ ] Add Prisma client/database module with lifecycle management and typed transaction access.
- [ ] Add identity/tenancy schema and migration with composite integrity constraints and primary-establishment uniqueness.
- [ ] Add idempotent reference-data seed command for business types and role/scope metadata.
- [ ] Add audit-event persistence and event payload builders with secret-field protection.
- [ ] Prove empty-database migration, rollback atomicity, and tenant/establishment referential integrity.

## 2. Identity and sessions

- [ ] Add Argon2id password service and normalized identifiers.
- [ ] Add asymmetric JWT key configuration with `kid`, issuer, audience, short access TTL, and no secret fallback.
- [ ] Add registration, login, current-user, refresh rotation, logout, password-change/session revocation primitives.
- [ ] Add replay/family revocation tests and login error/rate-limit behavior without user enumeration.

## 3. Organizations and establishments

- [ ] Add organization creation with atomic primary establishment and owner membership.
- [ ] Add organization/establishment reads and writes protected by authorization context.
- [ ] Add membership status and organization status checks on every private request.
- [ ] Add cross-tenant and cross-establishment HTTP tests.

## 4. Memberships, invitations, and authorization

- [ ] Add roles, deny-by-default permission policy, active membership resolution, and establishment scope intersection.
- [ ] Add opaque single-use invitation creation/acceptance with hashed tokens and expiry.
- [ ] Add membership scope management and last-owner protection.
- [ ] Add authorization matrix tests for positive and negative cases.

## 5. Capabilities and contract completion

- [ ] Add effective capabilities projection, preserving the separation between capability display and enforcement.
- [ ] Detail OpenAPI schemas, examples, errors, and security requirements for the client-critical flow.
- [ ] Add contract tests and request-id/problem-details behavior.

## 6. Delivery and closure

- [ ] Run migrations from an empty PostgreSQL database and upgrade path.
- [ ] Run lint, typecheck, build, unit, integration, contract, and HTTP E2E suites.
- [ ] Update Phase 1 status/tracker documentation and issue evidence.
- [ ] Open PR, obtain review/CI, squash merge, delete feature branch and worktree, and verify only useful branches remain.
