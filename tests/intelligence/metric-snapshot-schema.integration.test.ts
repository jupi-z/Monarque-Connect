import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';

describe('Phase 10A projection schema constraints', () => {
  let pool: Pool;
  let organizationId: string;
  let otherOrganizationId: string;
  let establishmentId: string;
  let otherEstablishmentId: string;
  let businessTypeCode: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    businessTypeCode = `intelligence-test-${randomUUID()}`;
    await pool.query('INSERT INTO business_types (code, name) VALUES ($1, $1)', [businessTypeCode]);
    organizationId = randomUUID();
    otherOrganizationId = randomUUID();
    establishmentId = randomUUID();
    otherEstablishmentId = randomUUID();

    await pool.query(
      `INSERT INTO organizations (id, business_type_code, name, handle, default_currency, created_at, updated_at)
       VALUES ($1, $3, 'Intelligence schema tenant', $4, 'EUR', now(), now()),
              ($2, $3, 'Other intelligence tenant', $5, 'EUR', now(), now())`,
      [organizationId, otherOrganizationId, businessTypeCode, `intel-${organizationId}`, `intel-${otherOrganizationId}`],
    );
    await pool.query(
      `INSERT INTO establishments (id, organization_id, code, name, type, created_at, updated_at)
       VALUES ($1, $3, 'MAIN', 'Main', 'HEAD_OFFICE', now(), now()),
              ($2, $4, 'MAIN', 'Main', 'HEAD_OFFICE', now(), now())`,
      [establishmentId, otherEstablishmentId, organizationId, otherOrganizationId],
    );
  }, 60000);

  afterAll(async () => {
    if (!pool) return;
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[organizationId, otherOrganizationId]]);
    await pool.query('DELETE FROM business_types WHERE code = $1', [businessTypeCode]);
    await pool.end();
  });

  const insertSnapshot = (overrides: Record<string, unknown> = {}) => {
    const defaults = {
      id: randomUUID(),
      organizationId,
      establishmentId: null as string | null,
      scopeKey: 'ORG',
      metricCode: 'SALES_ISSUED',
      definitionVersion: 1,
      dimensionKey: 'DEFAULT',
      currencyKey: 'NONE',
      currency: null as string | null,
      periodStart: new Date('2026-10-01T00:00:00.000Z') as Date | null,
      periodEnd: new Date('2026-11-01T00:00:00.000Z') as Date | null,
      asOf: null as Date | null,
      valueDecimal: '1.000000000000',
      valueJson: null as object | null,
    };
    const row = { ...defaults, ...overrides };
    return pool.query(
      `INSERT INTO metric_snapshots (
        id, organization_id, establishment_id, scope_key, metric_code, definition_version,
        dimension_key, currency_key, currency, period_start, period_end, as_of,
        value_decimal, value_json, calculated_at, source_as_of, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now(), now(), now())`,
      [row.id, row.organizationId, row.establishmentId, row.scopeKey, row.metricCode, row.definitionVersion,
        row.dimensionKey, row.currencyKey, row.currency, row.periodStart, row.periodEnd, row.asOf,
        row.valueDecimal, row.valueJson],
    );
  };

  const insertAlert = (overrides: Record<string, unknown> = {}) => {
    const row = {
      id: randomUUID(), organizationId, establishmentId: null, ruleCode: 'INVOICE_OVERDUE', ruleVersion: 1,
      severity: 'WARNING', status: 'OPEN', sourceType: 'INVOICE', sourceId: randomUUID(), dedupeKey: `invoice:${randomUUID()}`,
      triggeredAt: new Date(), lastEvaluatedAt: new Date(), resolvedAt: null, payloadJson: {},
      ...overrides,
    };
    return pool.query(
      `INSERT INTO insight_alerts (
        id, organization_id, establishment_id, rule_code, rule_version, severity, status,
        source_type, source_id, dedupe_key, triggered_at, last_evaluated_at, resolved_at, payload_json, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())`,
      [row.id, row.organizationId, row.establishmentId, row.ruleCode, row.ruleVersion, row.severity, row.status,
        row.sourceType, row.sourceId, row.dedupeKey, row.triggeredAt, row.lastEvaluatedAt, row.resolvedAt, row.payloadJson],
    );
  };

  it('enforces tenant-composite establishment foreign keys', async () => {
    await expect(insertSnapshot({
      establishmentId: otherEstablishmentId,
      scopeKey: `ESTABLISHMENT:${otherEstablishmentId}`,
      periodStart: new Date('2026-10-01T00:00:00.000Z'),
      periodEnd: new Date('2026-11-01T00:00:00.000Z'),
    })).rejects.toMatchObject({ code: '23503' });
  });

  it('requires exactly one temporal mode and an increasing half-open period', async () => {
    await expect(insertSnapshot({ periodStart: null, periodEnd: null, asOf: null })).rejects.toMatchObject({ code: '23514' });
    await expect(insertSnapshot({ asOf: new Date('2026-10-15T00:00:00.000Z') })).rejects.toMatchObject({ code: '23514' });
    await expect(insertSnapshot({ periodEnd: new Date('2026-10-01T00:00:00.000Z') })).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces separate unique keys for period and instant snapshots', async () => {
    const period = { metricCode: 'PERIOD_UNIQUE', dimensionKey: 'period' };
    await insertSnapshot(period);
    await expect(insertSnapshot(period)).rejects.toMatchObject({ code: '23505' });

    const instant = {
      metricCode: 'INSTANT_UNIQUE', dimensionKey: 'instant', periodStart: null, periodEnd: null,
      asOf: new Date('2026-10-15T00:00:00.000Z'),
    };
    await insertSnapshot(instant);
    await expect(insertSnapshot(instant)).rejects.toMatchObject({ code: '23505' });
  });

  it('normalizes absent currency to NONE without a currency value', async () => {
    await expect(insertSnapshot({ metricCode: 'NO_CURRENCY', dimensionKey: 'none' })).resolves.toBeDefined();
    await expect(insertSnapshot({ metricCode: 'INVALID_CURRENCY', dimensionKey: 'null-with-usd', currencyKey: 'USD' })).rejects.toMatchObject({ code: '23514' });
  });

  it('deduplicates open alerts but retains resolved occurrences', async () => {
    const dedupeKey = `invoice:${randomUUID()}`;
    await insertAlert({ dedupeKey });
    await expect(insertAlert({ dedupeKey })).rejects.toMatchObject({ code: '23505' });
    await expect(insertAlert({ dedupeKey, status: 'RESOLVED', resolvedAt: new Date() })).resolves.toBeDefined();
  });
});
