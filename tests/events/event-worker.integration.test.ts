import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { EventDispatcher } from '../../src/events/event-dispatcher.js';
import type { EventHandler } from '../../src/events/event-dispatcher.js';
import { EventWorker } from '../../src/events/event-worker.js';
import { OutboxRepository } from '../../src/events/outbox.repository.js';
import { createDomainEvent } from '../../src/events/domain-event.factory.js';
import { createTestPool, resetEventTables } from './test-database.js';

describe('EventWorker', () => {
  let pool: Pool;
  let repository: OutboxRepository;

  beforeAll(async () => {
    pool = createTestPool();
    await pool.query('SELECT 1');
    repository = new OutboxRepository();
  });

  beforeEach(async () => {
    await resetEventTables(pool);
    await pool.query('TRUNCATE TABLE foundation_probe_projections, foundation_probes RESTART IDENTITY CASCADE');
  });

  afterAll(async () => pool.end());

  it('does not let two workers claim the same locked row', async () => {
    const event = await insertEvent(pool);
    const first = await pool.connect();
    const second = await pool.connect();
    await first.query('BEGIN');
    const firstClaim = repository.claimBatch(first, { workerId: 'worker-a', batchSize: 1, leaseSeconds: 60 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await second.query('BEGIN');
    const secondClaim = repository.claimBatch(second, { workerId: 'worker-b', batchSize: 1, leaseSeconds: 60 });

    const [claimedByFirst, claimedBySecond] = await Promise.all([firstClaim, secondClaim]);
    await first.query('COMMIT');
    await second.query('COMMIT');
    first.release();
    second.release();

    expect(claimedByFirst).toHaveLength(1);
    expect(claimedByFirst[0]?.id).toBe(event.eventId);
    expect(claimedBySecond).toHaveLength(0);
  });

  it('recovers a processing row after its lease expires', async () => {
    const event = await insertEvent(pool);
    await pool.query(
      `UPDATE outbox_events SET status = 'PROCESSING', attempts = 1,
       locked_at = now() - interval '2 minutes', locked_by = 'dead-worker' WHERE id = $1`,
      [event.eventId],
    );
    const worker = createWorker(pool, () => Promise.resolve());

    await expect(worker.processBatch({ leaseSeconds: 60 })).resolves.toBe(1);
    const row = await pool.query('SELECT status, attempts, locked_by FROM outbox_events WHERE id = $1', [event.eventId]);
    expect(row.rows[0]).toEqual({ status: 'PROCESSED', attempts: 2, locked_by: null });
  });

  it('retries a recoverable handler failure and marks max attempts failed', async () => {
    const event = await insertEvent(pool);
    const handler = vi.fn().mockRejectedValue(new Error('temporary failure'));
    const worker = createWorker(pool, handler);

    await expect(worker.processBatch({ maxAttempts: 2, now: new Date('2026-10-06T19:00:00.000Z') })).resolves.toBe(1);
    const row = await pool.query<{ status: string; attempts: number; last_error_code: string; next_attempt_at: Date }>('SELECT status, attempts, last_error_code, next_attempt_at FROM outbox_events WHERE id = $1', [event.eventId]);
    expect(row.rows[0]?.status).toBe('PENDING');
    expect(row.rows[0]?.attempts).toBe(1);
    expect(row.rows[0]?.last_error_code).toBe('EVENT_PROCESSING_FAILED');
    expect(row.rows[0]?.next_attempt_at.toISOString()).toBe('2026-10-06T19:00:01.000Z');

    await pool.query('UPDATE outbox_events SET next_attempt_at = now() - interval \'1 second\' WHERE id = $1', [event.eventId]);
    await expect(worker.processBatch({ maxAttempts: 2 })).resolves.toBe(1);
    const finalRow = await pool.query<{ status: string; attempts: number; locked_by: string | null }>('SELECT status, attempts, locked_by FROM outbox_events WHERE id = $1', [event.eventId]);
    expect(finalRow.rows[0]).toEqual({ status: 'FAILED', attempts: 2, locked_by: null });
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

function createWorker(pool: Pool, handler: EventHandler): EventWorker {
  const dispatcher = new EventDispatcher();
  dispatcher.register('foundation.probe.recorded', 1, handler);
  return new EventWorker(pool, new OutboxRepository(), dispatcher);
}

async function insertEvent(pool: Pool): Promise<{ eventId: string }> {
  const repository = new OutboxRepository();
  const event = createDomainEvent({
    eventType: 'foundation.probe.recorded',
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    actor: { type: 'SYSTEM' },
    aggregate: { type: 'FoundationProbe', id: '0f8fad5b-d9cb-469f-a165-70867728950e' },
    correlationId: '9f8fad5b-d9cb-469f-a165-70867728950e',
    dataClassification: 'INTERNAL',
    purpose: 'phase-0.5-proof',
    payload: { value: 'worker' },
  });
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await repository.enqueue(client, event);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  return { eventId: event.eventId };
}
