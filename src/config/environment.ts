export type NodeEnvironment = 'development' | 'test' | 'staging' | 'production';

const ALLOWED_ENVIRONMENTS = new Set<NodeEnvironment>([
  'development',
  'test',
  'staging',
  'production',
]);

export function validateEnvironment(input: Record<string, unknown>): Record<string, unknown> {
  const nodeEnv = String(input.NODE_ENV ?? 'development') as NodeEnvironment;

  if (!ALLOWED_ENVIRONMENTS.has(nodeEnv)) {
    throw new Error('NODE_ENV must be one of development, test, staging, production');
  }

  const port = Number(input.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const databaseUrl = String(input.DATABASE_URL ?? '').trim();
  if (!databaseUrl || (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://'))) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }

  return {
    ...input,
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: databaseUrl,
  };
}
