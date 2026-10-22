import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import pg from 'pg';
import { assertMigrationSet } from './migration-proof-utils.mjs';

const { Pool } = pg;
const sourceMigrationsPath = join(process.cwd(), 'prisma', 'migrations');
const migrationDirectories = (await readdir(sourceMigrationsPath, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const phase9Start = '20261015010000_add_messaging_persistence';
const phase9MigrationDirectories = migrationDirectories.filter((name) => name >= phase9Start);
const phase8MigrationDirectories = migrationDirectories.filter((name) => name < phase9Start);
if (phase9MigrationDirectories.length === 0) throw new Error('No Phase 9 migration found');

const baseUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/monarque_connect');
const adminUrl = new URL(baseUrl); adminUrl.pathname = '/postgres';
const suffix = `${process.pid}_${randomUUID().replaceAll('-', '')}`;
const databaseNames = { empty: `monarque_phase9_empty_${suffix}`, upgrade: `monarque_phase9_upgrade_${suffix}` };
const databaseUrls = Object.fromEntries(Object.entries(databaseNames).map(([key, name]) => { const url = new URL(baseUrl); url.pathname = `/${name}`; return [key, url.toString()]; }));
const tempRoot = await mkdtemp(join(process.cwd(), 'tmp', 'monarque-phase9-migrations-'));
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

async function appliedNames(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try { const result = await pool.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name'); return result.rows.map((row) => row.migration_name); } finally { await pool.end(); }
}

async function structuralProof(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const requiredTables = ['conversations', 'conversation_organization_participants', 'conversation_user_participants', 'messaging_invitations', 'messages', 'messaging_organization_blocks', 'messaging_rate_buckets', 'messaging_command_receipts'];
    const tables = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\' AND table_name = ANY($1::text[])', [requiredTables]);
    const found = new Set(tables.rows.map((row) => row.table_name));
    const missing = requiredTables.filter((table) => !found.has(table));
    if (missing.length) throw new Error(`Phase 9 structural proof missing tables: ${missing.join(', ')}`);
    const columns = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'messaging_rate_buckets' AND column_name = ANY($1::text[])`, [['fingerprint_count']]);
    if (!columns.rows.some((row) => row.column_name === 'fingerprint_count')) throw new Error('Phase 9 structural proof missing fingerprint_count');
    const triggers = await pool.query(`SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = 'messages' AND NOT t.tgisinternal`);
    if (!triggers.rows.some((row) => row.tgname === 'messages_immutable_before_update_or_delete')) throw new Error('Phase 9 structural proof missing message immutability trigger');
    const indexes = await pool.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'messages' AND indexdef LIKE 'CREATE UNIQUE INDEX%'`);
    const definitions = indexes.rows.map((row) => row.indexdef.replaceAll('"', '').replace(/\s+/g, ' '));
    for (const required of ['(conversation_id, sequence)', '(conversation_id, author_user_id, client_message_id)']) if (!definitions.some((definition) => definition.includes(required))) throw new Error(`Phase 9 structural proof missing unique message index ${required}`);
  } finally { await pool.end(); }
}

async function databaseExists(pool, name) { return (await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount === 1; }
async function createDatabase(pool, name) { if (!await databaseExists(pool, name)) await pool.query(`CREATE DATABASE "${name}"`); }
async function dropDatabase(pool, name) { if (await databaseExists(pool, name)) await pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }

const adminPool = new Pool({ connectionString: adminUrl.toString() });
try {
  await createDatabase(adminPool, databaseNames.empty); await createDatabase(adminPool, databaseNames.upgrade);
  await writeMigrationSet(migrationDirectories); await migrate(databaseUrls.empty);
  const emptyNames = await appliedNames(databaseUrls.empty);
  assertMigrationSet(emptyNames, migrationDirectories, 'Phase 9 empty database');
  await structuralProof(databaseUrls.empty);
  await writeMigrationSet(phase8MigrationDirectories); await migrate(databaseUrls.upgrade);
  const phase8Names = await appliedNames(databaseUrls.upgrade);
  assertMigrationSet(phase8Names, phase8MigrationDirectories, 'Phase 8 upgrade baseline');
  await writeMigrationSet(migrationDirectories); await migrate(databaseUrls.upgrade);
  const finalNames = await appliedNames(databaseUrls.upgrade);
  assertMigrationSet(finalNames, migrationDirectories, 'Phase 9 upgrade');
  await structuralProof(databaseUrls.upgrade);
  console.log(`Phase 9 migration proof passed: empty database (${migrationDirectories.length} migrations) and Phase 8 upgrade (${phase8MigrationDirectories.length} + ${phase9MigrationDirectories.length} migrations).`);
} finally {
  await dropDatabase(adminPool, databaseNames.empty); await dropDatabase(adminPool, databaseNames.upgrade); await adminPool.end();
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
