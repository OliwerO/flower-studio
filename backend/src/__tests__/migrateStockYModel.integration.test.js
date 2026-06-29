// Y-model cutover migration — integration test (pglite).
//
// Regression lock for the #291 cutover defect found 2026-06-29:
// Phase 5 (`ALTER COLUMN date/type_name SET NOT NULL`) validates ALL
// physical rows, including soft-deleted ones. Phases 1-3 only date
// `deleted_at IS NULL` rows and the human backfill only types active
// rows, so soft-deleted undated/untyped zombie rows (qty 0) on prod
// would make Phase 5 FAIL. The fix adds `phaseDeletedFill` before
// Phase 5 to fill date/type_name on soft-deleted rows (no deletes —
// FK constraints from stock_purchases/stock_order_lines RESTRICT).
//
// We drive the ACTUAL script's exported `runMigration(client, opts)`
// against the raw pglite handle (same query interface as a pg client).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { runMigration } from '../../scripts/migrate-stock-y-model.js';

const TODAY = '2026-06-29';

let harness, pg;
beforeEach(async () => { harness = await setupPgHarness(); pg = harness.pg; });
afterEach(async () => { await teardownPgHarness(harness); });

async function ins(client, { name, qty = 0, date = null, type = null, deleted = false }) {
  const { rows } = await client.query(
    `INSERT INTO stock (display_name, current_quantity, date, type_name, active, deleted_at)
     VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
    [name, qty, date, type, deleted ? new Date().toISOString() : null]
  );
  return rows[0].id;
}

async function colNullable(client, col) {
  const { rows } = await client.query(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_name = 'stock' AND column_name = $1`, [col]);
  return rows[0]?.is_nullable === 'YES';
}

async function count(client, where) {
  const { rows } = await client.query(`SELECT count(*)::int n FROM stock WHERE ${where}`);
  return rows[0].n;
}

describe('migrate-stock-y-model (pglite)', () => {
  it('fills NULLs on soft-deleted rows so Phase 5 SET NOT NULL succeeds (regression #291)', async () => {
    // active undated positive — Phase 3 dates it to today
    await ins(pg, { name: 'Rose Red', qty: 10, type: 'Rose' });
    // soft-deleted, undated, untyped zombie (the prod state that broke Phase 5)
    await ins(pg, { name: 'Hydrangea Pink', qty: 0, type: null, deleted: true });

    await runMigration(pg, { today: TODAY }); // must not throw

    // no NULLs left anywhere — the SET NOT NULL pre-state
    expect(await count(pg, 'date IS NULL')).toBe(0);
    expect(await count(pg, 'type_name IS NULL')).toBe(0);

    // zombie row back-filled: today's date + type parsed from first word of display_name
    const { rows: [z] } = await pg.query(
      `SELECT date::text AS date, type_name FROM stock WHERE display_name = 'Hydrangea Pink'`);
    expect(z.type_name).toBe('Hydrangea');
    expect(z.date).toBe(TODAY);

    // soft-delete preserved — fix fills attrs, never resurrects the tombstone
    expect(await count(pg, "display_name = 'Hydrangea Pink' AND deleted_at IS NOT NULL")).toBe(1);

    // NOT NULL constraints now applied
    expect(await colNullable(pg, 'date')).toBe(false);
    expect(await colNullable(pg, 'type_name')).toBe(false);
  });

  it('aborts when an ACTIVE row is missing type_name (pre-condition, #292 backfill gate)', async () => {
    await ins(pg, { name: 'Mystery Flower', qty: 5, type: null }); // active + untyped
    await expect(runMigration(pg, { today: TODAY })).rejects.toThrow(/Pre-condition failed/);
  });

  it('--dry-run rolls back: NOT NULL not applied, NULLs untouched', async () => {
    await ins(pg, { name: 'Rose Red', qty: 10, type: 'Rose' });
    await ins(pg, { name: 'Hydrangea Pink', qty: 0, type: null, deleted: true });

    const res = await runMigration(pg, { dryRun: true, today: TODAY });
    expect(res.dryRun).toBe(true);

    expect(await colNullable(pg, 'date')).toBe(true);        // constraint NOT applied
    expect(await count(pg, 'type_name IS NULL')).toBe(1);    // zombie still null (rolled back)
  });

  it('is idempotent — re-running after cutover is a no-op', async () => {
    await ins(pg, { name: 'Rose Red', qty: 10, type: 'Rose' });
    await runMigration(pg, { today: TODAY });                 // commits + applies NOT NULL
    const res2 = await runMigration(pg, { today: TODAY });    // alreadyMigrated guard
    expect(res2.noop).toBe(true);
  });
});
