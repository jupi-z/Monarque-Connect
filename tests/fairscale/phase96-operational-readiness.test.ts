import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts', 'check-billing-operational-readiness.mjs');

function run(env: Record<string, string | undefined>): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [script], { env: { ...process.env, ...env }, encoding: 'utf8', stdio: 'pipe' });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    environment: 'production',
    provider: 'LIVE_PROVIDER',
    observedAt: '2026-10-19T12:00:00.000Z',
    expiresAt: '2099-10-19T12:00:00.000Z',
    providerVerified: true,
    mandateVerified: true,
    reconciliationVerified: true,
    observabilityVerified: true,
    backupRestoreVerified: true,
    complianceVerified: true,
    evidenceRefs: ['https://example.invalid/evidence/provider-run-1'],
    ...overrides,
  };
}

describe('FairScale billing operational preflight', () => {
  it('does not block local and test environments', () => {
    const result = run({ NODE_ENV: 'test', FAIRSCALE_BILLING_PROVIDER: 'TEST' });
    expect(result.status).toBe(0);
    expect(result.output).toContain('skipped for non-production');
  });

  it('rejects the TEST provider in production without exposing secrets', () => {
    const result = run({ NODE_ENV: 'production', FAIRSCALE_BILLING_PROVIDER: 'TEST', FAIRSCALE_BILLING_LIVE_ENABLED: 'true', FAIRSCALE_BILLING_WEBHOOK_SECRET: 'super-secret-that-must-not-be-printed-123456' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('verified non-TEST payment provider');
    expect(result.output).not.toContain('super-secret');
  });

  it('rejects missing, expired or incomplete external evidence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'monarque-billing-preflight-'));
    const path = join(directory, 'evidence.json');
    try {
      writeFileSync(path, JSON.stringify(manifest({ expiresAt: '2020-01-01T00:00:00.000Z', backupRestoreVerified: false })));
      const result = run({ NODE_ENV: 'production', FAIRSCALE_BILLING_PROVIDER: 'LIVE_PROVIDER', FAIRSCALE_BILLING_LIVE_ENABLED: 'true', FAIRSCALE_BILLING_WEBHOOK_SECRET: 'a'.repeat(40), FAIRSCALE_BILLING_OPERATIONAL_EVIDENCE_FILE: path });
      expect(result.status).toBe(1);
      expect(result.output).toContain('non-expired operational evidence');
      expect(result.output).toContain('backupRestoreVerified');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('passes only when all gates match the configured production provider', () => {
    const directory = mkdtempSync(join(tmpdir(), 'monarque-billing-preflight-'));
    const path = join(directory, 'evidence.json');
    try {
      writeFileSync(path, JSON.stringify(manifest()));
      const result = run({ NODE_ENV: 'production', FAIRSCALE_BILLING_PROVIDER: 'LIVE_PROVIDER', FAIRSCALE_BILLING_LIVE_ENABLED: 'true', FAIRSCALE_BILLING_WEBHOOK_SECRET: 'a'.repeat(40), FAIRSCALE_BILLING_OPERATIONAL_EVIDENCE_FILE: path });
      expect(result.status).toBe(0);
      expect(result.output).toContain('all external gates are evidenced');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
