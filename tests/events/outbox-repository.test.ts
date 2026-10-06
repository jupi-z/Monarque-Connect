import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { createDomainEvent } from '../../src/events/domain-event.factory.js';
import { OutboxRepository } from '../../src/events/outbox.repository.js';
import { createTestPool, resetEventTables } from './test-database.js';

describe('OutboxRepository', () => {
  let pool: Pool;
  let repository: OutboxRepository;

  beforeAll(async () => {
    pool = createTestPool();
    await pool.query('SELECT 1');
    repository = new OutboxRepository();
  });

  beforeEach(async () => resetEventTables(pool));
  afterAll(async () => pool.end());

  it('persists a canonical event and claims it exactly once', async () => {
    const event = createDomainEvent({
      eventType: 'foundation.probe.recorded',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      actor: { type: 'SYSTEM' },
      aggregate: { type: 'FoundationProbe', id: '0f8fad5b-d9cb-469f-a165-70867728950e' },
      correlationId: '9f8fad5b-d9cb-469f-a165-70867728950e',
      dataClassification: 'INTERNAL',
      purpose: 'phase-0.5-proof',
      payload: { value: 'probe' },
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await repository.enqueue(client, event);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const claimClient = await pool.connect();
    try {
      await claimClient.query('BEGIN');
      const [claimed] = await repository.claimBatch(claimClient, {
        workerId: 'worker-a',
        batchSize: 10,
        leaseSeconds: 60,
      });
      await claimClient.query('COMMIT');
      expect(claimed).toMatchObject({
        id: event.eventId,
        status: 'PROCESSING',
        attempts: 1,
        lockedBy: 'worker-a',
      });
    } finally {
      claimClient.release();
    }

    const row = await pool.query('SELECT status, attempts FROM outbox_events WHERE id = $1', [event.eventId]);
    expect(row.rows[0]).toEqual({ status: 'PROCESSING', attempts: 1 });
  });

  it('marks processed and clears the lease', async () => {
    const event = createDomainEvent({
      eventType: 'foundation.probe.recorded',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      actor: { type: 'SYSTEM' },
      aggregate: { type: 'FoundationProbe', id: '0f8fad5b-d9cb-469f-a165-70867728950e' },
      correlationId: '9f8fad5b-d9cb-469f-a165-70867728950e',
      dataClassification: 'INTERNAL',
      purpose: 'phase-0.5-proof',
      payload: { value: 'probe' },
    });
    await pool.query(
      `INSERT INTO outbox_events
        (id, event_type, event_version, actor_type, aggregate_type, aggregate_id,
         correlation_id, data_classification, purpose, payload_json, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
      [
        event.eventId,
        event.eventType,
        event.eventVersion,
        event.actor.type,
        event.aggregate.type,
        event.aggregate.id,
        event.correlationId,
        event.dataClassification,
        event.purpose,
        JSON.stringify(event.payload),
        event.occurredAt,
      ],
    );
    await pool.query("UPDATE outbox_events SET status = 'PROCESSING', locked_by = 'worker-a', claim_token = '0f8fad5b-d9cb-469f-a165-70867728950e', locked_at = now(), attempts = 1 WHERE id = $1", [event.eventId]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await repository.markProcessed(client, event.eventId, '0f8fad5b-d9cb-469f-a165-70867728950e');
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const row = await pool.query<{
      status: string;
      locked_by: string | null;
      locked_at: Date | null;
      processed_at: Date | null;
    }>('SELECT status, locked_by, locked_at, processed_at FROM outbox_events WHERE id = $1', [event.eventId]);
    const processed = row.rows[0];
    if (!processed) throw new Error('expected processed outbox row');
    expect(processed.status).toBe('PROCESSED');
    expect(processed.locked_by).toBeNull();
    expect(processed.locked_at).toBeNull();
    expect(processed.processed_at).not.toBeNull();
  });

  it('fences a stale worker after an expired lease is reclaimed', async () => {
    const event = createDomainEvent({
      eventType: 'foundation.probe.recorded',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      actor: { type: 'SYSTEM' },
      aggregate: { type: 'FoundationProbe', id: '0f8fad5b-d9cb-469f-a165-70867728950e' },
      correlationId: '9f8fad5b-d9cb-469f-a165-70867728950e',
      dataClassification: 'INTERNAL',
      purpose: 'phase-0.5-proof',
      payload: { value: 'fenced' },
    });
    await pool.query(
      `INSERT INTO outbox_events
        (id, event_type, event_version, actor_type, aggregate_type, aggregate_id,
         correlation_id, data_classification, purpose, payload_json, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
      [event.eventId, event.eventType, event.eventVersion, event.actor.type, event.aggregate.type,
        event.aggregate.id, event.correlationId, event.dataClassification, event.purpose,
        JSON.stringify(event.payload), event.occurredAt],
    );
    const firstClient = await pool.connect();
    await firstClient.query('BEGIN');
    const [firstClaim] = await repository.claimBatch(firstClient, {
      workerId: 'worker-a', batchSize: 1, leaseSeconds: 60, maxAttempts: 8,
    });
    await firstClient.query('COMMIT');
    firstClient.release();
    if (!firstClaim) throw new Error('expected first claim');
    await pool.query("UPDATE outbox_events SET locked_at = now() - interval '2 minutes' WHERE id = $1", [event.eventId]);

    const secondClient = await pool.connect();
    await secondClient.query('BEGIN');
    const [secondClaim] = await repository.claimBatch(secondClient, {
      workerId: 'worker-b', batchSize: 1, leaseSeconds: 60, maxAttempts: 8,
    });
    await secondClient.query('COMMIT');
    secondClient.release();
    if (!secondClaim) throw new Error('expected second claim');

    const staleClient = await pool.connect();
    await staleClient.query('BEGIN');
    await expect(repository.markProcessed(staleClient, firstClaim.id, firstClaim.claimToken)).rejects.toThrow(/claim lost/i);
    await staleClient.query('ROLLBACK');
    staleClient.release();
    const staleStatus = await pool.query<{ status: string; claim_token: string }>('SELECT status, claim_token FROM outbox_events WHERE id = $1', [event.eventId]);
    expect(staleStatus.rows[0]?.status).toBe('PROCESSING');
    expect(staleStatus.rows[0]?.claim_token).toBe(secondClaim.claimToken);
  });

  it('reports operational outbox metrics without exposing payloads', async () => {
    const event = createDomainEvent({
      eventType: 'foundation.probe.recorded',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      actor: { type: 'SYSTEM' },
      aggregate: { type: 'FoundationProbe', id: '0f8fad5b-d9cb-469f-a165-70867728950e' },
      correlationId: '9f8fad5b-d9cb-469f-a165-70867728950e',
      dataClassification: 'INTERNAL',
      purpose: 'phase-0.5-proof',
      payload: { value: 'metrics' },
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await repository.enqueue(client, event);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const metrics = await repository.readOperationalMetrics(pool);
    expect(metrics.pendingTotal).toBe(1);
    expect(metrics.failedTotal).toBe(0);
    expect(metrics.processingTotal).toBe(0);
    expect(metrics.oldestPendingAt).toBeInstanceOf(Date);
    expect(metrics.maxAttempts).toBe(0);
    expect(metrics).not.toHaveProperty('payload');
  });
});
