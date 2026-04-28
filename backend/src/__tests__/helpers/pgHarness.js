// pgHarness — boots an in-process Postgres (via @electric-sql/pglite)
// per-test, runs the same SQL migrations Railway runs, and returns a
// Drizzle handle compatible with the production `db` import.
//
// Why pglite, not pg-mem: pglite IS Postgres compiled to WASM — same
// query parser, same transaction semantics, same type system as Railway.
// Tests that pass here pass in production; pg-mem has gaps that bite at
// the worst time.
//
// Usage:
//   import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
//   beforeEach(async () => { harness = await setupPgHarness(); });
//   afterEach(async () => { await teardownPgHarness(harness); });
//   harness.db is a Drizzle instance you can pass anywhere the prod handle goes.

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
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

/**
 * Boot a fresh in-memory Postgres + apply migrations.
 * Returns { pg, db } — `db` is a Drizzle handle equivalent to the prod one.
 */
export async function setupPgHarness() {
  const pg = new PGlite();
  // Wait for the WASM runtime to be ready before issuing the first query.
  await pg.waitReady;
  await applyMigrations(pg);
  const db = drizzle(pg, { schema });
  return { pg, db };
}

/**
 * Close the WASM Postgres process. Always call from afterEach so each
 * test starts with a fresh database.
 */
export async function teardownPgHarness(harness) {
  if (harness?.pg) {
    await harness.pg.close();
  }
}

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
