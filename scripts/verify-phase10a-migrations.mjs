import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import pg from 'pg';

const { Pool } = pg;
const sourceMigrationsPath = join(process.cwd(), 'prisma', 'migrations');
const migrationDirectories = (await readdir(sourceMigrationsPath, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const phase10aStart = '20261020164848_phase10a_intelligence_projections';
const phase10aMigrationDirectories = migrationDirectories.filter((name) => name >= phase10aStart);
const baselineMigrationDirectories = migrationDirectories.filter((name) => name < phase10aStart);
if (!migrationDirectories.includes(phase10aStart) || phase10aMigrationDirectories.length !== 1) {
  throw new Error('Unexpected Phase 10A migration set');
}

const baseUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/monarque_connect');
const adminUrl = new URL(baseUrl);
adminUrl.pathname = '/postgres';
const suffix = `${process.pid}_${randomUUID().replaceAll('-', '')}`;
const databaseNames = { empty: `monarque_phase10a_empty_${suffix}`, upgrade: `monarque_phase10a_upgrade_${suffix}` };
const databaseUrls = Object.fromEntries(Object.entries(databaseNames).map(([key, name]) => {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return [key, url.toString()];
}));
const tempParent = join(process.cwd(), 'tmp');
await mkdir(tempParent, { recursive: true });
const tempRoot = await mkdtemp(join(tempParent, 'monarque-phase10a-migrations-'));
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

async function runNodeCli(script, args, cwd, databaseUrl) {
  await new Promise((resolve, reject) => {
    execFile(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (error) reject(error);
      else resolve();
    });
  });
}

async function migrate(databaseUrl) {
  const configPath = join(tempRoot, 'prisma.config.ts');
  await writeFile(configPath,
    "import { defineConfig } from 'prisma/config';\nexport default defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env.DATABASE_URL } });\n",
    'utf8');
  await runNodeCli(join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'), ['migrate', 'deploy', '--config', configPath], tempRoot, databaseUrl);
}

async function seed(databaseUrl) {
  await runNodeCli(join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    [join(process.cwd(), 'prisma', 'seed.ts')], process.cwd(), databaseUrl);
}

async function appliedNames(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    return (await pool.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at, migration_name'))
      .rows.map((row) => row.migration_name);
  } finally { await pool.end(); }
}

async function sourceCounts(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const tables = ['organizations', 'invoices', 'payment_records', 'expenses', 'cash_movements', 'inventory_movements', 'projects'];
    const result = {};
    for (const table of tables) result[table] = Number((await pool.query(`SELECT count(*) FROM "${table}"`)).rows[0].count);
    return result;
  } finally { await pool.end(); }
}

async function structuralProof(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const expectedTables = ['metric_snapshots', 'insight_alerts'];
    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
      [expectedTables],
    );
    const foundTables = new Set(tables.rows.map((row) => row.table_name));
    for (const table of expectedTables) if (!foundTables.has(table)) throw new Error(`Missing projection table ${table}`);

    const checks = await pool.query(
      "SELECT conname FROM pg_constraint WHERE conrelid IN ('metric_snapshots'::regclass, 'insight_alerts'::regclass) AND contype = 'c'",
    );
    const checkNames = new Set(checks.rows.map((row) => row.conname));
    for (const required of [
      'metric_snapshots_temporal_mode_check', 'metric_snapshots_scope_consistency_check',
      'metric_snapshots_currency_consistency_check', 'metric_snapshots_value_representation_check',
      'insight_alerts_status_check', 'insight_alerts_resolution_check',
    ]) if (!checkNames.has(required)) throw new Error(`Missing projection check ${required}`);

    const foreignKeys = await pool.query(
      "SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('metric_snapshots'::regclass, 'insight_alerts'::regclass) AND contype = 'f'",
    );
    for (const table of expectedTables) {
      const tenantFk = foreignKeys.rows.find((row) => row.conname === `${table}_establishment_id_organization_id_fkey`);
      if (!tenantFk || !tenantFk.definition.includes('(establishment_id, organization_id)') || !tenantFk.definition.includes('establishments(id, organization_id)')) {
        throw new Error(`Missing tenant-composite establishment FK on ${table}`);
      }
    }

    const indexes = await pool.query(
      `SELECT c.relname AS name, i.indisunique AS is_unique, pg_get_expr(i.indpred, i.indrelid) AS predicate, pg_get_indexdef(i.indexrelid) AS definition
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
       WHERE i.indrelid IN ('metric_snapshots'::regclass, 'insight_alerts'::regclass)`,
    );
    const normalized = (value) => (value ?? '').replaceAll('"', '').replaceAll('(', '').replaceAll(')', '').replace(/::(?:text|character varying)/g, '').replace(/\s+/g, ' ').toLowerCase();
    const findPartialUnique = (name, columns, predicate) => {
      const index = indexes.rows.find((row) => row.name === name);
      return index?.is_unique && normalized(index.definition).includes(columns) && normalized(index.predicate).includes(predicate);
    };
    if (!findPartialUnique('metric_snapshots_period_key', 'organization_id, scope_key, metric_code, definition_version, dimension_key, currency_key, period_start, period_end', 'period_start is not null') ||
        !findPartialUnique('metric_snapshots_instant_key', 'organization_id, scope_key, metric_code, definition_version, dimension_key, currency_key, as_of', 'as_of is not null') ||
        !findPartialUnique('insight_alerts_open_dedupe_key', 'organization_id, dedupe_key', "status = 'open'")) {
      throw new Error('Missing one or more partial unique indexes for period, instant, or open-alert projection keys');
    }
  } finally { await pool.end(); }
}

async function databaseExists(pool, name) {
  return (await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount === 1;
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
  await migrate(databaseUrls.empty);
  await structuralProof(databaseUrls.empty);
  await seed(databaseUrls.empty);
  await seed(databaseUrls.empty);
  const emptyApplied = await appliedNames(databaseUrls.empty);
  if (emptyApplied.length !== migrationDirectories.length || emptyApplied.at(-1) !== migrationDirectories.at(-1)) {
    const appliedSet = new Set(emptyApplied);
    const sourceSet = new Set(migrationDirectories);
    const missing = migrationDirectories.filter((name) => !appliedSet.has(name));
    const unexpected = emptyApplied.filter((name) => !sourceSet.has(name));
    throw new Error(
      `Phase 10A empty-database migration set mismatch: expected ${migrationDirectories.length} migrations ending with ` +
      `${migrationDirectories.at(-1)}, found ${emptyApplied.length} ending with ${emptyApplied.at(-1)}; ` +
      `missing=[${missing.join(', ')}], unexpected=[${unexpected.join(', ')}]`,
    );
  }

  await writeMigrationSet(baselineMigrationDirectories);
  await migrate(databaseUrls.upgrade);
  await seed(databaseUrls.upgrade);
  const upgradeBefore = await appliedNames(databaseUrls.upgrade);
  if (upgradeBefore.length !== baselineMigrationDirectories.length || upgradeBefore.at(-1) !== baselineMigrationDirectories.at(-1)) {
    throw new Error('Phase 9.6 upgrade baseline mismatch');
  }
  const beforeCounts = await sourceCounts(databaseUrls.upgrade);

  await writeMigrationSet(migrationDirectories);
  await migrate(databaseUrls.upgrade);
  await structuralProof(databaseUrls.upgrade);
  await seed(databaseUrls.upgrade);
  await seed(databaseUrls.upgrade);
  const upgradeAfter = await appliedNames(databaseUrls.upgrade);
  if (upgradeAfter.length !== migrationDirectories.length || upgradeAfter.at(-1) !== migrationDirectories.at(-1)) {
    throw new Error('Phase 10A upgrade migration set mismatch');
  }
  const afterCounts = await sourceCounts(databaseUrls.upgrade);
  if (JSON.stringify(beforeCounts) !== JSON.stringify(afterCounts)) throw new Error('Projection migration changed Phase 9.6 source-table row counts');

  console.log(`Phase 10A migration proof passed: empty database (${migrationDirectories.length} migrations), Phase 9.6 upgrade (${baselineMigrationDirectories.length} + ${phase10aMigrationDirectories.length} migrations), tenant FKs, temporal checks, partial uniqueness, idempotent seed, and source-row preservation verified.`);
} finally {
  await dropDatabase(adminPool, databaseNames.empty);
  await dropDatabase(adminPool, databaseNames.upgrade);
  await adminPool.end();
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
