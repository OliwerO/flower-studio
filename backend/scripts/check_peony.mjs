import { db } from '../src/db/index.js';
import { stock } from '../src/db/schema.js';
import { sql, like, or } from 'drizzle-orm';

const rows = await db.select({
  id: stock.id,
  airtableId: stock.airtableId,
  displayName: stock.displayName,
  currentQuantity: stock.currentQuantity,
  active: stock.active,
  deletedAt: stock.deletedAt,
  createdAt: stock.createdAt,
}).from(stock).where(
  or(
    sql`lower(${stock.displayName}) like '%peony%'`,
    sql`lower(${stock.displayName}) like '%paeonia%'`,
    sql`lower(${stock.displayName}) like '%coral%'`
  )
).orderBy(stock.displayName, stock.createdAt);

console.log(JSON.stringify(rows, null, 2));
process.exit(0);
