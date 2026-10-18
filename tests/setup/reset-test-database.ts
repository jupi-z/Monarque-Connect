import { afterAll, beforeAll } from 'vitest';
import { Pool } from 'pg';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) throw new Error('Integration tests require DATABASE_URL or TEST_DATABASE_URL');

const databaseUrl = new URL(connectionString);
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || !databaseUrl.pathname.includes('_test')) {
  throw new Error('Test database reset refused: use a local database whose name contains _test');
}

const pool = new Pool({ connectionString });

beforeAll(async () => {
  await pool.query(`
    DO $$
    DECLARE table_name text;
    BEGIN
      FOR table_name IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      LOOP
        EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', table_name);
      END LOOP;
    END
    $$;
  `);
});

afterAll(async () => {
  await pool.end();
});
