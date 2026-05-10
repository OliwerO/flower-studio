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

async function phase1Split(client) {
  // Find aggregate DEs: negative qty, no date, linked to at least one order_line.
  const { rows: aggregates } = await client.query(`
    SELECT s.id, s.display_name, s.type_name, s.colour, s.size_cm, s.cultivar,
           s.current_quantity, s.current_cost_price, s.current_sell_price,
           s.supplier, s.unit, s.category
    FROM stock s
    WHERE s.current_quantity < 0
      AND s.date IS NULL
      AND s.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM order_lines ol WHERE ol.stock_item_id = s.id::text)
  `);

  for (const agg of aggregates) {
    // Group linked order_lines by Required By fallback chain.
    const { rows: lines } = await client.query(`
      SELECT ol.id AS line_id, ol.quantity,
             COALESCE(o.required_by::text, o.order_date::text, CURRENT_DATE::text) AS due_date
      FROM order_lines ol
      JOIN orders o ON o.id = ol.order_id
      WHERE ol.stock_item_id = $1::text
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

async function phase2OrphanNegative(client, today) {
  const { rows: orphans } = await client.query(`
    SELECT s.id FROM stock s
    WHERE s.current_quantity < 0
      AND s.date IS NULL
      AND s.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM order_lines ol WHERE ol.stock_item_id = s.id::text)
  `);
  for (const o of orphans) {
    await client.query(`UPDATE stock SET date = $1, updated_at = NOW() WHERE id = $2`, [today, o.id]);
  }
  console.log(`[phase2] Dated ${orphans.length} orphan aggregate DE(s) → ${today}.`);
}

async function phase3PositiveUndated(client, today) {
  const { rowCount } = await client.query(`
    UPDATE stock SET date = $1, updated_at = NOW()
    WHERE current_quantity >= 0 AND date IS NULL AND deleted_at IS NULL
  `, [today]);
  console.log(`[phase3] Dated ${rowCount} positive-qty undated row(s) → ${today}.`);
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await preCondition(client);
    await phase1Split(client);
    await phase2OrphanNegative(client, today);
    await phase3PositiveUndated(client, today);

    // Phases 4-5 added in subsequent tasks.

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
