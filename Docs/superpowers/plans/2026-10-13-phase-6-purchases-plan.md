# Phase 6 Purchases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the tenant-scoped `SupplierRFQ → PurchaseOrder → GoodsReceipt` workflow with multi-supplier isolation, partial receipts and auditable corrections, without creating an Inventory engine.

**Architecture:** Extend the existing NestJS/Prisma modules with a focused `purchases` module. Reuse the central authorization service, Phase 5 money/numbering/idempotency primitives, Prisma transactions, audit events and transactional Outbox. GoodsReceipt emits a versioned fact for a future Phase 7 consumer but does not write stock state.

**Tech Stack:** NestJS, TypeScript strict mode, Prisma, PostgreSQL, OpenAPI YAML, Vitest/Supertest, Docker PostgreSQL.

**Spec:** `Docs/74_PHASE6_PURCHASES_EXECUTION_SPEC.md`

## Global Constraints

- All private operations follow `tenant actif → membership actif → entitlement PURCHASES → module PURCHASES actif → permission → scope établissement`.
- No phase 6 service may create or mutate stock movements, reservations, warehouse balances, valuation or Inventory projections.
- All mutations write state, audit and Outbox in one Prisma transaction.
- All mutation endpoints accept `Idempotency-Key`; decimal values are serialized as strings.
- Confirmed documents are immutable; corrections are append-only compensations with a mandatory reason.
- Phase 6 accepts only the organization default currency; no exchange-rate conversion is introduced.
- Phase 6 implementation starts only after the normative spec and machine-readable OpenAPI contract are reviewed and merged.

## Review Focus

- A supplier must never see another supplier's RFQ status, prices or private buyer data — test with two local recipients and one Network recipient in `tests/purchases/supplier-rfqs.integration.test.ts`.
- A Network target must require an active public profile and an accepted connection without granting tenant membership — test in the same integration suite.
- Concurrent receipts must not consume the same remaining quantity or create duplicate status events — test in `tests/purchases/goods-receipts.integration.test.ts`.
- A correction must not make net received quantity negative or mutate the original receipt — test in `tests/purchases/goods-receipts.integration.test.ts`.
- No Phase 6 operation may create a stock row or change Inventory state — test with migration/schema assertions and a transaction-level integration check.

---

### Task 1: Freeze the authorization and OpenAPI contract

**Files:**
- Modify: `src/tenancy/authorization.service.ts` — add six `purchases:*` permission literals and role matrix entries.
- Create: `src/purchases/purchases.permissions.ts` — single permission export used by the module.
- Modify: `openapi/openapi.yaml` — replace purchase placeholders with detailed paths, request/response schemas, idempotency parameters and Problem Details responses.
- Test: `tests/purchases/purchases.authorization.test.ts`, `tests/purchases/purchases.contracts.test.ts`.

**Interfaces:**
- Consumes: `AuthorizationService.requireModule`, existing `TenantRole`, `ScopeMode`, Problem Details and pagination conventions.
- Produces: `PurchasePermission = 'purchases:rfqs:read' | 'purchases:rfqs:write' | 'purchases:orders:read' | 'purchases:orders:write' | 'purchases:receipts:read' | 'purchases:receipts:write'` and stable OpenAPI operation IDs from the spec.

- [ ] **Step 1: Write the failing permission and contract tests** asserting the role matrix, `PURCHASES` module requirement, six operation families, decimal strings, `Idempotency-Key`, cursor pagination and `400/401/403/404/409` responses.
- [ ] **Step 2: Run `npm run openapi:validate` and the targeted tests**; expect failure because purchase permissions and detailed schemas are absent.
- [ ] **Step 3: Implement the central permission additions and the complete OpenAPI contract** without adding controllers or business behavior.
- [ ] **Step 4: Run `npm run openapi:validate`, `npm run contracts:validate` and the targeted tests**; expect all contract assertions to pass.
- [ ] **Step 5: Commit** `feat(purchases): freeze authorization and API contracts`.

### Task 2: Add the PostgreSQL model and migration boundary

**Files:**
- Modify: `prisma/schema.prisma` — add RFQ, recipient, RFQ line, purchase order, order line, goods receipt, receipt line and correction models/enums.
- Create: `prisma/migrations/<timestamp>_add_purchase_documents/migration.sql`.
- Modify: `src/sales/numbering.service.ts` or extract a shared numbering primitive only if the existing API cannot safely serve `RFQ`, `PO` and `GR` document types.
- Test: `tests/purchases/purchases.schema.integration.test.ts`.

**Interfaces:**
- Consumes: Phase 5 tenant-qualified relations, decimal columns, idempotency uniqueness, audit/Outbox relations and transactional numbering.
- Produces: tenant-qualified Prisma models with unique `(organization_id, document_type, year, number)` semantics, source RFQ recipient uniqueness and receipt correction references.

- [ ] **Step 1: Write schema tests** for tenant-qualified foreign keys, line uniqueness, source attribution uniqueness, recipient uniqueness, positive quantity checks and the absence of stock tables/columns introduced by the migration.
- [ ] **Step 2: Run the targeted PostgreSQL schema tests**; expect failure because the models do not exist.
- [ ] **Step 3: Implement the additive Prisma schema and migration** with indexes for organization, establishment, status and dates; do not add StockMovement or inventory balance state.
- [ ] **Step 4: Run `npm run prisma:validate` and the targeted schema tests** against PostgreSQL; expect pass.
- [ ] **Step 5: Commit** `feat(purchases): add purchase document persistence`.

### Task 3: Implement SupplierRFQ and recipient isolation

**Files:**
- Create: `src/purchases/supplier-rfq.dto.ts`, `src/purchases/supplier-rfq.controller.ts`, `src/purchases/supplier-rfq.service.ts`.
- Modify: `src/purchases/purchases.module.ts` and `src/app.module.ts`.
- Test: `tests/purchases/supplier-rfqs.integration.test.ts`.

**Interfaces:**
- Consumes: Task 1 permissions/OpenAPI and Task 2 models; `BusinessParty`, `ConnectionRequest`, `OrganizationNetworkProfile`, `AuthorizationService`, `PrismaOutboxWriter`.
- Produces: create/list/read/update-DRAFT/send/close/cancel RFQ operations, deterministic recipient projections and events `purchases.supplier_rfq.*.v1`.

- [ ] **Step 1: Write failing integration tests** for local supplier, Network supplier, multi-recipient send, duplicate/self-target rejection, disabled/inactive target rejection, cross-tenant denial, scope denial, idempotent retry and atomic audit/Outbox.
- [ ] **Step 2: Run the targeted suite**; expect failure because the module/routes/services do not exist.
- [ ] **Step 3: Implement the RFQ aggregate** with server-side validation of tenant, active supplier, accepted Network connection, snapshots and recipient-level visibility.
- [ ] **Step 4: Run the targeted suite and `npm run typecheck`**; expect pass with no private data leakage.
- [ ] **Step 5: Commit** `feat(purchases): add multi-supplier RFQs`.

### Task 4: Implement PurchaseOrder and RFQ attribution

**Files:**
- Create: `src/purchases/purchase-order.dto.ts`, `src/purchases/purchase-order.controller.ts`, `src/purchases/purchase-order.service.ts`.
- Test: `tests/purchases/purchase-orders.integration.test.ts`.

**Interfaces:**
- Consumes: RFQ recipient/line snapshots, Phase 5 money and numbering primitives, authorization and Outbox.
- Produces: direct or RFQ-derived PurchaseOrder CRUD/transition operations and `purchases.purchase_order.*.v1` events.

- [ ] **Step 1: Write failing integration tests** for direct creation, partial RFQ attribution to multiple suppliers, one order per recipient, snapshot immutability, currency/tax calculation, transitions, idempotency and cross-tenant/scope rejection.
- [ ] **Step 2: Run the targeted suite**; expect failure.
- [ ] **Step 3: Implement the PurchaseOrder aggregate** with deterministic allocation checks and no invoice/payment/stock side effects.
- [ ] **Step 4: Run targeted tests, `npm run lint` and `npm run typecheck`**; expect pass.
- [ ] **Step 5: Commit** `feat(purchases): add purchase orders`.

### Task 5: Implement GoodsReceipt, cumulative quantities and corrections

**Files:**
- Create: `src/purchases/goods-receipt.dto.ts`, `src/purchases/goods-receipt.controller.ts`, `src/purchases/goods-receipt.service.ts`.
- Test: `tests/purchases/goods-receipts.integration.test.ts`.

**Interfaces:**
- Consumes: confirmed PurchaseOrder lines, PostgreSQL row locks, append-only audit/Outbox and idempotency primitives.
- Produces: receipt create/list/read/confirm/cancel/correct operations, cumulative quantities and `purchases.goods_receipt.*.v1` events; no Inventory writes.

- [ ] **Step 1: Write failing integration tests** for total/partial receipts, exact cumulative totals, over-receipt refusal, cancellation rules, immutable confirmed receipt, signed correction, negative-net rejection, concurrent receipts and no-stock-side-effect assertion.
- [ ] **Step 2: Run the targeted suite**; expect failure.
- [ ] **Step 3: Implement deterministic locking** of PurchaseOrder and lines, cumulative quantity validation and append-only correction records in one transaction with audit/Outbox.
- [ ] **Step 4: Run targeted tests and the Phase 5 regression suite**; expect pass and no Inventory mutation.
- [ ] **Step 5: Commit** `feat(purchases): add goods receipts and corrections`.

### Task 6: Add migration proof, E2E and cross-phase evidence

**Files:**
- Create: `scripts/verify-phase6-migrations.mjs`.
- Modify: `package.json`, `.github/workflows/backend-ci.yml`.
- Create: `tests/e2e/phase6-purchases.e2e.test.ts`.
- Create: `Docs/76_PHASE_6_CLOSURE_EVIDENCE.md`.

**Interfaces:**
- Consumes: all Phase 6 models and routes; baseline `main@623fa9e…`; real PostgreSQL CI service.
- Produces: reproducible empty-database and Phase 5 upgrade proof, E2E RFQ → PO → partial receipt → correction, and closure evidence.

- [ ] **Step 1: Write failing migration and E2E assertions** for full migration count, Phase 5 upgrade, complete workflow, isolation and no stock side effect.
- [ ] **Step 2: Run `npm run prisma:phase6:migration-proof` and `npm run test:e2e`**; expect failure until the proof and E2E are wired.
- [ ] **Step 3: Implement the migration proof, CI step and E2E flow** with temporary databases cleaned in `finally`.
- [ ] **Step 4: Run `npm run prisma:phase6:migration-proof`, `npm run test:e2e`, `npm test`, `npm run build`, `npm run openapi:validate` and `npm run contracts:validate`**; expect pass.
- [ ] **Step 5: Commit** `test(purchases): add migration and cross-phase evidence`.

### Task 7: Close Phase 6 only after GitHub proof

**Files:**
- Modify: `Docs/75_PHASE_6_STATUS.md` — check gates only after proof.
- Modify: `Docs/21_EXECUTION_ROADMAP.md` — mark Phase 6 closed only after all controls.
- Modify: `Docs/74_PHASE6_PURCHASES_EXECUTION_SPEC.md` or closure evidence — record final SHA and CI URLs without rewriting historical facts.
- Modify: GitHub issue #75 and tracker issue #11 after merged-main CI.

- [ ] **Step 1: Open a dedicated closure PR** from a clean branch; no direct push to `main`.
- [ ] **Step 2: Verify PR CI and post-merge `main` CI** directly through GitHub, including migration, PostgreSQL, E2E, OpenAPI, contract and regression jobs.
- [ ] **Step 3: Synchronize issue #75, tracker #11, status and roadmap** with exact SHAs and run URLs.
- [ ] **Step 4: Delete the merged remote/local branch and archive the worktree**.
- [ ] **Step 5: Re-verify `main` clean, synchronized, and the only remaining branch**.
