// backfill-orders.js — copies every Airtable order + its lines + its
// delivery into Postgres. Run BEFORE flipping ORDER_BACKEND from
// 'airtable' to 'shadow'.
//
// Run from backend/ dir:
//   node --env-file=.env scripts/backfill-orders.js
//
// Idempotent: re-runs UPSERT on airtable_id so the script can be
// re-executed safely. Soft-deleted PG rows are not touched.
//
// Strategy:
//   1. Pull every Airtable order (active + cancelled — keep history).
//   2. Pull every order_line referenced by those orders.
//   3. Pull every delivery referenced by those orders.
//   4. UPSERT in dependency order: orders → order_lines → deliveries.
//
// Volume note: Blossom has ~2-4k active+legacy orders. With ~3 lines each,
// expect ~10-15k order_lines. This runs in ~30s on a fresh PG.

import * as airtable from '../src/services/airtable.js';
import { TABLES } from '../src/config/airtable.js';
import { db, pool } from '../src/db/index.js';
import { orders, orderLines, deliveries } from '../src/db/schema.js';
import {
  pgOrderToResponse,  // unused but kept for consistency / future debugging
} from '../src/repos/orderRepo.js';
import { eq, sql } from 'drizzle-orm';

if (!process.env.DATABASE_URL) {
  console.error('[backfill-orders] DATABASE_URL not set. Aborting.');
  process.exit(1);
}

// ── Field mapping helpers — mirror orderRepo's responseToPg shape, but
//    we replicate them here so this script stays decoupled from internal
//    repo plumbing. ──

function orderFieldsToPg(r) {
  return {
    airtableId:         r.id,
    appOrderId:         r['App Order ID'] || r.id, // fallback to airtable id if missing
    customerId:         (Array.isArray(r.Customer) ? r.Customer[0] : r.Customer) || 'recUNKNOWN',
    status:             r.Status || 'New',
    deliveryType:       r['Delivery Type'] || 'Pickup',
    orderDate:          r['Order Date'] || new Date().toISOString().split('T')[0],
    requiredBy:         r['Required By'] || null,
    deliveryTime:       r['Delivery Time'] || null,
    customerRequest:    r['Customer Request'] || null,
    notesOriginal:      r['Notes Original'] || null,
    floristNote:        r['Florist Note'] || null,
    greetingCardText:   r['Greeting Card Text'] || null,
    source:             r.Source || null,
    communicationMethod: r['Communication method'] || null,
    paymentStatus:      r['Payment Status'] || 'Unpaid',
    paymentMethod:      r['Payment Method'] || null,
    priceOverride:      r['Price Override'] != null ? String(r['Price Override']) : null,
    deliveryFee:        r['Delivery Fee'] != null ? String(r['Delivery Fee']) : null,
    createdBy:          r['Created By'] || null,
    payment1Amount:     r['Payment 1 Amount'] != null ? String(r['Payment 1 Amount']) : null,
    payment1Method:     r['Payment 1 Method'] || null,
  };
}

function lineFieldsToPg(r, orderPgIdByAirtableId) {
  const orderAirtableId = Array.isArray(r.Order) ? r.Order[0] : r.Order;
  const orderPgId = orderPgIdByAirtableId.get(orderAirtableId);
  if (!orderPgId) return null;  // orphan line — skip
  return {
    airtableId:        r.id,
    orderId:           orderPgId,
    stockItemId:       Array.isArray(r['Stock Item']) ? r['Stock Item'][0] : (r['Stock Item'] || null),
    flowerName:        r['Flower Name'] || '',
    quantity:          Number(r.Quantity || 0),
    costPricePerUnit:  r['Cost Price Per Unit'] != null ? String(r['Cost Price Per Unit']) : null,
    sellPricePerUnit:  r['Sell Price Per Unit'] != null ? String(r['Sell Price Per Unit']) : null,
    stockDeferred:     Boolean(r['Stock Deferred']),
  };
}

function deliveryFieldsToPg(r, orderPgIdByAirtableId) {
  const orderAirtableId = Array.isArray(r['Linked Order']) ? r['Linked Order'][0] : r['Linked Order'];
  const orderPgId = orderPgIdByAirtableId.get(orderAirtableId);
  if (!orderPgId) return null;
  return {
    airtableId:         r.id,
    orderId:            orderPgId,
    deliveryAddress:    r['Delivery Address'] || null,
    recipientName:      r['Recipient Name'] || null,
    recipientPhone:     r['Recipient Phone'] || null,
    deliveryDate:       r['Delivery Date'] || null,
    deliveryTime:       r['Delivery Time'] || null,
    assignedDriver:     r['Assigned Driver'] || null,
    deliveryFee:        r['Delivery Fee'] != null ? String(r['Delivery Fee']) : null,
    driverInstructions: r['Driver Instructions'] || null,
    deliveryMethod:     r['Delivery Method'] || null,
    driverPayout:       r['Driver Payout'] != null ? String(r['Driver Payout']) : null,
    status:             r.Status || 'Pending',
  };
}

// ── 1. Fetch ──

console.log('[backfill-orders] Pulling orders from Airtable…');
const airtableOrders = await airtable.list(TABLES.ORDERS, {
  sort: [{ field: 'Order Date', direction: 'desc' }],
});
console.log(`[backfill-orders] Fetched ${airtableOrders.length} orders.`);

// All linked line + delivery ids
const allLineIds = airtableOrders.flatMap(o => o['Order Lines'] || []);
const allDeliveryIds = airtableOrders.flatMap(o => o['Deliveries'] || []);

console.log(`[backfill-orders] Pulling ${allLineIds.length} order lines…`);
const { listByIds } = await import('../src/utils/batchQuery.js');
const airtableLines = allLineIds.length
  ? await listByIds(TABLES.ORDER_LINES, allLineIds)
  : [];
console.log(`[backfill-orders] Pulling ${allDeliveryIds.length} deliveries…`);
const airtableDeliveries = allDeliveryIds.length
  ? await listByIds(TABLES.DELIVERIES, allDeliveryIds)
  : [];

// ── 2. UPSERT orders ──

console.log('[backfill-orders] Upserting orders into PG…');
let ordersInserted = 0, ordersUpdated = 0, ordersSkipped = 0;
const orderIssues = [];
const orderPgIdByAirtableId = new Map();  // recXXX → uuid

for (const r of airtableOrders) {
  if (!r['App Order ID']) {
    orderIssues.push({ id: r.id, reason: 'missing App Order ID — skipped' });
    ordersSkipped++;
    continue;
  }
  const fields = orderFieldsToPg(r);
  try {
    const [existing] = await db.select().from(orders).where(eq(orders.airtableId, r.id)).limit(1);
    if (existing) {
      const [updated] = await db.update(orders).set({
        ...fields,
        updatedAt: new Date(),
      }).where(eq(orders.id, existing.id)).returning();
      orderPgIdByAirtableId.set(r.id, updated.id);
      ordersUpdated++;
    } else {
      const [inserted] = await db.insert(orders).values(fields).returning();
      orderPgIdByAirtableId.set(r.id, inserted.id);
      ordersInserted++;
    }
  } catch (err) {
    orderIssues.push({ id: r.id, reason: err.message });
    console.error(`[backfill-orders] Order FAILED ${r.id}:`, err.message);
  }
}

console.log(`[backfill-orders] Orders: ${ordersInserted} inserted, ${ordersUpdated} updated, ${ordersSkipped} skipped.`);

// ── 3. UPSERT order_lines ──

console.log('[backfill-orders] Upserting order_lines into PG…');
let linesInserted = 0, linesUpdated = 0, linesSkipped = 0;
const lineIssues = [];

for (const r of airtableLines) {
  const fields = lineFieldsToPg(r, orderPgIdByAirtableId);
  if (!fields) {
    linesSkipped++;
    continue;
  }
  try {
    const [existing] = await db.select().from(orderLines).where(eq(orderLines.airtableId, r.id)).limit(1);
    if (existing) {
      await db.update(orderLines).set({
        ...fields,
        updatedAt: new Date(),
      }).where(eq(orderLines.id, existing.id));
      linesUpdated++;
    } else {
      await db.insert(orderLines).values(fields);
      linesInserted++;
    }
  } catch (err) {
    lineIssues.push({ id: r.id, reason: err.message });
    console.error(`[backfill-orders] Line FAILED ${r.id}:`, err.message);
  }
}

console.log(`[backfill-orders] Lines: ${linesInserted} inserted, ${linesUpdated} updated, ${linesSkipped} skipped (orphan).`);

// ── 4. UPSERT deliveries ──

console.log('[backfill-orders] Upserting deliveries into PG…');
let delsInserted = 0, delsUpdated = 0, delsSkipped = 0;
const delIssues = [];

for (const r of airtableDeliveries) {
  const fields = deliveryFieldsToPg(r, orderPgIdByAirtableId);
  if (!fields) {
    delsSkipped++;
    continue;
  }
  try {
    const [existing] = await db.select().from(deliveries).where(eq(deliveries.airtableId, r.id)).limit(1);
    if (existing) {
      await db.update(deliveries).set({
        ...fields,
        updatedAt: new Date(),
      }).where(eq(deliveries.id, existing.id));
      delsUpdated++;
    } else {
      await db.insert(deliveries).values(fields);
      delsInserted++;
    }
  } catch (err) {
    delIssues.push({ id: r.id, reason: err.message });
    console.error(`[backfill-orders] Delivery FAILED ${r.id}:`, err.message);
  }
}

console.log(`[backfill-orders] Deliveries: ${delsInserted} inserted, ${delsUpdated} updated, ${delsSkipped} skipped (orphan).`);

// ── 5. Final tallies ──

const [{ count: pgOrderCount }] = await db.execute(sql`SELECT COUNT(*)::int AS count FROM orders WHERE deleted_at IS NULL`)
  .then(r => r.rows ?? r);
const [{ count: pgLineCount }] = await db.execute(sql`SELECT COUNT(*)::int AS count FROM order_lines WHERE deleted_at IS NULL`)
  .then(r => r.rows ?? r);
const [{ count: pgDeliveryCount }] = await db.execute(sql`SELECT COUNT(*)::int AS count FROM deliveries WHERE deleted_at IS NULL`)
  .then(r => r.rows ?? r);

console.log('\n[backfill-orders] Summary:');
console.log(`  Airtable orders:     ${airtableOrders.length}`);
console.log(`  Airtable lines:      ${airtableLines.length}`);
console.log(`  Airtable deliveries: ${airtableDeliveries.length}`);
console.log(`  PG orders now:       ${pgOrderCount}`);
console.log(`  PG lines now:        ${pgLineCount}`);
console.log(`  PG deliveries now:   ${pgDeliveryCount}`);

const totalIssues = orderIssues.length + lineIssues.length + delIssues.length;
if (totalIssues > 0) {
  console.log(`  Issues encountered:  ${totalIssues}`);
  for (const i of [...orderIssues, ...lineIssues, ...delIssues]) {
    console.log(`    - ${i.id}: ${i.reason}`);
  }
}

console.log('\n[backfill-orders] Done. Next: deploy with ORDER_BACKEND=shadow and watch parity_log.');

await pool.end();
process.exit(totalIssues > 0 ? 1 : 0);
