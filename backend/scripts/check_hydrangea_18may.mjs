// SAFE — read-only follow-up for #319.
import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const stockId = 'bd25114d-8590-4407-ae6d-c9883d5c91eb'; // Hydrangea White (18.May.)
const legacyAtId = 'recuxLEjqprNAttpr'; // legacy Hydrangea White at -2

console.log('=== STOCK row 18.May batch ===');
console.log((await client.query(`SELECT * FROM stock WHERE id = $1`, [stockId])).rows);

console.log('\n=== AUDIT LOG for 18.May batch (id) ===');
const aud18 = (await client.query(
  `SELECT created_at, action, entity_type, entity_id, actor_role, actor_pin_label, diff
     FROM audit_log
    WHERE entity_id = $1
    ORDER BY created_at DESC LIMIT 30`,
  [stockId]
)).rows;
console.log(JSON.stringify(aud18, null, 2));

console.log('\n=== Premade lines referencing 18.May batch ===');
console.log((await client.query(
  `SELECT pbl.id, pbl.bouquet_id, pbl.stock_id, pbl.flower_name, pbl.quantity, pb.name, pb.created_at AS bouquet_created
   FROM premade_bouquet_lines pbl
   LEFT JOIN premade_bouquets pb ON pbl.bouquet_id = pb.id
   WHERE pbl.stock_id = $1`,
  [stockId]
)).rows);

console.log('\n=== AUDIT LOG for legacy Hydrangea White (599cff09... = recuxLEjqprNAttpr) recently ===');
console.log((await client.query(
  `SELECT created_at, action, entity_type, entity_id, actor_role, actor_pin_label, diff
     FROM audit_log
    WHERE entity_id = '599cff09-04df-4716-b563-d9b53ae7c580'
      AND created_at >= '2026-05-15'
    ORDER BY created_at DESC LIMIT 30`
)).rows);

console.log('\n=== All stock rows with display_name = "Hydrangea White" exactly ===');
console.log((await client.query(
  `SELECT id, airtable_id, display_name, current_quantity, created_at, updated_at
     FROM stock
    WHERE display_name = 'Hydrangea White' OR display_name LIKE 'Hydrangea White%'
    ORDER BY created_at`
)).rows);

console.log('\n=== Recent order_lines for "Hydrangea White" exact name match (last 14d) ===');
console.log((await client.query(
  `SELECT ol.created_at, ol.order_id, ol.stock_item_id, ol.flower_name, ol.quantity, o.app_order_id, o.status
     FROM order_lines ol
     LEFT JOIN orders o ON ol.order_id = o.id
    WHERE (ol.flower_name = 'Hydrangea White' OR ol.flower_name ILIKE 'Hydrangea White%')
      AND ol.created_at >= '2026-05-15'
    ORDER BY ol.created_at DESC`
)).rows);

await client.end();
process.exit(0);
