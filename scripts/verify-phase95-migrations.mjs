import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import pg from 'pg';

const { Pool } = pg;
const sourceMigrationsPath = join(process.cwd(), 'prisma', 'migrations');
const migrationDirectories = (await readdir(sourceMigrationsPath, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const fairScaleStart = '20261019101428_add_fairscale_catalog_and_billing_identity';
const phase96Start = '20261019131202_phase96_billing_transactions';
const preFairScaleMigrationDirectories = migrationDirectories.filter((name) => name < fairScaleStart);
const phase95MigrationDirectories = migrationDirectories.filter((name) => name >= fairScaleStart && name < phase96Start);
const laterFairScaleMigrationDirectories = migrationDirectories.filter((name) => name >= phase96Start);
if (phase95MigrationDirectories.length !== 1 || phase95MigrationDirectories[0] !== fairScaleStart) throw new Error('Unexpected Phase 9.5 migration set');

const baseUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/monarque_connect');
const adminUrl = new URL(baseUrl); adminUrl.pathname = '/postgres';
const suffix = `${process.pid}_${randomUUID().replaceAll('-', '')}`;
const databaseNames = { empty: `monarque_phase95_empty_${suffix}`, upgrade: `monarque_phase95_upgrade_${suffix}` };
const databaseUrls = Object.fromEntries(Object.entries(databaseNames).map(([key, name]) => {
  const url = new URL(baseUrl); url.pathname = `/${name}`; return [key, url.toString()];
}));
const tempParent = join(process.cwd(), 'tmp');
await mkdir(tempParent, { recursive: true });
const tempRoot = await mkdtemp(join(tempParent, 'monarque-phase95-migrations-'));
const tempPrismaRoot = join(tempRoot, 'prisma');
await mkdir(tempPrismaRoot, { recursive: true });
await cp(join(process.cwd(), 'prisma', 'schema.prisma'), join(tempPrismaRoot, 'schema.prisma'));

async function writeMigrationSet(names) {
  const migrationsPath = join(tempPrismaRoot, 'migrations');
  await rm(migrationsPath, { recursive: true, force: true });
  await cp(sourceMigrationsPath, migrationsPath, { recursive: true, filter: (source) => {
    const relative = source.slice(sourceMigrationsPath.length + 1);
    return relative === '' || names.some((name) => relative === name || relative.startsWith(`${name}${sep}`));
  } });
}

async function migrate(databaseUrl) {
  const configPath = join(tempRoot, 'prisma.config.ts');
  await writeFile(configPath, "import { defineConfig } from 'prisma/config';\nexport default defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env.DATABASE_URL } });\n", 'utf8');
  await new Promise((resolve, reject) => {
    const executable = process.execPath;
    const prismaEntryPoint = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
    execFile(executable, [prismaEntryPoint, 'migrate', 'deploy', '--config', configPath], { cwd: tempRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout); if (stderr) process.stderr.write(stderr); if (error) reject(error); else resolve();
    });
  });
}

async function seed(databaseUrl) {
  await new Promise((resolve, reject) => {
    const executable = process.execPath;
    const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    execFile(executable, [tsxCli, join(process.cwd(), 'prisma', 'seed.ts')], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout); if (stderr) process.stderr.write(stderr); if (error) reject(error); else resolve();
    });
  });
}

async function appliedNames(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try { return (await pool.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at, migration_name')).rows.map((row) => row.migration_name); }
  finally { await pool.end(); }
}

async function structuralProof(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const requiredTables = ['price_versions', 'price_components', 'billing_customers', 'billing_customer_organizations', 'billing_quotes', 'billing_quote_lines', 'billing_promotion_redemptions', 'billing_promotion_eligibilities'];
    const tables = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\' AND table_name = ANY($1::text[])', [requiredTables]);
    const found = new Set(tables.rows.map((row) => row.table_name));
    const missing = requiredTables.filter((table) => !found.has(table));
    if (missing.length) throw new Error(`Phase 9.5 structural proof missing tables: ${missing.join(', ')}`);
    const indexes = await pool.query(`SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('price_versions', 'price_components', 'billing_quotes', 'billing_promotion_redemptions') AND indexdef LIKE 'CREATE UNIQUE INDEX%'`);
    const definitions = indexes.rows.map((row) => ({ table: row.tablename, definition: row.indexdef.replaceAll('"', '').replace(/\s+/g, ' ') }));
    for (const [table, columns] of [['price_versions', '(plan_code, version, billing_period)'], ['price_components', '(price_version_id, code)'], ['billing_quotes', '(organization_id, idempotency_key)'], ['billing_promotion_redemptions', '(billing_customer_id, promotion_code, billing_period, sequence)']]) {
      if (!definitions.some((definition) => definition.table === table && definition.definition.includes(columns))) throw new Error(`Phase 9.5 structural proof missing unique index ${table} ${columns}`);
    }
  } finally { await pool.end(); }
}

async function databaseExists(pool, name) { return (await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount === 1; }
async function createDatabase(pool, name) { if (!await databaseExists(pool, name)) await pool.query(`CREATE DATABASE "${name}"`); }
async function dropDatabase(pool, name) { if (await databaseExists(pool, name)) await pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }

const adminPool = new Pool({ connectionString: adminUrl.toString() });
try {
  await createDatabase(adminPool, databaseNames.empty); await createDatabase(adminPool, databaseNames.upgrade);

  const phase95MigrationSet = [...preFairScaleMigrationDirectories, ...phase95MigrationDirectories];
  await writeMigrationSet(phase95MigrationSet); await migrate(databaseUrls.empty); await structuralProof(databaseUrls.empty);
  await seed(databaseUrls.empty); await seed(databaseUrls.empty);
  const emptyPool = new Pool({ connectionString: databaseUrls.empty });
  try {
    const prices = await emptyPool.query('SELECT COUNT(*)::int AS count FROM price_versions');
    const historicalPlans = await emptyPool.query("SELECT COUNT(*)::int AS count FROM plan_versions WHERE currency = 'EUR'");
    const quotes = await emptyPool.query('SELECT COUNT(*)::int AS count FROM billing_quotes');
    if (Number(prices.rows[0]?.count) !== 8) throw new Error('Phase 9.5 seed did not publish exactly 8 USD price versions');
    if (Number(historicalPlans.rows[0]?.count) !== 4) throw new Error('Phase 9.5 seed changed the historical EUR plan versions');
    if (Number(quotes.rows[0]?.count) !== 0) throw new Error('Phase 9.5 seed inserted operational billing quotes');
  } finally { await emptyPool.end(); }

  await writeMigrationSet(preFairScaleMigrationDirectories); await migrate(databaseUrls.upgrade);
  const beforeFairScale = await appliedNames(databaseUrls.upgrade);
  if (beforeFairScale.length !== preFairScaleMigrationDirectories.length || beforeFairScale.at(-1) !== preFairScaleMigrationDirectories.at(-1)) throw new Error('Phase 9.5 upgrade baseline mismatch');
  await writeMigrationSet(phase95MigrationSet); await migrate(databaseUrls.upgrade); await structuralProof(databaseUrls.upgrade);
  const finalNames = await appliedNames(databaseUrls.upgrade);
  if (finalNames.length !== phase95MigrationSet.length || finalNames.at(-1) !== fairScaleStart) throw new Error('Phase 9.5 upgrade migration set mismatch');
  await seed(databaseUrls.upgrade); await seed(databaseUrls.upgrade);
  console.log(`Phase 9.5 migration proof passed: empty database (${phase95MigrationSet.length} migrations) and Phase 9 upgrade (${preFairScaleMigrationDirectories.length} + ${phase95MigrationDirectories.length} migrations), additive FairScale schema and idempotent seed verified. Later FairScale migrations intentionally excluded: ${laterFairScaleMigrationDirectories.length}.`);
} finally {
  await dropDatabase(adminPool, databaseNames.empty); await dropDatabase(adminPool, databaseNames.upgrade); await adminPool.end();
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
