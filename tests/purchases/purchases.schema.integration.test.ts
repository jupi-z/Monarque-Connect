import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPool } from '../events/test-database.js';

const purchaseTables = [
  'supplier_rfqs',
  'supplier_rfq_recipients',
  'supplier_rfq_lines',
  'purchase_orders',
  'purchase_order_lines',
  'goods_receipts',
  'goods_receipt_lines',
  'goods_receipt_corrections',
  'goods_receipt_correction_lines',
];

async function constraintsFor(pool: Pool, tableNames: string[]): Promise<string[]> {
  const result = await pool.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c
     JOIN pg_class r ON r.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'public' AND r.relname = ANY($1::text[])`,
    [tableNames],
  );
  return result.rows.map((row) => row.definition);
}

describe('Phase 6 Purchases persistence schema', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates all tenant-scoped purchase document tables and composite tenant foreign keys', async () => {
    const result = await pool.query<{ tableName: string | null }>(
      'SELECT to_regclass(format(\'public.%s\', table_name)) AS "tableName" FROM unnest($1::text[]) AS table_name',
      [purchaseTables],
    );
    expect(result.rows.map((row) => row.tableName)).toEqual(purchaseTables);

    const constraints = await constraintsFor(pool, purchaseTables);
    const normalizedConstraints = constraints.map((definition) => definition.replaceAll('"', ''));
    expect(normalizedConstraints.filter((definition) => definition.includes('FOREIGN KEY') && definition.includes('organization_id')).length).toBeGreaterThanOrEqual(9);
    expect(normalizedConstraints.filter((definition) => definition.includes('(establishment_id, organization_id)')).length).toBeGreaterThanOrEqual(3);
    expect(normalizedConstraints.some((definition) => definition.includes('(supplier_rfq_id, organization_id)'))).toBe(true);
    expect(normalizedConstraints.some((definition) => definition.includes('(purchase_order_id, organization_id)'))).toBe(true);
    expect(normalizedConstraints.some((definition) => definition.includes('(goods_receipt_id, organization_id)'))).toBe(true);
    expect(normalizedConstraints.some((definition) => definition.includes('(goods_receipt_line_id, goods_receipt_id, organization_id)'))).toBe(true);
    expect(normalizedConstraints.some((definition) => definition.includes('(source_rfq_id, source_rfq_recipient_id, organization_id)'))).toBe(true);
    expect(normalizedConstraints.some((definition) => definition.includes('(source_rfq_id, source_rfq_line_id, organization_id)'))).toBe(true);
  });

  it('enforces positive quantities and exactly one recipient target at the database boundary', async () => {
    const constraints = (await constraintsFor(pool, purchaseTables)).map((definition) => definition.replaceAll('"', ''));
    expect(constraints.some((definition) => definition.includes('> (0)::numeric'))).toBe(true);
    expect(constraints.some((definition) => definition.includes('delta_quantity <> (0)::numeric'))).toBe(true);
    expect(constraints.some((definition) => definition.includes('num_nonnulls(local_party_id, network_organization_id) = 1'))).toBe(true);
    expect(constraints.some((definition) => definition.includes('supplier_kind') && definition.includes('supplier_party_id'))).toBe(true);
    expect(constraints.filter((definition) => definition.includes('<> organization_id')).length).toBeGreaterThanOrEqual(2);
    expect(constraints.some((definition) => definition.includes('source_rfq_id') && definition.includes('source_rfq_line_id'))).toBe(true);
  });

  it('enforces idempotency, line, recipient and RFQ attribution uniqueness', async () => {
    const indexes = await pool.query<{ definition: string }>(
      `SELECT indexdef AS definition
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = ANY($1::text[])`,
      [purchaseTables],
    );
    const definitions = indexes.rows.map((row) => row.definition.replaceAll('"', '').replace(/\s+/g, ' '));
    expect(definitions.filter((definition) => definition.includes('organization_id') && definition.includes('idempotency_key')).length).toBeGreaterThanOrEqual(4);
    expect(definitions.some((definition) => definition.includes('supplier_rfqs') && definition.includes('organization_id, number'))).toBe(true);
    expect(definitions.some((definition) => definition.includes('purchase_orders') && definition.includes('organization_id, number'))).toBe(true);
    expect(definitions.some((definition) => definition.includes('goods_receipts') && definition.includes('organization_id, number'))).toBe(true);
    expect(definitions.some((definition) => definition.includes('supplier_rfq_id, line_index'))).toBe(true);
    expect(definitions.some((definition) => definition.includes('purchase_order_id, line_index'))).toBe(true);
    expect(definitions.some((definition) => definition.includes('goods_receipt_id, line_index'))).toBe(true);
    expect(definitions.some((definition) => definition.includes('source_rfq_id, source_rfq_recipient_id'))).toBe(true);
    expect(definitions.some((definition) => definition.includes('supplier_rfq_id, local_party_id'))).toBe(true);
    expect(definitions.some((definition) => definition.includes('supplier_rfq_id, network_organization_id'))).toBe(true);
  });

  it('does not introduce stock state or inventory projections', async () => {
    const result = await pool.query<{ tableName: string }>(
      `SELECT table_name AS "tableName"
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('stock_movements', 'inventory_balances', 'inventory_projections')`,
    );
    expect(result.rows).toEqual([]);

    const columns = await pool.query<{ columnName: string }>(
      `SELECT column_name AS "columnName"
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
         AND column_name ~ '(stock|warehouse|balance|valuation)'`,
      [purchaseTables],
    );
    expect(columns.rows).toEqual([]);
  });
});
