export type NodeEnvironment = 'development' | 'test' | 'staging' | 'production';

const ALLOWED_ENVIRONMENTS = new Set<NodeEnvironment>([
  'development',
  'test',
  'staging',
  'production',
]);

export function validateEnvironment(input: Record<string, unknown>): Record<string, unknown> {
  const rawNodeEnv = input.NODE_ENV;
  const nodeEnv = (typeof rawNodeEnv === 'string' ? rawNodeEnv : 'development') as NodeEnvironment;

  if (!ALLOWED_ENVIRONMENTS.has(nodeEnv)) {
    throw new Error('NODE_ENV must be one of development, test, staging, production');
  }

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

  return {
    ...input,
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: databaseUrl,
    CORS_ORIGINS: corsOrigins,
    PLATFORM_ADMIN_USER_IDS:
      typeof input.PLATFORM_ADMIN_USER_IDS === 'string'
        ? input.PLATFORM_ADMIN_USER_IDS.split(',').map((id) => id.trim()).filter(Boolean)
        : [],
  };
}
