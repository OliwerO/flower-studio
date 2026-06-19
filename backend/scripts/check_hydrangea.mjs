// SAFE — read-only query for issue #319 Phase 0 sweep.
import { db } from '../src/db/index.js';
import { stock, orderLines, orders, premadeBouquetLines, premadeBouquets } from '../src/db/schema.js';
import { sql, eq, inArray, and, gte, isNull } from 'drizzle-orm';

const stockRows = await db.select({
  id: stock.id,
  airtableId: stock.airtableId,
  displayName: stock.displayName,
  currentQuantity: stock.currentQuantity,
  active: stock.active,
  deletedAt: stock.deletedAt,
  createdAt: stock.createdAt,
  updatedAt: stock.updatedAt,
}).from(stock).where(
  sql`lower(${stock.displayName}) like '%hydrangea%' or lower(${stock.displayName}) like '%гортензи%'`
).orderBy(stock.createdAt);

console.log('=== STOCK ROWS (hydrangea) ===');
console.log(JSON.stringify(stockRows, null, 2));

if (stockRows.length === 0) {
  console.log('No hydrangea stock rows.');
  process.exit(0);
}

const ids = stockRows.map(r => r.id);
const atIds = stockRows.map(r => r.airtableId).filter(Boolean);
const allIdRefs = [...ids, ...atIds];

const lines = await db.select({
  id: orderLines.id,
  orderId: orderLines.orderId,
  stockItemId: orderLines.stockItemId,
  flowerName: orderLines.flowerName,
  quantity: orderLines.quantity,
  stockDeferred: orderLines.stockDeferred,
  createdAt: orderLines.createdAt,
  deletedAt: orderLines.deletedAt,
  orderStatus: orders.status,
  orderDate: orders.orderDate,
  appOrderId: orders.appOrderId,
}).from(orderLines)
  .leftJoin(orders, eq(orderLines.orderId, orders.id))
  .where(
    sql`${orderLines.stockItemId} in (${sql.join(allIdRefs.map(x => sql`${x}`), sql`, `)})
        or lower(${orderLines.flowerName}) like '%hydrangea%'
        or lower(${orderLines.flowerName}) like '%гортензи%'`
  )
  .orderBy(sql`${orderLines.createdAt} desc`)
  .limit(50);

console.log('\n=== ORDER_LINES touching hydrangea (last 50) ===');
console.log(JSON.stringify(lines, null, 2));

const premades = await db.select({
  id: premadeBouquetLines.id,
  bouquetId: premadeBouquetLines.bouquetId,
  stockId: premadeBouquetLines.stockId,
  stockAirtableId: premadeBouquetLines.stockAirtableId,
  flowerName: premadeBouquetLines.flowerName,
  quantity: premadeBouquetLines.quantity,
  bouquetStatus: premadeBouquets.status,
  bouquetName: premadeBouquets.name,
  bouquetCreatedAt: premadeBouquets.createdAt,
}).from(premadeBouquetLines)
  .leftJoin(premadeBouquets, eq(premadeBouquetLines.bouquetId, premadeBouquets.id))
  .where(
    sql`${premadeBouquetLines.stockId} in (${sql.join(ids.map(x => sql`${x}`), sql`, `)})
        or ${premadeBouquetLines.stockAirtableId} in (${sql.join(atIds.length ? atIds.map(x => sql`${x}`) : [sql`''`], sql`, `)})
        or lower(${premadeBouquetLines.flowerName}) like '%hydrangea%'
        or lower(${premadeBouquetLines.flowerName}) like '%гортензи%'`
  );

console.log('\n=== PREMADE LINES touching hydrangea ===');
console.log(JSON.stringify(premades, null, 2));

process.exit(0);
