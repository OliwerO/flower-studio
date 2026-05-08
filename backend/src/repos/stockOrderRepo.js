// Stock Order repository — persistence boundary for Stock Orders + their lines.
// Phase 7 of the SQL migration. Postgres-only — no shadow window, direct cutover.
//
// Wire format: routes/services pass Airtable-shaped fields ({ Status, 'Stock Order ID', ... })
// and receive the same shape back. The repo translates to/from snake_case PG columns.
//
// id semantics: returned `id` is `airtableId || uuid` so callers carrying recXXX
// IDs from before the cutover keep working. `_pgId` carries the UUID for new
// callers that want it. getById() / updateLine() / deleteLineById() all accept
// either form and disambiguate by the 'rec' prefix.

import { db } from '../db/index.js';
import { stockOrders, stockOrderLines } from '../db/schema.js';
import { eq, and, desc, asc, sql, inArray } from 'drizzle-orm';

// ── Wire ↔ PG mapping ──

export function poToWire(row) {
  if (!row) return null;
  return {
    id:                  row.airtableId || row.id,
    _pgId:               row.id,
    Status:              row.status,
    'Stock Order ID':    row.poNumber,
    'Created Date':      row.createdDate,
    'Assigned Driver':   row.assignedDriver,
    'Planned Date':      row.plannedDate || null,
    Notes:               row.notes,
    'Supplier Payments': row.supplierPayments,
    'Driver Payment':    row.driverPayment,
    'Order Lines':       [],
  };
}

function poToPg(fields) {
  const out = {};
  if ('Status' in fields)            out.status           = fields.Status || 'Draft';
  if ('Stock Order ID' in fields)    out.poNumber         = fields['Stock Order ID'] || '';
  if ('Created Date' in fields)      out.createdDate      = fields['Created Date'] || '';
  if ('Assigned Driver' in fields)   out.assignedDriver   = fields['Assigned Driver'] || '';
  if ('Planned Date' in fields)      out.plannedDate      = fields['Planned Date'] || null;
  if ('Notes' in fields)             out.notes            = fields.Notes || '';
  if ('Supplier Payments' in fields) out.supplierPayments = String(fields['Supplier Payments'] ?? '');
  if ('Driver Payment' in fields)    out.driverPayment    = String(fields['Driver Payment'] ?? '');
  return out;
}

async function findPgByAirtableOrUuid(id) {
  if (!id || !db) return null;
  const isAtId = typeof id === 'string' && id.startsWith('rec');
  const where = isAtId ? eq(stockOrders.airtableId, id) : eq(stockOrders.id, id);
  const [row] = await db.select().from(stockOrders).where(where).limit(1);
  return row ?? null;
}

// ── Header CRUD ──

export async function list({ status, role, driverName } = {}) {
  if (!db) throw new Error('stockOrderRepo.list: no DATABASE_URL configured');
  const filters = [];
  if (status) filters.push(eq(stockOrders.status, status));
  if (role === 'driver' && driverName) {
    filters.push(eq(stockOrders.assignedDriver, driverName));
  }
  const rows = await db.select().from(stockOrders)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(stockOrders.createdAt));
  return rows.map(poToWire);
}

// Bulk fetch by airtableId or uuid — accepts mixed arrays.
export async function listByIds(ids) {
  if (!ids?.length || !db) return [];
  const recs = ids.filter(x => typeof x === 'string' && x.startsWith('rec'));
  const uuids = ids.filter(x => typeof x === 'string' && !x.startsWith('rec'));
  const orParts = [];
  if (recs.length)  orParts.push(inArray(stockOrders.airtableId, recs));
  if (uuids.length) orParts.push(inArray(stockOrders.id, uuids));
  if (!orParts.length) return [];
  const where = orParts.length === 1 ? orParts[0] : sql`(${orParts[0]} OR ${orParts[1]})`;
  const rows = await db.select().from(stockOrders).where(where);
  return rows.map(poToWire);
}

export async function getById(id) {
  const row = await findPgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Stock Order ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  return poToWire(row);
}

export async function create(fields) {
  if (!db) throw new Error('stockOrderRepo.create: no DATABASE_URL configured');
  const values = poToPg(fields);
  if (!values.createdDate) values.createdDate = new Date().toISOString().split('T')[0];
  const [row] = await db.insert(stockOrders).values(values).returning();
  return poToWire(row);
}

export async function update(id, fields) {
  const row = await findPgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Stock Order ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  const patch = poToPg(fields);
  if (Object.keys(patch).length === 0) return poToWire(row);
  const [updated] = await db.update(stockOrders).set(patch)
    .where(eq(stockOrders.id, row.id)).returning();
  return poToWire(updated);
}

export async function deleteById(id) {
  const row = await findPgByAirtableOrUuid(id);
  if (!row) return;
  await db.delete(stockOrders).where(eq(stockOrders.id, row.id));
  // ON DELETE CASCADE handles stock_order_lines.
}

// PO number sequence: MAX(N)+1 of existing PO-YYYYMMDD-N values for the date.
// MAX-based (not COUNT-based) so backfilled historical POs that share today's
// date don't corrupt the sequence for newly created POs.
export async function nextPoSequence(date /* YYYY-MM-DD */) {
  if (!db) throw new Error('stockOrderRepo.nextPoSequence: no DATABASE_URL configured');
  const prefix = `PO-${date.replace(/-/g, '')}-`;
  const rows = await db.select({ poNumber: stockOrders.poNumber })
    .from(stockOrders)
    .where(sql`${stockOrders.poNumber} LIKE ${prefix + '%'}`);
  let maxN = 0;
  for (const r of rows) {
    const tail = r.poNumber.slice(prefix.length);
    if (!/^\d+$/.test(tail)) continue;
    const n = parseInt(tail, 10);
    if (n > maxN) maxN = n;
  }
  return maxN + 1;
}

// ── Line CRUD ──

export function lineToWire(row) {
  if (!row) return null;
  return {
    id:                    row.airtableId || row.id,
    _pgId:                 row.id,
    'Stock Orders':        [row.poId],
    'Stock Item':          row.stockAirtableId
                              ? [row.stockAirtableId]
                              : row.stockId ? [row.stockId] : [],
    'Flower Name':         row.flowerName,
    'Quantity Needed':     row.quantityNeeded,
    'Quantity Found':      row.quantityFound,
    'Lot Size':            row.lotSize,
    'Driver Status':       row.driverStatus,
    Supplier:              row.supplier,
    'Cost Price':          Number(row.costPrice),
    'Sell Price':          Number(row.sellPrice),
    Farmer:                row.farmer,
    Notes:                 row.notes,
    'Alt Flower Name':     row.substituteFlowerName,
    'Alt Flower Status':   row.substituteStatus,
    'Alt Quantity Found':  row.substituteQuantityFound,
    'Alt Cost':            Number(row.substituteCost),
    'Alt Supplier':        row.substituteSupplier,
    'Quantity Accepted':   row.quantityAccepted,
    'Write Off Qty':       row.writeOffQty,
    'Eval Status':         row.evalStatus,
  };
}

function lineToPg(fields) {
  const out = {};
  if ('Flower Name' in fields)         out.flowerName               = fields['Flower Name'] || '';
  if ('Quantity Needed' in fields)     out.quantityNeeded           = Number(fields['Quantity Needed']) || 0;
  if ('Quantity Found' in fields)      out.quantityFound            = Number(fields['Quantity Found']) || 0;
  if ('Lot Size' in fields)            out.lotSize                  = Number(fields['Lot Size']) || 0;
  if ('Driver Status' in fields)       out.driverStatus             = fields['Driver Status'] || 'Pending';
  if ('Supplier' in fields)            out.supplier                 = fields.Supplier || '';
  if ('Cost Price' in fields)          out.costPrice                = String(Number(fields['Cost Price']) || 0);
  if ('Sell Price' in fields)          out.sellPrice                = String(Number(fields['Sell Price']) || 0);
  if ('Farmer' in fields)              out.farmer                   = fields.Farmer || '';
  if ('Notes' in fields)               out.notes                    = fields.Notes || '';
  if ('Alt Flower Name' in fields)     out.substituteFlowerName     = fields['Alt Flower Name'] || '';
  if ('Alt Flower Status' in fields)   out.substituteStatus         = fields['Alt Flower Status'] || '';
  if ('Alt Quantity Found' in fields)  out.substituteQuantityFound  = Number(fields['Alt Quantity Found']) || 0;
  if ('Alt Cost' in fields)            out.substituteCost           = String(Number(fields['Alt Cost']) || 0);
  if ('Alt Supplier' in fields)        out.substituteSupplier       = fields['Alt Supplier'] || '';
  if ('Quantity Accepted' in fields)   out.quantityAccepted         = Number(fields['Quantity Accepted']) || 0;
  if ('Write Off Qty' in fields)       out.writeOffQty              = Number(fields['Write Off Qty']) || 0;
  if ('Eval Status' in fields)         out.evalStatus               = fields['Eval Status'] || '';
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

async function findLinePgByAirtableOrUuid(id) {
  if (!id || !db) return null;
  const isAtId = typeof id === 'string' && id.startsWith('rec');
  const where = isAtId ? eq(stockOrderLines.airtableId, id) : eq(stockOrderLines.id, id);
  const [row] = await db.select().from(stockOrderLines).where(where).limit(1);
  return row ?? null;
}

export async function createLine(fields) {
  if (!db) throw new Error('stockOrderRepo.createLine: no DATABASE_URL configured');
  const poRef = Array.isArray(fields['Stock Orders']) ? fields['Stock Orders'][0] : null;
  if (!poRef) throw new Error('createLine: missing Stock Orders link');
  const po = await findPgByAirtableOrUuid(poRef);
  if (!po) throw new Error(`createLine: PO ${poRef} not found`);
  const values = { poId: po.id, ...lineToPg(fields) };
  const [row] = await db.insert(stockOrderLines).values(values).returning();
  return lineToWire(row);
}

export async function getLineById(id) {
  const row = await findLinePgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Stock Order Line ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  return lineToWire(row);
}

export async function getLinesByPoId(poId) {
  if (!db) return [];
  const isAtId = typeof poId === 'string' && poId.startsWith('rec');
  let pgPoId = poId;
  if (isAtId) {
    const po = await findPgByAirtableOrUuid(poId);
    pgPoId = po?.id;
    if (!pgPoId) return [];
  }
  const rows = await db.select().from(stockOrderLines)
    .where(eq(stockOrderLines.poId, pgPoId))
    .orderBy(asc(stockOrderLines.createdAt));
  return rows.map(lineToWire);
}

// Bulk fetch lines across multiple POs — for /stock-orders?include=lines
// and /pending-po. Returns lines grouped under each PO id.
export async function getLinesForPos(poIds) {
  if (!poIds?.length || !db) return new Map();
  const recs = poIds.filter(x => typeof x === 'string' && x.startsWith('rec'));
  const uuids = poIds.filter(x => typeof x === 'string' && !x.startsWith('rec'));

  // Resolve recXXX → uuid
  let pgIds = [...uuids];
  if (recs.length) {
    const resolved = await db.select({ id: stockOrders.id, airtableId: stockOrders.airtableId })
      .from(stockOrders).where(inArray(stockOrders.airtableId, recs));
    pgIds.push(...resolved.map(r => r.id));
  }
  if (!pgIds.length) return new Map();

  const rows = await db.select().from(stockOrderLines)
    .where(inArray(stockOrderLines.poId, pgIds))
    .orderBy(asc(stockOrderLines.createdAt));

  const byPo = new Map();
  for (const r of rows) {
    if (!byPo.has(r.poId)) byPo.set(r.poId, []);
    byPo.get(r.poId).push(lineToWire(r));
  }
  return byPo;
}

export async function updateLine(id, fields) {
  const row = await findLinePgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Stock Order Line ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  const patch = lineToPg(fields);
  if (Object.keys(patch).length === 0) return lineToWire(row);
  const [updated] = await db.update(stockOrderLines).set(patch)
    .where(eq(stockOrderLines.id, row.id)).returning();
  return lineToWire(updated);
}

export async function deleteLineById(id) {
  const row = await findLinePgByAirtableOrUuid(id);
  if (!row) return;
  await db.delete(stockOrderLines).where(eq(stockOrderLines.id, row.id));
}
