// Premade Bouquet repository — persistence boundary for Premade Bouquets + their lines.
// Phase 7. Postgres-only. Same dual-lookup + wire-format pattern as stockOrderRepo.

import { db } from '../db/index.js';
import { premadeBouquets, premadeBouquetLines } from '../db/schema.js';
import { eq, asc, desc, inArray } from 'drizzle-orm';

// ── Wire ↔ PG ──

export function bouquetToWire(row) {
  if (!row) return null;
  return {
    id:               row.airtableId || row.id,
    _pgId:            row.id,
    Name:             row.name,
    'Created By':     row.createdBy,
    'Price Override': row.priceOverride != null ? Number(row.priceOverride) : null,
    Notes:            row.notes,
    'Created At':     row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    Lines:            [],
  };
}

function bouquetToPg(fields) {
  const out = {};
  if ('Name' in fields)            out.name          = (fields.Name || '').trim();
  if ('Created By' in fields)      out.createdBy     = fields['Created By'] || '';
  if ('Price Override' in fields)  out.priceOverride = fields['Price Override'] != null ? String(fields['Price Override']) : null;
  if ('Notes' in fields)           out.notes         = fields.Notes || '';
  return out;
}

export function lineToWire(row) {
  if (!row) return null;
  return {
    id:                    row.airtableId || row.id,
    _pgId:                 row.id,
    'Premade Bouquets':    [row.bouquetId],
    'Stock Item':          row.stockAirtableId
                              ? [row.stockAirtableId]
                              : row.stockId ? [row.stockId] : [],
    'Flower Name':         row.flowerName,
    Quantity:              row.quantity,
    'Cost Price Per Unit': Number(row.costPricePerUnit),
    'Sell Price Per Unit': Number(row.sellPricePerUnit),
  };
}

function lineToPg(fields) {
  const out = {};
  if ('Flower Name' in fields)         out.flowerName        = fields['Flower Name'] || '';
  if ('Quantity' in fields)            out.quantity          = Number(fields.Quantity) || 0;
  if ('Cost Price Per Unit' in fields) out.costPricePerUnit  = String(Number(fields['Cost Price Per Unit']) || 0);
  if ('Sell Price Per Unit' in fields) out.sellPricePerUnit  = String(Number(fields['Sell Price Per Unit']) || 0);
  if ('Stock Item' in fields) {
    const raw = Array.isArray(fields['Stock Item']) ? fields['Stock Item'][0] : null;
    out.stockId = null;
    out.stockAirtableId = null;
    if (raw) {
      if (raw.startsWith('rec')) out.stockAirtableId = raw;
      else                       out.stockId         = raw;
    }
  }
  return out;
}

async function findBouquetPgByAirtableOrUuid(id) {
  if (!id || !db) return null;
  const isAtId = typeof id === 'string' && id.startsWith('rec');
  const where = isAtId ? eq(premadeBouquets.airtableId, id) : eq(premadeBouquets.id, id);
  const [row] = await db.select().from(premadeBouquets).where(where).limit(1);
  return row ?? null;
}

async function findLinePgByAirtableOrUuid(id) {
  if (!id || !db) return null;
  const isAtId = typeof id === 'string' && id.startsWith('rec');
  const where = isAtId ? eq(premadeBouquetLines.airtableId, id) : eq(premadeBouquetLines.id, id);
  const [row] = await db.select().from(premadeBouquetLines).where(where).limit(1);
  return row ?? null;
}

// ── Bouquet CRUD ──

export async function list() {
  if (!db) return [];
  const rows = await db.select().from(premadeBouquets).orderBy(desc(premadeBouquets.createdAt));
  return rows.map(bouquetToWire);
}

export async function getById(id) {
  const row = await findBouquetPgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Premade bouquet ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  return bouquetToWire(row);
}

export async function create(fields) {
  if (!db) throw new Error('premadeBouquetRepo.create: no DATABASE_URL configured');
  const values = bouquetToPg(fields);
  if (!values.name) throw new Error('premadeBouquetRepo.create: name required');
  const [row] = await db.insert(premadeBouquets).values(values).returning();
  return bouquetToWire(row);
}

export async function update(id, fields) {
  const row = await findBouquetPgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Premade bouquet ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  const patch = bouquetToPg(fields);
  if (Object.keys(patch).length === 0) return bouquetToWire(row);
  const [updated] = await db.update(premadeBouquets).set(patch)
    .where(eq(premadeBouquets.id, row.id)).returning();
  return bouquetToWire(updated);
}

export async function deleteById(id) {
  const row = await findBouquetPgByAirtableOrUuid(id);
  if (!row) return;
  await db.delete(premadeBouquets).where(eq(premadeBouquets.id, row.id));
  // CASCADE deletes lines.
}

// ── Line CRUD ──

export async function createLine(fields) {
  if (!db) throw new Error('premadeBouquetRepo.createLine: no DATABASE_URL configured');
  const ref = Array.isArray(fields['Premade Bouquets']) ? fields['Premade Bouquets'][0] : null;
  if (!ref) throw new Error('createLine: missing Premade Bouquets link');
  const bouquet = await findBouquetPgByAirtableOrUuid(ref);
  if (!bouquet) throw new Error(`createLine: bouquet ${ref} not found`);
  const values = { bouquetId: bouquet.id, ...lineToPg(fields) };
  const [row] = await db.insert(premadeBouquetLines).values(values).returning();
  return lineToWire(row);
}

export async function getLineById(id) {
  const row = await findLinePgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Premade bouquet line ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  return lineToWire(row);
}

export async function getLinesByBouquetId(bouquetId) {
  if (!db) return [];
  const isAtId = typeof bouquetId === 'string' && bouquetId.startsWith('rec');
  let pgId = bouquetId;
  if (isAtId) {
    const b = await findBouquetPgByAirtableOrUuid(bouquetId);
    pgId = b?.id;
    if (!pgId) return [];
  }
  const rows = await db.select().from(premadeBouquetLines)
    .where(eq(premadeBouquetLines.bouquetId, pgId))
    .orderBy(asc(premadeBouquetLines.createdAt));
  return rows.map(lineToWire);
}

// Used by /stock/:id PATCH cascade and orderService.createOrder price-sync.
// Returns all lines whose stock matches the given id (recXXX or uuid).
export async function getLinesByStockId(stockId) {
  if (!stockId || !db) return [];
  const isAtId = typeof stockId === 'string' && stockId.startsWith('rec');
  const rows = await db.select().from(premadeBouquetLines)
    .where(isAtId
      ? eq(premadeBouquetLines.stockAirtableId, stockId)
      : eq(premadeBouquetLines.stockId, stockId));
  return rows.map(lineToWire);
}

export async function updateLine(id, fields) {
  const row = await findLinePgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Premade bouquet line ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  const patch = lineToPg(fields);
  if (Object.keys(patch).length === 0) return lineToWire(row);
  const [updated] = await db.update(premadeBouquetLines).set(patch)
    .where(eq(premadeBouquetLines.id, row.id)).returning();
  return lineToWire(updated);
}

export async function deleteLineById(id) {
  const row = await findLinePgByAirtableOrUuid(id);
  if (!row) return;
  await db.delete(premadeBouquetLines).where(eq(premadeBouquetLines.id, row.id));
}
