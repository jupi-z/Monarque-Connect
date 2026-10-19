import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('fails closed for staging without FairScale operational evidence', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'staging', DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test' })).toThrow(/operational preflight/);
  });

  it('accepts staging only with matching, unexpired evidence for every external gate', () => {
    const directory = mkdtempSync(join(tmpdir(), 'monarque-environment-'));
    const evidencePath = join(directory, 'evidence.json');
    try {
      writeFileSync(evidencePath, JSON.stringify({
        environment: 'staging',
        provider: 'LIVE_PROVIDER',
        observedAt: '2026-10-19T12:00:00.000Z',
        expiresAt: '2099-10-19T12:00:00.000Z',
        providerVerified: true,
        mandateVerified: true,
        reconciliationVerified: true,
        observabilityVerified: true,
        backupRestoreVerified: true,
        complianceVerified: true,
        evidenceRefs: ['external-record-1'],
      }));
      expect(validateEnvironment({ NODE_ENV: 'staging', DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test', FAIRSCALE_BILLING_PROVIDER: 'LIVE_PROVIDER', FAIRSCALE_BILLING_LIVE_ENABLED: 'true', FAIRSCALE_BILLING_WEBHOOK_SECRET: 'a'.repeat(40), FAIRSCALE_BILLING_OPERATIONAL_EVIDENCE_FILE: evidencePath })).toMatchObject({ FAIRSCALE_BILLING_PROVIDER: 'LIVE_PROVIDER', FAIRSCALE_BILLING_LIVE_ENABLED: true });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
