// SAFE — read-only.
import { db } from '../src/db/index.js';
import { appConfig, orders } from '../src/db/schema.js';
import { sql, eq } from 'drizzle-orm';

const [counterRow] = await db.select().from(appConfig).where(eq(appConfig.key, 'orderCounters'));
console.log('orderCounters:', JSON.stringify(counterRow?.value, null, 2));

const all = await db.execute(sql`
  SELECT app_order_id, wix_order_id, customer_request, created_at, status
  FROM orders
  WHERE app_order_id LIKE '202605-%'
  ORDER BY app_order_id
`);
console.log('\nAll orders this month (by appOrderId):');
for (const r of all.rows || all) {
  console.log(' ', r.app_order_id, '|', r.created_at, '|', r.wix_order_id ? 'WIX' : '---', '|', r.status);
}
process.exit(0);
