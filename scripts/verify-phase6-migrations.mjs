import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import pg from 'pg';

const { Pool } = pg;
const phase6Start = '20261013170000_add_purchase_documents';
const sourceMigrationsPath = join(process.cwd(), 'prisma', 'migrations');
const migrationDirectories = (await readdir(sourceMigrationsPath, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const phase6MigrationDirectories = migrationDirectories.filter((name) => name >= phase6Start);
const phase5MigrationDirectories = migrationDirectories.filter((name) => name < phase6Start);
if (phase6MigrationDirectories.length === 0) throw new Error('No Phase 6 migrations found');

const baseUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect');
const adminUrl = new URL(baseUrl);
adminUrl.pathname = '/postgres';
const suffix = `${process.pid}_${randomUUID().replaceAll('-', '')}`;
const databaseNames = { empty: `monarque_phase6_empty_${suffix}`, upgrade: `monarque_phase6_upgrade_${suffix}` };
const databaseUrls = Object.fromEntries(Object.entries(databaseNames).map(([key, name]) => {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return [key, url.toString()];
}));
const tempWorkspace = join(process.cwd(), 'tmp');
await mkdir(tempWorkspace, { recursive: true });
const tempRoot = await mkdtemp(join(tempWorkspace, 'monarque-phase6-migrations-'));
const tempPrismaRoot = join(tempRoot, 'prisma');
await mkdir(tempPrismaRoot, { recursive: true });
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
  await writeFile(configPath, `import { defineConfig } from 'prisma/config';\n\nexport default defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env.DATABASE_URL } });\n`, 'utf8');
  await new Promise((resolve, reject) => {
    const executable = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
    execFile(executable, ['migrate', 'deploy', '--config', configPath], { cwd: tempRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 10 * 1024 * 1024, shell: process.platform === 'win32' }, (error, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (error) reject(new Error(`prisma migrate deploy failed: ${error.message}`));
      else resolve();
    });
  });
}

async function databaseExists(pool, name) { return (await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount === 1; }
async function createDatabase(pool, name) { if (!await databaseExists(pool, name)) await pool.query(`CREATE DATABASE "${name}"`); }
async function dropDatabase(pool, name) { if (await databaseExists(pool, name)) await pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
async function appliedNames(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at, migration_name');
    return result.rows.map((row) => row.migration_name);
  } finally {
    await pool.end();
  }
}

async function structuralProof(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const tableResult = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`, [[
      'supplier_rfqs', 'supplier_rfq_lines', 'supplier_rfq_recipients', 'purchase_orders', 'purchase_order_lines',
      'goods_receipts', 'goods_receipt_lines', 'goods_receipt_corrections', 'goods_receipt_correction_lines',
    ]]);
    const foundTables = new Set(tableResult.rows.map((row) => row.table_name));
    const requiredTables = ['supplier_rfqs', 'supplier_rfq_lines', 'supplier_rfq_recipients', 'purchase_orders', 'purchase_order_lines', 'goods_receipts', 'goods_receipt_lines', 'goods_receipt_corrections', 'goods_receipt_correction_lines'];
    const missingTables = requiredTables.filter((table) => !foundTables.has(table));
    if (missingTables.length) throw new Error(`Phase 6 structural proof missing tables: ${missingTables.join(', ')}`);

    const columnResult = await pool.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'purchase_orders' AND column_name IN ('total_net', 'total_tax', 'total_gross')) OR (table_name = 'goods_receipt_correction_lines' AND column_name = 'delta_quantity'))`);
    const foundColumns = new Set(columnResult.rows.map((row) => `${row.table_name}:${row.column_name}`));
    const requiredColumns = ['purchase_orders:total_net', 'purchase_orders:total_tax', 'purchase_orders:total_gross', 'goods_receipt_correction_lines:delta_quantity'];
    const missingColumns = requiredColumns.filter((column) => !foundColumns.has(column));
    if (missingColumns.length) throw new Error(`Phase 6 structural proof missing columns: ${missingColumns.join(', ')}`);

    const stockResult = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('stock_movements', 'inventory_balances', 'stock_balances')`);
    if (stockResult.rowCount) throw new Error(`Phase 6 introduced forbidden Inventory tables: ${stockResult.rows.map((row) => row.table_name).join(', ')}`);
  } finally {
    await pool.end();
  }
}

const adminPool = new Pool({ connectionString: adminUrl.toString() });
try {
  await createDatabase(adminPool, databaseNames.empty);
  await createDatabase(adminPool, databaseNames.upgrade);

  await writeMigrationSet(migrationDirectories);
  await runMigrateDeploy(databaseUrls.empty);
  const emptyNames = await appliedNames(databaseUrls.empty);
  if (emptyNames.length !== migrationDirectories.length || emptyNames.at(-1) !== migrationDirectories.at(-1)) throw new Error(`Phase 6 empty baseline mismatch: expected ${migrationDirectories.length} migrations ending at ${migrationDirectories.at(-1)}, got ${emptyNames.length} ending at ${emptyNames.at(-1)}`);
  await structuralProof(databaseUrls.empty);

  await writeMigrationSet(phase5MigrationDirectories);
  await runMigrateDeploy(databaseUrls.upgrade);
  const phase5Names = await appliedNames(databaseUrls.upgrade);
  if (phase5Names.length !== phase5MigrationDirectories.length || phase5Names.at(-1) !== phase5MigrationDirectories.at(-1)) throw new Error(`Phase 5 upgrade baseline mismatch: expected ${phase5MigrationDirectories.length} migrations ending at ${phase5MigrationDirectories.at(-1)}, got ${phase5Names.length} ending at ${phase5Names.at(-1)}`);

  await writeMigrationSet(migrationDirectories);
  await runMigrateDeploy(databaseUrls.upgrade);
  const finalNames = await appliedNames(databaseUrls.upgrade);
  if (finalNames.length !== migrationDirectories.length || finalNames.at(-1) !== migrationDirectories.at(-1)) throw new Error(`Phase 6 upgrade mismatch: expected ${migrationDirectories.length} migrations ending at ${migrationDirectories.at(-1)}, got ${finalNames.length} ending at ${finalNames.at(-1)}`);
  await structuralProof(databaseUrls.upgrade);

  console.log(`Phase 6 migration proof passed: empty database (${migrationDirectories.length} migrations) and Phase 5 upgrade (${phase5MigrationDirectories.length} + ${phase6MigrationDirectories.length} migrations).`);
} finally {
  await dropDatabase(adminPool, databaseNames.empty);
  await dropDatabase(adminPool, databaseNames.upgrade);
  await adminPool.end();
  await new Promise((resolve) => setTimeout(resolve, 250));
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
