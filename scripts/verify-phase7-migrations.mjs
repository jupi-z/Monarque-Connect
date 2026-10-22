import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import pg from 'pg';
import { assertMigrationSet } from './migration-proof-utils.mjs';

const { Pool } = pg;
const sourceMigrationsPath = join(process.cwd(), 'prisma', 'migrations');
const migrationDirectories = (await readdir(sourceMigrationsPath, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const phase7Start = '20261014080000_add_inventory_ledger';
const phase7MigrationDirectories = migrationDirectories.filter((name) => name >= phase7Start);
const phase6MigrationDirectories = migrationDirectories.filter((name) => name < phase7Start);
if (phase7MigrationDirectories.length === 0) throw new Error('No Phase 7 migrations found');

const baseUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect');
const adminUrl = new URL(baseUrl); adminUrl.pathname = '/postgres';
const suffix = `${process.pid}_${randomUUID().replaceAll('-', '')}`;
const databaseNames = { empty: `monarque_phase7_empty_${suffix}`, upgrade: `monarque_phase7_upgrade_${suffix}` };
const databaseUrls = Object.fromEntries(Object.entries(databaseNames).map(([key, name]) => { const url = new URL(baseUrl); url.pathname = `/${name}`; return [key, url.toString()]; }));
const tempWorkspace = join(process.cwd(), 'tmp'); await mkdir(tempWorkspace, { recursive: true });
const tempRoot = await mkdtemp(join(tempWorkspace, 'monarque-phase7-migrations-'));
const tempPrismaRoot = join(tempRoot, 'prisma'); await mkdir(tempPrismaRoot, { recursive: true });
await cp(join(process.cwd(), 'prisma', 'schema.prisma'), join(tempPrismaRoot, 'schema.prisma'));

async function writeMigrationSet(names) {
  const migrationsPath = join(tempPrismaRoot, 'migrations'); await rm(migrationsPath, { recursive: true, force: true });
  await cp(sourceMigrationsPath, migrationsPath, { recursive: true, filter: (source) => { const relative = source.slice(sourceMigrationsPath.length + 1); return relative === '' || names.some((name) => relative === name || relative.startsWith(`${name}${sep}`)); } });
}

async function runPrismaCommand(databaseUrl, args) {
  const configPath = join(tempRoot, 'prisma.config.ts');
  await writeFile(configPath, `import { defineConfig } from 'prisma/config';\n\nexport default defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env.DATABASE_URL } });\n`, 'utf8');
  await new Promise((resolve, reject) => {
    const executable = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
    execFile(executable, args(configPath), { cwd: tempRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 10 * 1024 * 1024, shell: process.platform === 'win32' }, (error, stdout, stderr) => { if (stdout) process.stdout.write(stdout); if (stderr) process.stderr.write(stderr); if (error) reject(new Error(`Prisma command failed: ${error.message}`)); else resolve(); });
  });
}

async function runMigrateDeploy(databaseUrl) { await runPrismaCommand(databaseUrl, (configPath) => ['migrate', 'deploy', '--config', configPath]); }

async function runSeed(databaseUrl) {
  await new Promise((resolve, reject) => {
    const executable = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
    execFile(executable, [join(process.cwd(), 'prisma', 'seed.ts')], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 10 * 1024 * 1024, shell: process.platform === 'win32' }, (error, stdout, stderr) => { if (stdout) process.stdout.write(stdout); if (stderr) process.stderr.write(stderr); if (error) reject(new Error(`Reference seed failed: ${error.message}`)); else resolve(); });
  });
}

async function databaseExists(pool, name) { return (await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount === 1; }
async function createDatabase(pool, name) { if (!await databaseExists(pool, name)) await pool.query(`CREATE DATABASE "${name}"`); }
async function dropDatabase(pool, name) { if (await databaseExists(pool, name)) await pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
async function appliedNames(databaseUrl) { const pool = new Pool({ connectionString: databaseUrl }); try { const result = await pool.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name'); return result.rows.map((row) => row.migration_name); } finally { await pool.end(); } }

async function structuralProof(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const requiredTables = ['inventory_movements', 'inventory_balances', 'inventory_reconciliations', 'goods_receipt_inventory_links', 'goods_receipt_inventory_entries', 'expenses', 'expense_idempotency_keys', 'cash_accounts', 'cash_account_idempotency_keys', 'cash_movements', 'cash_movement_idempotency_keys'];
    const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`, [requiredTables]);
    const found = new Set(tables.rows.map((row) => row.table_name));
    for (const required of requiredTables) if (!found.has(required)) throw new Error(`Phase 7 structural proof missing table: ${required}`);
    const trigger = await pool.query(`SELECT tgname FROM pg_trigger WHERE tgname IN ('inventory_movements_append_only_update', 'cash_movements_append_only_update')`);
    const triggers = new Set(trigger.rows.map((row) => row.tgname));
    for (const required of ['inventory_movements_append_only_update', 'cash_movements_append_only_update']) if (!triggers.has(required)) throw new Error(`Phase 7 append-only trigger is missing: ${required}`);
    const checks = await pool.query(`SELECT conname FROM pg_constraint WHERE conname IN ('inventory_movements_direction_check', 'inventory_balances_quantity_nonnegative_check', 'goods_receipt_inventory_entries_delta_nonzero_check', 'cash_accounts_currency_uppercase_check', 'cash_movements_amount_positive_check', 'cash_movements_source_check', 'cash_movements_correction_check')`);
    const names = new Set(checks.rows.map((row) => row.conname));
    for (const required of ['inventory_movements_direction_check', 'inventory_balances_quantity_nonnegative_check', 'goods_receipt_inventory_entries_delta_nonzero_check', 'cash_accounts_currency_uppercase_check', 'cash_movements_amount_positive_check', 'cash_movements_source_check', 'cash_movements_correction_check']) if (!names.has(required)) throw new Error(`Phase 7 structural proof missing constraint: ${required}`);
    const cashIndexes = await pool.query(`SELECT table_class.relname AS table_name, index_class.relname AS index_name, index_meta.indisunique AS is_unique, array_agg(attribute.attname ORDER BY index_column.ordinality) AS columns
      FROM pg_index AS index_meta
      JOIN pg_class AS index_class ON index_class.oid = index_meta.indexrelid
      JOIN pg_class AS table_class ON table_class.oid = index_meta.indrelid
      JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
      CROSS JOIN LATERAL unnest(index_meta.indkey) WITH ORDINALITY AS index_column(attnum, ordinality)
      JOIN pg_attribute AS attribute ON attribute.attrelid = table_class.oid AND attribute.attnum = index_column.attnum
      WHERE namespace.nspname = 'public' AND table_class.relname IN ('cash_accounts', 'cash_movements', 'cash_movement_idempotency_keys', 'expense_idempotency_keys', 'inventory_reconciliations')
      GROUP BY table_class.relname, index_class.relname, index_meta.indisunique`);
    const indexDefinitions = cashIndexes.rows.map((row) => ({
      tableName: row.table_name,
      isUnique: row.is_unique,
      columns: Array.isArray(row.columns) ? row.columns : String(row.columns).replace(/^\{|\}$/g, '').split(','),
    }));
    const requiredIndexes = [
      ['cash_accounts organization/code uniqueness', 'cash_accounts', ['organization_id', 'code']],
      ['cash movements correction uniqueness', 'cash_movements', ['corrected_movement_id', 'organization_id']],
      ['cash movement idempotency uniqueness', 'cash_movement_idempotency_keys', ['organization_id', 'actor_user_id', 'operation', 'key']],
      ['expense idempotency uniqueness', 'expense_idempotency_keys', ['organization_id', 'actor_user_id', 'operation', 'key']],
      ['inventory reconciliation idempotency uniqueness', 'inventory_reconciliations', ['organization_id', 'idempotency_key']],
    ];
    for (const [label, tableName, columns] of requiredIndexes) if (!indexDefinitions.some((definition) => definition.tableName === tableName && definition.isUnique && definition.columns.join(',') === columns.join(','))) throw new Error(`Phase 7 structural proof missing index: ${label}`);
    const forbidden = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('stock_movements', 'stock_balances')`);
    if (forbidden.rowCount) throw new Error(`Phase 7 created forbidden legacy stock tables: ${forbidden.rows.map((row) => row.table_name).join(', ')}`);
  } finally { await pool.end(); }
}

const adminPool = new Pool({ connectionString: adminUrl.toString() });
try {
  await createDatabase(adminPool, databaseNames.empty); await createDatabase(adminPool, databaseNames.upgrade);
  await writeMigrationSet(migrationDirectories); await runMigrateDeploy(databaseUrls.empty);
  const emptyNames = await appliedNames(databaseUrls.empty);
  assertMigrationSet(emptyNames, migrationDirectories, 'Phase 7 empty baseline');
  await structuralProof(databaseUrls.empty);
  await runSeed(databaseUrls.empty); await runSeed(databaseUrls.empty);
  const emptyPool = new Pool({ connectionString: databaseUrls.empty });
  try {
    for (const table of ['inventory_movements', 'expenses', 'cash_movements']) {
      const result = await emptyPool.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
      if (result.rows[0]?.count !== 0) throw new Error(`Phase 7 seed inserted operational data into ${table}`);
    }
  } finally { await emptyPool.end(); }
  await writeMigrationSet(phase6MigrationDirectories); await runMigrateDeploy(databaseUrls.upgrade);
  const phase6Names = await appliedNames(databaseUrls.upgrade);
  assertMigrationSet(phase6Names, phase6MigrationDirectories, 'Phase 6 upgrade baseline');
  await writeMigrationSet(migrationDirectories); await runMigrateDeploy(databaseUrls.upgrade);
  const finalNames = await appliedNames(databaseUrls.upgrade);
  assertMigrationSet(finalNames, migrationDirectories, 'Phase 7 upgrade');
  await structuralProof(databaseUrls.upgrade);
  await runSeed(databaseUrls.upgrade); await runSeed(databaseUrls.upgrade);
  console.log(`Phase 7 migration proof passed: empty database (${migrationDirectories.length} migrations), Phase 6 upgrade (${phase6MigrationDirectories.length} + ${phase7MigrationDirectories.length} migrations), idempotent reference seed, and no operational fixtures.`);
} finally {
  await dropDatabase(adminPool, databaseNames.empty); await dropDatabase(adminPool, databaseNames.upgrade); await adminPool.end();
  await new Promise((resolve) => setTimeout(resolve, 250)); await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
