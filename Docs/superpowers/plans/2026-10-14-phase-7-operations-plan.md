# Phase 7 Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer Inventory, Expenses et Cash avec des écritures traçables, une isolation tenant stricte et une intégration idempotente des GoodsReceipts.

**Architecture:** Un ledger append-only est l'autorité de chaque domaine. Les balances sont des projections transactionnelles reconstructibles. L'intégration Purchases est un consommateur Outbox dédié, protégé par des receipts d'événements et des clés de source, sans modifier les agrégats Phase 6.

**Tech Stack:** NestJS 12, TypeScript, Prisma 7, PostgreSQL 17, OpenAPI YAML, Vitest, Supertest, Docker Compose et les primitives d'autorisation, d'idempotence, d'audit et d'Outbox existantes.

**Spec:** `Docs/77_PHASE7_OPERATIONS_EXECUTION_SPEC.md`

## Global Constraints

- Aucun endpoint métier ne modifie directement un solde ; toute variation provient d'une écriture append-only.
- Toute ressource opérationnelle porte `organization_id`; toute ressource localisée porte `establishment_id`.
- Toute mutation suit `tenant → membership → entitlement → activation → permission → scope`.
- GoodsReceipt Phase 6 ne crée aucun mouvement de stock ; Phase 7 consomme ses événements versionnés.
- Les corrections sont compensatoires et auditées ; aucune réécriture historique silencieuse.
- Aucun calcul fiscal, comptable ou conversion de devise implicite n'est ajouté.
- Chaque tranche passe par branche dédiée, PR, CI verte, fusion contrôlée et suppression de branche.

## Review Focus

- Rejeu du même événement GoodsReceipt : le mouvement ne doit apparaître qu'une fois.
- Affectation absente ou entrepôt devenu inactif : aucune écriture de stock ne doit être produite.
- Deux sorties concurrentes : une seule transaction peut consommer le stock disponible.
- Réconciliation divergente : elle doit signaler l'écart sans le corriger silencieusement.
- Transfert ou correction de caisse concurrent : aucun solde intermédiaire ou double débit ne doit être visible.

---

### Task 1: Contract and authorization freeze

**Files:** `openapi/openapi.yaml`, `src/tenancy/authorization.service.ts`, `Docs/07_AUTHORIZATION_MATRIX.md`, `tests/tenancy/authorization.policy.test.ts`, `tests/contracts/openapi.contract.test.ts`

**Interfaces:** Consumes `AuthorizationService.requireModule` and canonical modules `INVENTORY`, `EXPENSES`, `CASH`. Produces detailed Phase 7 DTO schemas, status enums, Problem Details and permission literals.

- [ ] Write failing tests for every planned route, required field, decimal-as-string field and error response.
- [ ] Run OpenAPI and authorization tests and verify the failure identifies missing Phase 7 contracts.
- [ ] Add the exact OpenAPI paths/schemas and central permission literals without adding controller behavior.
- [ ] Run `npm run openapi:validate`, `npm run contracts:validate`, lint and authorization tests.
- [ ] Commit `contract(operations): freeze Phase 7 API and permissions`.

### Task 2: Inventory ledger and balances

**Files:** `prisma/schema.prisma`, `prisma/migrations/<timestamp>_add_inventory_ledger/migration.sql`, `src/inventory/*`, `tests/inventory/*.integration.test.ts`

**Interfaces:** Consumes Task 1 contracts, `Prisma.TransactionClient`, existing Outbox, audit and idempotency primitives. Produces `InventoryMovementService.create`, `InventoryBalanceService.list`, `InventoryTransferService.create` and a reconstructible balance query.

- [x] Write failing PostgreSQL tests for tenant-qualified rows, append-only constraints, positive/negative movements and balance reconstruction.
- [x] Add the ledger, balance projection and indexes with additive tenant-qualified foreign keys and source uniqueness.
- [x] Implement the transactional command that locks `(organization, warehouse, item)`, checks availability and writes movement + projection + audit + Outbox.
- [x] Add transfer as two linked movements with deterministic warehouse lock ordering.
- [x] Run focused integration tests, Prisma validate, migration proof and typecheck.
- [x] Commit `feat(inventory): add authoritative stock ledger`.

### Task 3: GoodsReceipt integration and historical import

**Files:** `prisma/schema.prisma`, `prisma/migrations/20261014093000_link_goods_receipts_inventory/migration.sql`, `src/inventory/goods-receipt-inventory.*`, `src/purchases/goods-receipt.events.ts`, `tests/inventory/goods-receipt-inventory.integration.test.ts`, `tests/purchases/goods-receipt-events.test.ts`

**Interfaces:** Consumes `purchases.goods_receipt.confirmed.v1`, `purchases.goods_receipt.corrected.v1`, Task 2 ledger commands and event receipts. Produces explicit assignment/import commands and source revision deduplication.

- [x] Write failing tests for assignment, missing warehouse, duplicate event, replay, correction delta and historical import.
- [x] Add the qualified GoodsReceipt integration link and unique source/revision constraints.
- [x] Implement the consumer so receipt recording and stock posting commit atomically, or neither commits.
- [x] Implement explicit historical import with `HISTORICAL_IMPORT` revision and audit.
- [x] Run PostgreSQL GoodsReceipt → Inventory integration, migration proof and focused Phase 0–6 regression suites.
- [x] Commit `feat(inventory): consume goods receipt events idempotently`.

### Task 4: Expenses

**Files:** `prisma/schema.prisma`, `prisma/migrations/<timestamp>_add_expenses/migration.sql`, `src/expenses/*`, `tests/expenses/*.integration.test.ts`

**Interfaces:** Consumes Task 1 permissions, Money primitives and an optional tenant-qualified `BusinessParty` reference. Project, Document and Cash references remain out of scope until their owning domains are delivered. Produces `ExpenseService` with `DRAFT → RECORDED → VOID` and explicit Cash integration reserved for Task 5.

- [x] Write failing tests for lifecycle, immutable recorded fields, void reason, tenant/scope isolation and idempotent retries.
- [x] Add the tenant-qualified Expense model and constraints.
- [x] Implement create/update/record/void with audit + Outbox in one transaction.
- [x] Add the optional tenant-qualified Party reference without creating accounting or Cash behavior.
- [x] Run focused tests and full regression through CI, including PostgreSQL migration proofs, E2E, OpenAPI and contracts.
- [x] Commit and merge `feat(expenses): add operational expense lifecycle` via PR #93.

### Task 5: CashAccounts and CashMovements

**Files:** `prisma/schema.prisma`, `prisma/migrations/<timestamp>_add_cash_ledger/migration.sql`, `src/cash/*`, `tests/cash/*.integration.test.ts`

**Interfaces:** Consumes Task 1 permissions, Money primitives, and validated Expense/PaymentRecord source identifiers. Produces append-only cash ledger, derived balances, compensating corrections and same-currency transfers. Normative freeze: `Docs/80_PHASE_7_CASH_EXECUTION_SPEC.md`; execution plan: `Docs/superpowers/plans/2026-10-14-phase-7-cash-plan.md`; issue #95.

- [x] Write failing tests for account lifecycle, signed balance, insufficient funds, correction, transfer and concurrent writes.
- [x] Add account, movement and source-link constraints with tenant-qualified relations.
- [x] Implement movement/correction commands with account locks, audit and Outbox.
- [x] Implement same-currency transfer as two linked movements in one transaction.
- [x] Run focused tests and E2E/regression suite through CI.
- [x] Commit and merge `feat(operations): implement CashAccounts and CashMovements` via PR #97.

Evidence: `main@58b4193b35f648234122bc277ed0ecae9701e468`,
[PR #97](https://github.com/jupi-z/Monarque-Connect/pull/97),
[PR corrective #99](https://github.com/jupi-z/Monarque-Connect/pull/99),
[CI PR #266](https://github.com/jupi-z/Monarque-Connect/actions/runs/38565073106),
[CI post-merge #267](https://github.com/jupi-z/Monarque-Connect/actions/runs/38565603162).

### Task 6: Cross-phase migration and proof harness

**Files:** `scripts/verify-phase7-migrations.mjs`, `package.json`, `.github/workflows/*`, `Docs/79_PHASE_7_CLOSURE_EVIDENCE.md`, `tests/e2e/phase7-operations.e2e.test.ts`

**Interfaces:** Consumes all Phase 7 models and Phase 6 baseline `main@3b7245469a2b9ee2a2ccb19c04f621d1d75497ec`. Produces reproducible empty-database and Phase 6-upgrade evidence plus CI commands.

- [ ] Write failing migration proof for empty database, Phase 6 upgrade and required constraints.
- [ ] Implement the proof script with temporary PostgreSQL databases and cleanup in `finally`.
- [ ] Add CI commands for migrations, OpenAPI, contracts, E2E and regressions.
- [ ] Run the complete prescribed suite and record exact outputs.
- [ ] Commit `test(operations): prove Phase 7 migrations and cross-phase behavior`.

### Task 7: Closure and governance

**Files:** `Docs/79_PHASE_7_CLOSURE_EVIDENCE.md`, `Docs/78_PHASE_7_STATUS.md`, `Docs/21_EXECUTION_ROADMAP.md`, GitHub issue #84 and tracker #11

**Interfaces:** Consumes migration, test, CI and GitHub evidence from Tasks 1–6. Produces a strict gate-by-gate closure decision; the phase remains open if one proof is absent.

- [ ] Re-run every gate from the status document on the final merge commit.
- [ ] Record URLs and exact counts without inferring success from an absent check.
- [ ] Update issue, tracker and roadmap only after CI post-merge is green.
- [ ] Delete merged branches and verify local/remote state.
- [ ] Commit `docs(operations): close Phase 7 with reproducible evidence` only when every gate is proven.
