// One-time script: moves orders stuck in "In Preparation" or "Accepted" back to "New".
// These statuses were removed from the workflow.
//
// Usage:  node scripts/fix-in-preparation-orders.js
//         (runs against the env configured in .env / .env.dev)

import 'dotenv/config';
import db from '../src/services/airtable.js';
import { TABLES } from '../src/config/airtable.js';

const STUCK_STATUSES = ['In Preparation', 'Accepted'];

async function run() {
  console.log('[FIX] Looking for orders in:', STUCK_STATUSES.join(', '));

  const formula = `OR(${STUCK_STATUSES.map(s => `{Status}='${s}'`).join(',')})`;
  const orders = await db.list(TABLES.ORDERS, { filterByFormula: formula });

  if (orders.length === 0) {
    console.log('[FIX] No stuck orders found. Nothing to do.');
    return;
  }

  console.log(`[FIX] Found ${orders.length} stuck order(s):`);
  for (const o of orders) {
    console.log(`  - ${o['App Order ID'] || o.id}  status="${o.Status}"`);
  }

  for (const o of orders) {
    await db.update(TABLES.ORDERS, o.id, { Status: 'New' });
    console.log(`[FIX] ${o['App Order ID'] || o.id}: "${o.Status}" → "New"`);
  }

  console.log('[FIX] Done.');
}

run().catch(err => {
  console.error('[FIX] Fatal error:', err);
  process.exit(1);
});
