// SAFE — read-only diagnostic for issue #323
import { db } from '../src/db/index.js';
import { stock, auditLog, orderLines } from '../src/db/schema.js';
import { sql, eq, desc } from 'drizzle-orm';

const NEW_BATCH = '9da0cd4a-7481-45c3-a768-304073eef970';
const ORIG_PINK = '1bf8a34e-c1dd-4b42-84e2-1a4e421b63ff';

const rows = await db.execute(sql`
  SELECT id, display_name, current_quantity, type_name, colour, size_cm, cultivar, last_restocked, created_at
  FROM stock
  WHERE id IN (${NEW_BATCH}, ${ORIG_PINK})
`);
console.log('STOCK ROWS:');
console.log(JSON.stringify(rows.rows, null, 2));

const audit = await db.execute(sql`
  SELECT created_at, action, actor_role, actor_pin_label, diff
  FROM audit_log
  WHERE entity_id IN (${NEW_BATCH}, ${ORIG_PINK})
  ORDER BY created_at DESC LIMIT 60
`);
console.log('\nAUDIT (newest first):');
for (const r of audit.rows) {
  const b = r.diff?.before;
  const a = r.diff?.after;
  const bQ = b?.['Current Quantity'] ?? b?.current_quantity ?? '·';
  const aQ = a?.['Current Quantity'] ?? a?.current_quantity ?? '·';
  console.log(`${r.created_at} ${r.action} ${r.actor_role}/${r.actor_pin_label || ''}  qty: ${bQ} → ${aQ}  eid=${(r.diff?.after?.id || r.diff?.before?.id || '').slice(0,8)}`);
}

const lines = await db.execute(sql`
  SELECT ol.id, ol.order_id, ol.stock_item_id, ol.quantity, ol.created_at
  FROM order_lines ol
  WHERE ol.stock_item_id IN (${NEW_BATCH}, ${ORIG_PINK})
  ORDER BY ol.created_at DESC LIMIT 30
`);
console.log('\nORDER LINES on these stock rows:');
console.log(JSON.stringify(lines.rows, null, 2));

process.exit(0);
