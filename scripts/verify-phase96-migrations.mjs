import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import pg from 'pg';

const { Pool } = pg;
const sourceMigrationsPath = join(process.cwd(), 'prisma', 'migrations');
const migrationDirectories = (await readdir(sourceMigrationsPath, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const phase95Start = '20261019101428_add_fairscale_catalog_and_billing_identity';
const phase96Start = '20261019131202_phase96_billing_transactions';
const phase95MigrationDirectories = migrationDirectories.filter((name) => name < phase96Start);
const phase96MigrationDirectories = migrationDirectories.filter((name) => name >= phase96Start);
if (!migrationDirectories.includes(phase95Start) || phase96MigrationDirectories.length < 3) throw new Error('Unexpected FairScale migration set');

const baseUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/monarque_connect');
const adminUrl = new URL(baseUrl); adminUrl.pathname = '/postgres';
const suffix = `${process.pid}_${randomUUID().replaceAll('-', '')}`;
const databaseNames = { empty: `monarque_phase96_empty_${suffix}`, upgrade: `monarque_phase96_upgrade_${suffix}` };
const databaseUrls = Object.fromEntries(Object.entries(databaseNames).map(([key, name]) => { const url = new URL(baseUrl); url.pathname = `/${name}`; return [key, url.toString()]; }));
const tempRoot = await mkdtemp(join(process.cwd(), 'tmp', 'monarque-phase96-migrations-'));
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
    execFile(process.execPath, [join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy', '--config', configPath], { cwd: tempRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => { if (stdout) process.stdout.write(stdout); if (stderr) process.stderr.write(stderr); if (error) reject(error); else resolve(); });
  });
}

async function seed(databaseUrl) {
  await new Promise((resolve, reject) => {
    execFile(process.execPath, [join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(process.cwd(), 'prisma', 'seed.ts')], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => { if (stdout) process.stdout.write(stdout); if (stderr) process.stderr.write(stderr); if (error) reject(error); else resolve(); });
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
    const requiredTables = ['billing_subscription_terms', 'billing_checkout_orders', 'billing_invoices', 'billing_invoice_lines', 'billing_payment_attempts', 'billing_payments', 'billing_refunds', 'billing_provider_event_inbox', 'billing_scheduled_changes'];
    const tables = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\' AND table_name = ANY($1::text[])', [requiredTables]);
    const found = new Set(tables.rows.map((row) => row.table_name));
    const missing = requiredTables.filter((table) => !found.has(table));
    if (missing.length) throw new Error(`Phase 9.6 structural proof missing tables: ${missing.join(', ')}`);
    const indexes = await pool.query("SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('billing_invoices', 'billing_payment_attempts', 'billing_scheduled_changes') AND indexdef LIKE 'CREATE UNIQUE INDEX%'");
    const definitions = indexes.rows.map((row) => `${row.tablename} ${row.indexdef.replaceAll('"', '').replace(/\s+/g, ' ')}`);
    for (const required of ['(subscription_term_id, period_start, period_end)', '(provider, provider_payment_id)', '(organization_id, idempotency_key)']) if (!definitions.some((definition) => definition.includes(required))) throw new Error(`Phase 9.6 structural proof missing unique index ${required}`);
    const sequence = await pool.query("SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'billing_invoice_number_seq'");
    if (sequence.rowCount !== 1) throw new Error('Phase 9.6 structural proof missing billing invoice sequence');
    const triggers = await pool.query("SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname IN ('billing_invoice_lines', 'billing_payments') AND NOT t.tgisinternal");
    const triggerNames = new Set(triggers.rows.map((row) => row.tgname));
    for (const required of ['billing_invoice_lines_immutable', 'billing_payments_identity_immutable']) if (!triggerNames.has(required)) throw new Error(`Phase 9.6 structural proof missing trigger ${required}`);
  } finally { await pool.end(); }
}

async function databaseExists(pool, name) { return (await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount === 1; }
async function createDatabase(pool, name) { if (!await databaseExists(pool, name)) await pool.query(`CREATE DATABASE "${name}"`); }
async function dropDatabase(pool, name) { if (await databaseExists(pool, name)) await pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }

const adminPool = new Pool({ connectionString: adminUrl.toString() });
try {
  await createDatabase(adminPool, databaseNames.empty); await createDatabase(adminPool, databaseNames.upgrade);
  await writeMigrationSet(migrationDirectories); await migrate(databaseUrls.empty); await structuralProof(databaseUrls.empty); await seed(databaseUrls.empty); await seed(databaseUrls.empty);
  await writeMigrationSet(phase95MigrationDirectories); await migrate(databaseUrls.upgrade);
  const before = await appliedNames(databaseUrls.upgrade);
  if (before.length !== phase95MigrationDirectories.length || before.at(-1) !== phase95MigrationDirectories.at(-1)) throw new Error('Phase 9.6 upgrade baseline mismatch');
  await writeMigrationSet(migrationDirectories); await migrate(databaseUrls.upgrade); await structuralProof(databaseUrls.upgrade); await seed(databaseUrls.upgrade); await seed(databaseUrls.upgrade);
  const after = await appliedNames(databaseUrls.upgrade);
  if (after.length !== migrationDirectories.length || after.at(-1) !== migrationDirectories.at(-1)) throw new Error('Phase 9.6 upgrade migration set mismatch');
  console.log(`Phase 9.6 migration proof passed: empty database (${migrationDirectories.length} migrations) and Phase 9.5 upgrade (${phase95MigrationDirectories.length} + ${phase96MigrationDirectories.length} migrations), immutable billing structures and idempotent seed verified.`);
} finally {
  await dropDatabase(adminPool, databaseNames.empty); await dropDatabase(adminPool, databaseNames.upgrade); await adminPool.end();
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
