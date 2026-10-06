import { Pool } from 'pg';

export function assertSafeTestDatabaseUrl(connectionString: string): void {
  const databaseName = new URL(connectionString).pathname.replace(/^\//, '').toLowerCase();
  if (!/(^|[_-])test($|[_-])/.test(databaseName)) {
    throw new Error('Integration tests require an explicitly named test database');
  }
}

export function createTestPool(): Pool {
  const connectionString =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
  assertSafeTestDatabaseUrl(connectionString);
  return new Pool({
    connectionString,
    max: 4,
  });
}

export async function resetEventTables(pool: Pool): Promise<void> {
  assertSafeTestDatabaseUrl(String(pool.options.connectionString));
  await pool.query('TRUNCATE TABLE event_consumer_receipts, outbox_events RESTART IDENTITY CASCADE');
}
