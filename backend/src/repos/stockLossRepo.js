// Stock Loss Log repository — Phase 6 direct Postgres cutover.
// GET enriches each row with flower name + supplier via LEFT JOIN on stock table.
import { db } from '../db/index.js';
import { stockLossLog, stock } from '../db/schema.js';
import { and, isNull, gte, lte, eq, desc, sql, like } from 'drizzle-orm';

function toWire(row) {
  return {
    id:           row.id,
    Date:         row.date,
    Quantity:     Number(row.quantity || 0),
    Reason:       row.reason,
    Notes:        row.notes || '',
    // Return the Airtable ID when available (backward compat with frontends +
    // E2E tests that compare 'Stock Item' against the original recXXX ID).
    'Stock Item': row.stockAirtableId ? [row.stockAirtableId] : (row.stockId ? [row.stockId] : []),
    flowerName:   row.displayName || row.purchaseName || '—',
    supplier:     row.supplier    || '—',
    costPrice:    Number(row.costPrice || 0),
    lastRestocked: row.lastRestocked || null,
  };
}

const JOINED_FIELDS = {
  id:               stockLossLog.id,
  date:             stockLossLog.date,
  stockId:          stockLossLog.stockId,
  quantity:         stockLossLog.quantity,
  reason:           stockLossLog.reason,
  notes:            stockLossLog.notes,
  displayName:      stock.displayName,
  purchaseName:     stock.purchaseName,
  supplier:         stock.supplier,
  costPrice:        stock.currentCostPrice,
  lastRestocked:    stock.lastRestocked,
  stockAirtableId:  stock.airtableId,
};

async function enrichById(id) {
  const [row] = await db.select(JOINED_FIELDS).from(stockLossLog)
    .leftJoin(stock, eq(stockLossLog.stockId, stock.id))
    .where(eq(stockLossLog.id, id));
  return row ? toWire(row) : null;
}

export async function list({ from, to } = {}) {
  const conditions = [isNull(stockLossLog.deletedAt)];
  if (from) conditions.push(gte(stockLossLog.date, from));
  if (to)   conditions.push(lte(stockLossLog.date, to));

  const rows = await db.select(JOINED_FIELDS).from(stockLossLog)
    .leftJoin(stock, eq(stockLossLog.stockId, stock.id))
    .where(and(...conditions))
    .orderBy(desc(stockLossLog.date));

  return rows.map(toWire);
}

export async function getById(id) {
  const [row] = await db.select().from(stockLossLog).where(eq(stockLossLog.id, id));
  return row || null;
}

export async function create({ date, stockId, quantity, reason, notes }) {
  const values = {
    date: date || new Date().toISOString().split('T')[0],
    quantity: String(Number(quantity)),
    reason,
    notes: notes || '',
  };
  if (stockId) values.stockId = stockId;

  const [row] = await db.insert(stockLossLog).values(values).returning();
  return (await enrichById(row.id)) ?? toWire(row);
}

export async function update(id, { quantity, reason, notes, date }) {
  const updates = {};
  if (quantity != null) updates.quantity = String(Number(quantity));
  if (reason   != null) updates.reason   = reason;
  if (notes    != null) updates.notes    = notes;
  if (date     != null) updates.date     = date;
  const [row] = await db.update(stockLossLog).set(updates).where(eq(stockLossLog.id, id)).returning();
  if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
  return (await enrichById(row.id)) ?? toWire(row);
}

export async function remove(id) {
  await db.update(stockLossLog).set({ deletedAt: new Date() }).where(eq(stockLossLog.id, id));
}

// Idempotency: true if a loss row's notes contain this marker (ADR-0003
// write-off extension). Deliberately ignores deletedAt — "was ever recorded"
// is the idempotency question; a manually deleted row must not resurrect on
// PO evaluate retry.
export async function noteMarkerExists(marker) {
  const [row] = await db.select({ id: stockLossLog.id })
    .from(stockLossLog)
    .where(like(stockLossLog.notes, `%${marker}%`))
    .limit(1);
  return row != null;
}

// Distinct write-off reasons with counts, sorted by count desc, soft-deleted
// rows excluded. Used by the assistant list_values tool.
export async function distinctReasons() {
  if (!db) return [];
  const rows = await db
    .select({ value: stockLossLog.reason, count: sql`count(*)` })
    .from(stockLossLog)
    .where(and(isNull(stockLossLog.deletedAt), sql`${stockLossLog.reason} IS NOT NULL`))
    .groupBy(stockLossLog.reason)
    .orderBy(desc(sql`count(*)`));
  return rows.map(r => ({ value: r.value, count: Number(r.count) }));
}
