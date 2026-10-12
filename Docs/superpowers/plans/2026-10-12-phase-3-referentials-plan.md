# Phase 3 Référentiels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire les référentiels tenant-scoped de business parties, items de catalogue et warehouses avec autorisation, audit, Outbox et contrats API vérifiables.

**Architecture:** Les trois agrégats restent séparés par responsabilité et réutilisent `AuthorizationService`, `EffectiveEntitlementsService`, `QuotaService` lorsque nécessaire, `PrismaService` et `PrismaOutboxWriter`. Les parties sont organization-wide et contrôlées par `CRM`, les items par `CATALOG`, les warehouses par `INVENTORY`; les ressources établissement-scopées appliquent le scope avant toute lecture ou agrégation.

**Tech Stack:** NestJS 12, TypeScript strict, Prisma 7, PostgreSQL 17, OpenAPI YAML, Vitest, Supertest, GitHub Actions.

**Spec:** `Docs/60_PHASE3_REFERENTIALS_EXECUTION_SPEC.md`

## Global Constraints

- Toute requête suit `tenant active → membership active → entitlement → module active → permission → establishment scope`.
- Toute mutation significative écrit état, audit et Outbox dans la même transaction Prisma.
- Les désactivations sont non destructives et idempotentes.
- Les montants décimaux sont sérialisés en chaînes ; les clients ne sont jamais source de vérité d'autorisation.
- Les branches sont courtes, les PR sont obligatoires, la CI doit être verte et le merge se fait par squash.
- Aucun changement de code ne précède un test rouge qui prouve le comportement attendu.

## Review Focus

- Un membre actif d'un tenant ne peut jamais lire ou modifier la party, l'item ou le warehouse d'un autre tenant : tests négatifs dédiés dans chaque tranche.
- Un membre `SELECTED_ESTABLISHMENTS` ne peut jamais déduire l'existence ou compter les warehouses hors scope : test de liste, lecture directe et mutation.
- Un module absent, désactivé ou suspendu refuse l'opération même pour `OWNER` : test d'entitlement/activation côté HTTP.
- Les retries d'une mutation idempotente ne créent ni doublon, ni second audit, ni second événement : test de répétition et de concurrence.
- Les codes/SKU concurrents rendent une seule réponse métier contrôlée et ne laissent pas de ligne partiellement créée : test PostgreSQL de contrainte et transaction.

---

### Task 1: Schéma, permissions et primitives référentiels

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_phase3_referentials/migration.sql`
- Modify: `src/tenancy/authorization.service.ts`
- Modify: `src/tenancy/tenancy.module.ts`
- Modify: `src/app.module.ts`
- Test: `tests/tenancy/authorization.policy.test.ts`
- Test: `tests/referentials/referentials.schema.integration.test.ts`

**Interfaces:**
- Consumes: `AuthorizationService.requireMembership`, `assertEstablishment`, `EffectiveEntitlementsService.resolve`.
- Produces: Prisma models `BusinessParty`, `Item`, `Warehouse`; permissions `parties:*`, `catalog:*`, `inventory:*`; module wiring shared by later services.

- [ ] **Step 1: Write failing authorization and schema tests**

  Pin the exact role matrix, module codes, unique SKU/warehouse code constraints,
  same-organization warehouse parent rule and non-destructive `active` fields.

- [ ] **Step 2: Run tests and verify the expected missing-model/permission failure**

  Run: `node node_modules/vitest/vitest.mjs run tests/tenancy/authorization.policy.test.ts tests/referentials/referentials.schema.integration.test.ts --pool=forks --poolOptions.forks.singleFork`
  Expected: FAIL because Phase 3 models and permissions do not yet exist.

- [ ] **Step 3: Add the Prisma models and additive migration**

  Use UUID keys, tenant foreign keys, timestamps, soft status, explicit indexes,
  non-null tenant ownership and constraints from the Phase 3 specification.

- [ ] **Step 4: Add permissions and register a shared referentials module**

  Extend the existing role permission map without creating a parallel policy
  engine; expose one module for the three bounded services/controllers.

- [ ] **Step 5: Run schema and authorization tests**

  Run: `node node_modules/vitest/vitest.mjs run tests/tenancy/authorization.policy.test.ts tests/referentials/referentials.schema.integration.test.ts --pool=forks --poolOptions.forks.singleFork`
  Expected: PASS.

- [ ] **Step 6: Verify migration paths and commit**

  Run: `npm run prisma:validate` and the Phase 3 migration proof command once
  it exists; commit only schema, migration, wiring and tests.

### Task 2: Business parties

**Files:**
- Create: `src/referentials/party.dto.ts`
- Create: `src/referentials/party.service.ts`
- Create: `src/referentials/party.controller.ts`
- Test: `tests/referentials/parties.integration.test.ts`
- Test: `tests/e2e/phase3-referentials.e2e.test.ts`
- Modify: `openapi/openapi.yaml`

**Interfaces:**
- Consumes: Task 1 `parties:read/write`, `CRM` entitlement and shared tenant authorization.
- Produces: paginated party list, create/update, idempotent activate/deactivate and `business_party.*` events.

- [ ] **Step 1: Write the failing PostgreSQL integration tests**

  Cover CUSTOMER/SUPPLIER/BOTH, normalization, list filtering, tenant isolation,
  role denial, missing/disabled CRM, idempotent status transitions and atomic
  audit/Outbox.

- [ ] **Step 2: Run the party tests and verify they fail for the absent route/service**

  Run: `node node_modules/vitest/vitest.mjs run tests/referentials/parties.integration.test.ts --pool=forks --poolOptions.forks.singleFork`
  Expected: FAIL because the route and model behavior are absent.

- [ ] **Step 3: Implement DTO validation, authorization and transactional service**

  Apply tenant predicates before loading rows. Use soft status transitions and
  create exactly one audit/event for an effective mutation.

- [ ] **Step 4: Add controller, OpenAPI schemas and error contract**

  Reuse existing pagination/problem-details conventions and never expose
  `linked_organization_id` as a network capability in this phase.

- [ ] **Step 5: Run party and E2E tests to green**

  Run the focused tests and the Phase 3 E2E file; expected PASS with no cross-tenant leakage.

- [ ] **Step 6: Commit the party slice**

  Commit: `feat: add tenant business parties`.

### Task 3: Catalog items

**Files:**
- Create: `src/referentials/item.dto.ts`
- Create: `src/referentials/item.service.ts`
- Create: `src/referentials/item.controller.ts`
- Test: `tests/referentials/items.integration.test.ts`
- Modify: `tests/e2e/phase3-referentials.e2e.test.ts`
- Modify: `openapi/openapi.yaml`

**Interfaces:**
- Consumes: Task 1 shared authorization and `CATALOG` entitlement.
- Produces: product/service CRUD, SKU uniqueness, decimal string serialization, soft status and `catalog.item.*` events.

- [ ] **Step 1: Write failing tests for product/service and SKU invariants**
- [ ] **Step 2: Verify RED with the focused item test command**
- [ ] **Step 3: Implement the item service with server-side module/role checks**
- [ ] **Step 4: Add OpenAPI and HTTP behavior, including decimal serialization**
- [ ] **Step 5: Verify focused, E2E and contract tests are green**
- [ ] **Step 6: Commit the catalog slice**

  Commit: `feat: add tenant catalog items`.

### Task 4: Warehouses

**Files:**
- Create: `src/referentials/warehouse.dto.ts`
- Create: `src/referentials/warehouse.service.ts`
- Create: `src/referentials/warehouse.controller.ts`
- Test: `tests/referentials/warehouses.integration.test.ts`
- Modify: `tests/e2e/phase3-referentials.e2e.test.ts`
- Modify: `openapi/openapi.yaml`

**Interfaces:**
- Consumes: Task 1 establishment scope and `INVENTORY` entitlement.
- Produces: establishment-scoped warehouse CRUD, code uniqueness and `warehouse.*` events.

- [ ] **Step 1: Write failing tests for same-tenant parent and selected scope**
- [ ] **Step 2: Verify RED with the focused warehouse test command**
- [ ] **Step 3: Implement scope-first queries and transactional mutations**
- [ ] **Step 4: Add OpenAPI and controlled conflict/not-found behavior**
- [ ] **Step 5: Verify concurrency, isolation and E2E tests are green**
- [ ] **Step 6: Commit the warehouse slice**

### Task 5: Phase 3 proofs and closure preparation

**Files:**
- Create: `scripts/verify-phase3-migrations.mjs`
- Modify: `package.json`
- Modify: `Docs/61_PHASE_3_STATUS.md`
- Create: `Docs/62_PHASE_3_CLOSURE_EVIDENCE.md`
- Modify: `Docs/00_README.md`
- Modify: `Docs/21_EXECUTION_ROADMAP.md`
- Modify: `Docs/27_REQUIREMENTS_TRACEABILITY.md`

**Interfaces:**
- Consumes: Tasks 1–4 migrations, routes, events, tests and OpenAPI.
- Produces: reproducible migration proof, final gate matrix and synchronized tracker evidence.

- [ ] **Step 1: Add failing migration proof and contract assertions**
- [ ] **Step 2: Implement empty-database and Phase 2-upgrade proof**
- [ ] **Step 3: Run full verification**

  Run: `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`,
  `npm run build`, `npm run openapi:validate`, `npm run contracts:validate`,
  `npm run prisma:validate`, `npm run prisma:phase3:migration-proof`.

- [ ] **Step 4: Fill the evidence document only with observed outputs**
- [ ] **Step 5: Open a final review PR, wait for green CI, then update issue #43 and tracker #11**
- [ ] **Step 6: Delete the merged branch and verify only useful branches remain**

## Self-review

- Spec coverage: Tasks 1–4 cover all three referentials, authorization, audit,
  Outbox, migrations, OpenAPI, isolation and concurrency; Task 5 covers proof and
  closure. No stock movement or CRM workflow requirement is silently included.
- Step scan: each implementation task begins with a failing behavioral test and
  ends with a focused verification and commit boundary.
- Type consistency: the shared permission and model names are fixed in Task 1
  before services consume them.
- Review focus: all five failure classes are explicitly assigned to Tasks 1–4.
- Proportion: this plan fixes Phase 3 boundaries and interfaces without
  prescribing implementation bodies that belong to the code review.
