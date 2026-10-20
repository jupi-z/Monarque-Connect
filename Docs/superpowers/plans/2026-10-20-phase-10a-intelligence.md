# Phase 10A Deterministic Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver tenant-scoped deterministic KPI projections, explainable alerts, and read-only dashboard APIs without changing source-domain facts.

**Architecture:** A versioned server registry owns metric definitions and source authorization. Existing Event Fabric events trigger idempotent PostgreSQL recomputation from canonical source tables; an internal rebuild path repairs missed events. Read APIs query projections only after entitlement, module, permission, and establishment-scope checks.

**Tech Stack:** NestJS, TypeScript, Prisma, PostgreSQL, OpenAPI, Vitest, existing Event Fabric and Outbox.

**Spec:** `Docs/101_PHASE_10A_INTELLIGENCE_EXECUTION_SPEC.md`

## Global Constraints

- Keep source business tables authoritative; snapshots and alerts are disposable projections.
- Require `INTELLIGENCE_BASIC`, active source modules, `intelligence:read`, source permissions, and tenant/establishment scope on every read.
- Never aggregate across currencies, tenants, or incompatible inventory units; serialize exact decimals as strings.
- Keep source mutation, its versioned Outbox event, and event receipt/projection writes transactionally consistent where applicable.
- Add no broker, external analytics store, AI provider, frontend, or schema changes to prior business invariants.
- Every delivery tranche uses a dedicated branch and PR; no direct push to `main`; merge only after required GitHub checks pass.

## Review Focus

- Reversal and out-of-order payment records: assert signed period flow and current receivable reconciliation in Task 5.
- `NULL` scope/currency/time dimensions: assert duplicate snapshot keys are rejected in PostgreSQL in Task 3.
- Different permissions across requested metrics: assert forbidden metrics are omitted or denied without leaking source rows in Tasks 4 and 7.
- Establishment filter and cursor reuse across tenants/scopes: assert no widening or cross-context continuation in Task 7.
- Delayed/duplicated events and rebuild racing a newer projection: assert convergence and monotonic `sourceAsOf` in Task 6.

---

## File Map

- `src/intelligence/metric-registry.ts`: immutable KPI/rule definitions, source modules, permissions, and activity/current-state classification.
- `src/intelligence/metric-calculator.service.ts`: deterministic source queries and exact value serialization.
- `src/intelligence/intelligence-projection.service.ts`: transactional upsert/rebuild and alert transitions.
- `src/intelligence/intelligence.consumer.ts`: Event Fabric consumer; only maps event references to bounded recomputation requests.
- `src/intelligence/intelligence.service.ts`, `intelligence.controller.ts`, `intelligence.dto.ts`, `intelligence.module.ts`: authorized query orchestration and HTTP contract.
- `src/tenancy/authorization.service.ts`: centrally typed `intelligence:read` permission and role grants consistent with `Docs/07`.
- `src/events/event.module.ts` and source-domain services: register consumer and add only missing versioned events transactionally.
- `prisma/schema.prisma` and `prisma/migrations/*`: additive snapshots, alerts, constraints, indexes, and tenant-safe relations.
- `tests/unit/intelligence/*`, `tests/integration/intelligence/*`, `tests/e2e/intelligence.e2e-spec.ts`, `tests/contracts/phase10a-intelligence.contract.test.ts`: calculation, PostgreSQL, HTTP security, and OpenAPI gates.
- `Docs/21_EXECUTION_ROADMAP.md`, `Docs/93_FAIRSCALE_PHASES_STATUS.md`, `Docs/100_PHASE_9_6_CORRECTIVE_STABILIZATION_EVIDENCE.md`, `Docs/102_PHASE_10A_STATUS.md`: phase and FairScale state kept accurate; external commercial gates remain separate.

## Task 1: Freeze Phase 10A contract and project tracking

**Files:** `Docs/101_PHASE_10A_INTELLIGENCE_EXECUTION_SPEC.md`, `Docs/21_EXECUTION_ROADMAP.md`, `Docs/93_FAIRSCALE_PHASES_STATUS.md`, `Docs/100_PHASE_9_6_CORRECTIVE_STABILIZATION_EVIDENCE.md`, `Docs/102_PHASE_10A_STATUS.md`, `README.md`, `Docs/00_README.md`.

**Interfaces:** spec defines the route and metric vocabulary; status document links the GitHub Phase 10A issue and records gates without claiming delivery. No runtime code.

- [ ] Correct the FairScale technical state using verified PR #140 merge and post-merge CI evidence; keep live-payment/compliance gates open.
- [ ] Add Phase 10A issue and tracker references; record baseline `26cf9c5e71d83674c2c8954f7c3eda00874293ea`.
- [ ] Verify no contract decision remains implicit: source fields, nullable uniqueness, current-state versus period metrics, error semantics, and permission mapping.
- [ ] Run `npm run lint`/the repository's documentation checks if configured, inspect `git diff --check`, open a PR, and merge only after GitHub checks succeed.

## Task 2: Freeze OpenAPI and permission contract (no migration)

**Files:** `src/intelligence/intelligence.dto.ts`, `src/intelligence/intelligence.controller.ts`, `src/intelligence/intelligence.module.ts`, `src/app.module.ts`, `src/tenancy/authorization.service.ts`, OpenAPI contract tests.

**Interfaces:** `GET /dashboard`, `/metrics`, `/alerts`, `/alerts/{alertId}` under the spec base path. DTOs validate UTC ranges, max 366-day activity windows, known metric codes, page size <= 100, and opaque scope-bound cursors. Source permissions come from `MetricDefinition.requiredPermissions`.

- [ ] Add contract tests for route paths, query schemas, response decimal strings, `ACTIVITY`/`CURRENT_STATE`, errors, and pagination bounds; confirm they fail before implementation.
- [ ] Add `intelligence:read` to the central permission union and the exact role grants in the authorization matrix.
- [ ] Implement controller/DTO/module skeleton with guards and OpenAPI annotations; do not add Prisma models or migrations in this task.
- [ ] Run contract tests and OpenAPI validation; publish a dedicated PR and require GitHub CI before merge.

## Task 3: Add projection schema and migration proofs

**Files:** `prisma/schema.prisma`, generated migration, migration proof scripts and PostgreSQL integration tests.

**Interfaces:** `MetricSnapshot` key is `(organizationId, scopeKey, metricCode, definitionVersion, dimensionKey, currencyKey, temporalKey)` with separate partial unique indexes for period and instant rows; `InsightAlert` uses a partial unique index for open `(organizationId, dedupeKey)`.

- [ ] Write PostgreSQL tests for tenant-composite FKs, exactly-one temporal mode, `periodStart < periodEnd`, both partial unique keys, `currencyKey = NONE`, and open-alert dedupe.
- [ ] Add Prisma models and an additive SQL migration; include raw PostgreSQL indexes/checks Prisma cannot represent.
- [ ] Verify `prisma validate`, migration from an empty DB, and upgrade from the Phase 9.6 baseline; confirm no source tables are rewritten.
- [ ] Publish a focused schema PR and wait for required checks before merge.

## Task 4: Implement the versioned registry and deterministic calculators

**Files:** `src/intelligence/metric-registry.ts`, `src/intelligence/metric-calculator.service.ts`, unit tests for each metric.

**Interfaces:** `MetricDefinition` exposes `code`, `definitionVersion`, `kind: ACTIVITY | CURRENT_STATE`, `sourceModules`, `requiredPermissions`, dimensions, and a calculator accepting `{ organizationId, establishmentIds, from?, to?, sourceAsOf }` and returning exact typed values.

- [ ] Write one table-driven failing test per KPI: `SALES_ISSUED`, `PAYMENTS_RECORDED`, `RECEIVABLES_OUTSTANDING`, `QUOTE_ORDER_CONVERSION`, `EXPENSES_RECORDED`, `CASH_BALANCE`, `INVENTORY_ON_HAND`, `PURCHASE_ORDERS_PENDING`, `PROJECTS_OVERDUE`, `CRM_PIPELINE`, `NETWORK_INQUIRIES_CONVERTED`.
- [ ] Implement registry definitions with source status, currency, unit, establishment, and activity/current-state rules exactly as Docs/101.
- [ ] Implement tenant-bounded Prisma queries; use decimals/BigInt, never JS floating-point for money or quantities.
- [ ] Run unit suite and add regression cases for payment reversal timing, void invoices, mixed currency, missing opportunity value, and incompatible inventory units.

## Task 5: Implement transactional projection and alert rules

**Files:** `src/intelligence/intelligence-projection.service.ts`, `src/intelligence/intelligence.consumer.ts`, `src/events/event.module.ts`, source service files only where an event is missing, PostgreSQL integration tests.

**Interfaces:** `recompute({ organizationId, establishmentIds?, metricCodes?, period?, sourceAsOf, causeEventId? })`; consumer name `intelligence-projection`; alert evaluator emits only `INVOICE_OVERDUE` and `PROJECT_OVERDUE` warning rules.

- [ ] Write failing PostgreSQL tests for duplicate event receipt, retry, late event, concurrent upsert, monotonic `sourceAsOf`, alert open/resolution/reopen, and rebuild equality.
- [ ] Recompute from canonical source tables in a consistent transaction; write event receipt and projection/Outbox alert event atomically.
- [ ] Register existing producer event types. Add only necessary missing source events in the same transaction as their existing source mutation; do not block source writes on worker availability.
- [ ] Add internal bounded rebuild/reconciliation entry point with no HTTP exposure; verify repeat run is idempotent and cannot overwrite newer results.

## Task 6: Expose authorized dashboard and metric reads

**Files:** `src/intelligence/intelligence.service.ts`, `intelligence.controller.ts`, `intelligence.module.ts`, authorization/E2E tests.

**Interfaces:** route orchestration calls central membership/entitlement/module checks, `intelligence:read`, then every requested metric's source permissions and establishment scope. Unauthorized explicit metric request returns standard forbidden; dashboard omits non-readable metrics.

- [ ] Add E2E tests for authenticated success, inactive tenant/member, missing entitlement, inactive source module, missing source permission, and unauthorized establishment.
- [ ] Implement `/dashboard` and `/metrics` with bounded queries and separate activity-series/current-state output.
- [ ] Assert response contains no ORM-only fields, cross-currency sum, source descriptions, or values from out-of-scope establishments.
- [ ] Validate OpenAPI and HTTP smoke tests; publish a dedicated PR with CI gates.

## Task 7: Expose alert reads and harden pagination/isolation

**Files:** `src/intelligence/intelligence.service.ts`, `intelligence.controller.ts`, E2E tests and contract tests.

**Interfaces:** cursor binds tenant, scope, filters, sort key, and version; alert detail is visible only when both target tenant/scope and source-module permission pass.

- [ ] Add failing tests for other-tenant IDs, nonparticipant actors, scope escape, source permission revocation, cursor replay with changed filters/tenant, and page boundary duplicates.
- [ ] Implement `/alerts` keyset pagination and `/alerts/{alertId}` with source authorization before returning data.
- [ ] Verify alert payload is minimized and only server-generated deterministic metadata is exposed.
- [ ] Run relevant HTTP E2E and OpenAPI contract suite.

## Task 8: Full regression, evidence, and Phase 10A closure

**Files:** project test/migration proof scripts, `Docs/92_FAIRSCALE_V1_ACCEPTANCE_MATRIX.md` only if applicable, new `Docs/103_PHASE_10A_CLOSURE_EVIDENCE.md`, `Docs/102_PHASE_10A_STATUS.md`, `Docs/21_EXECUTION_ROADMAP.md`, tracker issue.

**Interfaces:** closure evidence references merged commits and actual CI run URLs; no prospective or local-only results are labeled as GitHub CI.

- [ ] Run full lint, typecheck, tests, PostgreSQL suites, E2E, OpenAPI, migration-empty/upgrade, build, and smoke validation from a clean checkout of final Phase 10A candidate.
- [ ] Merge only after every required PR check succeeds; verify post-merge `main` CI separately.
- [ ] Record exact SHA, CI run URL, executed commands, counts, migration baseline, and known non-goals; keep Phase 10B and FairScale commercial launch gates open.
- [ ] Close the Phase 10A issue only after post-merge evidence is verified and linked.
