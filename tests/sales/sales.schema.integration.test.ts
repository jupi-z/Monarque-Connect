import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPool } from '../events/test-database.js';
import type { Pool } from 'pg';

let pool: Pool;

describe('Sales persistence schema', () => {
  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates the document, line, payment and counter tables', async () => {
    const result = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('quotes', 'quote_lines', 'sales_orders', 'sales_order_lines', 'invoices', 'invoice_lines', 'payment_records', 'sales_number_counters')
      ORDER BY table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      'invoice_lines',
      'invoices',
      'payment_records',
      'quote_lines',
      'quotes',
      'sales_number_counters',
      'sales_order_lines',
      'sales_orders',
    ]);
  });

  it('uses the prescribed numeric scales and immutable snapshot columns', async () => {
    const result = await pool.query<{ table_name: string; column_name: string; numeric_precision: string; numeric_scale: string }>(`
      SELECT table_name, column_name, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('quote_lines', 'sales_order_lines', 'invoice_lines')
        AND column_name IN ('quantity', 'unit_price', 'net_amount', 'tax_amount', 'gross_amount')
      ORDER BY table_name, column_name
    `);

    expect(result.rows.filter((row) => row.column_name === 'quantity').every((row) => Number(row.numeric_precision) === 19 && Number(row.numeric_scale) === 6)).toBe(true);
    expect(result.rows.filter((row) => row.column_name !== 'quantity').every((row) => Number(row.numeric_precision) === 19 && Number(row.numeric_scale) === 4)).toBe(true);

    const snapshots = await pool.query<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('quote_lines', 'sales_order_lines', 'invoice_lines')
        AND column_name IN ('item_name_snapshot', 'item_sku_snapshot', 'description_snapshot', 'unit_snapshot')
    `);
    expect(snapshots.rows.length).toBe(12);
  });

  it('declares tenant-scoped establishment foreign keys and unique quote/order source links', async () => {
    const constraints = await pool.query<{ constraint_name: string; table_name: string }>(`
      SELECT DISTINCT con.conname AS constraint_name, cls.relname AS table_name
      FROM pg_constraint con
      JOIN pg_class cls ON cls.oid = con.conrelid
      WHERE cls.relname IN ('quotes', 'sales_orders', 'invoices', 'payment_records')
        AND con.contype IN ('f', 'u')
    `);

    expect(constraints.rows.some((row) => row.table_name === 'quotes' && row.constraint_name.includes('establishment'))).toBe(true);
    expect(constraints.rows.some((row) => row.table_name === 'sales_orders' && row.constraint_name.includes('establishment'))).toBe(true);
    expect(constraints.rows.some((row) => row.table_name === 'invoices' && row.constraint_name.includes('establishment'))).toBe(true);

    const uniqueSourceLinks = await pool.query<{ table_name: string; index_definition: string }>(`
      SELECT tablename AS table_name, indexdef AS index_definition
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('sales_orders', 'invoices')
        AND indexdef ILIKE '%source_%'
    `);
    expect(uniqueSourceLinks.rows.some((row) => row.table_name === 'sales_orders' && row.index_definition.includes('UNIQUE') && row.index_definition.includes('source_quote_id'))).toBe(true);
    expect(uniqueSourceLinks.rows.some((row) => row.table_name === 'invoices' && row.index_definition.includes('UNIQUE') && row.index_definition.includes('source_order_id'))).toBe(true);
  });
});
