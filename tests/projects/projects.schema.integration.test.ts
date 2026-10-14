import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPool } from '../events/test-database.js';

const phase8Tables = ['projects', 'tasks', 'documents', 'document_links', 'phase8_idempotency_keys'];

async function constraintsFor(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c
     JOIN pg_class r ON r.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'public' AND r.relname = ANY($1::text[])`,
    [phase8Tables],
  );
  return result.rows.map((row) => row.definition.replaceAll('"', ''));
}

describe('Phase 8 Projects & Documents persistence schema', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates tenant-scoped project, task, document and link tables', async () => {
    const result = await pool.query<{ tableName: string | null }>(
      'SELECT to_regclass(format(\'public.%s\', table_name)) AS "tableName" FROM unnest($1::text[]) AS table_name',
      [phase8Tables],
    );
    expect(result.rows.map((row) => row.tableName)).toEqual(phase8Tables);

    const constraints = await constraintsFor(pool);
    expect(constraints.filter((definition) => definition.includes('organization_id')).length).toBeGreaterThanOrEqual(12);
    expect(constraints.filter((definition) => definition.includes('(establishment_id, organization_id)')).length).toBeGreaterThanOrEqual(2);
    expect(constraints.some((definition) => definition.includes('(project_id, organization_id)'))).toBe(true);
    expect(constraints.some((definition) => definition.includes('(document_id, organization_id)'))).toBe(true);
  });

  it('persists the normative state and classification checks', async () => {
    const constraints = await constraintsFor(pool);
    expect(constraints.some((definition) => definition.includes('byte_size') && definition.includes('>='))).toBe(true);
    const enums = await pool.query<{ typname: string }>('SELECT typname FROM pg_type WHERE typname = ANY($1::text[])', [['ProjectStatus', 'TaskStatus', 'DocumentStatus', 'DocumentClassification', 'DocumentLinkTargetType']]);
    expect(enums.rows.map((row) => row.typname)).toEqual(expect.arrayContaining(['ProjectStatus', 'TaskStatus', 'DocumentStatus', 'DocumentClassification', 'DocumentLinkTargetType']));
  });

  it('enforces idempotency and unique document links per tenant', async () => {
    const indexes = await pool.query<{ definition: string }>(
      `SELECT indexdef AS definition
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [phase8Tables],
    );
    const definitions = indexes.rows.map((row) => row.definition.replaceAll('"', '').replace(/\s+/g, ' '));
    expect(definitions.some((definition) => definition.includes('phase8_idempotency_keys') && definition.includes('organization_id, actor_user_id, operation, key'))).toBe(true);
    expect(definitions.some((definition) => definition.includes('document_links') && definition.includes('organization_id, document_id, target_type, target_id'))).toBe(true);
  });
});
