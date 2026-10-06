import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { FoundationProbeConsumer } from '../../src/events/foundation-probe.consumer.js';
import { FoundationProbeService } from '../../src/events/foundation-probe.service.js';
import { createRequestContext } from '../../src/events/event-context.js';
import { OutboxRepository, type ClaimedOutboxEvent } from '../../src/events/outbox.repository.js';
import { createTestPool, resetEventTables } from './test-database.js';

describe('FoundationProbeConsumer', () => {
  let pool: Pool;
  let service: FoundationProbeService;
  let consumer: FoundationProbeConsumer;

  beforeAll(async () => {
    pool = createTestPool();
    await pool.query('SELECT 1');
    service = new FoundationProbeService(new OutboxRepository());
    consumer = new FoundationProbeConsumer();
  });

  beforeEach(async () => {
    await resetEventTables(pool);
    await pool.query('TRUNCATE TABLE foundation_probe_projections RESTART IDENTITY CASCADE');
    await pool.query('TRUNCATE TABLE foundation_probes RESTART IDENTITY CASCADE');
  });

  afterAll(async () => pool.end());

  it('applies the projection once when the event is replayed', async () => {
    const writeClient = await pool.connect();
    await writeClient.query('BEGIN');
    const created = await service.recordFoundationProbe(
      writeClient,
      'project-me',
      createRequestContext(),
    );
    await writeClient.query('COMMIT');
    writeClient.release();

    const claimClient = await pool.connect();
    await claimClient.query('BEGIN');
    const [event] = await new OutboxRepository().claimBatch(claimClient, {
      workerId: 'worker-a',
      batchSize: 1,
      leaseSeconds: 60,
    });
    await claimClient.query('COMMIT');
    claimClient.release();
    expect(event.id).toBe(created.eventId);

    await consumeInTransaction(pool, consumer, event);
    await consumeInTransaction(pool, consumer, event);

    const projections = await pool.query('SELECT event_id, value FROM foundation_probe_projections');
    const receipts = await pool.query('SELECT consumer_name, event_id FROM event_consumer_receipts');
    expect(projections.rows).toHaveLength(1);
    expect(projections.rows[0]).toEqual({ event_id: event.id, value: 'project-me' });
    expect(receipts.rows).toHaveLength(1);
    expect(receipts.rows[0]).toEqual({ consumer_name: 'foundation-probe-projection', event_id: event.id });
  });

  it('rolls back the receipt and effect together', async () => {
    const writeClient = await pool.connect();
    await writeClient.query('BEGIN');
    await service.recordFoundationProbe(writeClient, 'rollback-me', createRequestContext());
    await writeClient.query('COMMIT');
    writeClient.release();

    const claimClient = await pool.connect();
    await claimClient.query('BEGIN');
    const [event] = await new OutboxRepository().claimBatch(claimClient, {
      workerId: 'worker-a',
      batchSize: 1,
      leaseSeconds: 60,
    });
    await claimClient.query('COMMIT');
    claimClient.release();

    const client = await pool.connect();
    await client.query('BEGIN');
    await consumer.handle(client, event);
    await client.query('ROLLBACK');
    client.release();

    expect((await pool.query('SELECT 1 FROM foundation_probe_projections')).rows).toHaveLength(0);
    expect((await pool.query('SELECT 1 FROM event_consumer_receipts')).rows).toHaveLength(0);
  });
});

async function consumeInTransaction(
  pool: Pool,
  consumer: FoundationProbeConsumer,
  event: ClaimedOutboxEvent,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await consumer.handle(client, event);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}
