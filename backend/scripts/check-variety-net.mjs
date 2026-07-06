#!/usr/bin/env node
// Category: SAFE — read-only. Connects via CLAUDE_RO_URL (read-only role),
// cannot mutate prod. Safe to run any time.
//
// check-variety-net.mjs — sum the net effective stock for one Variety.
//
// In the Y-model, a Variety's effective stock is the SUM of every live stock
// row (Batches positive, Demand Entries negative) that shares its
// Type / Colour [/ Cultivar / Size]. This prints every contributing row and
// the net, so you can confirm a Variety's on-hand figure and see exactly which
// batches/demands compose it (the reusable form of the reconciliation probe).
//
// Matching is case-insensitive on Type + Colour; Cultivar and Size narrow it
// further when given. Type falls back to display_name for legacy attr-less rows.
//
// Usage:
//   CLAUDE_RO_URL=... node backend/scripts/check-variety-net.mjs <type> [colour] [cultivar] [sizeCm]
// Examples:
//   node backend/scripts/check-variety-net.mjs Peony Pink
//   node backend/scripts/check-variety-net.mjs Hydrangea Pink
//   node backend/scripts/check-variety-net.mjs Peony Pink "Sarah Bernhardt"

import pg from 'pg';

const url = process.env.CLAUDE_RO_URL || process.env.RO;
if (!url) {
  console.error('check-variety-net: set CLAUDE_RO_URL (read-only DSN).');
  process.exit(2);
}

const [type, colour, cultivar, sizeCm] = process.argv.slice(2);
if (!type) {
  console.error('Usage: node backend/scripts/check-variety-net.mjs <type> [colour] [cultivar] [sizeCm]');
  process.exit(2);
}

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const where = [`deleted_at IS NULL`, `LOWER(COALESCE(type_name, display_name)) = LOWER($1)`];
const params = [type];
if (colour)   { params.push(colour);   where.push(`LOWER(COALESCE(colour,'')) = LOWER($${params.length})`); }
if (cultivar) { params.push(cultivar); where.push(`LOWER(COALESCE(cultivar,'')) = LOWER($${params.length})`); }
if (sizeCm)   { params.push(Number(sizeCm)); where.push(`size_cm = $${params.length}`); }

const { rows } = await c.query(`
  SELECT id, display_name, type_name, colour, cultivar, size_cm, "date",
         current_quantity AS qty
  FROM stock
  WHERE ${where.join(' AND ')}
  ORDER BY "date" NULLS FIRST, current_quantity DESC
`, params);

const key = [type, colour, cultivar, sizeCm ? `${sizeCm}cm` : null].filter(Boolean).join(' / ');
console.log(`\ncheck-variety-net — ${key}\n`);

if (rows.length === 0) {
  console.log('  (no matching stock rows)\n');
  await c.end();
  process.exit(0);
}

let net = 0;
for (const r of rows) {
  net += r.qty;
  const kind = r.qty < 0 ? 'DEMAND' : 'batch ';
  const date = r.date ? String(r.date).slice(0, 10) : 'no-date ';
  console.log(`  ${kind}  ${String(r.qty).padStart(5)}   ${date}   ${String(r.id).slice(0, 8)}   ${r.display_name || ''}`);
}
console.log('  ' + '─'.repeat(48));
console.log(`  NET: ${net}   (${rows.length} row${rows.length === 1 ? '' : 's'})\n`);

await c.end();
