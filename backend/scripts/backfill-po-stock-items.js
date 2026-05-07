// backend/scripts/backfill-po-stock-items.js
// Category: DESTRUCTIVE
//
// Ensures every stock item referenced by active PO lines exists in Postgres.
//
// Two failure modes this fixes:
//   A. Unlinked PO line (Flower Name only, no Stock Item) — stock card never
//      existed anywhere. Creates a new PG row from the flower name.
//   B. Linked PO line (has Stock Item recXXX) where the Airtable stock item
//      was created AFTER the Phase 3 stock backfill (2026-05-02) and was
//      therefore never synced to Postgres. The pending-po response keys off
//      the recXXX but the stock list returns nothing → item hidden in picker.
//
// Idempotent: only creates rows that don't exist yet (checks by airtable_id
// for case B, case-insensitive display_name for case A).
// Usage: APPROVE=yes node backend/scripts/backfill-po-stock-items.js

import 'dotenv/config';
import Airtable from 'airtable';
import pg from 'pg';

if (process.env.APPROVE !== 'yes') {
  console.error('Set APPROVE=yes to confirm you want to write to production Postgres.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

const STOCK_ORDERS_TABLE      = process.env.AIRTABLE_STOCK_ORDERS_TABLE;
const STOCK_ORDER_LINES_TABLE = process.env.AIRTABLE_STOCK_ORDER_LINES_TABLE;
const STOCK_TABLE             = process.env.AIRTABLE_STOCK_TABLE;

// ── 1. Fetch active POs ──────────────────────────────────────────────────────

console.log('Fetching active POs from Airtable…');
const activePOs = await new Promise((resolve, reject) => {
  const recs = [];
  base(STOCK_ORDERS_TABLE).select({
    filterByFormula: `OR(
      {Status} = 'Sent',
      {Status} = 'Shopping',
      {Status} = 'Reviewing',
      {Status} = 'Evaluating',
      {Status} = 'Draft'
    )`,
    fields: ['Stock Order ID', 'Status', 'Order Lines'],
  }).eachPage(
    (records, next) => { recs.push(...records); next(); },
    err => err ? reject(err) : resolve(recs),
  );
});
console.log(`Found ${activePOs.length} active PO(s).`);

const allLineIds = activePOs.flatMap(po => po.fields['Order Lines'] || []);
if (allLineIds.length === 0) {
  console.log('No PO lines. Nothing to do.');
  await pool.end();
  process.exit(0);
}

// ── 2. Fetch all PO lines ────────────────────────────────────────────────────

console.log(`Fetching ${allLineIds.length} PO line(s)…`);
const CHUNK = 100;
const allLines = [];
for (let i = 0; i < allLineIds.length; i += CHUNK) {
  const chunk = allLineIds.slice(i, i + CHUNK);
  const formula = `OR(${chunk.map(id => `RECORD_ID()="${id}"`).join(',')})`;
  const recs = await new Promise((resolve, reject) => {
    const rows = [];
    base(STOCK_ORDER_LINES_TABLE).select({
      filterByFormula: formula,
      fields: ['Flower Name', 'Stock Item', 'Cost Price', 'Sell Price', 'Supplier'],
    }).eachPage(
      (records, next) => { rows.push(...records); next(); },
      err => err ? reject(err) : resolve(rows),
    );
  });
  allLines.push(...recs);
}

// ── Case A: unlinked lines (Flower Name, no Stock Item) ──────────────────────

const unlinked = allLines.filter(l =>
  (l.fields['Flower Name'] || '').trim() &&
  !(l.fields['Stock Item']?.length > 0)
);
const uniqueNames = [...new Set(unlinked.map(l => l.fields['Flower Name'].trim()).filter(Boolean))];

// ── Case B: linked lines whose Airtable recXXX is missing from Postgres ──────

const linkedRecIds = [...new Set(
  allLines
    .filter(l => l.fields['Stock Item']?.length > 0)
    .map(l => l.fields['Stock Item'][0])
)];

let missingRecIds = [];
if (linkedRecIds.length > 0) {
  // Find which recXXX values are NOT in Postgres stock
  const { rows: pgRows } = await pool.query(
    `SELECT airtable_id FROM stock WHERE airtable_id = ANY($1) AND deleted_at IS NULL`,
    [linkedRecIds],
  );
  const existingInPg = new Set(pgRows.map(r => r.airtable_id));
  missingRecIds = linkedRecIds.filter(id => !existingInPg.has(id));
}

console.log(`\nCase A — unlinked lines:   ${uniqueNames.length} unique name(s)`);
console.log(`Case B — linked but missing from PG: ${missingRecIds.length} item(s)`);

if (uniqueNames.length === 0 && missingRecIds.length === 0) {
  console.log('\nAll PO stock items already exist in Postgres. Nothing to create.');
  await pool.end();
  process.exit(0);
}

let created = 0;
let alreadyExisted = 0;

// ── Fix Case A: create from flower name ──────────────────────────────────────

for (const name of uniqueNames) {
  const { rows } = await pool.query(
    `SELECT id FROM stock WHERE LOWER(display_name) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
    [name],
  );
  if (rows.length > 0) {
    console.log(`  A ✓ Already exists: "${name}"`);
    alreadyExisted++;
    continue;
  }
  const srcLine = unlinked.find(l => l.fields['Flower Name'].trim() === name);
  const costPrice = Number(srcLine?.fields['Cost Price']) || null;
  const sellPrice = Number(srcLine?.fields['Sell Price']) || null;
  const supplier  = srcLine?.fields['Supplier'] || null;
  const { rows: ins } = await pool.query(
    `INSERT INTO stock (display_name, purchase_name, current_quantity, current_cost_price, current_sell_price, supplier, category, active)
     VALUES ($1, $2, 0, $3, $4, $5, 'Other', true) RETURNING id`,
    [name, name, costPrice, sellPrice, supplier],
  );
  console.log(`  A + Created: "${name}" → ${ins[0].id}`);
  created++;
}

// ── Fix Case B: fetch Airtable stock item and create in PG with airtable_id ──

if (missingRecIds.length > 0) {
  console.log('\nFetching missing stock items from Airtable…');
  const atItems = [];
  for (let i = 0; i < missingRecIds.length; i += CHUNK) {
    const chunk = missingRecIds.slice(i, i + CHUNK);
    const formula = `OR(${chunk.map(id => `RECORD_ID()="${id}"`).join(',')})`;
    const recs = await new Promise((resolve, reject) => {
      const rows = [];
      base(STOCK_TABLE).select({
        filterByFormula: formula,
        fields: [
          'Display Name', 'Purchase Name', 'Category', 'Current Quantity',
          'Current Cost Price', 'Current Sell Price', 'Supplier', 'Unit',
          'Lot Size', 'Active',
        ],
      }).eachPage(
        (records, next) => { rows.push(...records); next(); },
        err => err ? reject(err) : resolve(rows),
      );
    });
    atItems.push(...recs);
  }

  for (const item of atItems) {
    const f = item.fields;
    const name = (f['Display Name'] || '').trim();
    if (!name) { console.log(`  B ⚠ Skipping ${item.id} — no Display Name`); continue; }

    const { rows: ins } = await pool.query(
      `INSERT INTO stock
         (airtable_id, display_name, purchase_name, category, current_quantity,
          current_cost_price, current_sell_price, supplier, unit, lot_size, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (airtable_id) DO NOTHING
       RETURNING id`,
      [
        item.id,
        name,
        f['Purchase Name'] || name,
        f['Category'] || 'Other',
        Number(f['Current Quantity']) || 0,
        f['Current Cost Price'] != null ? String(f['Current Cost Price']) : null,
        f['Current Sell Price'] != null ? String(f['Current Sell Price']) : null,
        f['Supplier'] || null,
        f['Unit'] || null,
        f['Lot Size'] != null ? Number(f['Lot Size']) : null,
        f['Active'] !== false,
      ],
    );
    if (ins.length > 0) {
      console.log(`  B + Created: "${name}" (airtable_id=${item.id}) → pg_id=${ins[0].id}`);
      created++;
    } else {
      console.log(`  B ✓ Already existed (ON CONFLICT): "${name}"`);
      alreadyExisted++;
    }
  }

  // Report any missing recIds that weren't found in Airtable
  const foundIds = new Set(atItems.map(i => i.id));
  for (const id of missingRecIds) {
    if (!foundIds.has(id)) {
      console.log(`  B ⚠ Airtable record ${id} not found (deleted?)`);
    }
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nDone. Created ${created} stock card(s), ${alreadyExisted} already existed.`);
if (created > 0) {
  console.log('These items will now appear in the bouquet picker (open/reopen the editor).');
}

await pool.end();
