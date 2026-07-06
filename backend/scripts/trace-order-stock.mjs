#!/usr/bin/env node
// Category: SAFE — read-only. Connects via CLAUDE_RO_URL (read-only role),
// cannot mutate prod. Safe to run any time.
//
// trace-order-stock.mjs — show how one order binds to stock.
//
// For a given human order id (e.g. 202607-002), prints the order header and
// each order line with the stock row it references (via stock_item_id), that
// row's kind (Batch / Demand Entry / legacy) and current qty. Makes the
// "where does this demand come from / which stock does this order touch"
// question answerable in one shot — the reusable form of the binding probe.
//
// A line whose bound stock row is a DEMAND ENTRY while the order is TERMINAL
// (Delivered / Picked Up) is flagged — that is the #3 phantom pattern: the
// order is done but its need never got settled against a real batch.
//
// Usage:
//   CLAUDE_RO_URL=... node backend/scripts/trace-order-stock.mjs <order_id>
// Example:
//   node backend/scripts/trace-order-stock.mjs 202607-002

import pg from 'pg';

const url = process.env.CLAUDE_RO_URL || process.env.RO;
if (!url) { console.error('trace-order-stock: set CLAUDE_RO_URL (read-only DSN).'); process.exit(2); }

const humanId = process.argv[2];
if (!humanId) {
  console.error('Usage: node backend/scripts/trace-order-stock.mjs <order_id>   (e.g. 202607-002)');
  process.exit(2);
}

const TERMINAL = ['Delivered', 'Picked Up'];

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows: [order] } = await c.query(
  `SELECT id, app_order_id, status, delivery_type, required_by, deleted_at
   FROM orders WHERE app_order_id = $1`, [humanId]);
if (!order) { console.log(`\n  No order ${humanId}.\n`); await c.end(); process.exit(0); }

console.log(`\ntrace-order-stock — ${order.app_order_id}  [${order.status}]  ${order.delivery_type || ''}` +
  `${order.deleted_at ? '  (DELETED)' : ''}\n`);

const { rows: lines } = await c.query(`
  SELECT ol.id, ol.flower_name, ol.quantity, ol.stock_item_id, ol.stock_deferred,
         s.id AS s_id, s.display_name, s.type_name, s.colour, s.cultivar,
         s."date" AS s_date, s.current_quantity AS s_qty, s.deleted_at AS s_deleted
  FROM order_lines ol
  LEFT JOIN stock s ON s.id::text = ol.stock_item_id
  WHERE ol.order_id = $1 AND ol.deleted_at IS NULL
  ORDER BY ol.created_at
`, [order.id]);

if (lines.length === 0) { console.log('  (no order lines)\n'); await c.end(); process.exit(0); }

const isTerminal = TERMINAL.includes(order.status);
let flags = 0;
for (const l of lines) {
  console.log(`  • ${l.flower_name}  ×${l.quantity}${l.stock_deferred ? '  (deferred)' : ''}`);
  if (!l.stock_item_id) { console.log(`      ↳ no stock binding`); continue; }
  if (!l.s_id) { console.log(`      ↳ binds to ${l.stock_item_id} — not a live stock uuid (legacy/airtable id)`); continue; }
  const kind = l.s_qty < 0 ? 'DEMAND ENTRY' : 'batch';
  const variety = [l.type_name || l.display_name, l.colour, l.cultivar].filter(Boolean).join(' / ');
  const date = l.s_date ? String(l.s_date).slice(0, 10) : 'no-date';
  // Only a LIVE demand entry (not soft-deleted) on a terminal order is a real
  // phantom. A deleted DE means it was already settled/cleaned — not stale.
  const flag = (isTerminal && l.s_qty < 0 && !l.s_deleted)
    ? '   ⚠ STALE: terminal order still on a live demand entry' : '';
  if (flag) flags++;
  console.log(`      ↳ ${kind}  ${variety}  [${date}]  qty ${l.s_qty}${l.s_deleted ? ' (deleted)' : ''}${flag}`);
}
console.log(flags ? `\n⚠ ${flags} line(s) show the #3 phantom pattern.\n` : '\n✓ No stale terminal→demand bindings.\n');

await c.end();
