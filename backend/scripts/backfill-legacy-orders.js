// backend/scripts/backfill-legacy-orders.js
// Category: DESTRUCTIVE
// Reads LEGACY_ORDERS from Airtable; for each record, resolves the linked
// customer by airtable_id in PG, then upserts into legacy_orders.
// Run AFTER backfill-customers.js.
// Usage: APPROVE=yes node backend/scripts/backfill-legacy-orders.js

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

const LEGACY_ORDERS_TABLE = process.env.AIRTABLE_LEGACY_ORDERS_TABLE;

const LEGACY_ODER_DATE_RE = /^(\d{4})(\d{2})-.*-(\d{1,2})[A-Za-z]{3}-\d+$/;
function parseLegacyOderDate(s) {
  if (!s) return null;
  const m = LEGACY_ODER_DATE_RE.exec(s);
  if (!m) return null;
  const [, year, month, day] = m;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

function legacyDate(r) {
  return r.get('Order Delivery Date') || r.get('Order date')
    || parseLegacyOderDate(r.get('Oder Number'));
}

const rows = [];
await base(LEGACY_ORDERS_TABLE).select({
  fields: [
    'Oder Number', 'Flowers+Details of order', 'Order Reason',
    'Order Delivery Date', 'Order date', 'Price (with Delivery)',
    'Clients (B2C)',
  ],
}).eachPage((records, next) => {
  for (const r of records) rows.push(r);
  next();
});

console.log(`Fetched ${rows.length} legacy order records.`);

let inserted = 0, skipped = 0;

for (const r of rows) {
  try {
    const atCustomerId = r.get('Clients (B2C)')?.[0];
    if (!atCustomerId) { skipped++; continue; }

    const custResult = await pool.query(
      'SELECT id FROM customers WHERE airtable_id = $1',
      [atCustomerId],
    );
    if (custResult.rows.length === 0) {
      console.warn(`  No PG customer for Airtable id ${atCustomerId} — skipping legacy order ${r.id}`);
      skipped++;
      continue;
    }

    const customerId = custResult.rows[0].id;
    const description = [
      r.get('Oder Number'), r.get('Flowers+Details of order'), r.get('Order Reason'),
    ].filter(Boolean).join(' — ');

    const rawAmount = r.get('Price (with Delivery)');
    const amount = (typeof rawAmount === 'number' && Number.isFinite(rawAmount)) ? rawAmount : null;

    await pool.query(
      `INSERT INTO legacy_orders (airtable_id, customer_id, order_date, description, amount, raw)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (airtable_id) DO UPDATE SET
         customer_id = EXCLUDED.customer_id,
         order_date  = EXCLUDED.order_date,
         description = EXCLUDED.description,
         amount      = EXCLUDED.amount,
         raw         = EXCLUDED.raw`,
      [
        r.id,
        customerId,
        legacyDate(r) || null,
        description || null,
        amount,
        JSON.stringify(r.fields),
      ],
    );
    inserted++;
  } catch (err) {
    console.error(`Failed on legacy order ${r.id}:`, err.message);
  }
}

console.log(`legacy_orders: ${inserted} upserted, ${skipped} skipped (no linked customer).`);
await pool.end();
