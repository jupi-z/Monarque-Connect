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
    const expectedTables = [
      'metric_snapshots', 'insight_alerts', 'external_identities', 'external_identity_link_challenges',
      'measure_units', 'currency_definitions', 'item_variants', 'commercial_offers', 'catalog_command_receipts',
      'commercial_price_versions',
    ];
    const projectionTables = ['metric_snapshots', 'insight_alerts'];
    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
      [expectedTables],
    );
    const foundTables = new Set(tables.rows.map((row) => row.table_name));
    for (const table of expectedTables) if (!foundTables.has(table)) throw new Error(`Missing required migration-proof table ${table}`);

    const priceConstraints = await pool.query(
      `SELECT conname, contype, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint WHERE conrelid = 'public.commercial_price_versions'::regclass`,
    );
    const priceConstraintNames = new Set(priceConstraints.rows.map((row) => row.conname));
    for (const required of [
      'commercial_price_versions_version_check', 'commercial_price_versions_amount_check',
      'commercial_price_versions_payload_hash_check', 'commercial_price_versions_offer_org_product_fkey',
      'commercial_price_versions_currency_code_fkey', 'commercial_price_versions_price_unit_code_fkey',
    ]) if (!priceConstraintNames.has(required)) throw new Error(`Missing commercial price constraint ${required}`);
    const priceIndexes = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'commercial_price_versions'`,
    );
    const priceIndexNames = new Set(priceIndexes.rows.map((row) => row.indexname));
    for (const required of [
      'commercial_price_versions_offer_currency_version_key',
      'commercial_price_versions_org_offer_currency_effective_key',
      'commercial_price_versions_price_scope_time_idx',
    ]) if (!priceIndexNames.has(required)) throw new Error(`Missing commercial price index ${required}`);
    const priceTriggers = await pool.query(
      `SELECT t.tgname, pg_get_functiondef(t.tgfoid) AS function_definition
       FROM pg_trigger t WHERE t.tgrelid = 'public.commercial_price_versions'::regclass AND NOT t.tgisinternal`,
    );
    const insertGuard = priceTriggers.rows.find((row) => row.tgname === 'commercial_price_versions_insert_guard');
    const immutableGuard = priceTriggers.rows.find((row) => row.tgname === 'commercial_price_versions_immutable');
    if (!insertGuard || !insertGuard.function_definition.includes('FOR UPDATE OF o')
      || !insertGuard.function_definition.includes('NEW."effective_from" <= latest_effective_from')
      || !insertGuard.function_definition.includes('commercial price effective times must increase strictly')) {
      throw new Error('Commercial price insertion guard is missing its offer lock or temporal-order check');
    }
    if (!immutableGuard || !immutableGuard.function_definition.includes('commercial price versions are immutable')) {
      throw new Error('Commercial price immutable update/delete guard is missing');
    }

    const checks = await pool.query(
      'SELECT conname FROM pg_constraint WHERE conrelid = ANY($1::regclass[]) AND contype = \'c\'',
      [projectionTables.map((table) => `public.${table}`)],
    );
    const checkNames = new Set(checks.rows.map((row) => row.conname));
    for (const required of [
      'metric_snapshots_temporal_mode_check', 'metric_snapshots_scope_consistency_check',
      'metric_snapshots_currency_consistency_check', 'metric_snapshots_value_representation_check',
      'insight_alerts_status_check', 'insight_alerts_resolution_check',
    ]) if (!checkNames.has(required)) throw new Error(`Missing projection check ${required}`);

    const foreignKeys = await pool.query(
      'SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = ANY($1::regclass[]) AND contype = \'f\'',
      [projectionTables.map((table) => `public.${table}`)],
    );
    for (const table of projectionTables) {
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
       WHERE i.indrelid = ANY($1::regclass[])`,
      [projectionTables.map((table) => `public.${table}`)],
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

    const identityIndexes = await pool.query(
      `SELECT c.relname AS name, i.indisunique AS is_unique, pg_get_indexdef(i.indexrelid) AS definition
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
       WHERE i.indrelid IN ('external_identities'::regclass, 'external_identity_link_challenges'::regclass, 'refresh_sessions'::regclass)`,
    );
    for (const required of [
      ['external_identities_issuer_subject_key', 'issuer, subject'],
      ['external_identities_id_user_id_key', 'id, user_id'],
      ['refresh_sessions_id_user_id_key', 'id, user_id'],
      ['external_identity_link_challenges_state_hash_key', 'state_hash'],
      ['external_identity_link_challenges_nonce_hash_key', 'nonce_hash'],
    ]) {
      const index = identityIndexes.rows.find((row) => row.name === required[0]);
      if (!index?.is_unique || !normalized(index.definition).includes(required[1])) {
        throw new Error(`Missing C2 unique identity index ${required[0]}`);
      }
    }
    const identityChecks = await pool.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid IN ('external_identities'::regclass, 'external_identity_link_challenges'::regclass) AND contype = 'c'`,
    );
    const identityCheckNames = new Set(identityChecks.rows.map((row) => row.conname));
    for (const required of [
      'external_identities_issuer_ascii_url_check', 'external_identities_issuer_octet_length_check',
      'external_identities_subject_ascii_check', 'external_identities_subject_octet_length_check',
      'external_identities_status_revocation_check', 'external_identity_link_challenges_state_hash_format_check',
      'external_identity_link_challenges_nonce_hash_format_check', 'external_identity_link_challenges_expiry_check',
      'external_identity_link_challenges_consumption_check',
    ]) if (!identityCheckNames.has(required)) throw new Error(`Missing C2 identity constraint ${required}`);
    const identityForeignKeys = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid IN ('external_identities'::regclass, 'external_identity_link_challenges'::regclass) AND contype = 'f'`,
    );
    for (const required of [
      ['external_identities_user_id_fkey', 'users(id)', 'RESTRICT'],
      ['external_identities_created_by_user_id_fkey', 'users(id)', 'RESTRICT'],
      ['external_identities_revoked_by_user_id_fkey', 'users(id)', 'RESTRICT'],
      ['external_identity_link_challenges_session_user_fkey', 'refresh_sessions(id, user_id)', 'CASCADE'],
      ['external_identity_link_challenges_identity_user_fkey', 'external_identities(id, user_id)', 'RESTRICT'],
    ]) {
      const foreignKey = identityForeignKeys.rows.find((row) => row.conname === required[0]);
      if (!foreignKey?.definition.toUpperCase().includes(required[1].toUpperCase())
        || !foreignKey.definition.toUpperCase().includes(`ON DELETE ${required[2]}`)) {
        throw new Error(`Missing C2 identity foreign-key policy ${required[0]}`);
      }
    }
    const identityTriggers = await pool.query(
      `SELECT tgname FROM pg_trigger
       WHERE NOT tgisinternal AND tgrelid IN ('external_identities'::regclass, 'external_identity_link_challenges'::regclass)`,
    );
    const identityTriggerNames = new Set(identityTriggers.rows.map((row) => row.tgname));
    for (const required of ['external_identities_ownership_immutable', 'external_identity_link_challenges_proof_immutable']) {
      if (!identityTriggerNames.has(required)) throw new Error(`Missing C2 identity protection trigger ${required}`);
    }
    const identityAuditActions = await pool.query(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'AuditAction'`,
    );
    const identityAuditActionNames = new Set(identityAuditActions.rows.map((row) => row.enumlabel));
    for (const required of ['EXTERNAL_IDENTITY_LINKED', 'EXTERNAL_IDENTITY_REACTIVATED', 'EXTERNAL_IDENTITY_REVOKED', 'CATALOG_VARIANT_CREATED', 'CATALOG_OFFER_CREATED', 'CATALOG_OFFER_UPDATED', 'CATALOG_OFFER_STATUS_CHANGED']) {
      if (!identityAuditActionNames.has(required)) throw new Error(`Missing required audit action ${required}`);
    }

    const unitChecks = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('measure_units'::regclass, 'currency_definitions'::regclass, 'item_variants'::regclass, 'commercial_offers'::regclass, 'catalog_command_receipts'::regclass) AND contype = 'c'`,
    );
    const unitCheckNames = new Set(unitChecks.rows.map((row) => row.conname));
    for (const required of ['measure_units_factor_check', 'measure_units_registry_version_check', 'currency_definitions_minor_digits_check', 'item_variants_code_format_check', 'item_variants_attributes_object_check', 'commercial_offers_version_check', 'catalog_command_receipts_payload_hash_check']) {
      if (!unitCheckNames.has(required)) throw new Error(`Missing C3 catalog constraint ${required}`);
    }
    const attributesCheck = unitChecks.rows.find((row) => row.conname === 'item_variants_attributes_object_check')?.definition?.replaceAll('"', '').toLowerCase();
    if (!attributesCheck?.includes('jsonb_typeof(attributes_json) = \'object\'') || !attributesCheck.includes('jsonb_path_query_array') || !attributesCheck.includes('<= 30')) {
      throw new Error('Item variant JSON attributes are not constrained to a bounded object');
    }
    const attributeCountProbe = await pool.query(
      `SELECT jsonb_array_length(jsonb_path_query_array($1::jsonb, '$.keyvalue()')) AS count`,
      [JSON.stringify(Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`field${index}`, 'value'])))],
    );
    if (Number(attributeCountProbe.rows[0]?.count) !== 31) throw new Error('PostgreSQL JSONPath key counting did not return the expected result');

    const units = await pool.query("SELECT code, dimension, base_unit_code, numerator::text, denominator::text, registry_version, source_revision FROM measure_units WHERE active ORDER BY code");
    const expectedUnits = [
      { code: 'CM', dimension: 'LENGTH', base_unit_code: 'M', numerator: '1', denominator: '100', registry_version: 1, source_revision: 'monarque-measures-v1' },
      { code: 'EA', dimension: 'COUNT', base_unit_code: 'EA', numerator: '1', denominator: '1', registry_version: 1, source_revision: 'monarque-measures-v1' },
      { code: 'G', dimension: 'MASS', base_unit_code: 'KG', numerator: '1', denominator: '1000', registry_version: 1, source_revision: 'monarque-measures-v1' },
      { code: 'HOUR', dimension: 'TIME', base_unit_code: 'HOUR', numerator: '1', denominator: '1', registry_version: 1, source_revision: 'monarque-measures-v1' },
      { code: 'KG', dimension: 'MASS', base_unit_code: 'KG', numerator: '1', denominator: '1', registry_version: 1, source_revision: 'monarque-measures-v1' },
      { code: 'L', dimension: 'VOLUME', base_unit_code: 'L', numerator: '1', denominator: '1', registry_version: 1, source_revision: 'monarque-measures-v1' },
      { code: 'M', dimension: 'LENGTH', base_unit_code: 'M', numerator: '1', denominator: '1', registry_version: 1, source_revision: 'monarque-measures-v1' },
      { code: 'MG', dimension: 'MASS', base_unit_code: 'KG', numerator: '1', denominator: '1000000', registry_version: 1, source_revision: 'monarque-measures-v1' },
      { code: 'MINUTE', dimension: 'TIME', base_unit_code: 'HOUR', numerator: '1', denominator: '60', registry_version: 1, source_revision: 'monarque-measures-v1' },
      { code: 'ML', dimension: 'VOLUME', base_unit_code: 'L', numerator: '1', denominator: '1000', registry_version: 1, source_revision: 'monarque-measures-v1' },
      { code: 'MM', dimension: 'LENGTH', base_unit_code: 'M', numerator: '1', denominator: '1000', registry_version: 1, source_revision: 'monarque-measures-v1' },
    ];
    if (JSON.stringify(units.rows) !== JSON.stringify(expectedUnits)) throw new Error('C3 active measure registry differs from its reviewed exact rational allowlist');
    const invalidMeasureBases = await pool.query(
      `SELECT unit.code FROM measure_units unit
       LEFT JOIN measure_units base ON base.code = unit.base_unit_code
       WHERE base.code IS NULL OR base.dimension <> unit.dimension
          OR base.base_unit_code <> base.code OR base.numerator <> 1 OR base.denominator <> 1`,
    );
    if (invalidMeasureBases.rowCount !== 0) throw new Error('C3 measure registry contains an invalid dimension or non-canonical base unit');

    const currencies = await pool.query("SELECT code, minor_unit_digits, registry_version, source_revision FROM currency_definitions WHERE active ORDER BY code");
    if (JSON.stringify(currencies.rows) !== JSON.stringify([
      { code: 'CDF', minor_unit_digits: 2, registry_version: 1, source_revision: 'six-iso4217-list-one-2026-10' },
      { code: 'EUR', minor_unit_digits: 2, registry_version: 1, source_revision: 'six-iso4217-list-one-2026-10' },
      { code: 'USD', minor_unit_digits: 2, registry_version: 1, source_revision: 'six-iso4217-list-one-2026-10' },
    ])) {
      throw new Error('C3 supported currency registry differs from the reviewed initial allowlist');
    }

    const catalogForeignKeys = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('item_variants'::regclass, 'commercial_offers'::regclass, 'catalog_command_receipts'::regclass) AND contype = 'f'`,
    );
    for (const [name, references] of [
      ['item_variants_item_id_organization_id_fkey', '(item_id, organization_id) REFERENCES items(id, organization_id)'],
      ['commercial_offers_item_id_organization_id_fkey', '(item_id, organization_id) REFERENCES items(id, organization_id)'],
      ['commercial_offers_establishment_id_organization_id_fkey', '(establishment_id, organization_id) REFERENCES establishments(id, organization_id)'],
      ['commercial_offers_variant_id_item_id_organization_id_fkey', '(variant_id, item_id, organization_id) REFERENCES item_variants(id, item_id, organization_id)'],
      ['commercial_offers_product_code_fkey', '(product_code) REFERENCES product_catalog(code)'],
      ['commercial_offers_sell_unit_code_fkey', '(sell_unit_code) REFERENCES measure_units(code)'],
      ['catalog_command_receipts_organization_id_fkey', '(organization_id) REFERENCES organizations(id)'],
      ['catalog_command_receipts_actor_user_id_fkey', '(actor_user_id) REFERENCES users(id)'],
    ]) {
      const foreignKey = catalogForeignKeys.rows.find((row) => row.conname === name);
      if (!foreignKey?.definition.replaceAll('"', '').includes(references)) throw new Error(`Missing C3 tenant-scoped foreign key ${name}`);
    }
    const receiptUniqueIndex = await pool.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'catalog_command_receipts' AND indexname = 'catalog_command_receipts_organization_id_actor_user_id_operation_idempotency_key_key'`,
    );
    const receiptIndex = receiptUniqueIndex.rows[0]?.indexdef?.replaceAll('"', '').toLowerCase();
    if (!receiptIndex?.includes('unique') || !receiptIndex.includes('(organization_id, actor_user_id, operation, idempotency_key)')) {
      throw new Error('C3 catalog idempotency receipt uniqueness is not enforced by PostgreSQL');
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

  console.log(`Phase 10A.5 migration proof passed: empty database (${migrationDirectories.length} migrations), Phase 9.6 upgrade, and current-main upgrade; product catalog/backfill, scoped entitlements, identity registry/challenges and immutability, exact C3 measure/currency registries, tenant-scoped catalog constraints and idempotency, audit enum values, projection constraints, idempotent seed, and historical source-row preservation verified.`);
} finally {
  await dropDatabase(adminPool, databaseNames.empty);
  await dropDatabase(adminPool, databaseNames.upgrade);
  await dropDatabase(adminPool, databaseNames.c1Upgrade);
  await adminPool.end();
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
