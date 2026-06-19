// SAFE — read-only. Dumps current prod stock + recent orders + lines + any
// in-flight PO, as JSON, to mirror into the lab DB for owner-facing testing.
import { db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';

const stock = await db.execute(sql`
  SELECT id, display_name, type_name, colour, size_cm, cultivar, current_quantity,
         current_cost_price, current_sell_price, supplier, unit, active, last_restocked, reorder_threshold, lot_size
  FROM stock WHERE deleted_at IS NULL AND active = true
  ORDER BY display_name
`);

const pos = await db.execute(sql`
  SELECT id, po_number, status, created_date, assigned_driver, planned_date
  FROM stock_orders ORDER BY created_date DESC LIMIT 10
`);

console.log(JSON.stringify({
  stock: stock.rows,
  purchaseOrders: pos.rows,
}, null, 2));
process.exit(0);
