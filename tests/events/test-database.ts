import { Pool } from 'pg';

export function createTestPool(): Pool {
  return new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect',
    max: 4,
  });
}

export async function resetEventTables(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE TABLE event_consumer_receipts, outbox_events RESTART IDENTITY CASCADE');
}
