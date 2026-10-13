# Phase 5 Sales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the tenant- and establishment-scoped Sales chain `Quote → SalesOrder → Invoice → PaymentRecord` defined by `Docs/71_PHASE5_SALES_EXECUTION_SPEC.md`.

**Architecture:** Extend the existing centralized authorization and entitlement pipeline with a focused Sales module. Persist immutable document snapshots, transactionally allocated numbers, audit rows and Outbox events in Prisma/PostgreSQL; use conditional transitions, row locks and idempotency records for safe retries and concurrent commands.

**Tech Stack:** NestJS 12, TypeScript 5.9, Prisma 7, PostgreSQL 17, OpenAPI YAML, Vitest 5, Docker-backed PostgreSQL integration tests.

**Spec:** `Docs/71_PHASE5_SALES_EXECUTION_SPEC.md`

## Global Constraints

- Every private operation follows `tenant active → membership active → entitlement SALES → module SALES active → permission → establishment scope`.
- `organizationId`, `establishmentId`, role, plan, module and prices supplied by the client are never authority proofs.
- PostgreSQL stores amounts as `numeric(19,4)` and quantities as `numeric(19,6)`; API decimals are strings.
- Issued document snapshots, totals, currency and numbers are immutable.
- Every effective mutation commits state, audit and Outbox event in one Prisma transaction.
- No payment processor, external charge, national tax inference, FX conversion, accounting or regulatory credit note is implemented.
- No direct push to `main`; every slice uses a dedicated branch, PR, CI and controlled squash merge.

## Review Focus

- A member scoped to establishment A must never list, read, aggregate or mutate a document in establishment B; test this in every aggregate integration suite.
- Concurrent quote/order/invoice conversions must produce one target and one audit/event; test duplicate and different idempotency keys.
- Monetary rounding, inclusive/exclusive explicit taxes, zero/negative quantities and currency mismatch must be rejected or calculated exactly as specified.
- Issued invoices and recorded payments must resist silent edits, overpayment, invalid reversal and terminal-state transitions.
- A disabled `SALES` entitlement/module or suspended membership must deny every Sales route without leaking document existence.

---

### Task 1: Contract, authorization and reference boundaries

**Files:**
- Modify: `openapi/openapi.yaml`
- Modify: `src/tenancy/authorization.service.ts`
- Modify: `src/entitlements/effective-entitlements.service.ts` only if the existing `SALES` projection needs no semantic change
- Create: `src/sales/sales.module.ts`
- Create: `src/sales/sales.permissions.ts`
- Test: `tests/sales/sales.authorization.test.ts`
- Test: `tests/sales/sales.contracts.test.ts`

**Interfaces:**
- Consumes: existing `AuthorizationService`, `EffectiveEntitlementsService`, `PrismaOutboxWriter`, `Idempotency-Key` parameter and `SALES` module catalog code.
- Produces: `sales:*` permission literals, Sales module registration, complete request/response schemas and operation IDs used by later slices.

- [ ] **Step 1: Write failing authorization and contract tests**

  Pin role permissions from the specification, `SALES` entitlement/activation
  denial, selected-establishment denial, and presence of detailed schemas for
  every Phase 5 operation. Assert decimal fields are strings and mutation
  routes declare `Idempotency-Key`.

- [ ] **Step 2: Run focused tests to verify the contract is incomplete**

  Run: `npm test -- tests/sales/sales.authorization.test.ts tests/sales/sales.contracts.test.ts`

  Expected: FAIL because Sales permissions, module registration and detailed
  schemas do not exist yet.

- [ ] **Step 3: Add the central permission literals and OpenAPI contract**

  Add the exact `sales:quotes:*`, `sales:orders:*`, `sales:invoices:*` and
  `sales:payments:*` permissions to the existing matrix. Replace Sales
  placeholders with schemas, parameters, responses, examples and Problem
  Details references. Do not add a second authorization service.

- [ ] **Step 4: Run contract and authorization tests**

  Run: `npm test -- tests/sales/sales.authorization.test.ts tests/sales/sales.contracts.test.ts && npm run openapi:validate`

  Expected: PASS with all Sales operations represented and no authorization
  bypass.

- [ ] **Step 5: Commit**

  `git add openapi/openapi.yaml src/tenancy/authorization.service.ts src/sales tests/sales && git commit -m "feat: define sales contracts and authorization"`

### Task 2: Persistence, money arithmetic, snapshots and numbering

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_sales_documents/migration.sql`
- Create: `src/sales/money.ts`
- Create: `src/sales/numbering.service.ts`
- Create: `src/sales/sales.types.ts`
- Test: `tests/sales/money.test.ts`
- Test: `tests/sales/numbering.integration.test.ts`
- Test: `tests/sales/sales.schema.integration.test.ts`

**Interfaces:**
- Consumes: Phase 3 `BusinessParty`/`Item`, Phase 1 organization/establishment/membership relations, existing audit/outbox/idempotency models.
- Produces: Quote, QuoteLine, SalesOrder, SalesOrderLine, Invoice, InvoiceLine, PaymentRecord and number-counter persistence; `MoneyCalculator`; `NumberingService.allocate(type, organizationId, year, tx)`.

- [ ] **Step 1: Write failing database and arithmetic tests**

  Cover numeric scales, `HALF_UP` rounding, explicit tax modes, currency
  mismatch, snapshot fields, unique source conversion constraints and two
  concurrent number allocations.

- [ ] **Step 2: Run the focused tests to verify RED**

  Run: `npm test -- tests/sales/money.test.ts tests/sales/numbering.integration.test.ts tests/sales/sales.schema.integration.test.ts`

  Expected: FAIL because the models, migration and services are absent.

- [ ] **Step 3: Add the additive Prisma schema and migration**

  Add tenant/establishment composite integrity, document status fields,
  immutable snapshot columns, payment reversal relation, idempotency/source
  uniqueness, indexes and transactionally locked annual counters. Do not add
  regulatory fields whose semantics are not in the specification.

- [ ] **Step 4: Implement deterministic money and numbering primitives**

  Use Prisma's Decimal implementation or an already-approved equivalent; keep
  scale and rounding explicit. Allocate numbers under a row lock and return a
  formatted value without reusing committed numbers.

- [ ] **Step 5: Run schema, arithmetic and concurrency tests**

  Run: `npm test -- tests/sales/money.test.ts tests/sales/numbering.integration.test.ts tests/sales/sales.schema.integration.test.ts && npm run prisma:validate`

  Expected: PASS on real PostgreSQL for structural constraints and concurrent
  numbering.

- [ ] **Step 6: Commit**

  `git add prisma src/sales tests/sales && git commit -m "feat: add sales document persistence primitives"`

### Task 3: Quote aggregate

**Files:**
- Create: `src/sales/quote.dto.ts`
- Create: `src/sales/quote.controller.ts`
- Create: `src/sales/quote.service.ts`
- Test: `tests/sales/quotes.integration.test.ts`
- Modify: `src/sales/sales.module.ts`

**Interfaces:**
- Consumes: Task 1 contracts/permissions and Task 2 snapshots, money and numbering.
- Produces: create/list/get/update-draft and `send`, `accept`, `reject`, `cancel` commands; `Quote` response and `sales.quote.*` events.

- [ ] **Step 1: Write failing quote integration tests**

  Cover valid creation from same-tenant party/items, snapshotting, draft-only
  edits, each legal transition, terminal transition rejection, selected scope,
  disabled party/item rejection, audit/Outbox atomicity and idempotent retries.

- [ ] **Step 2: Run the quote tests to verify RED**

  Run: `npm test -- tests/sales/quotes.integration.test.ts`

  Expected: FAIL because the aggregate and routes are absent.

- [ ] **Step 3: Implement the quote service and controller**

  Resolve authorization before every read/write, validate parent tenant and
  active references inside the transaction, calculate snapshots server-side,
  allocate the number, and write state/audit/Outbox atomically.

- [ ] **Step 4: Run quote integration tests to green**

  Run: `npm test -- tests/sales/quotes.integration.test.ts`

  Expected: PASS with no cross-tenant or cross-establishment leakage.

- [ ] **Step 5: Commit**

  `git add src/sales tests/sales && git commit -m "feat: add sales quotes"`

### Task 4: SalesOrder aggregate and quote conversion

**Files:**
- Create: `src/sales/order.dto.ts`
- Create: `src/sales/order.controller.ts`
- Create: `src/sales/order.service.ts`
- Test: `tests/sales/orders.integration.test.ts`
- Modify: `src/sales/sales.module.ts`

**Interfaces:**
- Consumes: accepted Quote, Task 2 document primitives and shared authorization.
- Produces: direct draft order creation, quote conversion, draft update, confirm/cancel commands and `sales.order.*` events.

- [ ] **Step 1: Write failing order tests**

  Cover accepted-quote conversion, source uniqueness, direct order rules,
  snapshot preservation, confirm/cancel transitions, concurrent conversion,
  idempotency-key reuse conflict, authorization and atomic audit/Outbox.

- [ ] **Step 2: Run the order tests to verify RED**

  Run: `npm test -- tests/sales/orders.integration.test.ts`

  Expected: FAIL because order persistence and commands are absent.

- [ ] **Step 3: Implement order creation, conversion and transitions**

  Lock or conditionally update the source Quote, create exactly one order for
  a successful conversion, and preserve all line snapshots in one transaction.

- [ ] **Step 4: Run order tests to green**

  Run: `npm test -- tests/sales/orders.integration.test.ts`

  Expected: PASS including two concurrent conversion attempts.

- [ ] **Step 5: Commit**

  `git add src/sales tests/sales && git commit -m "feat: add sales orders and quote conversion"`

### Task 5: Invoice aggregate and order conversion

**Files:**
- Create: `src/sales/invoice.dto.ts`
- Create: `src/sales/invoice.controller.ts`
- Create: `src/sales/invoice.service.ts`
- Test: `tests/sales/invoices.integration.test.ts`
- Modify: `src/sales/sales.module.ts`

**Interfaces:**
- Consumes: confirmed SalesOrder and Task 2 document primitives.
- Produces: invoice conversion, draft edits, issue/void commands, derived payment totals and `sales.invoice.*` events.

- [ ] **Step 1: Write failing invoice tests**

  Cover confirmed-order conversion, unique source order, issue immutability,
  due date validation, void-before-payment, refusal after payment, terminal
  transitions and atomic audit/Outbox.

- [ ] **Step 2: Run the invoice tests to verify RED**

  Run: `npm test -- tests/sales/invoices.integration.test.ts`

  Expected: FAIL because invoice persistence and commands are absent.

- [ ] **Step 3: Implement invoice conversion and lifecycle**

  Lock the source order, preserve snapshots, refuse edits after issue and allow
  `VOID` only when the locked invoice has no valid payment records.

- [ ] **Step 4: Run invoice tests to green**

  Run: `npm test -- tests/sales/invoices.integration.test.ts`

  Expected: PASS with concurrent conversion and terminal-state coverage.

- [ ] **Step 5: Commit**

  `git add src/sales tests/sales && git commit -m "feat: add sales invoices"`

### Task 6: PaymentRecord aggregate, partial payment and reversal

**Files:**
- Create: `src/sales/payment.dto.ts`
- Create: `src/sales/payment.controller.ts`
- Create: `src/sales/payment.service.ts`
- Test: `tests/sales/payments.integration.test.ts`
- Modify: `src/sales/sales.module.ts`

**Interfaces:**
- Consumes: issued Invoice, Task 2 money primitives and shared idempotency.
- Produces: payment listing, record and reversal commands; `sales.payment_record.*` events; invoice status recalculation.

- [ ] **Step 1: Write failing payment tests**

  Cover full payment, partial payment, exact balance, overpayment rejection,
  currency mismatch, two concurrent payments, duplicate idempotency, reversal,
  paid/void invoice restrictions and payment audit/Outbox atomicity.

- [ ] **Step 2: Run the payment tests to verify RED**

  Run: `npm test -- tests/sales/payments.integration.test.ts`

  Expected: FAIL because payment persistence and commands are absent.

- [ ] **Step 3: Implement locked payment recording and reversal**

  Lock the invoice, recompute valid net payments in the transaction, reject an
  outstanding-balance breach, create the immutable record and update the
  derived invoice status with one audit and event. Reversal is a separate
  append-only command linked to the original.

- [ ] **Step 4: Run payment tests to green**

  Run: `npm test -- tests/sales/payments.integration.test.ts`

  Expected: PASS with concurrent balance protection.

- [ ] **Step 5: Commit**

  `git add src/sales tests/sales && git commit -m "feat: add payment records and reversals"`

### Task 7: Cross-phase proof, CI and phase evidence

**Files:**
- Create: `scripts/verify-phase5-migrations.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/backend-ci.yml`
- Modify: `openapi/README.md`
- Create: `Docs/73_PHASE_5_CLOSURE_EVIDENCE.md`
- Test: `tests/e2e/phase5-sales.e2e.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6 endpoints, schema, events and test fixtures.
- Produces: reproducible migration proof from empty DB and Phase 4 upgrade, CI gates, E2E evidence and closure checklist for issue #63.

- [ ] **Step 1: Write failing migration and E2E proof tests**

  Assert empty-database migration, upgrade from the Phase 4 baseline, full
  quote-to-payment journey, cross-tenant denial, selected-establishment
  denial, disabled module denial and rollback of state/audit/Outbox.

- [ ] **Step 2: Run the proof commands to verify RED**

  Run: `npm run prisma:phase5:migration-proof` and
  `npm test -- tests/e2e/phase5-sales.e2e.test.ts`

  Expected: FAIL until the migration proof script and E2E flow exist.

- [ ] **Step 3: Implement the migration proof and CI integration**

  Apply all migrations to temporary PostgreSQL databases, verify migration
  counts and structural constraints, then run the Phase 4 upgrade path. Add
  the command to CI after the existing Phase 3 proof and preserve all prior
  Phase 0–4 checks.

- [ ] **Step 4: Run the complete validation matrix**

  Run: `npm run lint`, `npm run typecheck`, `npm run prisma:validate`,
  `npm run prisma:phase2:migration-proof`,
  `npm run prisma:phase3:migration-proof`,
  `npm run prisma:phase5:migration-proof`, `npm run openapi:validate`,
  `npm run contracts:validate`, `npm test`, `npm run build`.

  Expected: all commands exit 0, PostgreSQL proofs pass, and the new E2E flow
  is included in the full suite.

- [ ] **Step 5: Write and self-review the closure evidence**

  Record exact local outputs, CI URLs, migration baselines, test counts,
  branch/PR provenance and all known non-goals. Do not mark issue #63 closed.

- [ ] **Step 6: Commit**

  `git add scripts package.json .github/workflows/backend-ci.yml openapi Docs tests/e2e && git commit -m "test: add phase 5 sales cross-phase evidence"`

## Final review checklist

- [ ] Every spec section maps to at least one implementation task and test.
- [ ] No task introduces a second authorization or entitlement mechanism.
- [ ] All money and tax calculations use the same exact Decimal policy.
- [ ] All irreversible document transitions have explicit negative tests.
- [ ] Existing Phase 0–4 tests remain green.
- [ ] No regulatory or payment-provider behavior has been inferred silently.
- [ ] The final PR is merged only after CI success; its branch is deleted.
