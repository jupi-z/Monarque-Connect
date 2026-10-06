import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../src/config/environment.js';

describe('validateEnvironment', () => {
  it('normalizes a valid environment', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'test',
        PORT: '3100',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
      }),
    ).toMatchObject({
      NODE_ENV: 'test',
      PORT: 3100,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
    });
  });

  it('rejects an invalid port', () => {
    expect(() =>
      validateEnvironment({
        PORT: '70000',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
      }),
    ).toThrow(/PORT/);
  });

  it('rejects a missing PostgreSQL URL', () => {
    expect(() => validateEnvironment({ PORT: '3000' })).toThrow(/DATABASE_URL/);
  });
});
