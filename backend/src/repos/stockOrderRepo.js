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
  if ('Supplier Payments' in fields) out.supplierPayments = fields['Supplier Payments'] || '';
  if ('Driver Payment' in fields)    out.driverPayment    = fields['Driver Payment'] || '';
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
    const n = parseInt(tail, 10);
    if (!isNaN(n) && n > maxN) maxN = n;
  }
  return maxN + 1;
}
