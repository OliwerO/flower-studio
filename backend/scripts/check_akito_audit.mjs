// SAFE — read-only.
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const akito = 'c2fd6fd5-c409-4063-b2a5-b46a476d0df7';
const may18 = 'bd25114d-8590-4407-ae6d-c9883d5c91eb';
const legacyWhite = '599cff09-04df-4716-b563-d9b53ae7c580';

for (const [name, id] of [['akito 8.May', akito], ['18.May White', may18], ['legacy White (-2)', legacyWhite]]) {
  console.log(`\n=== AUDIT for ${name} (${id}) ===`);
  const r = (await c.query(
    `SELECT created_at, action, actor_role, actor_pin_label, diff
       FROM audit_log WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 20`, [id])).rows;
  console.log(JSON.stringify(r, null, 2));
}

console.log('\n=== Orders touching either Hydrangea name in last 7d (any stock_item_id) ===');
const rows = (await c.query(
  `SELECT ol.created_at, ol.order_id, ol.stock_item_id, ol.flower_name, ol.quantity, ol.deleted_at, o.app_order_id, o.status, o.order_date
     FROM order_lines ol
     LEFT JOIN orders o ON ol.order_id = o.id
    WHERE ol.flower_name ILIKE '%hydrangea%'
      AND ol.created_at >= '2026-05-12'
    ORDER BY ol.created_at DESC`
)).rows;
console.log(JSON.stringify(rows, null, 2));

await c.end();
process.exit(0);
