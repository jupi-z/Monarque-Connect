# Phase 1 Closure Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close every verified Phase 1 gap so the implementation, tests, contracts, bootstrap, documentation, and repository governance meet the strict completion gate.

**Architecture:** Keep authorization centralized, add establishment-detail operations through the existing organization service, and make the active establishment an explicit request-scoped capability rather than weakening tenant checks. Extend real PostgreSQL/HTTP tests before production changes; update only repository documentation in the same branch.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Vitest, Supertest, OpenAPI YAML, GitHub Actions.

**Spec:** `Docs/54_PHASE1_IDENTITY_TENANCY_EXECUTION_SPEC.md`

## Global Constraints

- Cross-tenant and out-of-scope establishment access is denied by default.
- Membership, role, scope, user, and organization status are revalidated for every private action.
- Sensitive mutations are audited and produce transactional domain events.
- OpenAPI must match implemented handlers and client-critical response schemas.
- No generated/runtime or local progress artifacts are committed.

## Review Focus

- A selected-scope member cannot read or mutate another establishment.
- A non-admin role cannot perform organization or membership writes.
- Logout revokes the session and leaves an auditable transactional record.
- A fresh clone can generate Prisma and seed deterministically from documented commands.
- OpenAPI operations have corresponding handlers and executable contract coverage.

### Task 1: Establishment operations and scope enforcement

**Files:**
- Modify: `src/tenancy/organization.controller.ts`
- Modify: `src/tenancy/organization.service.ts`
- Modify: `openapi/openapi.yaml`
- Test: `tests/e2e/phase1-http.e2e.test.ts`

- [x] Write failing HTTP tests for establishment detail read/update and selected-scope denial.
- [x] Run the focused tests and observe the expected missing-route/authorization failure.
- [x] Implement minimal scoped get/update handlers with audit and outbox behavior.
- [x] Update response/request schemas and security/error responses.
- [x] Run focused tests and the full suite.
- [x] Commit the task.

### Task 2: RBAC matrix and active establishment contract

**Files:**
- Modify: `src/auth/auth.types.ts`
- Modify: `src/auth/auth.guard.ts`
- Modify: `src/tenancy/organization.controller.ts`
- Modify: `src/tenancy/organization.service.ts`
- Modify: `openapi/openapi.yaml`
- Test: `tests/e2e/phase1-http.e2e.test.ts`
- Test: `tests/tenancy/identity-tenancy.integration.test.ts`

- [x] Write tests for role-positive/negative writes and explicit active-establishment selection.
- [x] Run them and observe the pre-fix route/authorization failures.
- [x] Implement the smallest request contract for active establishment and enforce it through existing scope checks.
- [x] Document the behavior in OpenAPI and status/spec notes.
- [x] Run focused and full tests.
- [x] Commit the task.

### Task 3: Logout audit and bootstrap reliability

**Files:**
- Modify: `src/auth/auth.service.ts`
- Modify: `package.json`
- Modify: `.github/workflows/backend-ci.yml`
- Test: `tests/e2e/phase1-http.e2e.test.ts`
- Test: `tests/auth/identity.test.ts`

- [x] Write failing logout audit/event and clean-bootstrap tests.
- [x] Run them and observe failure.
- [x] Implement transactional logout recording and make seed invoke Prisma generation safely.
- [x] Run focused and full tests.
- [x] Commit the task.

### Task 4: Closure evidence and governance documentation

**Files:**
- Modify: `Docs/56_PHASE_1_STATUS.md`
- Modify: `Docs/superpowers/plans/2026-10-08-phase-1-identity-tenancy-implementation.md`
- Modify: `Docs/54_PHASE1_IDENTITY_TENANCY_EXECUTION_SPEC.md`
- Modify: `README.md`

- [x] Update evidence with exact commands and completion state.
- [x] Record any intentionally deferred Phase 2 boundary without weakening Phase 1 gates.
- [x] Validate docs, OpenAPI, migrations, full tests, and git cleanliness.
- [x] Commit the task.

### Task 5: Delivery gate

- [x] Review the complete branch diff and requirements checklist.
- [x] Run the complete verification suite from a clean worktree state.
- [x] Open a pull request, obtain CI/review, squash merge, delete the feature branch/worktree, and verify only useful branches remain.
