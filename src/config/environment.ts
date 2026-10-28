import { readFileSync } from 'node:fs';

export type NodeEnvironment = 'development' | 'test' | 'staging' | 'production';

const ALLOWED_ENVIRONMENTS = new Set<NodeEnvironment>([
  'development',
  'test',
  'staging',
  'production',
]);

const BILLING_EXTERNAL_GATES = [
  'providerVerified',
  'mandateVerified',
  'reconciliationVerified',
  'observabilityVerified',
  'backupRestoreVerified',
  'complianceVerified',
] as const;

function validateBillingOperationalConfiguration(input: Record<string, unknown>, nodeEnv: NodeEnvironment): void {
  if (!['staging', 'production'].includes(nodeEnv)) return;

  const provider = typeof input.FAIRSCALE_BILLING_PROVIDER === 'string' ? input.FAIRSCALE_BILLING_PROVIDER.trim() : '';
  const liveEnabledValue = input.FAIRSCALE_BILLING_LIVE_ENABLED;
  const liveEnabled = liveEnabledValue === true || (typeof liveEnabledValue === 'string' && liveEnabledValue.toLowerCase() === 'true');
  const webhookSecret = typeof input.FAIRSCALE_BILLING_WEBHOOK_SECRET === 'string' ? input.FAIRSCALE_BILLING_WEBHOOK_SECRET.trim() : '';
  const evidencePath = typeof input.FAIRSCALE_BILLING_OPERATIONAL_EVIDENCE_FILE === 'string' ? input.FAIRSCALE_BILLING_OPERATIONAL_EVIDENCE_FILE.trim() : '';
  if (!provider || provider.toUpperCase() === 'TEST' || !liveEnabled || webhookSecret.length < 32 || ['CHANGE_ME', 'test-fairscale-webhook-secret'].includes(webhookSecret) || !evidencePath) {
    throw new Error('FairScale billing operational preflight is required before staging/production startup');
  }

  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(evidencePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('manifest is not an object');
    manifest = parsed as Record<string, unknown>;
  } catch {
    throw new Error('FairScale billing operational evidence manifest is missing or invalid');
  }

  const expiresAt = typeof manifest.expiresAt === 'string' ? Date.parse(manifest.expiresAt) : Number.NaN;
  const observedAt = typeof manifest.observedAt === 'string' ? Date.parse(manifest.observedAt) : Number.NaN;
  const references = manifest.evidenceRefs;
  if (manifest.environment !== nodeEnv || manifest.provider !== provider || !Number.isFinite(observedAt) || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || !Array.isArray(references) || references.length === 0 || references.some((reference) => typeof reference !== 'string' || reference.trim().length === 0) || BILLING_EXTERNAL_GATES.some((gate) => manifest[gate] !== true)) {
    throw new Error('FairScale billing operational evidence manifest is incomplete, expired or mismatched');
  }
}

export function validateEnvironment(input: Record<string, unknown>): Record<string, unknown> {
  const rawNodeEnv = input.NODE_ENV;
  const nodeEnv = (typeof rawNodeEnv === 'string' ? rawNodeEnv : 'development') as NodeEnvironment;

  if (!ALLOWED_ENVIRONMENTS.has(nodeEnv)) {
    throw new Error('NODE_ENV must be one of development, test, staging, production');
  }

  validateBillingOperationalConfiguration(input, nodeEnv);

  const rawPort = input.PORT;
  const port =
    typeof rawPort === 'number'
      ? rawPort
      : typeof rawPort === 'string'
        ? Number(rawPort)
        : 3000;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const rawDatabaseUrl = input.DATABASE_URL;
  const databaseUrl = typeof rawDatabaseUrl === 'string' ? rawDatabaseUrl.trim() : '';

  if (
    !databaseUrl ||
    (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://'))
  ) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }

  const rawCorsOrigins = input.CORS_ORIGINS;
  const corsOrigins =
    typeof rawCorsOrigins === 'string'
      ? rawCorsOrigins
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0)
      : [];

  for (const origin of corsOrigins) {
    let parsed: URL;

    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('Invalid CORS origin');
    }

    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error('CORS origin must be an exact http(s) origin');
    }
  }

  const platformAdminUserIds = typeof input.PLATFORM_ADMIN_USER_IDS === 'string'
    ? input.PLATFORM_ADMIN_USER_IDS.split(',').map((id) => id.trim()).filter(Boolean)
    : [];
  const platformPricingFxIngestUserIds = typeof input.PLATFORM_PRICING_FX_INGEST_USER_IDS === 'string'
    ? input.PLATFORM_PRICING_FX_INGEST_USER_IDS.split(',').map((id) => id.trim()).filter(Boolean)
    : [];
  if (platformPricingFxIngestUserIds.some((id) => !platformAdminUserIds.includes(id))) {
    throw new Error('FX ingestion users must also be platform administrators');
  }

  const pricingFxAllowedSources = typeof input.PRICING_FX_ALLOWED_SOURCES === 'string'
    ? input.PRICING_FX_ALLOWED_SOURCES.split(',').map((source) => source.trim().toUpperCase()).filter(Boolean)
    : [];
  if (pricingFxAllowedSources.some((source) => !/^[A-Z][A-Z0-9._-]{0,63}$/.test(source))
    || new Set(pricingFxAllowedSources).size !== pricingFxAllowedSources.length) {
    throw new Error('PRICING_FX_ALLOWED_SOURCES must contain unique source codes');
  }

  return {
    ...input,
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: databaseUrl,
    CORS_ORIGINS: corsOrigins,
    FAIRSCALE_BILLING_PROVIDER: typeof input.FAIRSCALE_BILLING_PROVIDER === 'string' ? input.FAIRSCALE_BILLING_PROVIDER.trim() : '',
    FAIRSCALE_BILLING_LIVE_ENABLED: input.FAIRSCALE_BILLING_LIVE_ENABLED === true || (typeof input.FAIRSCALE_BILLING_LIVE_ENABLED === 'string' && input.FAIRSCALE_BILLING_LIVE_ENABLED.toLowerCase() === 'true'),
    FAIRSCALE_BILLING_OPERATIONAL_EVIDENCE_FILE: typeof input.FAIRSCALE_BILLING_OPERATIONAL_EVIDENCE_FILE === 'string' ? input.FAIRSCALE_BILLING_OPERATIONAL_EVIDENCE_FILE.trim() : '',
    PLATFORM_ADMIN_USER_IDS: platformAdminUserIds,
    PLATFORM_PRICING_FX_INGEST_USER_IDS: platformPricingFxIngestUserIds,
    PRICING_FX_ALLOWED_SOURCES: pricingFxAllowedSources,
  };
}
