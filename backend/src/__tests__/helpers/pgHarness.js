// pgHarness — boots an in-process Postgres (via @electric-sql/pglite),
// runs the same SQL migrations Railway runs, and returns a Drizzle handle
// compatible with the production `db` import.
//
// Why pglite, not pg-mem: pglite IS Postgres compiled to WASM — same
// query parser, same transaction semantics, same type system as Railway.
// Tests that pass here pass in production; pg-mem has gaps that bite at
// the worst time.
//
// Usage (unchanged — call it per-test exactly as before):
//   import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
//   beforeEach(async () => { harness = await setupPgHarness(); });
//   afterEach(async () => { await teardownPgHarness(harness); });
//   harness.db is a Drizzle instance you can pass anywhere the prod handle goes.
//
// ── Why setup is pooled per FILE, not per test (2026-07-26) ──────────────
// Each test still starts with a completely empty database, but it gets there
// by TRUNCATE rather than by booting a second Postgres. Measured on this
// suite: `new PGlite()` + waitReady = ~562ms, replaying all migrations =
// ~44ms, TRUNCATE of the whole public schema = ~15ms. The WASM boot — not
// the migration replay — was 93% of the cost, and roughly 600 harness-backed
// tests over ~73 files were each paying it instead of paying it once per file.
//
// Measured locally, same commit, only this file swapped: 267.6s → 52.0s for
// the full backend suite, 1085/1085 green both ways. The single heaviest file
// (orderRepo.integration.test.js, 58 tests) went 32.7s → 2.8s. In CI the same
// suite had been taking ~590s and tripping a 10-minute ceiling. Because the
// pooling lives here rather than in each test file, every future integration
// test inherits it — the creep this fixed cannot come back one file at a time.
//
// Vitest gives each test file its own module registry (`isolate: true`, the
// default), so `pooled` below is per-file state, never shared across files.
// The instance is closed in an afterAll registered at import time.
//
// If a test genuinely needs a SECOND, independent database alongside the
// pooled one (see assistantTools.ordersPack.integration.test.js), ask for it
// with `setupPgHarness({ fresh: true })` — that instance is never pooled and
// IS really closed by teardownPgHarness().

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as schema from '../../db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');

// Apply every .sql file in src/db/migrations in lexicographic order.
// Drizzle's standard migration runner uses meta/_journal.json for ordering;
// we replicate that by sorting filenames since pglite doesn't need the
// migration tracking infrastructure (each test starts fresh).
//
// Statements are split on the standard `--> statement-breakpoint` marker
// drizzle-kit emits between DDL chunks.
async function applyMigrations(pg) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }
}

// The per-file pooled instance. Null until the file's first setup call.
let pooled = null;

async function bootHarness() {
  const pg = new PGlite();
  // Wait for the WASM runtime to be ready before issuing the first query.
  await pg.waitReady;
  await applyMigrations(pg);
  const db = drizzle(pg, { schema });
  return { pg, db };
}

/**
 * Empty every table without re-booting Postgres.
 *
 * RESTART IDENTITY resets serial sequences, so a pooled database is
 * indistinguishable from a freshly-migrated one; CASCADE lets us truncate
 * FK-linked tables in a single statement without hand-ordering them.
 *
 * The table list is read once and cached — it only changes when migrations
 * change, which cannot happen mid-file.
 */
export async function resetPgHarness(harness) {
  if (!harness?.pg) return;
  if (harness._truncateSql === undefined) {
    const { rows } = await harness.pg.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
    );
    const names = rows.map(r => `"${r.tablename}"`).join(', ');
    harness._truncateSql = names ? `TRUNCATE ${names} RESTART IDENTITY CASCADE;` : '';
  }
  if (harness._truncateSql) await harness.pg.exec(harness._truncateSql);
}

/**
 * Return a Postgres with the full schema applied and no rows in it.
 *
 * Reuses this file's pooled instance (emptying it first) instead of booting
 * a new one — see the header comment for why. Pass `{ fresh: true }` for an
 * independent instance that is not pooled and is really closed on teardown.
 */
export async function setupPgHarness({ fresh = false } = {}) {
  if (fresh) {
    const harness = await bootHarness();
    harness._standalone = true;
    return harness;
  }
  if (pooled) {
    await resetPgHarness(pooled);
    return pooled;
  }
  pooled = await bootHarness();
  return pooled;
}

/**
 * Per-test teardown. For the pooled instance this is a no-op: the database
 * is emptied on the way IN (by setupPgHarness) rather than on the way out,
 * and the WASM process is closed once per file by the afterAll below.
 * A `{ fresh: true }` harness is closed here for real.
 */
export async function teardownPgHarness(harness) {
  if (harness?._standalone && harness.pg) {
    await harness.pg.close();
  }
}

// Close the pooled Postgres when the importing test file finishes. Registered
// at import time, which happens during that file's collection phase, so this
// binds to the file's own root suite.
afterAll(async () => {
  if (pooled) {
    await pooled.pg.close();
    pooled = null;
  }
});

/**
 * Replace the production `db` import with the harness handle for the
 * duration of a test suite. Restores on teardown so other tests aren't
 * affected.
 *
 * Why this is needed: `stockRepo.js` imports `db` from `../db/index.js`.
 * Tests that exercise the repo against real PG must point that import at
 * the harness. We do this by stubbing the module via vi.doMock pattern —
 * but the simpler trick is to patch the exported binding via a setter,
 * which our db/index.js doesn't currently expose. Instead, tests use
 * `vi.mock('../../db/index.js', ...)` at the file level and inject the
 * harness `db` via the factory's getter pattern (see stockRepo.integration.test.js).
 */
export function harnessAsDbModule(harness) {
  return {
    get db() { return harness.db; },
    get pool() { return harness.pg; },
    isPostgresConfigured: true,
    connectPostgres: async () => {},
    disconnectPostgres: async () => {},
  };
}
