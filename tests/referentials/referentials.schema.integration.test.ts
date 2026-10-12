import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createTestPool } from '../events/test-database.js';

describe('Phase 3 referentials database schema', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates tenant-owned business parties with non-destructive status', async () => {
    const result = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'business_parties'
      ORDER BY ordinal_position
    `);

    expect(result.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining([
      'id', 'organization_id', 'type', 'display_name', 'active', 'created_at', 'updated_at',
    ]));
  });

  it('creates catalog items with a partial tenant-scoped SKU uniqueness index', async () => {
    const result = await pool.query<{ indexdef: string }>(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'items'
    `);

    expect(result.rows.map((row) => row.indexdef).join('\n')).toMatch(/UNIQUE.*organization_id.*sku/i);
    expect(result.rows.map((row) => row.indexdef).join('\n')).toMatch(/WHERE.*sku IS NOT NULL/i);
  });

  it('creates warehouses with tenant-scoped codes and a composite organization parent link', async () => {
    const columns = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'warehouses'
    `);
    const foreignKeys = await pool.query<{ constraint_name: string }>(`
      SELECT DISTINCT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_schema = 'public' AND tc.table_name = 'warehouses' AND tc.constraint_type = 'FOREIGN KEY'
    `);

    expect(columns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining([
      'id', 'organization_id', 'establishment_id', 'code', 'active', 'created_at', 'updated_at',
    ]));
    expect(foreignKeys.rows.length).toBeGreaterThanOrEqual(2);
  });
});
