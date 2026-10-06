import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabaseUrl } from './test-database.js';

describe('test database guard', () => {
  it('rejects a normal development database before destructive cleanup', () => {
    expect(() =>
      assertSafeTestDatabaseUrl('postgresql://postgres:postgres@localhost:5432/monarque_connect'),
    ).toThrow(/test database/i);
  });

  it('accepts an explicitly suffixed test database', () => {
    expect(() =>
      assertSafeTestDatabaseUrl('postgresql://postgres:postgres@localhost:5432/monarque_connect_test'),
    ).not.toThrow();
  });
});
