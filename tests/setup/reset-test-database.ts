import { afterAll, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { resolveAuthorizedTestDatabaseUrl } from './test-database-url.js';

const connectionString = resolveAuthorizedTestDatabaseUrl(process.env);
const pool = new Pool({ connectionString });

beforeAll(async () => {
  await pool.query(`
    DO $$
    DECLARE table_names text;
    BEGIN
      SELECT string_agg(format('%I', tablename), ', ' ORDER BY tablename)
      INTO table_names
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT IN ('_prisma_migrations', 'measure_units', 'currency_definitions');

      IF table_names IS NOT NULL THEN
        EXECUTE format('TRUNCATE TABLE %s RESTART IDENTITY CASCADE', table_names);
      END IF;
    END
    $$;
  `);
});

afterAll(async () => {
  await pool.end();
});
