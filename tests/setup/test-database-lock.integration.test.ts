import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveAuthorizedTestDatabaseUrl } from './test-database-url.js';

const client = new Client({ connectionString: resolveAuthorizedTestDatabaseUrl(process.env) });

describe('Vitest test database lock', () => {
  afterAll(async () => client.end());

  it('prevents a second execution from acquiring the database while this suite is active', async () => {
    await client.connect();
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended(current_database(), 0)) AS acquired',
    );

    expect(result.rows[0]?.acquired).toBe(false);
  });
});
