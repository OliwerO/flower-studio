// SAFE — read-only. Check premade dissolves + Y-model flag around 5/24 18:53 UTC.
import { db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';

const ORIG = '1bf8a34e-c1dd-4b42-84e2-1a4e421b63ff';
const NEW20 = '9da0cd4a-7481-45c3-a768-304073eef970';
const WINDOW_LO = '2026-05-24T18:50:00Z';
const WINDOW_HI = '2026-05-24T19:00:00Z';

// All audit events in that 10-min window across entities
const wide = await db.execute(sql`
  SELECT created_at, entity_type, entity_id, action, actor_role, actor_pin_label, diff
  FROM audit_log
  WHERE created_at BETWEEN ${WINDOW_LO} AND ${WINDOW_HI}
  ORDER BY created_at ASC
`);
console.log('AUDIT 18:50–19:00 UTC (all entities):');
for (const r of wide.rows) {
  const b = r.diff?.before;
  const a = r.diff?.after;
  const bN = b?.['Name'] ?? b?.name ?? '';
  const aN = a?.['Name'] ?? a?.name ?? '';
  const bQ = b?.['Current Quantity'] ?? b?.current_quantity ?? b?.Quantity ?? b?.quantity ?? '·';
  const aQ = a?.['Current Quantity'] ?? a?.current_quantity ?? a?.Quantity ?? a?.quantity ?? '·';
  console.log(`${r.created_at} ${r.entity_type}/${r.entity_id.slice(0,8)} ${r.action} ${r.actor_role}/${r.actor_pin_label || ''}  name="${bN || aN}" q:${bQ}→${aQ}`);
}

// Check Y-model flag
const cfg = await db.execute(sql`SELECT key, value FROM app_config WHERE key LIKE '%y%model%' OR key LIKE '%stock%y%' OR key LIKE '%y_model%'`);
console.log('\nCONFIG (Y-model flags):');
console.log(JSON.stringify(cfg.rows, null, 2));

// Premade lines referencing Peony Pink (ORIG or NEW20) — are they still active?
const pml = await db.execute(sql`
  SELECT pbl.id, pbl.bouquet_id, pbl.stock_id, pbl.flower_name, pbl.quantity, pbl.created_at,
         pb.id as bq_id, pb.name as bq_name
  FROM premade_bouquet_lines pbl
  LEFT JOIN premade_bouquets pb ON pb.id = pbl.bouquet_id
  WHERE pbl.stock_id IN (${ORIG}, ${NEW20})
  ORDER BY pbl.created_at DESC
`);
console.log('\nPREMADE LINES on Peony Pink:');
console.log(JSON.stringify(pml.rows, null, 2));

// Premade dissolve audit events around then
const dissolves = await db.execute(sql`
  SELECT created_at, entity_type, entity_id, action, diff
  FROM audit_log
  WHERE entity_type IN ('premade_bouquet', 'premade_bouquet_line')
    AND created_at BETWEEN '2026-05-24T17:00:00Z' AND '2026-05-24T20:00:00Z'
  ORDER BY created_at ASC
`);
console.log('\nPREMADE AUDIT 17:00–20:00 UTC:');
console.log(JSON.stringify(dissolves.rows.map(r => ({
  at: r.created_at, type: r.entity_type, id: r.entity_id?.slice(0,8), action: r.action,
  before_name: r.diff?.before?.Name ?? r.diff?.before?.name,
  after_name: r.diff?.after?.Name ?? r.diff?.after?.name,
  before_qty: r.diff?.before?.Quantity ?? r.diff?.before?.quantity,
  after_qty: r.diff?.after?.Quantity ?? r.diff?.after?.quantity,
  before_status: r.diff?.before?.Status ?? r.diff?.before?.status,
  after_status: r.diff?.after?.Status ?? r.diff?.after?.status,
})), null, 2));

process.exit(0);
