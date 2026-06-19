// SAFE — read-only. Wider sweep around 5/24 18:53 UTC fan-out.
import { db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';

// Identify each affected stock row + flag
const ids = ['bd25114d-c409-4063-b2a5-b46a476d0df7', 'a06bbb5f', '4bb5c3c0-0048-4dd4-8960-f5cc03913487', '2224af95'];
const rows = await db.execute(sql`
  SELECT id, display_name, type_name, colour, current_quantity
  FROM stock
  WHERE id::text LIKE 'bd25114d%' OR id::text LIKE 'a06bbb5f%' OR id::text LIKE '4bb5c3c0%' OR id::text LIKE '2224af95%'
`);
console.log('Affected stock IDs:');
console.log(JSON.stringify(rows.rows, null, 2));

// Any premade_bouquets audit broadly today
const pb = await db.execute(sql`
  SELECT created_at, entity_type, entity_id, action, diff
  FROM audit_log
  WHERE entity_type LIKE 'premade%'
    AND created_at BETWEEN '2026-05-24T00:00:00Z' AND '2026-05-25T00:00:00Z'
  ORDER BY created_at ASC
`);
console.log('\nPremade audit 5/24:');
console.log(JSON.stringify(pb.rows.map(r => ({
  at: r.created_at, type: r.entity_type, id: r.entity_id?.slice(0,8), action: r.action,
  name: r.diff?.before?.Name ?? r.diff?.after?.Name,
  qty:  r.diff?.before?.Quantity ?? r.diff?.after?.Quantity,
})), null, 2));

// All entity_types touched in the 18:53:30-40 window
const win = await db.execute(sql`
  SELECT entity_type, COUNT(*) as n
  FROM audit_log
  WHERE created_at BETWEEN '2026-05-24T18:53:30Z' AND '2026-05-24T18:53:40Z'
  GROUP BY entity_type ORDER BY n DESC
`);
console.log('\nEntity types in 18:53:30-40:');
console.log(JSON.stringify(win.rows, null, 2));

// app_config full dump for stock_y_model flag
const cfg = await db.execute(sql`SELECT key, value FROM app_config ORDER BY key`);
console.log('\nAll app_config keys:');
for (const r of cfg.rows) console.log(`  ${r.key} = ${JSON.stringify(r.value)}`);

process.exit(0);
