// backend/scripts/migrate-stock-y-model.js
// Category: DESTRUCTIVE
//
// Migrates production Stock data from legacy aggregate Demand Entry model
// to Y-model (dated Demand Entries + premade back-add).
//
// Pre-condition: All ACTIVE stock rows must have `type_name` set (run Owner
// backfill UI from issue #292 first). Soft-deleted rows are back-filled
// automatically by phaseDeletedFill (see below).
//
// Phases (single transaction):
//   1. Split aggregate Demand Entries by linked order Required By.
//   2. Orphan negative aggregates → today-dated Demand Entry.
//   3. Positive-qty undated rows → synthetic Batch dated migration day.
//   4. Premade reservation back-add to matching Batch on-hand.
//   4b. Back-fill date/type_name on SOFT-DELETED rows (phases 1-3 skip
//       them, but `ALTER ... SET NOT NULL` in phase 5 validates every
//       physical row — incl. tombstones — so they must be non-NULL too).
//       We fill, never DELETE: stock_purchases / stock_order_lines /
//       premade_bouquet_lines FK-reference stock(id) with default RESTRICT.
//   5. ALTER COLUMN date / type_name SET NOT NULL.
//
// Idempotent: re-running after Phase 5 (NOT NULL applied) is a no-op
// via the early-exit guard `alreadyMigrated()`. Phases 1-4b also become
// no-ops because their predicates require `date IS NULL` / NULL attrs.
//
// Usage:
//   APPROVE=yes node backend/scripts/migrate-stock-y-model.js --dry-run
//   APPROVE=yes node backend/scripts/migrate-stock-y-model.js

import pg from 'pg';
import { pathToFileURL } from 'url';

const DRY_RUN = process.argv.includes('--dry-run');

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export async function preCondition(client) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS missing FROM stock WHERE type_name IS NULL AND deleted_at IS NULL`
  );
  if (rows[0].missing > 0) {
    throw new Error(
      `Pre-condition failed: ${rows[0].missing} active stock row(s) have type_name IS NULL. ` +
      `Run the Owner-driven Variety attribute backfill (issue #292) first.`
    );
  }
}

export async function phase1Split(client) {
  // Find aggregate DEs: negative qty, no date, linked to at least one active order_line.
  // Phase 1 sums only **active, non-deleted** order_lines (status NOT IN
  //   Cancelled/Delivered/Picked Up). If an aggregate's only linked lines
  //   are terminated, it routes to Phase 2 (orphan path) instead and is
  //   today-dated for operator review.
  const { rows: aggregates } = await client.query(`
    SELECT s.id, s.display_name, s.type_name, s.colour, s.size_cm, s.cultivar,
           s.current_quantity, s.current_cost_price, s.current_sell_price,
           s.supplier, s.unit, s.category
    FROM stock s
    WHERE s.current_quantity < 0
      AND s.date IS NULL
      AND s.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM order_lines ol
        JOIN orders o ON o.id = ol.order_id
        WHERE ol.stock_item_id = s.id::text
          AND o.status NOT IN ('Cancelled', 'Delivered', 'Picked Up')
          AND o.deleted_at IS NULL
          AND ol.deleted_at IS NULL
      )
  `);

  for (const agg of aggregates) {
    // Group linked order_lines by Required By fallback chain.
    // Only active, non-deleted orders/lines — terminated lines persist in
    // production after cancel-with-return/delivery/pickup and must not be counted.
    const { rows: lines } = await client.query(`
      SELECT ol.id AS line_id, ol.quantity,
             COALESCE(o.required_by::text, o.order_date::text, CURRENT_DATE::text) AS due_date
      FROM order_lines ol
      JOIN orders o ON o.id = ol.order_id
      WHERE ol.stock_item_id = $1::text
        AND o.status NOT IN ('Cancelled', 'Delivered', 'Picked Up')
        AND o.deleted_at IS NULL
        AND ol.deleted_at IS NULL
    `, [agg.id]);

    // Group by due_date, summing quantities.
    const byDate = new Map();
    for (const l of lines) {
      const cur = byDate.get(l.due_date) ?? { qty: 0, lineIds: [] };
      cur.qty += l.quantity;
      cur.lineIds.push(l.line_id);
      byDate.set(l.due_date, cur);
    }

    // Create one dated DE per distinct date, repoint order_lines.
    for (const [date, group] of byDate.entries()) {
      const { rows: [newRow] } = await client.query(`
        INSERT INTO stock (
          display_name, purchase_name, category, current_quantity, unit,
          current_cost_price, current_sell_price, supplier,
          type_name, colour, size_cm, cultivar, date, active
        ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
        RETURNING id
      `, [
        agg.display_name, agg.category, -group.qty, agg.unit,
        agg.current_cost_price, agg.current_sell_price, agg.supplier,
        agg.type_name, agg.colour, agg.size_cm, agg.cultivar, date,
      ]);
      // Repoint order_lines to the new dated DE.
      await client.query(
        `UPDATE order_lines SET stock_item_id = $1 WHERE id = ANY($2::uuid[])`,
        [newRow.id, group.lineIds]
      );
      console.log(`[phase1] split ${agg.id} → ${newRow.id} (date=${date}, qty=${-group.qty}, lines=${group.lineIds.length})`);
    }

    // Delete the original aggregate DE.
    await client.query(`DELETE FROM stock WHERE id = $1`, [agg.id]);
  }

  console.log(`[phase1] Split ${aggregates.length} aggregate DE(s).`);
}

export async function phase2OrphanNegative(client, today) {
  const { rows: orphans } = await client.query(`
    SELECT s.id FROM stock s
    WHERE s.current_quantity < 0
      AND s.date IS NULL
      AND s.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM order_lines ol
        JOIN orders o ON o.id = ol.order_id
        WHERE ol.stock_item_id = s.id::text
          AND o.status NOT IN ('Cancelled', 'Delivered', 'Picked Up')
          AND o.deleted_at IS NULL
          AND ol.deleted_at IS NULL
      )
  `);
  for (const o of orphans) {
    await client.query(`UPDATE stock SET date = $1, updated_at = NOW() WHERE id = $2`, [today, o.id]);
  }
  console.log(`[phase2] Dated ${orphans.length} orphan aggregate DE(s) → ${today}.`);
}

export async function phase3PositiveUndated(client, today) {
  const { rowCount } = await client.query(`
    UPDATE stock SET date = $1, updated_at = NOW()
    WHERE current_quantity >= 0 AND date IS NULL AND deleted_at IS NULL
  `, [today]);
  console.log(`[phase3] Dated ${rowCount} positive-qty undated row(s) → ${today}.`);
}

export async function phase4PremadeBackAdd(client) {
  const { rows: sums } = await client.query(`
    SELECT stock_id, SUM(quantity)::int AS reserved
    FROM premade_bouquet_lines
    WHERE stock_id IS NOT NULL
    GROUP BY stock_id
  `);
  for (const { stock_id, reserved } of sums) {
    if (reserved > 0) {
      await client.query(
        `UPDATE stock SET current_quantity = current_quantity + $1, updated_at = NOW() WHERE id = $2`,
        [reserved, stock_id]
      );
    }
  }
  console.log(`[phase4] Back-added premade reservations to ${sums.length} Batch(es).`);
}

// Phase 4b — back-fill soft-deleted (tombstone) rows so phase 5's
// `SET NOT NULL` validates them. Phases 1-3 deliberately skip
// `deleted_at IS NOT NULL`, and the #292 backfill UI only types active
// rows, leaving deleted zombies undated/untyped. type_name falls back to
// the first word of display_name (e.g. "Hydrangea Pink" → "Hydrangea"),
// then 'Unknown'. We never DELETE: stock_purchases / stock_order_lines /
// premade_bouquet_lines reference stock(id) with default RESTRICT.
export async function phaseDeletedFill(client, today) {
  const { rowCount } = await client.query(`
    UPDATE stock
    SET date = COALESCE(date, $1::date),
        type_name = COALESCE(type_name, NULLIF(split_part(display_name, ' ', 1), ''), 'Unknown'),
        updated_at = NOW()
    WHERE deleted_at IS NOT NULL
      AND (date IS NULL OR type_name IS NULL)
  `, [today]);
  console.log(`[phase4b] Back-filled date/type_name on ${rowCount} soft-deleted row(s) → date ${today}.`);
}

export async function phase5SetNotNull(client) {
  await client.query(`ALTER TABLE stock ALTER COLUMN date SET NOT NULL`);
  await client.query(`ALTER TABLE stock ALTER COLUMN type_name SET NOT NULL`);
  console.log('[phase5] Applied NOT NULL on stock.date and stock.type_name.');
}

export async function alreadyMigrated(client) {
  const { rows } = await client.query(`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_name = 'stock' AND column_name = 'date'
  `);
  return rows[0]?.is_nullable === 'NO';
}

/**
 * Run the full migration against any client exposing `.query(text, params)`
 * (a pg pool client in production, the pglite handle in tests).
 * Owns its own BEGIN/COMMIT/ROLLBACK. Throws on failure (CLI wrapper maps
 * that to a non-zero exit code).
 * @returns {Promise<{noop?:true, dryRun?:true, committed?:true}>}
 */
export async function runMigration(client, { dryRun = false, today = isoToday() } = {}) {
  await client.query('BEGIN');
  try {
    await preCondition(client);

    if (await alreadyMigrated(client)) {
      console.log('[migrate] Stock.date already NOT NULL — migration already complete. No-op.');
      await client.query('ROLLBACK');
      return { noop: true };
    }

    await phase1Split(client);
    await phase2OrphanNegative(client, today);
    await phase3PositiveUndated(client, today);
    await phase4PremadeBackAdd(client);
    await phaseDeletedFill(client, today);
    await phase5SetNotNull(client);

    if (dryRun) {
      console.log('[migrate] DRY RUN — rolling back transaction.');
      await client.query('ROLLBACK');
      return { dryRun: true };
    }

    await client.query('COMMIT');
    console.log('[migrate] Done.');
    return { committed: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main() {
  await import('dotenv/config');
  if (process.env.APPROVE !== 'yes') {
    console.error('Set APPROVE=yes to confirm you want to run the Y-model migration.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Aborting.');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await runMigration(client, { dryRun: DRY_RUN });
  } catch (err) {
    console.error('[migrate] FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

// Only run the CLI side-effects when executed directly, not on import (tests).
const isCli = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isCli) main();
