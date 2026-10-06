# Event Fabric Phase 0.5 — Design

## Purpose

Implement the first durable event infrastructure before Identity & Tenancy. The Core remains deterministic and PostgreSQL remains the source of truth. The phase provides a reusable transactional outbox, a multi-instance-safe worker, idempotent consumers, correlation context, and a small technical proof use-case.

The implementation follows `Docs/50_EVENT_FABRIC_IMPLEMENTATION_SPEC.md`; this document records the concrete boundaries and interfaces chosen for this repository.

## Scope and non-goals

Included:

- versioned domain-event envelope matching `contracts/domain-event.schema.json`;
- `outbox_events` and `event_consumer_receipts` Prisma models and migration;
- atomic write of a technical foundation fact and its outbox event;
- worker claim/lease/retry/failure lifecycle;
- event dispatch by `eventType` and `eventVersion`;
- idempotent database consumer using `(consumerName,eventId)` receipts;
- request/correlation/causation context propagation;
- structured logs/metrics hooks without raw payload logging;
- PostgreSQL integration and concurrency tests;
- contributor documentation and operational commands.

Explicitly excluded: Kafka/RabbitMQ/NATS, event sourcing, Knowledge Layer persistence, embeddings, AI providers, chatbot, agent runtime, and final business notifications.

## Architecture

```text
application command
  └─ Prisma transaction
       ├─ foundation fact
       └─ outbox_events
             └─ worker: claim with FOR UPDATE SKIP LOCKED
                  └─ dispatcher(eventType,eventVersion)
                       └─ consumer transaction
                            ├─ event_consumer_receipts
                            └─ projection/effect
```

The worker never holds a database lock while executing a consumer. Delivery is at-least-once. A consumer must be safe when the same event is delivered again.

## Persistent model

`OutboxEvent` contains the fields required by the normative specification: UUID identity, stable event type/version, optional organization and establishment context, actor, aggregate, correlation/causation/request identifiers, classification, purpose, JSON object payload, status, attempts, retry time, lease ownership, sanitized failure information, and occurred/recorded/processed timestamps.

`EventConsumerReceipt` has a UUID identity, stable `consumerName`, foreign key to `OutboxEvent`, processing timestamp, and a unique `(consumerName,eventId)` pair. This unique constraint is the idempotency barrier.

The technical proof uses `FoundationProbe` and `FoundationProbeProjection`. These are infrastructure-only records and are not product verticals. A probe write creates the fact and its `foundation.probe.recorded` event in one transaction. The consumer creates one projection and one receipt atomically.

## Context and security

HTTP callers receive server-generated `requestId` and `correlationId`. Worker processing reuses the event correlation ID and sets `causationId` to the triggering event ID for newly emitted events. Context is metadata only; no permission is persisted or trusted from it.

The envelope factory rejects missing actor/context/classification/purpose, non-object payloads, secrets in reserved payload keys, invalid UUIDs, and incompatible event versions. Errors stored on an outbox row are sanitized and bounded; payloads are not logged by default.

## Worker lifecycle

- eligible rows: `PENDING` due for retry, or `PROCESSING` with an expired lease;
- claim: PostgreSQL `FOR UPDATE SKIP LOCKED`, set `PROCESSING`, increment attempts, set lease owner/time, commit;
- success: mark `PROCESSED`, clear lease and previous error;
- recoverable failure: return to `PENDING`, compute bounded backoff, clear lease, store sanitized error;
- terminal failure: mark `FAILED` at `maxAttempts`;
- unknown event type/version: controlled terminal failure, never an authorization decision.

Initial operational defaults are batch size 50, poll interval 1000 ms, lease 60 seconds, max attempts 8, with configurable values for tests and deployment.

## Testing strategy

Unit tests cover envelope validation, retry/backoff and dispatch decisions. PostgreSQL integration tests cover atomic commit/rollback, claim exclusion between workers, lease recovery, retry/FAILED transitions, receipt/effect atomicity, replay idempotence, and sanitized errors. The existing validation suite remains mandatory.

## Documentation contract

The implementation plan, a contributor guide for running PostgreSQL/worker tests, the migration rationale, and the current Phase 0.5 status are committed with the code. No local progress files, generated output, credentials, or worktree metadata are committed.

