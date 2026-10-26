export function resolveAuthorizedTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  if (env.NODE_ENV !== 'test') {
    throw new Error('Test database reset refused: NODE_ENV=test is required');
  }

  const databaseUrl = env.DATABASE_URL;
  const testDatabaseUrl = env.TEST_DATABASE_URL;
  if (!databaseUrl || !testDatabaseUrl) {
    throw new Error('Test database reset refused: both DATABASE_URL and TEST_DATABASE_URL are required');
  }
  if (databaseUrl !== testDatabaseUrl) {
    throw new Error('Test database reset refused: DATABASE_URL and TEST_DATABASE_URL must identify the same database');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(testDatabaseUrl);
  } catch {
    throw new Error('Test database reset refused: invalid PostgreSQL test database URL');
  }

  const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ''));
  const allowedDatabaseName = /^monarque_connect_(?:ci_)?test(?:_[a-z0-9]+)*$/i.test(databaseName);
  const allowedHost = ['127.0.0.1', 'localhost', '[::1]'].includes(parsedUrl.hostname);
  const allowedProtocol = parsedUrl.protocol === 'postgresql:' || parsedUrl.protocol === 'postgres:';

  if (!allowedHost || !allowedDatabaseName || !allowedProtocol) {
    throw new Error('Test database reset refused: use an authorized local PostgreSQL test database');
  }

  return testDatabaseUrl;
}
