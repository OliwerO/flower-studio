// backend/scripts/fix-po-stock-names.js
// Category: DESTRUCTIVE
// One-shot: fixes 5 Postgres stock rows that were created with UUID display
// names (ghost records from broken Airtable backfill) and patches the
// corresponding Airtable ghost records with the real flower names sourced
// from the PO lines that reference them.
//
// Usage: APPROVE=yes node backend/scripts/fix-po-stock-names.js

import 'dotenv/config';
import Airtable from 'airtable';
import pg from 'pg';

if (process.env.APPROVE !== 'yes') {
  console.error('Set APPROVE=yes to run.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// Sourced from PO lines: airtable_id → [displayName, costPrice, sellPrice, supplier]
const FIXES = {
  rec2woJHkTjjM1lPv: ['Paeonia sarah bernhardt',             '8.58',  '25',  '4f'],
  recmZqmrpmg1Ggmya: ['Matthiola white',                     '4.62',  '11',  'OZ'],
  recodfjwc3AiLBMPO: ['Hydrangea my beautiful akito (White)', '20.9',  '55',  'OZ'],
  recrhgmSsWm6NfiYY: ['Matthiola pink light',                '3.81',  '11',  'OZ'],
  rectLctpKxh1fKwNH: ['Hydrangea verena (Pink)',             '23.33', '60',  'OZ'],
};

// 1. Fix Postgres rows
console.log('Fixing Postgres rows…');
for (const [atId, [name, cost, sell, supplier]] of Object.entries(FIXES)) {
  const { rowCount } = await pool.query(
    `UPDATE stock
     SET display_name=$1, purchase_name=$1, current_cost_price=$2, current_sell_price=$3, supplier=$4
     WHERE airtable_id=$5`,
    [name, cost, sell, supplier, atId],
  );
  console.log(`  PG (${rowCount} row updated): ${atId} → "${name}"`);
}

// 2. Patch Airtable ghost records with real names
console.log('\nPatching Airtable ghost records…');
for (const [atId, [name, cost, sell]] of Object.entries(FIXES)) {
  try {
    await base(process.env.AIRTABLE_STOCK_TABLE).update(atId, {
      'Display Name': name,
      'Current Cost Price': Number(cost),
      'Current Sell Price': Number(sell),
    });
    console.log(`  AT updated: ${atId} → "${name}"`);
  } catch (err) {
    console.error(`  AT FAILED ${atId}: ${err.message}`);
  }
}

console.log('\nDone. Reopen bouquet editor — these items will now appear.');
await pool.end();
