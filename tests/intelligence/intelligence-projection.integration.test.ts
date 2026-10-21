import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { IntelligenceConsumer } from '../../src/intelligence/intelligence.consumer.js';
import { IntelligenceProjectionService } from '../../src/intelligence/intelligence-projection.service.js';
import { MetricCalculatorService } from '../../src/intelligence/metric-calculator.service.js';
import { createDomainEvent } from '../../src/events/domain-event.factory.js';
import { OutboxRepository, type ClaimedOutboxEvent, type EventDbClient } from '../../src/events/outbox.repository.js';
import { PrismaOutboxWriter } from '../../src/events/prisma-outbox.writer.js';
import { createTestPool } from '../events/test-database.js';

const observedAt = new Date('2026-10-21T12:00:00.000Z');
const activityDay = new Date('2026-10-05T00:00:00.000Z');

describe('Intelligence projections (PostgreSQL)', () => {
  let pool: Pool;
  let prisma: PrismaService;
  let calculator: MetricCalculatorService;
  let projection: IntelligenceProjectionService;
  let consumer: IntelligenceConsumer;
  let organizationId: string;
  let establishmentId: string;
  let invoiceId: string;
  let businessTypeCode: string;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    pool = createTestPool();
    const connectionString = String(pool.options.connectionString);
    process.env.DATABASE_URL = connectionString;
    prisma = new PrismaService({ getOrThrow: () => connectionString } as never);
    await prisma.$connect();
    calculator = new MetricCalculatorService(prisma);
    projection = new IntelligenceProjectionService(prisma, calculator, new PrismaOutboxWriter());
    consumer = new IntelligenceConsumer(prisma, projection);
    businessTypeCode = `intelligence-projection-${randomUUID()}`;
    organizationId = randomUUID();
    establishmentId = randomUUID();
    await pool.query('INSERT INTO business_types (code, name) VALUES ($1, $1)', [businessTypeCode]);
    await pool.query(
      `INSERT INTO organizations (id, business_type_code, name, handle, default_currency, created_at, updated_at)
       VALUES ($1, $2, 'Projection test', $3, 'EUR', now(), now())`,
      [organizationId, businessTypeCode, `projection-${organizationId}`],
    );
    await pool.query(
      `INSERT INTO establishments (id, organization_id, code, name, type, created_at, updated_at)
       VALUES ($1, $2, 'MAIN', 'Main', 'HEAD_OFFICE', now(), now())`,
      [establishmentId, organizationId],
    );
  }, 60000);

  beforeEach(async () => {
    await pool.query('DELETE FROM event_consumer_receipts WHERE consumer_name = $1', ['intelligence-projection']);
    await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [organizationId]);
    await pool.query('DELETE FROM metric_snapshots WHERE organization_id = $1', [organizationId]);
    await pool.query('DELETE FROM insight_alerts WHERE organization_id = $1', [organizationId]);
    await pool.query('DELETE FROM invoices WHERE organization_id = $1', [organizationId]);
    await pool.query('DELETE FROM projects WHERE organization_id = $1', [organizationId]);
    invoiceId = randomUUID();
    await insertInvoice('ISSUED');
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
      await pool.query('DELETE FROM business_types WHERE code = $1', [businessTypeCode]);
      await pool.end();
    }
    await prisma?.$disconnect();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it('deduplicates event receipts and produces the canonical daily snapshot once', async () => {
    const event = await enqueueEvent('sales.invoice.created', 'Invoice', invoiceId, { status: 'ISSUED' });
    await consumer.handle(noopClient, event);
    await consumer.handle(noopClient, event);

    const snapshots = await pool.query<{ value_json: Record<string, unknown>; source_as_of: Date; period_start: Date; period_end: Date }>(
      `SELECT value_json, source_as_of, period_start, period_end FROM metric_snapshots
       WHERE organization_id = $1 AND metric_code = 'SALES_ISSUED'`,
      [organizationId],
    );
    const receipts = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM event_consumer_receipts WHERE consumer_name = 'intelligence-projection' AND event_id = $1`,
      [event.id],
    );
    expect(snapshots.rows).toHaveLength(1);
    expect(snapshots.rows[0]?.value_json).toMatchObject({ count: 1, amount: '125.5000', currency: 'EUR' });
    expect(snapshots.rows[0]?.period_start).toEqual(activityDay);
    expect(snapshots.rows[0]?.period_end).toEqual(new Date('2026-10-06T00:00:00.000Z'));
    expect(receipts.rows[0]?.count).toBe(1);
  });

  it('rolls back the receipt when projection fails, then accepts a valid retry', async () => {
    const event = await enqueueEvent('sales.invoice.created', 'Invoice', invoiceId, { status: 'ISSUED' });
    const calculate = vi.spyOn(calculator, 'calculate').mockRejectedValueOnce(new Error('transient calculation failure'));
    await expect(consumer.handle(noopClient, event)).rejects.toThrow('transient calculation failure');
    calculate.mockRestore();
    expect((await pool.query(`SELECT 1 FROM event_consumer_receipts WHERE consumer_name = 'intelligence-projection'`)).rows).toHaveLength(0);
    expect((await pool.query(`SELECT 1 FROM metric_snapshots WHERE organization_id = $1`, [organizationId])).rows).toHaveLength(0);

    await consumer.handle(noopClient, event);
    expect((await pool.query(`SELECT 1 FROM metric_snapshots WHERE organization_id = $1 AND metric_code = 'SALES_ISSUED'`, [organizationId])).rows).toHaveLength(1);
  });

  it('does not let a late, older recomputation overwrite a newer sourceAsOf', async () => {
    const period = { from: activityDay, to: new Date('2026-10-06T00:00:00.000Z') };
    await projection.recompute({ organizationId, period, metricCodes: ['SALES_ISSUED'], sourceAsOf: observedAt });
    await pool.query('UPDATE invoices SET total_gross = 999.0000 WHERE id = $1', [invoiceId]);
    await projection.recompute({ organizationId, period, metricCodes: ['SALES_ISSUED'], sourceAsOf: new Date('2026-10-20T12:00:00.000Z') });

    const snapshot = await pool.query<{ value_json: Record<string, unknown>; source_as_of: Date }>(
      `SELECT value_json, source_as_of FROM metric_snapshots WHERE organization_id = $1 AND metric_code = 'SALES_ISSUED'`,
      [organizationId],
    );
    expect(snapshot.rows[0]?.value_json).toMatchObject({ amount: '125.5000' });
    expect(snapshot.rows[0]?.source_as_of).toEqual(observedAt);
  });

  it('serializes concurrent upserts to one period key and preserves the newest sourceAsOf', async () => {
    const period = { from: activityDay, to: new Date('2026-10-06T00:00:00.000Z') };
    await Promise.all([
      projection.recompute({ organizationId, period, metricCodes: ['SALES_ISSUED'], sourceAsOf: observedAt }),
      projection.recompute({ organizationId, period, metricCodes: ['SALES_ISSUED'], sourceAsOf: new Date('2026-10-21T12:01:00.000Z') }),
    ]);
    const snapshots = await pool.query<{ source_as_of: Date }>(
      `SELECT source_as_of FROM metric_snapshots WHERE organization_id = $1 AND metric_code = 'SALES_ISSUED'`,
      [organizationId],
    );
    expect(snapshots.rows).toHaveLength(1);
    expect(snapshots.rows[0]?.source_as_of).toEqual(new Date('2026-10-21T12:01:00.000Z'));
  });

  it('opens, resolves, and reopens an overdue invoice alert with atomic transition events', async () => {
    const recompute = (sourceAsOf: Date) => projection.recompute({ organizationId, metricCodes: ['RECEIVABLES_OUTSTANDING'], sourceAsOf });
    await recompute(observedAt);
    await recompute(observedAt);
    expect((await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM insight_alerts WHERE organization_id = $1 AND rule_code = 'INVOICE_OVERDUE' AND status = 'OPEN'`, [organizationId])).rows[0]?.count).toBe(1);
    expect((await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM outbox_events WHERE organization_id = $1 AND event_type = 'intelligence.alert.opened.v1'`, [organizationId])).rows[0]?.count).toBe(1);

    await pool.query(`UPDATE invoices SET status = 'PAID' WHERE id = $1`, [invoiceId]);
    await recompute(new Date('2026-10-21T12:01:00.000Z'));
    expect((await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM insight_alerts WHERE organization_id = $1 AND rule_code = 'INVOICE_OVERDUE' AND status = 'RESOLVED'`, [organizationId])).rows[0]?.count).toBe(1);
    expect((await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM outbox_events WHERE organization_id = $1 AND event_type = 'intelligence.alert.resolved.v1'`, [organizationId])).rows[0]?.count).toBe(1);

    await pool.query(`UPDATE invoices SET status = 'ISSUED' WHERE id = $1`, [invoiceId]);
    await recompute(new Date('2026-10-21T12:02:00.000Z'));
    expect((await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM insight_alerts WHERE organization_id = $1 AND rule_code = 'INVOICE_OVERDUE'`, [organizationId])).rows[0]?.count).toBe(2);
    expect((await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM insight_alerts WHERE organization_id = $1 AND rule_code = 'INVOICE_OVERDUE' AND status = 'OPEN'`, [organizationId])).rows[0]?.count).toBe(1);
  });

  it('opens and resolves the initial overdue-project warning without exposing source content', async () => {
    const userId = randomUUID();
    const projectId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, normalized_email, password_hash, first_name, last_name, created_at, updated_at)
       VALUES ($1, $2, $2, 'test-hash', 'Test', 'User', now(), now())`,
      [userId, `${userId}@example.test`],
    );
    await pool.query(
      `INSERT INTO projects (id, organization_id, establishment_id, name, description, due_on, status, created_by_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'Overdue project', 'private description', '2026-10-10', 'ACTIVE', $4, now(), now())`,
      [projectId, organizationId, establishmentId, userId],
    );

    await projection.recompute({ organizationId, metricCodes: ['PROJECTS_OVERDUE'], sourceAsOf: observedAt });
    const opened = await pool.query<{ status: string; payload_json: Record<string, unknown> }>(
      `SELECT status, payload_json FROM insight_alerts WHERE organization_id = $1 AND source_id = $2`,
      [organizationId, projectId],
    );
    expect(opened.rows).toHaveLength(1);
    expect(opened.rows[0]).toMatchObject({ status: 'OPEN', payload_json: {} });
    expect((await pool.query<{ payload_json: Record<string, unknown> }>(
      `SELECT payload_json FROM outbox_events WHERE organization_id = $1 AND event_type = 'intelligence.alert.opened.v1'`,
      [organizationId],
    )).rows[0]?.payload_json).not.toHaveProperty('description');

    await pool.query(`UPDATE projects SET status = 'COMPLETED' WHERE id = $1`, [projectId]);
    await projection.recompute({ organizationId, metricCodes: ['PROJECTS_OVERDUE'], sourceAsOf: new Date('2026-10-21T12:01:00.000Z') });
    expect((await pool.query<{ status: string }>(`SELECT status FROM insight_alerts WHERE organization_id = $1 AND source_id = $2`, [organizationId, projectId])).rows[0]?.status).toBe('RESOLVED');
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  });

  it('makes bounded rebuild repeatable and equal to the source calculation', async () => {
    const input = { organizationId, from: activityDay, to: new Date('2026-10-06T00:00:00.000Z'), sourceAsOf: observedAt };
    await projection.rebuild(input);
    const first = await pool.query<{ metric_code: string; dimension_key: string; currency_key: string; value_json: Record<string, unknown> }>(
      `SELECT metric_code, dimension_key, currency_key, value_json FROM metric_snapshots WHERE organization_id = $1 ORDER BY metric_code, dimension_key`,
      [organizationId],
    );
    await projection.rebuild(input);
    const second = await pool.query<{ metric_code: string; dimension_key: string; currency_key: string; value_json: Record<string, unknown> }>(
      `SELECT metric_code, dimension_key, currency_key, value_json FROM metric_snapshots WHERE organization_id = $1 ORDER BY metric_code, dimension_key`,
      [organizationId],
    );
    expect(second.rows).toEqual(first.rows);
    const salesSnapshot = second.rows.find((row) => row.metric_code === 'SALES_ISSUED');
    expect(salesSnapshot?.value_json.count).toBe(1);
  });

  it('rejects activity windows that are not whole UTC days or exceed the rebuild bound', async () => {
    await expect(projection.recompute({
      organizationId,
      metricCodes: ['SALES_ISSUED'],
      period: { from: new Date('2026-10-05T12:00:00.000Z'), to: new Date('2026-10-06T00:00:00.000Z') },
      sourceAsOf: observedAt,
    })).rejects.toThrow(/UTC-midnight/);
    await expect(projection.rebuild({
      organizationId,
      from: new Date('2025-10-01T00:00:00.000Z'),
      to: new Date('2026-10-03T00:00:00.000Z'),
      sourceAsOf: observedAt,
    })).rejects.toThrow(/limited to 366/);
  });

  async function insertInvoice(status: 'ISSUED' | 'PAID'): Promise<void> {
    await pool.query(
      `INSERT INTO invoices (id, organization_id, establishment_id, number, status, currency, issued_at, due_at, total_net, total_tax, total_gross, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'EUR', $6, $7, 100.0000, 25.5000, 125.5000, now(), now())`,
      [invoiceId, organizationId, establishmentId, `INV-${invoiceId.slice(0, 8)}`, status, activityDay, new Date('2026-10-10T00:00:00.000Z')],
    );
  }

  async function enqueueEvent(eventType: string, aggregateType: string, aggregateId: string, payload: Record<string, unknown>): Promise<ClaimedOutboxEvent> {
    const domainEvent = createDomainEvent({
      eventType,
      eventVersion: 1,
      occurredAt: activityDay.toISOString(),
      actor: { type: 'SYSTEM' },
      aggregate: { type: aggregateType, id: aggregateId },
      organizationId,
      establishmentId,
      correlationId: randomUUID(),
      dataClassification: 'CONFIDENTIAL',
      purpose: 'test-intelligence-projection',
      payload,
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await new OutboxRepository().enqueue(client, domainEvent);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    return {
      id: domainEvent.eventId,
      eventType,
      eventVersion: 1,
      organizationId,
      establishmentId,
      actorType: 'SYSTEM',
      actorId: null,
      aggregateType,
      aggregateId,
      correlationId: domainEvent.correlationId,
      causationId: null,
      requestId: null,
      dataClassification: 'CONFIDENTIAL',
      purpose: domainEvent.purpose,
      payload,
      status: 'PROCESSING',
      attempts: 1,
      lockedBy: 'test-worker',
      claimToken: randomUUID(),
      occurredAt: new Date(domainEvent.occurredAt),
      recordedAt: new Date(domainEvent.recordedAt),
    };
  }
});

const noopClient: EventDbClient = {
  query: () => Promise.resolve({ rows: [], rowCount: 0 }) as never,
};
