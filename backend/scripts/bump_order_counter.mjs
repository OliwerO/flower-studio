// DESTRUCTIVE — owner-approved 2026-05-19. One-off counter bump for 202605.
// Issue: nextOrderId returned IDs that already existed because counter (24)
// was behind MAX(app_order_id) numeric suffix (26). Bump to 26 so next call
// returns 027.
import { db } from '../src/db/index.js';
import { appConfig } from '../src/db/schema.js';
import { sql, eq } from 'drizzle-orm';

const KEY = 'orderCounters';
const MONTH = '202605';

const [before] = await db.select().from(appConfig).where(eq(appConfig.key, KEY));
console.log('BEFORE:', JSON.stringify(before?.value));

const current = before?.value || {};
const monthMax = await db.execute(sql`
  SELECT MAX(CAST(SUBSTRING(app_order_id FROM '[0-9]+$') AS INTEGER)) AS max_n
  FROM orders
  WHERE app_order_id ~ ('^' || ${MONTH} || '-[0-9]+$')
`);
const maxN = (monthMax.rows || monthMax)[0].max_n;
console.log('MAX numeric suffix in DB for', MONTH, '=', maxN);

if (maxN == null) {
  console.log('No orders for month; no bump needed.');
  process.exit(0);
}

if ((current[MONTH] || 0) >= maxN) {
  console.log('Counter already ≥ max; no bump needed.');
  process.exit(0);
}

const next = { ...current, [MONTH]: maxN };
await db.update(appConfig)
  .set({ value: next, updatedAt: new Date() })
  .where(eq(appConfig.key, KEY));

const [after] = await db.select().from(appConfig).where(eq(appConfig.key, KEY));
console.log('AFTER:', JSON.stringify(after?.value));
process.exit(0);
