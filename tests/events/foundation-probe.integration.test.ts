import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { createRequestContext } from '../../src/events/event-context.js';
import { FoundationProbeService } from '../../src/events/foundation-probe.service.js';
import { OutboxRepository } from '../../src/events/outbox.repository.js';
import { createTestPool, resetEventTables } from './test-database.js';

describe('FoundationProbeService', () => {
  let pool: Pool;
  let service: FoundationProbeService;
  let client: PoolClient;

  beforeAll(async () => {
    pool = createTestPool();
    await pool.query('SELECT 1');
    service = new FoundationProbeService(new OutboxRepository());
  });

  beforeEach(async () => {
    await resetEventTables(pool);
    await pool.query('TRUNCATE TABLE foundation_probes RESTART IDENTITY CASCADE');
  });

  afterAll(async () => pool.end());

  it('writes the foundation fact and outbox event in one transaction', async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await service.recordFoundationProbe(client, 'probe-value', createRequestContext());
    await client.query('COMMIT');
    client.release();

    const probes = await pool.query('SELECT id, value FROM foundation_probes');
    const events = await pool.query<{ aggregate_id: string; event_type: string; payload_json: { value: string } }>(
      "SELECT aggregate_id, event_type, payload_json FROM outbox_events WHERE event_type = 'foundation.probe.recorded'",
    );
    expect(probes.rows).toHaveLength(1);
    expect(probes.rows[0]).toEqual({ id: result.probeId, value: 'probe-value' });
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]?.aggregate_id).toBe(result.probeId);
    expect(events.rows[0]?.payload_json).toEqual({ value: 'probe-value' });
  });

  it('rolls back the fact and event together', async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    await service.recordFoundationProbe(client, 'rolled-back', createRequestContext());
    await client.query('ROLLBACK');
    client.release();

    await expect(pool.query('SELECT 1 FROM foundation_probes')).resolves.toMatchObject({ rows: [] });
    await expect(pool.query('SELECT 1 FROM outbox_events')).resolves.toMatchObject({ rows: [] });
  });
});
