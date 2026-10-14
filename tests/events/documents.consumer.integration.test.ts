import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { EventReceiptConsumer } from '../../src/events/event-receipt.consumer.js';
import type { ClaimedOutboxEvent } from '../../src/events/outbox.repository.js';
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
    const event: ClaimedOutboxEvent = {
      id: '11111111-1111-4111-8111-111111111111',
      eventType: 'document.available.v1',
      eventVersion: 1,
      organizationId: null,
      establishmentId: null,
      actorType: 'USER',
      actorId: null,
      aggregateType: 'Document',
      aggregateId: '22222222-2222-4222-8222-222222222222',
      correlationId: '33333333-3333-4333-8333-333333333333',
      causationId: null,
      requestId: null,
      dataClassification: 'CONFIDENTIAL',
      purpose: 'documents',
      payload: { checksumSha256: 'a'.repeat(64) },
      status: 'PROCESSING',
      attempts: 1,
      lockedBy: 'test-worker',
      claimToken: '44444444-4444-4444-8444-444444444444',
      occurredAt: new Date(),
      recordedAt: new Date(),
    };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
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
