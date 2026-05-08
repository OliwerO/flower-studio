// Standalone migration runner. Invoked by `npm run db:migrate` (Railway preDeployCommand).
//
// Reads .sql files from src/db/migrations/ in lexicographic order — the SAME
// path the pglite test harness uses (helpers/pgHarness.js). Tracks applied
// files in `_applied_sql_migrations` (filename PRIMARY KEY). Idempotent:
// re-runs skip already-applied entries.
//
// Why a custom runner instead of Drizzle's `migratePg`:
//   Drizzle's migrator reads `meta/_journal.json` to enumerate migrations.
//   When a new .sql file lands without a matching journal entry, Drizzle
//   silently skips it. Tests pass (pglite reads the dir directly), prod
//   deploys without applying the SQL, the next request hits a missing
//   table at runtime. Phase 7 (#266) hit this exact failure mode and
//   left prod broken until a hotfix added the journal entry. This runner
//   eliminates the class of bug entirely — there is no journal to fall
//   out of sync.
//
// Bridge for existing prod (one-shot, runs only when the tracking table is
// empty AND the schema is non-empty): seeds `_applied_sql_migrations` with
// every .sql filename currently on disk, treating them as already-applied.
// This handles the cutover from Drizzle's migrator on a DB that already has
// 0000–0011 applied. Fresh databases (empty schema) skip the bridge and
// apply everything from scratch.

import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

function listSqlFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

// Exported for `db/index.js` boot-time migrate path. Accepts any pg-compatible
// client (a `pg.PoolClient` from a pool.connect(), or a thin pg-like wrapper).
export async function applyPendingMigrations(client) {
  await ensureTrackingTable(client);

  let applied = await loadApplied(client);
  if (applied.size === 0) {
    const bridged = await bridgeFromPriorMigrator(client);
    if (bridged) applied = await loadApplied(client);
  }

  const files = listSqlFiles();
  const pending = files.filter(f => !applied.has(f));

  if (pending.length === 0) {
    console.log(`[PG] No pending migrations. ${files.length} already applied.`);
    return { applied: 0, total: files.length };
  }

  console.log(`[PG] Applying ${pending.length} pending migration(s):`);
  for (const f of pending) console.log(`     - ${f}`);

  for (const f of pending) {
    await applyOne(client, f);
  }
  return { applied: pending.length, total: files.length };
}

async function ensureTrackingTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _applied_sql_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function loadApplied(client) {
  const r = await client.query('SELECT filename FROM _applied_sql_migrations');
  return new Set(r.rows.map(row => row.filename));
}

async function bridgeFromPriorMigrator(client) {
  // Detect whether the schema already has migration history from the previous
  // (Drizzle journal-based) migrator. We use a public-table existence probe
  // because Drizzle's `__drizzle_migrations` lives in the `drizzle` schema
  // and may not be readable from the default search_path.
  const { rows } = await client.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('stock', 'orders', 'customers')
    LIMIT 1
  `);
  if (rows.length === 0) return false;

  const files = listSqlFiles();
  if (files.length === 0) return false;

  console.log(`[PG] Bridge: schema is non-empty but tracking table is fresh — marking ${files.length} existing migration(s) as already applied.`);
  for (const f of files) {
    await client.query(
      'INSERT INTO _applied_sql_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
      [f],
    );
  }
  return true;
}

async function applyOne(client, filename) {
  const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8');
  // Same separator as drizzle-kit emits and the pglite harness consumes.
  const statements = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);

  await client.query('BEGIN');
  try {
    for (const stmt of statements) {
      await client.query(stmt);
    }
    await client.query(
      'INSERT INTO _applied_sql_migrations (filename) VALUES ($1)',
      [filename],
    );
    await client.query('COMMIT');
    console.log(`[PG] applied ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`Migration ${filename} failed: ${err.message}`);
  }
}

async function runFromCli() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[FATAL] DATABASE_URL not set — cannot run migrations.');
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: url,
    ssl: process.env.PGSSL_DISABLE === 'true'
      ? false
      : (process.env.PGSSL_REJECT_UNAUTHORIZED === 'true'
          ? { rejectUnauthorized: true }
          : { rejectUnauthorized: false }),
  });

  const client = await pool.connect();
  try {
    await applyPendingMigrations(client);
    console.log('[PG] Migration runner finished.');
  } finally {
    client.release();
    await pool.end();
  }
}

// Run CLI logic only when invoked directly, not when imported by db/index.js.
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  try {
    await runFromCli();
  } catch (err) {
    console.error('[PG] Migration failed:', err.message || err);
    process.exitCode = 1;
  }
}
