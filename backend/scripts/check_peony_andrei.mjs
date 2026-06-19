// SAFE — read-only diagnostic for follow-up on #323 + FEFO leak
import { db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';

const ORIG = '1bf8a34e-c1dd-4b42-84e2-1a4e421b63ff';
const NEW20 = '9da0cd4a-7481-45c3-a768-304073eef970';

const rows = await db.execute(sql`
  SELECT id, display_name, current_quantity, type_name, colour, size_cm, cultivar, last_restocked, created_at
  FROM stock
  WHERE id IN (${ORIG}, ${NEW20})
`);
console.log('STOCK NOW:');
console.log(JSON.stringify(rows.rows, null, 2));

const audit = await db.execute(sql`
  SELECT created_at, entity_id, action, actor_role, actor_pin_label, diff
  FROM audit_log
  WHERE entity_id IN (${ORIG}, ${NEW20})
    AND created_at > '2026-05-20T08:30:00Z'
  ORDER BY created_at ASC
`);
console.log('\nAUDIT since 5/20 08:30 UTC:');
for (const r of audit.rows) {
  const b = r.diff?.before;
  const a = r.diff?.after;
  const bQ = b?.['Current Quantity'] ?? b?.current_quantity ?? '·';
  const aQ = a?.['Current Quantity'] ?? a?.current_quantity ?? '·';
  const which = r.entity_id === ORIG ? 'ORIG' : 'NEW20';
  console.log(`${r.created_at} ${which} ${r.action} ${r.actor_role}/${r.actor_pin_label || ''}  qty: ${bQ} → ${aQ}`);
}

// Andrei's order
const andrei = await db.execute(sql`
  SELECT o.id, o.app_order_id, o.status, o.required_by_date, o.created_at
  FROM orders o
  WHERE o.app_order_id = '202605-032'
`);
console.log('\nANDREI ORDER:');
console.log(JSON.stringify(andrei.rows, null, 2));

if (andrei.rows.length > 0) {
  const oid = andrei.rows[0].id;
  const lines = await db.execute(sql`
    SELECT ol.id, ol.stock_item_id, ol.flower_name, ol.quantity, ol.created_at, s.display_name, s.type_name, s.colour, s.current_quantity
    FROM order_lines ol
    LEFT JOIN stock s ON s.id = ol.stock_item_id
    WHERE ol.order_id = ${oid}
  `);
  console.log('\nANDREI LINES:');
  console.log(JSON.stringify(lines.rows, null, 2));
}

process.exit(0);
