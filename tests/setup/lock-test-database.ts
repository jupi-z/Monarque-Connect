import { Client } from 'pg';
import { resolveAuthorizedTestDatabaseUrl } from './test-database-url.js';

/** Hold a PostgreSQL session advisory lock for the whole suite so another Vitest process
 * cannot run the global TRUNCATE against the same database concurrently. */
export default async function lockTestDatabase(): Promise<() => Promise<void>> {
  const connectionString = resolveAuthorizedTestDatabaseUrl(process.env);
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended(current_database(), 0)) AS acquired',
    );
    if (result.rows[0]?.acquired !== true) {
      throw new Error('Test database is already in use by another Vitest process; use a distinct isolated database');
    }
  } catch (error) {
    await client.end();
    throw error;
  }

  return async () => {
    await client.end();
  };
}
