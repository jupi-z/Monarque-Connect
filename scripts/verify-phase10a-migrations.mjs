import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import pg from 'pg';
import { assertMigrationSet } from './migration-proof-utils.mjs';

const { Pool } = pg;
const sourceMigrationsPath = join(process.cwd(), 'prisma', 'migrations');
const migrationDirectories = (await readdir(sourceMigrationsPath, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const phase10aStart = '20261020164848_phase10a_intelligence_projections';
const c1Start = '20261027160000_c1_product_scoped_entitlements';
const phase10aMigrationDirectories = migrationDirectories.filter((name) => name >= phase10aStart && name < c1Start);
const c1MigrationDirectories = migrationDirectories.filter((name) => name >= c1Start);
const baselineMigrationDirectories = migrationDirectories.filter((name) => name < phase10aStart);
if (!migrationDirectories.includes(phase10aStart) || phase10aMigrationDirectories.length !== 1 || !migrationDirectories.includes(c1Start) || c1MigrationDirectories.length < 1) {
  throw new Error('Unexpected Phase 10A migration set');
}

const baseUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/monarque_connect');
const adminUrl = new URL(baseUrl);
adminUrl.pathname = '/postgres';
const suffix = `${process.pid}_${randomUUID().replaceAll('-', '')}`;
const databaseNames = { empty: `monarque_phase10a_empty_${suffix}`, upgrade: `monarque_phase10a_upgrade_${suffix}`, c1Upgrade: `monarque_c1_upgrade_${suffix}` };
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
    return (await pool.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name'))
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

    const products = await pool.query('SELECT code FROM product_catalog ORDER BY code');
    if (JSON.stringify(products.rows.map((row) => row.code)) !== JSON.stringify(['MONARQUE_CONNECT', 'ZAMUREK'])) {
      throw new Error('Product catalog does not contain exactly the initial server-controlled product codes');
    }
    for (const table of ['plans', 'plan_versions', 'price_versions', 'subscriptions', 'billing_subscription_terms', 'organization_module_activations', 'organization_entitlements', 'organization_quota_usages', 'quota_reservations', 'quota_ledgers']) {
      const result = await pool.query(`SELECT count(*)::int AS count FROM "${table}" WHERE product_code <> 'MONARQUE_CONNECT'`);
      if (result.rows[0].count !== 0) throw new Error(`Historical ${table} rows were not backfilled to MONARQUE_CONNECT`);
      const fk = await pool.query(
        `SELECT count(*)::int AS count FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'f' AND confrelid = 'product_catalog'::regclass AND pg_get_constraintdef(oid) LIKE '%product_code%'`,
        [table],
      );
      // C1.3 replaces direct product-code FKs on module-scoped records with a
      // composite (product_code, module_code) FK to product_modules. That
      // registry itself references product_catalog, so the product remains
      // constrained through the server-owned product/module mapping.
      const productModuleScoped = ['organization_module_activations', 'organization_entitlements'].includes(table);
      if (!productModuleScoped && fk.rows[0].count !== 1) throw new Error(`Missing product catalog foreign key on ${table}`);
    }
    const subscriptionConstraint = await pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'subscriptions'::regclass AND conname = 'subscriptions_no_overlapping_effective_periods'");
    if (!subscriptionConstraint.rows[0]?.definition.includes('product_code')) throw new Error('Subscription overlap constraint is not product scoped');
    const subscriptionLifecycleIndex = await pool.query("SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'subscriptions_one_open_org_product_key'");
    if (!subscriptionLifecycleIndex.rows[0]?.indexdef.includes('(organization_id, product_code)')) throw new Error('Open subscription lifecycle uniqueness is not product scoped');
    const billingConstraint = await pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'billing_subscription_terms'::regclass AND conname = 'billing_subscription_terms_no_overlap'");
    if (!billingConstraint.rows[0]?.definition.includes('product_code')) throw new Error('Billing term overlap constraint is not product scoped');

    const productModules = await pool.query("SELECT to_regclass('public.product_modules') IS NOT NULL AS exists");
    if (!productModules.rows[0]?.exists) throw new Error('Missing product_modules registry table');
    for (const [table, constraint] of [
      ['plan_version_modules', 'plan_version_modules_product_module_fkey'],
      ['organization_module_activations', 'organization_module_activations_product_module_fkey'],
      ['organization_entitlements', 'organization_entitlements_product_module_fkey'],
    ]) {
      const scopedFk = await pool.query(
        'SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2 AND contype = \'f\' AND confrelid = \'product_modules\'::regclass',
        [table, constraint],
      );
      const definition = scopedFk.rows[0]?.definition ?? '';
      if (!definition.includes('(product_code, module_code)') || !definition.includes('product_modules(product_code, module_code)')) {
        throw new Error(`Missing product/module scoped foreign key ${table}.${constraint}`);
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
  await createDatabase(adminPool, databaseNames.c1Upgrade);

  await writeMigrationSet(migrationDirectories);
  await migrate(databaseUrls.empty);
  await structuralProof(databaseUrls.empty);
  await seed(databaseUrls.empty);
  await seed(databaseUrls.empty);
  const emptyApplied = await appliedNames(databaseUrls.empty);
  assertMigrationSet(emptyApplied, migrationDirectories, 'Phase 10A empty database');

  await writeMigrationSet(baselineMigrationDirectories);
  await migrate(databaseUrls.upgrade);
  const upgradeBefore = await appliedNames(databaseUrls.upgrade);
  assertMigrationSet(upgradeBefore, baselineMigrationDirectories, 'Phase 9.6 upgrade baseline');
  const beforeCounts = await sourceCounts(databaseUrls.upgrade);

  await writeMigrationSet(migrationDirectories);
  await migrate(databaseUrls.upgrade);
  await structuralProof(databaseUrls.upgrade);
  await seed(databaseUrls.upgrade);
  await seed(databaseUrls.upgrade);
  const upgradeAfter = await appliedNames(databaseUrls.upgrade);
  assertMigrationSet(upgradeAfter, migrationDirectories, 'Phase 10A upgrade');
  const afterCounts = await sourceCounts(databaseUrls.upgrade);
  if (JSON.stringify(beforeCounts) !== JSON.stringify(afterCounts)) throw new Error('Projection migration changed Phase 9.6 source-table row counts');

  const preC1MigrationDirectories = migrationDirectories.filter((name) => name < c1Start);
  await writeMigrationSet(preC1MigrationDirectories);
  await migrate(databaseUrls.c1Upgrade);
  const c1Before = await appliedNames(databaseUrls.c1Upgrade);
  assertMigrationSet(c1Before, preC1MigrationDirectories, 'C1 pre-migration main schema');
  const c1BeforeCounts = await sourceCounts(databaseUrls.c1Upgrade);
  await writeMigrationSet(migrationDirectories);
  await migrate(databaseUrls.c1Upgrade);
  await structuralProof(databaseUrls.c1Upgrade);
  await seed(databaseUrls.c1Upgrade);
  await seed(databaseUrls.c1Upgrade);
  assertMigrationSet(await appliedNames(databaseUrls.c1Upgrade), migrationDirectories, 'C1 main upgrade');
  const c1AfterCounts = await sourceCounts(databaseUrls.c1Upgrade);
  if (JSON.stringify(c1BeforeCounts) !== JSON.stringify(c1AfterCounts)) throw new Error('C1 migration changed historical source-table row counts');

  console.log(`Phase 10A/C1 migration proof passed: empty database (${migrationDirectories.length} migrations), Phase 9.6 upgrade (${baselineMigrationDirectories.length} + ${phase10aMigrationDirectories.length + c1MigrationDirectories.length}), and current-main upgrade (${preC1MigrationDirectories.length} + ${c1MigrationDirectories.length}); product catalog, Connect backfill, product FKs and temporal exclusions, tenant FKs, product/module scoped FKs, partial uniqueness, idempotent seed, and source-row preservation verified.`);
} finally {
  await dropDatabase(adminPool, databaseNames.empty);
  await dropDatabase(adminPool, databaseNames.upgrade);
  await dropDatabase(adminPool, databaseNames.c1Upgrade);
  await adminPool.end();
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
