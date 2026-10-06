import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../src/config/environment.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test',
  JWT_ISSUER: 'monarque-connect',
  JWT_AUDIENCE: 'monarque-connect-api',
  CORS_ORIGINS: 'http://localhost:3001',
  STORAGE_DRIVER: 'memory',
};

describe('validateEnvironment', () => {
  it('accepts the minimal test configuration and applies defaults', () => {
    const result = validateEnvironment(base);

    expect(result.PORT).toBe(3000);
    expect(result.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(result.JWT_REFRESH_TTL_SECONDS).toBe(2_592_000);
    expect(result.JWT_KEY_ID).toBe('monarque-connect-key-1');
  });

  it('fails when DATABASE_URL is missing', () => {
    const invalid: Record<string, unknown> = { ...base };
    delete invalid.DATABASE_URL;

    expect(() => validateEnvironment(invalid)).toThrow(
      'DATABASE_URL is required',
    );
  });

  it('rejects wildcard CORS origins', () => {
    expect(() =>
      validateEnvironment({ ...base, CORS_ORIGINS: '*' }),
    ).toThrow('wildcard CORS origin is forbidden');
  });

  it('requires production JWT key paths and S3 storage', () => {
    expect(() =>
      validateEnvironment({ ...base, NODE_ENV: 'production' }),
    ).toThrow('staging/production require JWT key paths');
  });

  it('rejects production memory storage after JWT keys are present', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY_PATH: '/run/secrets/jwt-private.pem',
        JWT_PUBLIC_KEY_PATH: '/run/secrets/jwt-public.pem',
      }),
    ).toThrow('staging/production require STORAGE_DRIVER=s3');
  });
});
