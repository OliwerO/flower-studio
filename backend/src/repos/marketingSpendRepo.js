// Marketing Spend repository — Phase 6 direct Postgres cutover.
import { db } from '../db/index.js';
import { marketingSpend } from '../db/schema.js';
import { and, isNull, gte, lt, desc } from 'drizzle-orm';

function toWire(row) {
  return {
    id:      row.id,
    Month:   row.month,
    Channel: row.channel,
    Amount:  Number(row.amount || 0),
    Notes:   row.notes || '',
  };
}

export async function list({ from, to } = {}) {
  const conditions = [isNull(marketingSpend.deletedAt)];
  if (from) conditions.push(gte(marketingSpend.month, `${from}-01`));
  if (to) {
    const [y, m] = to.split('-').map(Number);
    const d = new Date(y, m, 1); // first day of next month (Date month is 0-based, so m = next month)
    const nextMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    conditions.push(lt(marketingSpend.month, nextMonth));
  }
  const rows = await db.select().from(marketingSpend).where(and(...conditions)).orderBy(desc(marketingSpend.month));
  return rows.map(toWire);
}

export async function create({ month, channel, amount, notes }) {
  const [row] = await db.insert(marketingSpend).values({
    month, channel: channel.trim(), amount: String(amount), notes: notes || '',
  }).returning();
  return toWire(row);
}
