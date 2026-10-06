# Event Fabric Phase 0.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a durable PostgreSQL transactional outbox, safe worker, idempotent consumer, and technical proof use-case for Phase 0.5.

**Architecture:** Prisma models persist immutable event envelopes, outbox lifecycle state, and consumer receipts. Application code writes the proof fact and outbox event in one transaction; a worker claims due rows with `FOR UPDATE SKIP LOCKED`, dispatches by event type/version, and consumers commit receipts with effects atomically.

**Tech Stack:** Node.js 24, TypeScript strict, NestJS 12, Prisma 7, PostgreSQL 17, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-06-event-fabric-design.md`, governed by `Docs/43_DOMAIN_EVENT_CONTRACT.md` and `Docs/50_EVENT_FABRIC_IMPLEMENTATION_SPEC.md`.

## Global Constraints

- PostgreSQL is the source of truth; no event sourcing.
- Delivery is at-least-once; consumers must be idempotent.
- Critical state and its outbox event commit in the same PostgreSQL transaction.
- No broker, AI provider, vector store, chatbot, or agent runtime is introduced.
- Payloads contain no password, token, secret, or raw ORM dump.
- All HTTP APIs remain under `/api/v1`.
- Node baseline is `>=24 <25`; TypeScript strict; Prisma 7; PostgreSQL 17.
- No push to any remote branch.

## Review Focus

- Duplicate delivery must create one consumer effect: `event_consumer_receipts` unique constraint and replay integration test.
- Two workers must not claim one row: `SKIP LOCKED` concurrency test.
- A crash/lease expiry must make work recoverable: expired lease test.
- An invalid or unknown event must fail in a controlled, sanitized way: dispatch/error test.
- Transaction rollback must not leave an orphan fact or outbox event: rollback integration test.

---

### Task 1: Event envelope and context contracts

**Files:**
- Create: `src/events/domain-event.ts`
- Create: `src/events/event-context.ts`
- Create: `src/events/domain-event.factory.ts`
- Test: `tests/events/domain-event.test.ts`
- Test: `tests/events/event-context.test.ts`

**Interfaces:**
- Produces `DomainEvent`, `EventActor`, `EventContext`, `createDomainEvent(input)`, and `sanitizeError(error)`.

- [ ] Write failing tests for canonical fields, UUID/context validation, object payload enforcement, reserved secret-key rejection, and sanitized bounded errors.
- [ ] Run the focused Vitest files and confirm failure because the event contracts are absent.
- [ ] Implement the strict envelope types/factory and context helpers without database dependencies.
- [ ] Run focused tests and then `npm test`; confirm all pass.
- [ ] Commit `feat: add domain event envelope and context contracts`.

### Task 2: Prisma persistence model and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_event_fabric/migration.sql`
- Create: `src/events/outbox.repository.ts`
- Test: `tests/events/outbox-repository.test.ts`

**Interfaces:**
- Consumes `DomainEvent` from Task 1.
- Produces `OutboxRepository.enqueue(tx,event)`, `claimBatch(tx,options)`, `markProcessed`, `markRetry`, and `markFailed`.

- [ ] Write PostgreSQL-backed tests for enqueue, required indexes/constraints, status transitions, and sanitized error fields.
- [ ] Run the tests against the Docker PostgreSQL service and confirm failure because the models/repository are absent.
- [ ] Add enums/models/indexes and generate an additive migration; implement repository operations using the transaction client.
- [ ] Run Prisma validate/generate and the focused integration tests; confirm pass.
- [ ] Commit `feat: persist event outbox and consumer receipts`.

### Task 3: Atomic foundation probe use-case

**Files:**
- Create: `prisma/migrations/<timestamp>_add_foundation_probe/migration.sql`
- Modify: `prisma/schema.prisma`
- Create: `src/events/foundation-probe.service.ts`
- Test: `tests/events/foundation-probe.integration.test.ts`

**Interfaces:**
- Consumes `EventContext` and `OutboxRepository`.
- Produces `recordFoundationProbe(tx,value,context)` returning the created probe and event ID.

- [ ] Write a failing test proving successful transaction creates exactly one probe and one `foundation.probe.recorded` outbox row.
- [ ] Write a failing rollback test proving neither row survives a failed transaction.
- [ ] Run the integration tests and confirm failure before implementation.
- [ ] Implement the minimal probe models/service and atomic transaction boundary.
- [ ] Run the focused integration tests and full unit suite; confirm pass.
- [ ] Commit `feat: prove atomic foundation event writes`.

### Task 4: Dispatcher and idempotent consumer

**Files:**
- Create: `src/events/event-dispatcher.ts`
- Create: `src/events/foundation-probe.consumer.ts`
- Test: `tests/events/event-dispatcher.test.ts`
- Test: `tests/events/foundation-probe.consumer.integration.test.ts`

**Interfaces:**
- Consumes `OutboxEvent` and resolves handlers by `eventType:eventVersion`.
- Produces `EventConsumer` and an atomic projection/receipt effect for `foundation.probe.recorded`.

- [ ] Write failing tests for unknown event/version rejection, first delivery, replay no-op, and receipt/effect rollback behavior.
- [ ] Run focused tests and confirm the expected missing-dispatcher/consumer failures.
- [ ] Implement handler registration and consumer transactions with the unique receipt barrier.
- [ ] Run focused integration tests and full suite; confirm pass.
- [ ] Commit `feat: add versioned idempotent event consumers`.

### Task 5: Worker claim, lease, retry, and failure lifecycle

**Files:**
- Create: `src/events/event-worker.ts`
- Create: `src/events/retry-policy.ts`
- Test: `tests/events/event-worker.integration.test.ts`
- Test: `tests/events/retry-policy.test.ts`

**Interfaces:**
- Consumes `OutboxRepository` and `EventDispatcher`.
- Produces `EventWorker.processBatch(options)` and configurable defaults: batch 50, interval 1000 ms, lease 60 s, max attempts 8.

- [ ] Write failing tests for claim exclusion, expired lease recovery, retry backoff, terminal FAILED, and successful PROCESSED cleanup.
- [ ] Run focused tests and confirm failure before implementation.
- [ ] Implement short claim transactions, out-of-transaction dispatch, bounded backoff, and lifecycle updates.
- [ ] Run concurrency/integration tests and full suite; confirm pass.
- [ ] Commit `feat: add safe outbox worker lifecycle`.

### Task 6: Nest integration, operational documentation, and CI gates

**Files:**
- Create: `src/events/event.module.ts`
- Modify: `src/app.module.ts`
- Modify: `Docs/50_EVENT_FABRIC_IMPLEMENTATION_SPEC.md` only if implementation decisions need normative clarification
- Create: `Docs/52_EVENT_FABRIC_OPERATIONS.md`
- Modify: `README.md`
- Modify: `.github/workflows/backend-ci.yml`
- Test: `tests/events/event-module.test.ts`

**Interfaces:**
- Registers Prisma/event services in Nest without exposing a business endpoint.
- Documents local commands, migration/reset policy, worker configuration, failure recovery, and current Phase 0.5 status.

- [ ] Write a failing module test proving the event services are registered and lifecycle-safe.
- [ ] Run the test and confirm failure because the module is absent.
- [ ] Wire the module, add operational docs, and add CI commands for migration/integration validation without requiring a remote push.
- [ ] Run the complete validation matrix: lint, typecheck, Prisma validate/generate, OpenAPI, contracts, tests, build, Docker smoke live/ready.
- [ ] Commit `docs: document Event Fabric operations and gates`.

### Task 7: Final review and local delivery record

**Files:**
- Modify: `Docs/31_BOOTSTRAP_CHECKLIST.md`
- Create: `Docs/53_PHASE_0_5_STATUS.md`

- [ ] Verify every Phase 0.5 gate in `Docs/50_EVENT_FABRIC_IMPLEMENTATION_SPEC.md` against code, tests, migration, and CI output.
- [ ] Record completed gates, known limitations, exact local commands, branch name, and the fact that no remote push was performed.
- [ ] Run the full verification matrix one final time.
- [ ] Commit `docs: record Phase 0.5 implementation status`.

