import { afterAll, beforeAll } from 'vitest';
import { Pool } from 'pg';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (connectionString) {
  const databaseUrl = new URL(connectionString);
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ''));
  const allowedDatabaseName = /^monarque_connect_(?:ci_)?test(?:_[a-z0-9]+)*$/i.test(databaseName);

  const isLocalHost = ['127.0.0.1', 'localhost'].includes(databaseUrl.hostname);
  const isTrustedGitHubActionsHost =
    ['host.docker.internal', 'monarque-ci-postgres'].includes(databaseUrl.hostname) &&
    process.env.CI === 'true' &&
    process.env.GITHUB_ACTIONS === 'true';

  if ((!isLocalHost && !isTrustedGitHubActionsHost) || !allowedDatabaseName) {
    throw new Error('Test database reset refused: use a local monarque_connect_test database');
  }

  const pool = new Pool({ connectionString });

  beforeAll(async () => {
    await pool.query(`
      DO $$
      DECLARE table_names text;
      BEGIN
        SELECT string_agg(format('%I', tablename), ', ' ORDER BY tablename)
        INTO table_names
        FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';

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
}
