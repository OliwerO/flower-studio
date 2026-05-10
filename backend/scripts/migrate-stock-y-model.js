// backend/scripts/migrate-stock-y-model.js
// Category: DESTRUCTIVE
//
// Migrates production Stock data from legacy aggregate Demand Entry model
// to Y-model (dated Demand Entries + premade back-add).
//
// Pre-condition: All stock rows must have `type_name` set (run Owner
// backfill UI from issue #292 first).
//
// Phases (single transaction):
//   1. Split aggregate Demand Entries by linked order Required By.
//   2. Orphan negative aggregates → today-dated Demand Entry.
//   3. Positive-qty undated rows → synthetic Batch dated migration day.
//   4. Premade reservation back-add to matching Batch on-hand.
//   5. ALTER COLUMN date / type_name SET NOT NULL.
//
// Idempotent: re-running after Phase 5 is a no-op.
//
// Usage:
//   APPROVE=yes node backend/scripts/migrate-stock-y-model.js --dry-run
//   APPROVE=yes node backend/scripts/migrate-stock-y-model.js

import 'dotenv/config';
import pg from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');

if (process.env.APPROVE !== 'yes') {
  console.error('Set APPROVE=yes to confirm you want to run the Y-model migration.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Aborting.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const today = new Date().toISOString().slice(0, 10);

async function preCondition(client) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS missing FROM stock WHERE type_name IS NULL AND deleted_at IS NULL`
  );
  if (rows[0].missing > 0) {
    throw new Error(
      `Pre-condition failed: ${rows[0].missing} stock row(s) have type_name IS NULL. ` +
      `Run the Owner-driven Variety attribute backfill (issue #292) first.`
    );
  }
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await preCondition(client);

    // Phases 1-5 added in subsequent tasks.

    if (DRY_RUN) {
      console.log('[migrate] DRY RUN — rolling back transaction.');
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
      console.log('[migrate] Done.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
