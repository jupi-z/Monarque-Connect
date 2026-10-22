import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import pg from 'pg';
import { assertMigrationSet } from './migration-proof-utils.mjs';

const { Pool } = pg;
const sourceMigrationsPath = join(process.cwd(), 'prisma', 'migrations');
const migrationDirectories = (await readdir(sourceMigrationsPath, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const phase3MigrationDirectories = migrationDirectories.filter((name) => name >= '20261012150000_add_phase3_referentials');
const phase2MigrationDirectories = migrationDirectories.filter((name) => name < '20261012150000_add_phase3_referentials');

if (phase3MigrationDirectories.length === 0) throw new Error('No Phase 3 migrations found');

const baseUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect');
const adminUrl = new URL(baseUrl);
adminUrl.pathname = '/postgres';
const suffix = `${process.pid}_${randomUUID().replaceAll('-', '')}`;
const databaseNames = {
  empty: `monarque_phase3_empty_${suffix}`,
  upgrade: `monarque_phase3_upgrade_${suffix}`,
};
const databaseUrls = Object.fromEntries(Object.entries(databaseNames).map(([key, name]) => {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return [key, url.toString()];
}));

const tempWorkspace = join(process.cwd(), 'tmp');
await mkdir(tempWorkspace, { recursive: true });
const tempRoot = await mkdtemp(join(tempWorkspace, 'monarque-phase3-migrations-'));
const tempPrismaRoot = join(tempRoot, 'prisma');
await cp(join(process.cwd(), 'prisma', 'schema.prisma'), join(tempPrismaRoot, 'schema.prisma'));

async function writeMigrationSet(names) {
  const migrationsPath = join(tempPrismaRoot, 'migrations');
  await rm(migrationsPath, { recursive: true, force: true });
  await cp(sourceMigrationsPath, migrationsPath, {
    recursive: true,
    filter: (source) => {
      const relative = source.slice(sourceMigrationsPath.length + 1);
      return relative === '' || names.some((name) => relative === name || relative.startsWith(`${name}${sep}`));
    },
  });
}

async function runMigrateDeploy(databaseUrl) {
  const configPath = join(tempRoot, 'prisma.config.ts');
  await writeFile(configPath, `import { defineConfig } from 'prisma/config';\n\nexport default defineConfig({\n  schema: 'prisma/schema.prisma',\n  migrations: { path: 'prisma/migrations' },\n  datasource: { url: process.env.DATABASE_URL },\n});\n`, 'utf8');
  await new Promise((resolve, reject) => {
    const executable = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
    execFile(executable, ['migrate', 'deploy', '--config', configPath], {
      cwd: tempRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      maxBuffer: 10 * 1024 * 1024,
      shell: process.platform === 'win32',
    }, (error, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (error) reject(new Error(`prisma migrate deploy failed: ${error.message}`));
      else resolve();
    });
  });
}

async function databaseExists(pool, name) {
  const result = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  return result.rowCount === 1;
}

async function createDatabase(pool, name) {
  if (!await databaseExists(pool, name)) await pool.query(`CREATE DATABASE "${name}"`);
}

async function dropDatabase(pool, name) {
  if (await databaseExists(pool, name)) await pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
}

const adminPool = new Pool({ connectionString: adminUrl.toString() });
try {
  await createDatabase(adminPool, databaseNames.empty);
  await createDatabase(adminPool, databaseNames.upgrade);

  await writeMigrationSet(migrationDirectories);
  await runMigrateDeploy(databaseUrls.empty);

  await writeMigrationSet(phase2MigrationDirectories);
  await runMigrateDeploy(databaseUrls.upgrade);
  const phase2Pool = new Pool({ connectionString: databaseUrls.upgrade });
  try {
    const result = await phase2Pool.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name');
    const appliedNames = result.rows.map((row) => row.migration_name);
    assertMigrationSet(appliedNames, phase2MigrationDirectories, 'Phase 2 baseline');
  } finally {
    await phase2Pool.end();
  }

  await writeMigrationSet(migrationDirectories);
  await runMigrateDeploy(databaseUrls.upgrade);
  const finalPool = new Pool({ connectionString: databaseUrls.upgrade });
  try {
    const result = await finalPool.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name');
    const appliedNames = result.rows.map((row) => row.migration_name);
    assertMigrationSet(appliedNames, migrationDirectories, 'Phase 3 upgrade');
  } finally {
    await finalPool.end();
  }

  console.log(`Phase 3 migration proof passed: empty database (${migrationDirectories.length} migrations) and Phase 2 upgrade (${phase2MigrationDirectories.length} + ${phase3MigrationDirectories.length} migrations).`);
} finally {
  await dropDatabase(adminPool, databaseNames.empty);
  await dropDatabase(adminPool, databaseNames.upgrade);
  await adminPool.end();
  await new Promise((resolve) => setTimeout(resolve, 250));
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
