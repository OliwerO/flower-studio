// GUARDED — lab-only. Mirrors a real prod stock snapshot (from
// backend/scripts/dump_prod_stock_orders.mjs → /tmp/prod_dump.json) into the
// lab DB so the owner recognises her own inventory, then seeds a Peony Pink PO
// at "Evaluating" targeting the real "Peony Pink" orig Demand Entry.
//
// Demonstrates #323/#327: prod rows all have type_name=NULL, so under the
// Y-model grouped Stock view they are invisible. Evaluating the PO with the
// fix backfills the Peony Pink orig + tags the new dated Batch → the Variety
// reappears in the grouped list.
//
// Run (lab:dev must be STOPPED to avoid connection crash):
//   node backend/scripts/dump_prod_stock_orders.mjs > /tmp/prod_dump.json   (uses claude_ro)
//   DATABASE_URL=postgres://lab:lab@localhost:5433/lab node lab/scripts/seed-prod-mirror.mjs
import pg from 'pg';
import { readFileSync } from 'fs';

const dump = JSON.parse(readFileSync('/tmp/prod_dump.json', 'utf-8'));
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://lab:lab@localhost:5433/lab' });
await c.connect();

// Clean slate — clear stock + PO + dependent rows.
await c.query(`TRUNCATE stock, stock_orders, stock_order_lines, order_lines, premade_bouquet_lines RESTART IDENTITY CASCADE`);

// Insert every prod stock row verbatim (preserve id so the PO line can link).
let n = 0;
for (const r of dump.stock) {
  await c.query(`
    INSERT INTO stock (id, display_name, type_name, colour, size_cm, cultivar, current_quantity,
                       current_cost_price, current_sell_price, supplier, unit, active,
                       last_restocked, reorder_threshold, lot_size)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  `, [
    r.id, r.display_name, r.type_name, r.colour, r.size_cm, r.cultivar, r.current_quantity,
    r.current_cost_price ?? 0, r.current_sell_price ?? 0, r.supplier ?? '', r.unit ?? 'Stems',
    r.active ?? true, r.last_restocked ?? null, r.reorder_threshold ?? 0, r.lot_size ?? 0,
  ]);
  n++;
}
console.log(`Mirrored ${n} prod stock rows into lab.`);

// Peony Pink orig DE (real prod id) — confirm present + show its state.
const PEONY_PINK_ORIG = '1bf8a34e-c1dd-4b42-84e2-1a4e421b63ff';
const pp = await c.query(`SELECT display_name, current_quantity, type_name FROM stock WHERE id=$1`, [PEONY_PINK_ORIG]);
console.log('Peony Pink orig:', pp.rows[0]);

// PO at Evaluating mirroring the prod PO-20260519-1 receive that triggered #323.
const po = await c.query(`
  INSERT INTO stock_orders (po_number, status, created_date, assigned_driver, planned_date)
  VALUES ('PO-LAB-PEONY', 'Evaluating', '2026-05-29', 'Piotr', '2026-05-29')
  RETURNING id
`);
const poId = po.rows[0].id;

await c.query(`
  INSERT INTO stock_order_lines (po_id, stock_id, flower_name, quantity_needed, quantity_found,
                                 driver_status, supplier, cost_price, sell_price,
                                 type_name, colour, size_cm, cultivar, eval_status)
  VALUES ($1, $2, 'Peony Pink', 50, 50, 'Found', 'Stefan', 8, 25, 'Peony', 'Pink', 60, NULL, '')
`, [poId, PEONY_PINK_ORIG]);

console.log(`\nPO-LAB-PEONY (Evaluating) seeded — Peony Pink x50 linked to real orig ${PEONY_PINK_ORIG}.`);
console.log('Dashboard → Stock → Purchase Orders → PO-LAB-PEONY → evaluate → accept 50.');
console.log('Before: grouped Stock view hides Peony Pink (NULL attrs). After: it reappears, tagged Peony/Pink/60.');

await c.end();
process.exit(0);
