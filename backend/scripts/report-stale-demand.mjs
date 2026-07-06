#!/usr/bin/env node
// Category: SAFE — read-only. Connects via CLAUDE_RO_URL (read-only role),
// cannot mutate prod. Safe to run any time.
//
// report-stale-demand.mjs — Y-model demand-hygiene report.
//
// In the Y-model, a "demand entry" is a stock row with current_quantity < 0
// (a Variety's unmet need). Orders bind to it via order_lines.stock_item_id.
// A HEALTHY negative row is one still backing an OPEN (non-terminal) order —
// its need is real and pending. A STALE/PHANTOM row is a negative that:
//   • is backed only by TERMINAL orders (Delivered / Picked Up / Cancelled) —
//     the order is done, so the demand should have been settled against real
//     stock, not left floating (root cause of the 2026-07-06 phantom rows); or
//   • is ORPHANED — no live order line points at it at all.
//
// This is the reusable form of the one-off probe used during the 2026-07-06
// reconciliation. Use it to confirm prod demand hygiene before/after any
// terminal-settlement change, or when a Variety's net looks wrong.
//
// Output: three buckets (OPEN / TERMINAL-only / ORPHAN) with the driving
// orders per negative row, then a one-line summary.
//
// Usage:
//   CLAUDE_RO_URL='postgresql://claude_ro:...@...rlwy.net:PORT/railway' \
//     node backend/scripts/report-stale-demand.mjs
//
//   (CLAUDE_RO_URL: `railway variables -s Postgres --kv | grep CLAUDE_RO_URL`)

import pg from 'pg';

const url = process.env.CLAUDE_RO_URL || process.env.RO;
if (!url) {
  console.error('report-stale-demand: set CLAUDE_RO_URL (read-only DSN).');
  console.error('  railway variables -s Postgres --kv | grep CLAUDE_RO_URL');
  process.exit(2);
}

// Terminal order statuses — an order in one of these should own NO floating demand.
const TERMINAL = ['Delivered', 'Picked Up', 'Cancelled'];

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows: [{ role }] } = await c.query(`SELECT current_user AS role`);
console.log(`\nreport-stale-demand — role: ${role} (read-only)\n`);

// All live negative-qty stock rows = demand entries.
const { rows: demand } = await c.query(`
  SELECT id, display_name, type_name, colour, size_cm, cultivar, "date",
         current_quantity AS qty
  FROM stock
  WHERE deleted_at IS NULL AND current_quantity < 0
  ORDER BY type_name, colour, "date"
`);

if (demand.length === 0) {
  console.log('✓ No negative-qty stock rows. Demand ledger is clean.\n');
  await c.end();
  process.exit(0);
}

// For each demand row, pull the order lines that bind to it (stock_item_id is
// text; a Y-model demand id is a uuid, so cast the stock id to text to match).
const buckets = { open: [], terminalOnly: [], orphan: [] };

for (const d of demand) {
  const { rows: lines } = await c.query(`
    SELECT ol.quantity, o.order_id AS human_id, o.status
    FROM order_lines ol
    JOIN orders o ON o.id = ol.order_id
    WHERE ol.deleted_at IS NULL
      AND o.deleted_at IS NULL
      AND ol.stock_item_id = $1::text
    ORDER BY o.status
  `, [d.id]);

  const variety = [d.type_name || d.display_name, d.colour, d.cultivar,
                   d.size_cm ? `${d.size_cm}cm` : null].filter(Boolean).join(' / ');
  const label = `${variety}  [${d.date ? String(d.date).slice(0, 10) : 'no-date'}]  qty ${d.qty}  id ${String(d.id).slice(0, 8)}`;
  const entry = { label, lines };

  if (lines.length === 0) buckets.orphan.push(entry);
  else if (lines.every((l) => TERMINAL.includes(l.status))) buckets.terminalOnly.push(entry);
  else buckets.open.push(entry);
}

const printBucket = (title, arr) => {
  console.log(`── ${title} (${arr.length}) ──`);
  if (arr.length === 0) { console.log('  (none)\n'); return; }
  for (const e of arr) {
    console.log(`  • ${e.label}`);
    for (const l of e.lines) console.log(`      ↳ ${l.human_id}  ${l.status}  (qty ${l.quantity})`);
  }
  console.log();
};

printBucket('OPEN — healthy, real pending demand', buckets.open);
printBucket('TERMINAL-ONLY — STALE, should have been settled', buckets.terminalOnly);
printBucket('ORPHAN — no live order line references this demand', buckets.orphan);

const stale = buckets.terminalOnly.length + buckets.orphan.length;
console.log('────────────────────────────────────────');
console.log(`Summary: ${demand.length} negative rows — ` +
  `${buckets.open.length} open, ${buckets.terminalOnly.length} terminal-only, ${buckets.orphan.length} orphan.`);
console.log(stale === 0
  ? '✓ No stale/phantom demand. Ledger is clean.\n'
  : `⚠ ${stale} stale/phantom row(s) — each floats a negative with no open order behind it.\n`);

await c.end();
