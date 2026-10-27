import { describe, expect, it } from 'vitest';
import { resolveAuthorizedTestDatabaseUrl } from './test-database-url.js';

const testUrl = 'postgresql://postgres:postgres@127.0.0.1:5432/monarque_connect_test';

describe('authorized test database URL', () => {
  it('accepts only matching explicit URLs for a local test database', () => {
    expect(resolveAuthorizedTestDatabaseUrl({
      NODE_ENV: 'test',
      DATABASE_URL: testUrl,
      TEST_DATABASE_URL: testUrl,
    })).toBe(testUrl);
  });

  it('rejects missing explicit test database URLs', () => {
    expect(() => resolveAuthorizedTestDatabaseUrl({ NODE_ENV: 'test' })).toThrow(/both DATABASE_URL and TEST_DATABASE_URL/i);
  });

  it('rejects different runtime and reset database URLs', () => {
    expect(() => resolveAuthorizedTestDatabaseUrl({
      NODE_ENV: 'test',
      DATABASE_URL: testUrl,
      TEST_DATABASE_URL: testUrl.replace('monarque_connect_test', 'monarque_connect_test_e2e'),
    })).toThrow(/must identify the same database/i);
  });

  it('rejects reset attempts outside the test environment', () => {
    expect(() => resolveAuthorizedTestDatabaseUrl({
      NODE_ENV: 'production',
      DATABASE_URL: testUrl,
      TEST_DATABASE_URL: testUrl,
    })).toThrow(/NODE_ENV=test/i);
  });

  it('rejects production database names even on localhost', () => {
    const productionUrl = testUrl.replace('monarque_connect_test', 'monarque_connect');
    expect(() => resolveAuthorizedTestDatabaseUrl({
      NODE_ENV: 'test',
      DATABASE_URL: productionUrl,
      TEST_DATABASE_URL: productionUrl,
    })).toThrow(/authorized local PostgreSQL test database/i);
  });

  it('rejects remote hosts even when GitHub Actions variables are present', () => {
    const remoteUrl = testUrl.replace('127.0.0.1', 'db.example.invalid');
    expect(() => resolveAuthorizedTestDatabaseUrl({
      NODE_ENV: 'test',
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      DATABASE_URL: remoteUrl,
      TEST_DATABASE_URL: remoteUrl,
    })).toThrow(/authorized local PostgreSQL test database/i);
  });
});
