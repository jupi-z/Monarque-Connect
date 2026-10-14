import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createDomainEvent } from '../../src/events/domain-event.factory.js';
import { EventReceiptConsumer } from '../../src/events/event-receipt.consumer.js';
import { OutboxRepository, type ClaimedOutboxEvent } from '../../src/events/outbox.repository.js';
import { createTestPool, resetEventTables } from './test-database.js';

describe('Phase 8 document event consumer', () => {
  let pool: Pool;
  const consumer = new EventReceiptConsumer('phase8-document-event-sink');

  beforeAll(async () => {
    pool = createTestPool();
    await pool.query('SELECT 1');
  });

  beforeEach(async () => resetEventTables(pool));
  afterAll(async () => pool.end());

  it('records one receipt when a document event is replayed', async () => {
    const organizationId = '11111111-1111-4111-8111-111111111111';
    const aggregateId = '22222222-2222-4222-8222-222222222222';
    const domainEvent = createDomainEvent({
      eventType: 'document.available.v1', eventVersion: 1, occurredAt: new Date().toISOString(),
      actor: { type: 'SYSTEM' }, aggregate: { type: 'Document', id: aggregateId }, organizationId,
      correlationId: '33333333-3333-4333-8333-333333333333', dataClassification: 'CONFIDENTIAL',
      purpose: 'documents', payload: { checksumSha256: 'a'.repeat(64) },
    });
    const event: ClaimedOutboxEvent = {
      id: domainEvent.eventId, eventType: domainEvent.eventType, eventVersion: domainEvent.eventVersion,
      organizationId, establishmentId: null, actorType: domainEvent.actor.type, actorId: null,
      aggregateType: domainEvent.aggregate.type, aggregateId, correlationId: domainEvent.correlationId,
      causationId: null, requestId: null, dataClassification: domainEvent.dataClassification,
      purpose: domainEvent.purpose, payload: domainEvent.payload,
      status: 'PROCESSING',
      attempts: 1,
      lockedBy: 'test-worker',
      claimToken: '44444444-4444-4444-8444-444444444444',
      occurredAt: new Date(domainEvent.occurredAt), recordedAt: new Date(domainEvent.recordedAt),
    };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await new OutboxRepository().enqueue(client, domainEvent);
      await consumer.handle(client, event);
      await consumer.handle(client, event);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const receipts = await pool.query('SELECT consumer_name, event_id FROM event_consumer_receipts');
    expect(receipts.rows).toEqual([{ consumer_name: 'phase8-document-event-sink', event_id: event.id }]);
  });
});
