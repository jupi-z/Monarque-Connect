import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import pg from 'pg';

const { Pool } = pg;
const sourceMigrationsPath = join(process.cwd(), 'prisma', 'migrations');
const migrationDirectories = (await readdir(sourceMigrationsPath, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const phase8Start = '20261014210000_add_projects_documents';
const phase8MigrationDirectories = migrationDirectories.filter((name) => name >= phase8Start);
const phase7MigrationDirectories = migrationDirectories.filter((name) => name < phase8Start);
if (phase8MigrationDirectories.length === 0) throw new Error('No Phase 8 migration found');

const baseUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect');
const adminUrl = new URL(baseUrl); adminUrl.pathname = '/postgres';
const suffix = `${process.pid}_${randomUUID().replaceAll('-', '')}`;
const databaseNames = { empty: `monarque_phase8_empty_${suffix}`, upgrade: `monarque_phase8_upgrade_${suffix}` };
const databaseUrls = Object.fromEntries(Object.entries(databaseNames).map(([key, name]) => { const url = new URL(baseUrl); url.pathname = `/${name}`; return [key, url.toString()]; }));
const tempRoot = await mkdtemp(join(process.cwd(), 'tmp', 'monarque-phase8-migrations-'));
const tempPrismaRoot = join(tempRoot, 'prisma');
await mkdir(tempPrismaRoot, { recursive: true });
await cp(join(process.cwd(), 'prisma', 'schema.prisma'), join(tempPrismaRoot, 'schema.prisma'));

async function writeMigrationSet(names) {
  const migrationsPath = join(tempPrismaRoot, 'migrations');
  await rm(migrationsPath, { recursive: true, force: true });
  await cp(sourceMigrationsPath, migrationsPath, { recursive: true, filter: (source) => { const relative = source.slice(sourceMigrationsPath.length + 1); return relative === '' || names.some((name) => relative === name || relative.startsWith(`${name}${sep}`)); } });
}

async function migrate(databaseUrl) {
  const configPath = join(tempRoot, 'prisma.config.ts');
  await writeFile(configPath, "import { defineConfig } from 'prisma/config';\nexport default defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env.DATABASE_URL } });\n", 'utf8');
  await new Promise((resolve, reject) => {
    const executable = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
    execFile(executable, ['migrate', 'deploy', '--config', configPath], { cwd: tempRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 10 * 1024 * 1024, shell: process.platform === 'win32' }, (error, stdout, stderr) => { if (stdout) process.stdout.write(stdout); if (stderr) process.stderr.write(stderr); if (error) reject(error); else resolve(); });
  });
}

async function seed(databaseUrl) {
  await new Promise((resolve, reject) => {
    const executable = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
    execFile(executable, [join(process.cwd(), 'prisma', 'seed.ts')], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 10 * 1024 * 1024, shell: process.platform === 'win32' }, (error, stdout, stderr) => { if (stdout) process.stdout.write(stdout); if (stderr) process.stderr.write(stderr); if (error) reject(error); else resolve(); });
  });
}

async function databaseExists(pool, name) { return (await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount === 1; }
async function createDatabase(pool, name) { if (!await databaseExists(pool, name)) await pool.query(`CREATE DATABASE "${name}"`); }
async function dropDatabase(pool, name) { if (await databaseExists(pool, name)) await pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
async function appliedNames(databaseUrl) { const pool = new Pool({ connectionString: databaseUrl }); try { const result = await pool.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at, migration_name'); return result.rows.map((row) => row.migration_name); } finally { await pool.end(); } }

async function structuralProof(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const requiredTables = ['projects', 'tasks', 'documents', 'document_links', 'phase8_idempotency_keys'];
    const result = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\' AND table_name = ANY($1::text[])', [requiredTables]);
    const found = new Set(result.rows.map((row) => row.table_name));
    const missing = requiredTables.filter((table) => !found.has(table));
    if (missing.length) throw new Error(`Phase 8 structural proof missing tables: ${missing.join(', ')}`);
    const columns = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = ANY($1::text[])`, [['upload_token', 'upload_expires_at']]);
    const foundColumns = new Set(columns.rows.map((row) => row.column_name));
    for (const required of ['upload_token', 'upload_expires_at']) if (!foundColumns.has(required)) throw new Error(`Phase 8 structural proof missing document column: ${required}`);
    const constraints = await pool.query(`SELECT conname FROM pg_constraint WHERE conname IN ('projects_dates_check', 'tasks_position_check', 'documents_byte_size_check', 'documents_checksum_sha256_check', 'document_links_organization_id_document_id_target_type_target_id_key', 'phase8_idempotency_keys_organization_id_actor_user_id_operation_key_key')`);
    const names = new Set(constraints.rows.map((row) => row.conname));
    for (const required of ['projects_dates_check', 'tasks_position_check', 'documents_byte_size_check', 'documents_checksum_sha256_check']) if (!names.has(required)) throw new Error(`Phase 8 structural proof missing constraint: ${required}`);
    const indexes = await pool.query(`SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('document_links', 'phase8_idempotency_keys') AND indexdef LIKE 'CREATE UNIQUE INDEX%'`);
    const definitions = indexes.rows.map((row) => ({ table: row.tablename, definition: row.indexdef.replaceAll('"', '').replace(/\s+/g, ' ') }));
    const requiredIndexes = [
      ['document_links', '(organization_id, document_id, target_type, target_id)'],
      ['phase8_idempotency_keys', '(organization_id, actor_user_id, operation, key)'],
    ];
    for (const [table, columns] of requiredIndexes) if (!definitions.some((definition) => definition.table === table && definition.definition.includes(columns))) throw new Error(`Phase 8 structural proof missing unique index columns: ${table} ${columns}`);
  } finally { await pool.end(); }
}

const adminPool = new Pool({ connectionString: adminUrl.toString() });
try {
  await createDatabase(adminPool, databaseNames.empty); await createDatabase(adminPool, databaseNames.upgrade);
  await writeMigrationSet(migrationDirectories); await migrate(databaseUrls.empty);
  const emptyNames = await appliedNames(databaseUrls.empty);
  if (emptyNames.length !== migrationDirectories.length || emptyNames.at(-1) !== migrationDirectories.at(-1)) throw new Error('Phase 8 empty database migration set mismatch');
  await structuralProof(databaseUrls.empty);
  await seed(databaseUrls.empty); await seed(databaseUrls.empty);
  const emptyPool = new Pool({ connectionString: databaseUrls.empty });
  try {
    for (const table of ['projects', 'tasks', 'documents', 'document_links', 'phase8_idempotency_keys']) {
      const count = await emptyPool.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
      if (count.rows[0]?.count !== 0) throw new Error(`Phase 8 seed inserted operational data into ${table}`);
    }
  } finally { await emptyPool.end(); }
  await writeMigrationSet(phase7MigrationDirectories); await migrate(databaseUrls.upgrade);
  const phase7Names = await appliedNames(databaseUrls.upgrade);
  if (phase7Names.length !== phase7MigrationDirectories.length || phase7Names.at(-1) !== phase7MigrationDirectories.at(-1)) throw new Error('Phase 7 upgrade baseline mismatch');
  await writeMigrationSet(migrationDirectories); await migrate(databaseUrls.upgrade);
  const finalNames = await appliedNames(databaseUrls.upgrade);
  if (finalNames.length !== migrationDirectories.length || finalNames.at(-1) !== migrationDirectories.at(-1)) throw new Error('Phase 8 upgrade migration set mismatch');
  await structuralProof(databaseUrls.upgrade);
  await seed(databaseUrls.upgrade); await seed(databaseUrls.upgrade);
  console.log(`Phase 8 migration proof passed: empty database (${migrationDirectories.length} migrations) and Phase 7 upgrade (${phase7MigrationDirectories.length} + ${phase8MigrationDirectories.length} migrations).`);
} finally {
  await dropDatabase(adminPool, databaseNames.empty); await dropDatabase(adminPool, databaseNames.upgrade); await adminPool.end();
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
