export type NodeEnvironment = 'development' | 'test' | 'staging' | 'production';

export interface Environment {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  DATABASE_URL: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  JWT_PRIVATE_KEY_PATH?: string;
  JWT_PUBLIC_KEY_PATH?: string;
  JWT_KEY_ID: string;
  JWT_ACCESS_TTL_SECONDS: number;
  JWT_REFRESH_TTL_SECONDS: number;
  CORS_ORIGINS: string;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  STORAGE_DRIVER: 'memory' | 's3';
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
}

function requireString(
  config: Record<string, unknown>,
  key: string,
): string {
  const value = config[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid environment: ${key} is required`);
  }
  return value.trim();
}

function stringValue(
  config: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = config[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') {
    throw new Error(`Invalid environment: ${key} must be a string`);
  }
  return value.trim();
}

function optionalString(
  config: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = config[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new Error(`Invalid environment: ${key} must be a string`);
  }
  return value.trim();
}

function integer(
  config: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = config[key] ?? fallback;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `Invalid environment: ${key} must be an integer between ${min} and ${max}`,
    );
  }
  return value;
}

function assertUrl(value: string, key: string, protocols: string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid environment: ${key} must be a valid URL`);
  }

  if (!protocols.includes(parsed.protocol.replace(':', ''))) {
    throw new Error(
      `Invalid environment: ${key} must use one of: ${protocols.join(', ')}`,
    );
  }
}

export function validateEnvironment(
  config: Record<string, unknown>,
): Environment & Record<string, unknown> {
  const nodeEnvRaw = stringValue(config, 'NODE_ENV', 'development');
  const allowedNodeEnvs: NodeEnvironment[] = [
    'development',
    'test',
    'staging',
    'production',
  ];

  if (!allowedNodeEnvs.includes(nodeEnvRaw as NodeEnvironment)) {
    throw new Error('Invalid environment: NODE_ENV is invalid');
  }

  const NODE_ENV = nodeEnvRaw as NodeEnvironment;
  const PORT = integer(config, 'PORT', 3000, 1, 65535);
  const DATABASE_URL = requireString(config, 'DATABASE_URL');
  assertUrl(DATABASE_URL, 'DATABASE_URL', ['postgres', 'postgresql']);

  const JWT_ISSUER = requireString(config, 'JWT_ISSUER');
  const JWT_AUDIENCE = requireString(config, 'JWT_AUDIENCE');
  const JWT_PRIVATE_KEY_PATH = optionalString(config, 'JWT_PRIVATE_KEY_PATH');
  const JWT_PUBLIC_KEY_PATH = optionalString(config, 'JWT_PUBLIC_KEY_PATH');
  const JWT_KEY_ID = stringValue(
    config,
    'JWT_KEY_ID',
    'monarque-connect-key-1',
  );
  const JWT_ACCESS_TTL_SECONDS = integer(
    config,
    'JWT_ACCESS_TTL_SECONDS',
    900,
    60,
    900,
  );
  const JWT_REFRESH_TTL_SECONDS = integer(
    config,
    'JWT_REFRESH_TTL_SECONDS',
    2_592_000,
    3_600,
    2_592_000,
  );

  if (
    (NODE_ENV === 'staging' || NODE_ENV === 'production') &&
    (!JWT_PRIVATE_KEY_PATH || !JWT_PUBLIC_KEY_PATH)
  ) {
    throw new Error(
      'Invalid environment: staging/production require JWT key paths',
    );
  }

  const CORS_ORIGINS = stringValue(
    config,
    'CORS_ORIGINS',
    'http://localhost:3001',
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .join(',');

  if (CORS_ORIGINS.split(',').some((origin) => origin === '*')) {
    throw new Error('Invalid environment: wildcard CORS origin is forbidden');
  }

  for (const origin of CORS_ORIGINS.split(',')) {
    assertUrl(origin, 'CORS_ORIGINS', ['http', 'https']);
  }

  const logLevel = stringValue(config, 'LOG_LEVEL', 'info');
  const allowedLogLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
  if (!allowedLogLevels.includes(logLevel as (typeof allowedLogLevels)[number])) {
    throw new Error('Invalid environment: LOG_LEVEL is invalid');
  }
  const LOG_LEVEL = logLevel as Environment['LOG_LEVEL'];

  const storageDriverRaw = stringValue(config, 'STORAGE_DRIVER', 'memory');
  if (storageDriverRaw !== 'memory' && storageDriverRaw !== 's3') {
    throw new Error('Invalid environment: STORAGE_DRIVER must be memory or s3');
  }
  const STORAGE_DRIVER = storageDriverRaw;

  const S3_ENDPOINT = optionalString(config, 'S3_ENDPOINT');
  const S3_REGION = optionalString(config, 'S3_REGION');
  const S3_BUCKET = optionalString(config, 'S3_BUCKET');
  const S3_ACCESS_KEY_ID = optionalString(config, 'S3_ACCESS_KEY_ID');
  const S3_SECRET_ACCESS_KEY = optionalString(config, 'S3_SECRET_ACCESS_KEY');

  if (STORAGE_DRIVER === 's3') {
    if (
      !S3_ENDPOINT ||
      !S3_REGION ||
      !S3_BUCKET ||
      !S3_ACCESS_KEY_ID ||
      !S3_SECRET_ACCESS_KEY
    ) {
      throw new Error(
        'Invalid environment: S3 storage requires endpoint, region, bucket and credentials',
      );
    }
    assertUrl(S3_ENDPOINT, 'S3_ENDPOINT', ['http', 'https']);
  }

  if (
    (NODE_ENV === 'staging' || NODE_ENV === 'production') &&
    STORAGE_DRIVER !== 's3'
  ) {
    throw new Error(
      'Invalid environment: staging/production require STORAGE_DRIVER=s3',
    );
  }

  return {
    ...config,
    NODE_ENV,
    PORT,
    DATABASE_URL,
    JWT_ISSUER,
    JWT_AUDIENCE,
    JWT_PRIVATE_KEY_PATH,
    JWT_PUBLIC_KEY_PATH,
    JWT_KEY_ID,
    JWT_ACCESS_TTL_SECONDS,
    JWT_REFRESH_TTL_SECONDS,
    CORS_ORIGINS,
    LOG_LEVEL,
    STORAGE_DRIVER,
    S3_ENDPOINT,
    S3_REGION,
    S3_BUCKET,
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY,
  };
}

export function corsOriginsFromEnvironment(): string[] {
  const raw = process.env.CORS_ORIGINS ?? 'http://localhost:3001';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
