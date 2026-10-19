import { readFileSync } from 'node:fs';

const PRODUCTION_ENVIRONMENTS = new Set(['staging', 'production']);
const REQUIRED_GATES = [
  'providerVerified',
  'mandateVerified',
  'reconciliationVerified',
  'observabilityVerified',
  'backupRestoreVerified',
  'complianceVerified',
];
const PLACEHOLDER_SECRETS = new Set(['', 'CHANGE_ME', 'test-fairscale-webhook-secret']);

export function evaluateBillingReadiness(environment = process.env, manifest = null, now = new Date()) {
  const nodeEnv = String(environment.NODE_ENV ?? 'development').trim().toLowerCase();
  if (!PRODUCTION_ENVIRONMENTS.has(nodeEnv)) {
    return { ok: true, skipped: true, nodeEnv, missing: [] };
  }

  const provider = String(environment.FAIRSCALE_BILLING_PROVIDER ?? '').trim();
  const secret = String(environment.FAIRSCALE_BILLING_WEBHOOK_SECRET ?? '').trim();
  const missing = [];
  if (!provider || provider.toUpperCase() === 'TEST') missing.push('a verified non-TEST payment provider');
  if (String(environment.FAIRSCALE_BILLING_LIVE_ENABLED ?? '').toLowerCase() !== 'true') missing.push('FAIRSCALE_BILLING_LIVE_ENABLED=true');
  if (PLACEHOLDER_SECRETS.has(secret) || secret.length < 32) missing.push('a non-placeholder provider webhook secret');

  if (!manifest) {
    missing.push('an operational evidence manifest');
  } else {
    if (manifest.environment !== nodeEnv) missing.push('evidence for the target environment');
    if (manifest.provider !== provider) missing.push('evidence for the configured provider');
    if (!isDateAfter(manifest.expiresAt, now)) missing.push('non-expired operational evidence');
    if (!isDate(manifest.observedAt)) missing.push('an evidence observation timestamp');
    for (const gate of REQUIRED_GATES) if (manifest[gate] !== true) missing.push(gate);
    if (!Array.isArray(manifest.evidenceRefs) || manifest.evidenceRefs.length === 0 || manifest.evidenceRefs.some((ref) => typeof ref !== 'string' || ref.trim().length === 0)) {
      missing.push('non-sensitive evidence references');
    }
  }

  return { ok: missing.length === 0, skipped: false, nodeEnv, missing };
}

function isDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isDateAfter(value, now) {
  return isDate(value) && new Date(value).getTime() > now.getTime();
}

function readManifest(path) {
  if (!path) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function main(environment = process.env) {
  const nodeEnv = String(environment.NODE_ENV ?? 'development').trim().toLowerCase();
  const manifest = readManifest(environment.FAIRSCALE_BILLING_OPERATIONAL_EVIDENCE_FILE);
  const result = evaluateBillingReadiness(environment, manifest);
  if (result.skipped) {
    console.log(`Billing operational preflight skipped for non-production environment: ${result.nodeEnv}.`);
    return 0;
  }
  if (!result.ok) {
    console.error(`Billing operational preflight failed closed for ${nodeEnv}.`);
    console.error(`Missing or invalid gates: ${result.missing.join('; ')}.`);
    return 1;
  }
  console.log(`Billing operational preflight passed for ${nodeEnv}; all external gates are evidenced and unexpired.`);
  return 0;
}

process.exitCode = main();
