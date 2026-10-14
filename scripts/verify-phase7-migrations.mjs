import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import pg from 'pg';

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

async function runMigrateDeploy(databaseUrl) {
  const configPath = join(tempRoot, 'prisma.config.ts');
  await writeFile(configPath, `import { defineConfig } from 'prisma/config';\n\nexport default defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env.DATABASE_URL } });\n`, 'utf8');
  await new Promise((resolve, reject) => {
    const executable = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
    execFile(executable, ['migrate', 'deploy', '--config', configPath], { cwd: tempRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 10 * 1024 * 1024, shell: process.platform === 'win32' }, (error, stdout, stderr) => { if (stdout) process.stdout.write(stdout); if (stderr) process.stderr.write(stderr); if (error) reject(new Error(`prisma migrate deploy failed: ${error.message}`)); else resolve(); });
  });
}

async function databaseExists(pool, name) { return (await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount === 1; }
async function createDatabase(pool, name) { if (!await databaseExists(pool, name)) await pool.query(`CREATE DATABASE "${name}"`); }
async function dropDatabase(pool, name) { if (await databaseExists(pool, name)) await pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
async function appliedNames(databaseUrl) { const pool = new Pool({ connectionString: databaseUrl }); try { const result = await pool.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at, migration_name'); return result.rows.map((row) => row.migration_name); } finally { await pool.end(); } }

async function structuralProof(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`, [['inventory_movements', 'inventory_balances', 'goods_receipt_inventory_links', 'goods_receipt_inventory_entries']]);
    const found = new Set(tables.rows.map((row) => row.table_name));
    for (const required of ['inventory_movements', 'inventory_balances', 'goods_receipt_inventory_links', 'goods_receipt_inventory_entries']) if (!found.has(required)) throw new Error(`Phase 7 structural proof missing table: ${required}`);
    const trigger = await pool.query(`SELECT 1 FROM pg_trigger WHERE tgname = 'inventory_movements_append_only_update'`);
    if (!trigger.rowCount) throw new Error('Phase 7 append-only trigger is missing');
    const checks = await pool.query(`SELECT conname FROM pg_constraint WHERE conname IN ('inventory_movements_direction_check', 'inventory_balances_quantity_nonnegative_check', 'goods_receipt_inventory_entries_delta_nonzero_check')`);
    const names = new Set(checks.rows.map((row) => row.conname));
    for (const required of ['inventory_movements_direction_check', 'inventory_balances_quantity_nonnegative_check', 'goods_receipt_inventory_entries_delta_nonzero_check']) if (!names.has(required)) throw new Error(`Phase 7 structural proof missing constraint: ${required}`);
    const forbidden = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('stock_movements', 'stock_balances')`);
    if (forbidden.rowCount) throw new Error(`Phase 7 created forbidden legacy stock tables: ${forbidden.rows.map((row) => row.table_name).join(', ')}`);
  } finally { await pool.end(); }
}

const adminPool = new Pool({ connectionString: adminUrl.toString() });
try {
  await createDatabase(adminPool, databaseNames.empty); await createDatabase(adminPool, databaseNames.upgrade);
  await writeMigrationSet(migrationDirectories); await runMigrateDeploy(databaseUrls.empty);
  const emptyNames = await appliedNames(databaseUrls.empty);
  if (emptyNames.length !== migrationDirectories.length || emptyNames.at(-1) !== migrationDirectories.at(-1)) throw new Error(`Phase 7 empty baseline mismatch: expected ${migrationDirectories.length} migrations ending at ${migrationDirectories.at(-1)}, got ${emptyNames.length} ending at ${emptyNames.at(-1)}`);
  await structuralProof(databaseUrls.empty);
  await writeMigrationSet(phase6MigrationDirectories); await runMigrateDeploy(databaseUrls.upgrade);
  const phase6Names = await appliedNames(databaseUrls.upgrade);
  if (phase6Names.length !== phase6MigrationDirectories.length || phase6Names.at(-1) !== phase6MigrationDirectories.at(-1)) throw new Error(`Phase 6 upgrade baseline mismatch: expected ${phase6MigrationDirectories.length} migrations ending at ${phase6MigrationDirectories.at(-1)}, got ${phase6Names.length} ending at ${phase6Names.at(-1)}`);
  await writeMigrationSet(migrationDirectories); await runMigrateDeploy(databaseUrls.upgrade);
  const finalNames = await appliedNames(databaseUrls.upgrade);
  if (finalNames.length !== migrationDirectories.length || finalNames.at(-1) !== migrationDirectories.at(-1)) throw new Error(`Phase 7 upgrade mismatch: expected ${migrationDirectories.length} migrations ending at ${migrationDirectories.at(-1)}, got ${finalNames.length} ending at ${finalNames.at(-1)}`);
  await structuralProof(databaseUrls.upgrade);
  console.log(`Phase 7 migration proof passed: empty database (${migrationDirectories.length} migrations) and Phase 6 upgrade (${phase6MigrationDirectories.length} + ${phase7MigrationDirectories.length} migrations).`);
} finally {
  await dropDatabase(adminPool, databaseNames.empty); await dropDatabase(adminPool, databaseNames.upgrade); await adminPool.end();
  await new Promise((resolve) => setTimeout(resolve, 250)); await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
