import { db } from '../db/index.js';
import { stockPurchases } from '../db/schema.js';
import { eq, and, like, desc } from 'drizzle-orm';

function toWire(row) {
  return {
    id:                  row.id,
    airtableId:          row.airtableId || null,
    'Purchase Date':     row.purchaseDate,
    Supplier:            row.supplier || '',
    Flower:              row.stockAirtableId
                           ? [row.stockAirtableId]
                           : row.stockId ? [row.stockId] : [],
    'Quantity Purchased': Number(row.quantityPurchased || 0),
    'Price Per Unit':    row.pricePerUnit != null ? Number(row.pricePerUnit) : null,
    Notes:               row.notes || '',
  };
}

export async function create({ purchaseDate, supplier, stockId, stockAirtableId, quantityPurchased, pricePerUnit, notes }) {
  const values = {
    purchaseDate: purchaseDate || new Date().toISOString().split('T')[0],
    supplier:     supplier || '',
    quantityPurchased: Number(quantityPurchased) || 0,
    notes:        notes || '',
  };
  if (stockId)          values.stockId         = stockId;
  if (stockAirtableId)  values.stockAirtableId = stockAirtableId;
  if (pricePerUnit != null) values.pricePerUnit = String(pricePerUnit);

  const [row] = await db.insert(stockPurchases).values(values).returning();
  return toWire(row);
}

// Returns true when a row whose Notes field contains `marker` already exists.
// Used by PO evaluation for idempotency — prevent double-crediting on retry.
export async function noteMarkerExists(marker) {
  const [row] = await db.select({ id: stockPurchases.id })
    .from(stockPurchases)
    .where(like(stockPurchases.notes, `%${marker}%`))
    .limit(1);
  return row != null;
}

// Returns the purchase_date of the first row whose Notes contains `marker`.
// Used by PO evaluate retry to recover the original evalDate.
export async function findDateByPoMarker(poId) {
  const marker = `PO #${poId}`;
  const [row] = await db.select({ purchaseDate: stockPurchases.purchaseDate })
    .from(stockPurchases)
    .where(like(stockPurchases.notes, `%${marker}%`))
    .orderBy(desc(stockPurchases.createdAt))
    .limit(1);
  return row?.purchaseDate || null;
}
