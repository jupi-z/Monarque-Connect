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

  return {
    ...input,
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: databaseUrl,
  };
}
