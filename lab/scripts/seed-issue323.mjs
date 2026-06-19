// GUARDED — lab-only. Adds the issue-#323 demo case ON TOP of the y-model-demo
// scenario (rich, populated, grouped Stock list). Does NOT truncate.
//
// Injects:
//   - a legacy "Peony Pink" Demand Entry with NULL Variety attrs at qty -46
//     (mimics the pre-Y-model prod orig row that #327 must backfill)
//   - PO-PEONY-EVAL at "Evaluating": Peony Pink x50 linked to that orig
//   - PO-ROSE-EVAL  at "Evaluating": a fresh Rose Red line (auto-create path)
//   - PO-DRAFT-1    at "Draft" + PO-DONE-1 at "Complete" for a realistic list
//
// Run order (lab:dev must be STOPPED):
//   npm run lab:reset            # reloads y-model-demo template
//   DATABASE_URL=postgres://lab:lab@localhost:5433/lab node lab/scripts/seed-issue323.mjs
//   npm run lab:dev
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://lab:lab@localhost:5433/lab' });
await c.connect();

// 1. Legacy Peony Pink DE — NULL Variety attrs, negative qty (the #323 row).
const orig = await c.query(`
  INSERT INTO stock (display_name, current_quantity, active, type_name, colour, size_cm, cultivar,
                     current_cost_price, current_sell_price, supplier, unit)
  VALUES ('Peony Pink', -46, true, NULL, NULL, NULL, NULL, 8, 25, 'Stefan', 'Stems')
  RETURNING id
`);
const origId = orig.rows[0].id;
console.log('Legacy Peony Pink DE (NULL attrs, qty -46):', origId);

// helper to add a PO + line
async function po(poNumber, status, lineOpts) {
  const r = await c.query(`
    INSERT INTO stock_orders (po_number, status, created_date, assigned_driver, planned_date)
    VALUES ($1, $2, '2026-05-11', 'Piotr', '2026-05-11') RETURNING id
  `, [poNumber, status]);
  const poId = r.rows[0].id;
  if (lineOpts) {
    await c.query(`
      INSERT INTO stock_order_lines (po_id, stock_id, flower_name, quantity_needed, quantity_found,
                                     driver_status, supplier, cost_price, sell_price,
                                     type_name, colour, size_cm, cultivar, eval_status)
      VALUES ($1,$2,$3,$4,$5,'Found','Stefan',$6,$7,$8,$9,$10,$11,'')
    `, [poId, lineOpts.stockId ?? null, lineOpts.name, lineOpts.qty, lineOpts.qty,
        lineOpts.cost, lineOpts.sell, lineOpts.type ?? null, lineOpts.colour ?? null,
        lineOpts.size ?? null, lineOpts.cultivar ?? null]);
  }
  return poId;
}

// 2. PO at Evaluating — Peony Pink x50 linked to the legacy NULL-attr orig.
//    Evaluating + accepting demonstrates: orig backfilled + new dated Batch tagged.
await po('PO-PEONY-EVAL', 'Evaluating', {
  stockId: origId, name: 'Peony Pink', qty: 50, cost: 8, sell: 25,
  type: 'Peony', colour: 'Pink', size: 60,
});

// 3. PO at Evaluating — brand-new Rose Red (no stockId): auto-create path tags
//    a fresh Stock Item with Variety identity on accept.
await po('PO-ROSE-EVAL', 'Evaluating', {
  stockId: null, name: 'Rose Red 50cm Freedom', qty: 30, cost: 5, sell: 16,
  type: 'Rose', colour: 'Red', size: 50, cultivar: 'Freedom',
});

// 4. Filler POs so the list looks like a real shop.
await po('PO-DRAFT-1', 'Draft', {
  stockId: null, name: 'Tulip Yellow', qty: 40, cost: 3, sell: 9, type: 'Tulip', colour: 'Yellow', size: 40,
});
await po('PO-DONE-1', 'Complete', null);

console.log('\nSeeded on top of y-model-demo:');
console.log('  PO-PEONY-EVAL (Evaluating) — Peony Pink x50 → legacy NULL-attr orig');
console.log('  PO-ROSE-EVAL  (Evaluating) — new Rose Red x30 (auto-create path)');
console.log('  PO-DRAFT-1    (Draft), PO-DONE-1 (Complete)');
console.log('\nStock list already populated by y-model-demo. Evaluate the two POs to watch new Batches appear tagged + visible.');

await c.end();
process.exit(0);
