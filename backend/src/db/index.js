// Postgres + Drizzle singleton.
//
// Gated on DATABASE_URL — backend boots without Postgres until the
// per-entity cutover flips to PG (Phase 3+). Once flipped, the absence
// of DATABASE_URL becomes a startup error in the relevant code paths;
// here we stay tolerant and just log.
//
// Three modes (selected by DATABASE_URL):
//   - unset                 → no Postgres (Airtable-only legacy mode)
//   - postgres://...        → real Railway PG via node-postgres + Pool
//   - pglite:memory         → in-process pglite (test harness — see
//                            docs/migration/3b-e2e-harness-design.md).
//                            Migrations applied at boot. Forbidden in
//                            NODE_ENV=production (fail-fast).
//
// Exposes:
//   - `pool`            raw pg Pool (for LISTEN/NOTIFY in future SSE work).
//                       Null in pglite mode.
//   - `db`              drizzle handle (used by repos in Phase 3+).
//   - `isPostgresConfigured`  boolean — guards repo branches during shadow-write.
//   - `isPgliteMode`    boolean — boot script + admin routes use it for diagnostics.
//   - `connectPostgres()`     called once at boot to log the version + apply pglite migrations.
//   - `disconnectPostgres()`  for graceful shutdown.

import pg from 'pg';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as schema from './schema.js';

// Drizzle returns `bigserial` columns (audit_log.id, parity_log.id) as JS
// bigints. JSON.stringify can't serialise bigint, so res.json() throws 500
// on any endpoint returning audit / parity rows (e.g. /api/admin/parity/:e,
// /api/test/audit). Coerce bigints to strings — these ids are opaque and
// the frontend treats them as strings already. Safe to set globally:
// no caller in this codebase performs bigint arithmetic on response data.
if (!BigInt.prototype.toJSON) {
  // eslint-disable-next-line no-extend-native
  BigInt.prototype.toJSON = function () { return this.toString(); };
}

const { Pool } = pg;

const url = process.env.DATABASE_URL;
const PGLITE_SENTINEL = 'pglite:memory';

export const isPgliteMode      = url === PGLITE_SENTINEL;
export const isPostgresConfigured = Boolean(url);

if (isPgliteMode && process.env.NODE_ENV === 'production') {
  console.error(
    `[FATAL] DATABASE_URL=${PGLITE_SENTINEL} is set in NODE_ENV=production. ` +
    `Refusing to boot — pglite is for test harness only. ` +
    `Use a real postgres:// URL on Railway.`
  );
  process.exit(1);
}

// ── Pglite branch ──
//
// We can't `import` the pglite drizzle adapter at the top level — that
// would force pglite to be a runtime dependency on Railway. Instead, we
// dynamic-import it lazily once. Same trick used by airtable.js to avoid
// loading the real Airtable SDK in test mode.
//
// `pgliteHandle` holds the underlying PGlite instance for shutdown +
// `_getPgliteHandle()` (used by start-test-backend.js to inspect state
// during E2E debugging).

let pgliteHandle = null;

async function bootPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
  const { readFileSync, readdirSync } = await import('fs');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const MIGRATIONS_DIR = join(__dirname, 'migrations');

  const pg = new PGlite();
  await pg.waitReady;

  // Apply every .sql file in src/db/migrations in lexicographic order —
  // mirrors the Drizzle journal's natural ordering. Statements are split
  // on the standard `--> statement-breakpoint` marker.
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }

  pgliteHandle = pg;
  return drizzlePglite(pg, { schema });
}

// ── Real Postgres branch ──

function buildSslConfig() {
  if (!url || isPgliteMode) return undefined;
  if (process.env.PGSSL_DISABLE === 'true') return false;
  return process.env.PGSSL_REJECT_UNAUTHORIZED === 'true'
    ? { rejectUnauthorized: true }
    : { rejectUnauthorized: false };
}

export const pool = (isPostgresConfigured && !isPgliteMode)
  ? new Pool({
      connectionString: url,
      ssl: buildSslConfig(),
      max: 10,
      idleTimeoutMillis: 30_000,
    })
  : null;

// ── Exported db handle ──
//
// In real-PG mode the drizzle handle is constructed eagerly (matches the
// pre-pglite behaviour). In pglite mode it's set asynchronously by
// connectPostgres() on first boot. Until then `db` is null — same shape as
// the unconfigured case, so any caller that reads `db` before
// connectPostgres() runs gets the same fallback as today's "no
// DATABASE_URL" path. start-test-backend.js MUST await connectPostgres()
// before mounting routes.

export let db = pool ? drizzlePg(pool, { schema }) : null;

export async function connectPostgres() {
  if (!url) {
    console.log('[PG] DATABASE_URL not set — Postgres disabled. Backend running on Airtable only.');
    return;
  }
  if (isPgliteMode) {
    db = await bootPglite();
    console.log('\x1b[33m[PG] pglite (in-memory) mode — migrations applied. NOT a real Postgres.\x1b[0m');
    return;
  }
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT version() AS v');
    console.log(`[PG] Connected: ${rows[0].v}`);
  } finally {
    client.release();
  }

  // Apply pending migrations on boot. Primary path is railway.toml's
  // preDeployCommand; this is the fallback for manual restarts and for any
  // environment that boots without going through Railway's release pipeline.
  // Drizzle's migrator takes a Postgres advisory lock so concurrent replicas
  // serialize safely — only one applies, the rest see no-op.
  if (process.env.PG_AUTO_MIGRATE === 'false') {
    console.log('[PG] PG_AUTO_MIGRATE=false — skipping boot-time migrate.');
    return;
  }
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const migrationsFolder = join(__dirname, 'migrations');
    await migratePg(db, { migrationsFolder });
    console.log('[PG] Migrations up to date.');
  } catch (err) {
    console.error('[PG] Migration failed on boot:', err);
    throw err;
  }
}

export async function disconnectPostgres() {
  if (pool) await pool.end();
  if (pgliteHandle) await pgliteHandle.close();
}

/** Test-only: returns the underlying PGlite handle when in pglite mode. */
export function _getPgliteHandle() {
  return pgliteHandle;
}
