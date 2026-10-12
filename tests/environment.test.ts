import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../src/config/environment.js';

describe('validateEnvironment', () => {
  it('normalizes a valid environment and CORS allowlist', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'test',
        PORT: '3100',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
        CORS_ORIGINS: 'https://app.example.com,http://localhost:3001',
      }),
    ).toMatchObject({
      NODE_ENV: 'test',
      PORT: 3100,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
      CORS_ORIGINS: ['https://app.example.com', 'http://localhost:3001'],
    });
  });

  it('defaults to an empty CORS allowlist', () => {
    expect(
      validateEnvironment({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
      }),
    ).toMatchObject({
      CORS_ORIGINS: [],
    });
  });

  it('normalizes the platform administrator allowlist', () => {
    expect(validateEnvironment({ DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test', PLATFORM_ADMIN_USER_IDS: ' user-a, user-b ' })).toMatchObject({ PLATFORM_ADMIN_USER_IDS: ['user-a', 'user-b'] });
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

  it('rejects a CORS URL containing a path', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
        CORS_ORIGINS: 'https://app.example.com/path',
      }),
    ).toThrow(/CORS origin/);
  });
});
