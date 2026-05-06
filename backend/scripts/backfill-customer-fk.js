// backend/scripts/backfill-customer-fk.js
// Category: DESTRUCTIVE
// Updates orders.customer_id from recXXX (Airtable text) to the UUID string
// of the matching customers row. Both columns stay type=text; a future
// cleanup migration can ALTER COLUMN + add the formal FK constraint.
// Safe to re-run: WHERE customer_id LIKE 'rec%' limits to unprocessed rows.
// Usage: APPROVE=yes node backend/scripts/backfill-customer-fk.js

import 'dotenv/config';
import pg from 'pg';

if (process.env.APPROVE !== 'yes') {
  console.error('Set APPROVE=yes to confirm you want to write to production Postgres.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Only update rows whose customer_id still looks like a recXXX.
const updateResult = await pool.query(`
  UPDATE orders
  SET customer_id = customers.id::text
  FROM customers
  WHERE customers.airtable_id = orders.customer_id
    AND orders.customer_id LIKE 'rec%'
`);
console.log(`Updated ${updateResult.rowCount} orders to UUID customer_id.`);

// Report any orders that still have recXXX ids (no matching customer found).
const unmatched = await pool.query(`
  SELECT id, customer_id FROM orders WHERE customer_id LIKE 'rec%' LIMIT 20
`);
if (unmatched.rows.length > 0) {
  console.error(`⚠️  ${unmatched.rows.length} orders still have Airtable customer_id:`);
  for (const row of unmatched.rows) {
    console.error(`  order ${row.id} → customer_id ${row.customer_id}`);
  }
  console.error('Resolve these manually before cutover.');
} else {
  console.log('✓ All orders now have UUID customer_id. Safe to flip customerRepo to PG.');
}

await pool.end();
