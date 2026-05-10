// Stock repository — the persistence boundary for Stock records.
//
// Phase 3 of the SQL migration completed in Phase 7 PR 2b (2026-05-09).
// Postgres-only. Airtable infrastructure deleted; see CHANGELOG for details.
//
// Wire format: methods return Airtable-shaped records ({ id, 'Display Name',
// 'Current Quantity', ... }) so routes + frontends need no changes.
// The PG row's UUID is exposed as `_pgId`.
//
// `id` semantics:
//   - returned `id` is the airtableId if known (so existing callers
//     carrying recXXX values keep working), else the PG uuid.
//   - getById(id) accepts either form and disambiguates by the `rec` prefix.

import { pickAllowed } from '../utils/fields.js';
import { db } from '../db/index.js';
import { stock, orderLines, premadeBouquetLines } from '../db/schema.js';
import { recordAudit } from '../db/audit.js';
import { and, eq, ilike, isNull, inArray, gt, sql } from 'drizzle-orm';

/**
 * Resolves the demand date for a new Demand Entry from order data.
 * Fallback chain: Required By → Order Date → today.
 * @param {{ requiredBy?: string, orderDate?: string }} [order]
 * @returns {string} YYYY-MM-DD
 */
export function computeDemandDate(order) {
  if (order?.requiredBy) return order.requiredBy;
  if (order?.orderDate)  return order.orderDate;
  return new Date().toISOString().split('T')[0];
}

/**
 * Get or create a Demand Entry for (varietyKey, date).
 * Must be called inside an outer db.transaction — `tx` is required.
 *
 * @param {{ typeName: string, colour?: string|null, sizeCm?: number|null, cultivar?: string|null }} varietyKey
 * @param {string} date - YYYY-MM-DD
 * @param {number} qty  - positive number; stored as negative (demand is negative qty)
 * @param {object} tx   - Drizzle transaction handle
 * @param {object} [actor]
 * @returns {Promise<object>} pgToResponse(row)
 */
export async function getOrCreateDemandEntry(varietyKey, date, qty, tx, actor = { actorRole: 'system', actorPinLabel: null }) {
  const { typeName, colour = null, sizeCm = null, cultivar = null } = varietyKey ?? {};

  if (!typeName) {
    throw Object.assign(new Error('typeName is required for Demand Entry'), { statusCode: 400 });
  }
  if (!date) {
    throw Object.assign(new Error('date is required for Demand Entry'), { statusCode: 400 });
  }

  // Build the display name per ADR-0006:
  // "<Type> <Colour> <Size>cm <Cultivar?> (<Date>)"
  const parts = [typeName];
  if (colour)   parts.push(colour);
  if (sizeCm)   parts.push(`${sizeCm}cm`);
  if (cultivar) parts.push(cultivar);
  parts.push(`(${date})`);
  const displayName = parts.join(' ');

  // NULL-aware equality for the WHERE clause.
  // Drizzle's eq() uses = which is false for NULLs; isNull() needed for optional attrs.
  const varietyWhere = and(
    eq(stock.typeName, typeName),
    colour   ? eq(stock.colour, colour)     : isNull(stock.colour),
    sizeCm   ? eq(stock.sizeCm, sizeCm)     : isNull(stock.sizeCm),
    cultivar ? eq(stock.cultivar, cultivar) : isNull(stock.cultivar),
    eq(stock.date, date),
    sql`${stock.currentQuantity} < 0`,
    isNull(stock.deletedAt),
  );

  // Check for existing DE.
  // Note: SELECT FOR UPDATE is NOT used here — pglite doesn't support it.
  // Concurrency safety comes from the partial unique index (violating it on
  // a concurrent INSERT triggers a conflict). Production PG row-level locks on
  // the UPDATE statement provide sufficient isolation for the sum-on-reuse path.
  const [existing] = await tx.select().from(stock).where(varietyWhere).limit(1);

  if (existing) {
    // Sum qty: deepen the existing Demand Entry.
    const [after] = await tx.update(stock)
      .set({
        currentQuantity: sql`${stock.currentQuantity} - ${qty}`,
        displayName,
        updatedAt: new Date(),
      })
      .where(eq(stock.id, existing.id))
      .returning();
    await tryAudit(tx, {
      entityType: 'stock', entityId: after.id, action: 'update',
      before: { 'Current Quantity': existing.currentQuantity },
      after:  { 'Current Quantity': after.currentQuantity },
      ...actor,
    });
    return pgToResponse(after);
  }

  // Create new Demand Entry.
  const [row] = await tx.insert(stock).values({
    displayName,
    currentQuantity: -qty,
    active:   true,
    typeName,
    colour:   colour   ?? null,
    sizeCm:   sizeCm   ?? null,
    cultivar: cultivar ?? null,
    date,
  }).returning();
  await tryAudit(tx, {
    entityType: 'stock', entityId: row.id, action: 'create',
    before: null, after: pgToResponse(row), ...actor,
  });
  return pgToResponse(row);
}

/**
 * Cascade a Required By change to the linked Demand Entry's date column.
 *
 * Sole-owner path: update date in place. order_line FK unchanged.
 * Shared path: create/deepen a new DE for newDate, point order_line at it,
 *   decrement old DE qty by the line's quantity (split the demand).
 *
 * @param {string} orderLineId - UUID of the order_line row
 * @param {string} newDate     - new YYYY-MM-DD date
 * @param {object} tx          - Drizzle transaction handle (required)
 * @param {object} [actor]
 * @returns {Promise<{ demandEntryId: string, action: 'updated-in-place' | 'split' } | null>}
 */
export async function updateDemandEntryDate(orderLineId, newDate, tx, actor = { actorRole: 'system', actorPinLabel: null }) {
  // 1. Fetch the order_line to find stockItemId + qty
  const [line] = await tx.select().from(orderLines)
    .where(and(eq(orderLines.id, orderLineId), isNull(orderLines.deletedAt)))
    .limit(1);
  if (!line) {
    throw Object.assign(new Error(`order_line not found: ${orderLineId}`), { statusCode: 404 });
  }

  const deId = line.stockItemId;
  if (!deId) return null; // no linked DE (stock-deferred or orphan line)

  // 2. Fetch the linked stock row — must be a Demand Entry (qty < 0)
  const [de] = await tx.select().from(stock)
    .where(and(eq(stock.id, deId), isNull(stock.deletedAt), sql`${stock.currentQuantity} < 0`))
    .limit(1);
  if (!de) return null; // linked stock is a Batch (qty >= 0), not a DE — nothing to cascade

  // 3. Count other order_lines pointing at the same DE
  const sharingLines = await tx.select({ id: orderLines.id }).from(orderLines)
    .where(and(
      eq(orderLines.stockItemId, deId),
      sql`${orderLines.id}::text != ${orderLineId}`,
      isNull(orderLines.deletedAt),
    ));

  if (sharingLines.length === 0) {
    // Sole owner — update date in place
    const [after] = await tx.update(stock)
      .set({ date: newDate, updatedAt: new Date() })
      .where(eq(stock.id, de.id))
      .returning();
    await tryAudit(tx, {
      entityType: 'stock', entityId: after.id, action: 'update',
      before: { date: de.date }, after: { date: after.date }, ...actor,
    });
    return { demandEntryId: after.id, action: 'updated-in-place' };
  }

  // Shared — split: create/deepen DE for newDate, move this line's demand
  const lineQty = Math.abs(Number(line.quantity) || 0);
  const varietyKey = {
    typeName: de.typeName,
    colour:   de.colour,
    sizeCm:   de.sizeCm,
    cultivar: de.cultivar,
  };
  const newDe = await getOrCreateDemandEntry(varietyKey, newDate, lineQty, tx, actor);

  // Decrement old DE by lineQty (return its share back toward zero)
  const [oldAfter] = await tx.update(stock)
    .set({ currentQuantity: sql`${stock.currentQuantity} + ${lineQty}`, updatedAt: new Date() })
    .where(eq(stock.id, de.id))
    .returning();
  await tryAudit(tx, {
    entityType: 'stock', entityId: oldAfter.id, action: 'update',
    before: { 'Current Quantity': de.currentQuantity },
    after:  { 'Current Quantity': oldAfter.currentQuantity },
    ...actor,
  });

  // Update order_line to point at new DE (stockItemId is text in schema)
  await tx.update(orderLines)
    .set({ stockItemId: newDe._pgId, updatedAt: new Date() })
    .where(eq(orderLines.id, orderLineId));

  return { demandEntryId: newDe._pgId, action: 'split' };
}

// ── Backend mode stub ──
// getBackendMode is always 'postgres' post-Phase-7. Kept until Tasks 3+4
// remove the callers in orderService.js and wix.js.
/** @deprecated Remove after Task 3+4 clean up orderService.js / wix.js */
export function getBackendMode() { return 'postgres'; }

// ── PATCH allowlist (Airtable display names) ──
// Mirror routes/stock.js — anything outside this list is silently dropped on
// create/update. Display Name is required on create; only the allowlist runs
// for update.
export const STOCK_WRITE_ALLOWED = [
  'Display Name', 'Purchase Name', 'Category', 'Current Quantity', 'Unit',
  'Current Cost Price', 'Current Sell Price', 'Supplier', 'Reorder Threshold',
  'Active', 'Supplier Notes', 'Dead/Unsold Stems', 'Lot Size', 'Farmer',
  'Last Restocked', 'Substitute For',
];

// ── Wire-format ↔ PG-row mapping ──

// PG row → Airtable-shaped response. The frontend can't tell the difference.
// `_pgId` carries the UUID for new code that wants it; `id` keeps the recXXX
// during the cutover window so cached caller state stays valid.
export function pgToResponse(row) {
  if (!row) return null;
  return {
    id: row.airtableId || row.id,
    _pgId: row.id,
    'Display Name':       row.displayName,
    'Purchase Name':      row.purchaseName ?? null,
    Category:             row.category ?? null,
    'Current Quantity':   row.currentQuantity,
    Unit:                 row.unit ?? null,
    'Current Cost Price': row.currentCostPrice != null ? Number(row.currentCostPrice) : null,
    'Current Sell Price': row.currentSellPrice != null ? Number(row.currentSellPrice) : null,
    Supplier:             row.supplier ?? null,
    'Reorder Threshold':  row.reorderThreshold ?? null,
    Active:               row.active,
    'Supplier Notes':     row.supplierNotes ?? null,
    'Dead/Unsold Stems':  row.deadStems,
    'Lot Size':           row.lotSize ?? null,
    Farmer:               row.farmer ?? null,
    'Last Restocked':     row.lastRestocked ?? null,
    'Substitute For':     row.substituteFor ?? [],
    // Stock Y-model identity columns (issue #284 / #292)
    Type:                 row.typeName ?? null,
    Colour:               row.colour ?? null,
    Size:                 row.sizeCm ?? null,
    Cultivar:             row.cultivar ?? null,
  };
}

// Airtable-shaped fields → PG column object (only the keys present in the
// input survive — partial updates work). Numerics stored as strings to keep
// drizzle/pg from coercing precision.
export function responseToPg(fields) {
  const out = {};
  if ('Display Name' in fields)       out.displayName       = fields['Display Name'];
  if ('Purchase Name' in fields)      out.purchaseName      = fields['Purchase Name'] || null;
  if ('Category' in fields)           out.category          = fields.Category || null;
  if ('Current Quantity' in fields)   out.currentQuantity   = Number(fields['Current Quantity']) || 0;
  if ('Unit' in fields)               out.unit              = fields.Unit || null;
  if ('Current Cost Price' in fields) out.currentCostPrice  = fields['Current Cost Price'] != null ? String(fields['Current Cost Price']) : null;
  if ('Current Sell Price' in fields) out.currentSellPrice  = fields['Current Sell Price'] != null ? String(fields['Current Sell Price']) : null;
  if ('Supplier' in fields)           out.supplier          = fields.Supplier || null;
  if ('Reorder Threshold' in fields)  out.reorderThreshold  = fields['Reorder Threshold'] != null ? Number(fields['Reorder Threshold']) : null;
  if ('Active' in fields)             out.active            = Boolean(fields.Active);
  if ('Supplier Notes' in fields)     out.supplierNotes     = fields['Supplier Notes'] || null;
  if ('Dead/Unsold Stems' in fields)  out.deadStems         = Number(fields['Dead/Unsold Stems']) || 0;
  if ('Lot Size' in fields)           out.lotSize           = fields['Lot Size'] != null ? Number(fields['Lot Size']) : null;
  if ('Farmer' in fields)             out.farmer            = fields.Farmer || null;
  if ('Last Restocked' in fields)     out.lastRestocked     = fields['Last Restocked'] || null;
  if ('Substitute For' in fields)     out.substituteFor     = Array.isArray(fields['Substitute For']) ? fields['Substitute For'] : null;
  return out;
}

// ── Internal helpers ──

// Resolve an incoming id (recXXX or uuid) to a PG row.
//
// `handle` lets the caller pass a transaction (`tx`) so the lookup runs on
// the same connection that holds the surrounding write. Passing the
// top-level `db` from inside a transaction would deadlock under
// single-connection drivers (pglite) and contend for connections under
// pooled drivers — both are real failure modes.
async function findPgByAirtableOrUuid(id, handle = db) {
  if (!id || !handle) return null;
  const isAirtableId = typeof id === 'string' && id.startsWith('rec');
  const where = isAirtableId
    ? and(eq(stock.airtableId, id), isNull(stock.deletedAt))
    : and(eq(stock.id, id), isNull(stock.deletedAt));
  const [row] = await handle.select().from(stock).where(where).limit(1);
  return row ?? null;
}

// Audit helper that swallows errors. Production callers should always pass
// a real actor.
async function tryAudit(tx, args) {
  try {
    await recordAudit(tx, args);
  } catch (err) {
    console.error('[stockRepo] audit write failed:', err.message);
  }
}

// ── List ──
//
// PG shape: `{ pg: { active?, includeEmpty?, includeInactive?, category?,
//   ids? }, sort?: [{ field, direction }] }`. Reads always from Postgres.
export async function list(options = {}) {
  return listFromPg(options);
}

async function listFromPg(options = {}) {
  if (!db) throw new Error('stockRepo.list: postgres backend selected but DATABASE_URL not configured');

  const filters = [isNull(stock.deletedAt)];
  const pg = options.pg || {};
  if (pg.includeInactive !== true) filters.push(eq(stock.active, true));
  if (pg.includeEmpty !== true)    filters.push(gt(stock.currentQuantity, 0));
  if (pg.category)                 filters.push(eq(stock.category, String(pg.category)));
  if (pg.displayName)              filters.push(ilike(stock.displayName, String(pg.displayName)));
  if (Array.isArray(pg.ids) && pg.ids.length) {
    // Accept either airtable ids or uuids in the same array.
    const recs = pg.ids.filter(x => typeof x === 'string' && x.startsWith('rec'));
    const uuids = pg.ids.filter(x => typeof x === 'string' && !x.startsWith('rec'));
    const orParts = [];
    if (recs.length)  orParts.push(inArray(stock.airtableId, recs));
    if (uuids.length) orParts.push(inArray(stock.id, uuids));
    if (orParts.length === 1) filters.push(orParts[0]);
    if (orParts.length === 2) filters.push(sql`(${orParts[0]} OR ${orParts[1]})`);
  }

  let q = db.select().from(stock).where(and(...filters));

  // Sort — translate the small set of fields routes use today.
  const orderBy = [];
  for (const s of (options.sort || [])) {
    const col = SORT_FIELD_MAP[s.field];
    if (!col) continue;
    orderBy.push(s.direction === 'desc' ? sql`${col} DESC NULLS LAST` : sql`${col} ASC NULLS LAST`);
  }
  if (orderBy.length) q = q.orderBy(...orderBy);

  if (options.maxRecords) q = q.limit(Number(options.maxRecords));

  const rows = await q;
  return rows.map(pgToResponse);
}

const SORT_FIELD_MAP = {
  'Display Name':     stock.displayName,
  'Category':         stock.category,
  'Current Quantity': stock.currentQuantity,
  'Last Restocked':   stock.lastRestocked,
};

// ── listByIds — bulk fetch by Airtable record id (or PG uuid) ──
//
// Routes that need to resolve many ids at once (substitute reconciliation,
// premade rollups) use this for a single PG query.
export async function listByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  return listFromPg({ pg: { ids, includeInactive: true, includeEmpty: true } });
}

// ── getById ──
export async function getById(id) {
  const row = await findPgByAirtableOrUuid(id);
  if (!row) {
    const err = new Error(`Stock record not found: ${id}`);
    err.statusCode = 404;
    throw err;
  }
  return pgToResponse(row);
}

// ── Create ──
//
// `opts.tx`: when passed, the caller is inside an outer transaction
// (typically `orderRepo.createOrder`'s `db.transaction(...)`).
// Stock adjustments + order writes stay atomic.
export async function create(fields, opts = {}) {
  const safe = pickAllowed(fields, STOCK_WRITE_ALLOWED);
  if (!safe['Display Name']) {
    const err = new Error('Display Name is required');
    err.statusCode = 400;
    throw err;
  }
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };

  if (opts.tx) {
    const [row] = await opts.tx.insert(stock).values(responseToPg(safe)).returning();
    await tryAudit(opts.tx, {
      entityType: 'stock', entityId: row.id, action: 'create',
      before: null, after: pgToResponse(row), ...actor,
    });
    return pgToResponse(row);
  }

  if (!db) throw new Error('stockRepo.create: postgres backend but DATABASE_URL not configured');
  const pgRow = await db.transaction(async (tx) => {
    const [row] = await tx.insert(stock).values(responseToPg(safe)).returning();
    await tryAudit(tx, {
      entityType: 'stock',
      entityId:   row.id,
      action:     'create',
      before:     null,
      after:      pgToResponse(row),
      ...actor,
    });
    return row;
  });
  return pgToResponse(pgRow);
}

// ── Update ──
// `opts.tx`: see Create.
export async function update(id, fields, opts = {}) {
  const safe = pickAllowed(fields, STOCK_WRITE_ALLOWED);
  if (Object.keys(safe).length === 0) {
    const err = new Error('No valid fields to update.');
    err.statusCode = 400;
    throw err;
  }
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };

  if (opts.tx) {
    const before = await findPgByAirtableOrUuid(id, opts.tx);
    if (!before) {
      const err = new Error(`Stock record not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    const [after] = await opts.tx.update(stock)
      .set({ ...responseToPg(safe), updatedAt: new Date() })
      .where(eq(stock.id, before.id))
      .returning();
    await tryAudit(opts.tx, {
      entityType: 'stock', entityId: after.id, action: 'update',
      before: pgToResponse(before), after: pgToResponse(after), ...actor,
    });
    return pgToResponse(after);
  }

  if (!db) throw new Error('stockRepo.update: postgres backend but DATABASE_URL not configured');
  const pgRow = await db.transaction(async (tx) => {
    const before = await findPgByAirtableOrUuid(id, tx);
    if (!before) {
      const err = new Error(`Stock record not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    const [after] = await tx
      .update(stock)
      .set({ ...responseToPg(safe), updatedAt: new Date() })
      .where(eq(stock.id, before.id))
      .returning();
    await tryAudit(tx, {
      entityType: 'stock',
      entityId:   after.id,
      action:     'update',
      before:     pgToResponse(before),
      after:      pgToResponse(after),
      ...actor,
    });
    return after;
  });
  return pgToResponse(pgRow);
}

// ── adjustQuantity ──
//
// Single-statement atomic UPDATE — no serialised queue needed because
// PG row locking handles concurrency.
//
// Returns { stockId, previousQty, newQty }.
export async function adjustQuantity(id, delta, opts = {}) {
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };

  // When called from inside an outer transaction (orderRepo mutating an
  // order + its lines + adjusting stock atomically), use the parent tx.
  if (opts.tx) {
    const before = await findPgByAirtableOrUuid(id, opts.tx);
    if (!before) {
      const err = new Error(`Stock record not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    const [after] = await opts.tx.update(stock)
      .set({ currentQuantity: sql`${stock.currentQuantity} + ${delta}`, updatedAt: new Date() })
      .where(eq(stock.id, before.id))
      .returning();
    await tryAudit(opts.tx, {
      entityType: 'stock', entityId: after.id, action: 'update',
      before: { 'Current Quantity': before.currentQuantity },
      after:  { 'Current Quantity': after.currentQuantity },
      ...actor,
    });
    return {
      stockId: after.airtableId || after.id,
      previousQty: before.currentQuantity,
      newQty: after.currentQuantity,
    };
  }

  if (!db) throw new Error('stockRepo.adjustQuantity: postgres backend but DATABASE_URL not configured');
  return await db.transaction(async (tx) => {
    const before = await findPgByAirtableOrUuid(id, tx);
    if (!before) {
      const err = new Error(`Stock record not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    const [after] = await tx
      .update(stock)
      .set({
        currentQuantity: sql`${stock.currentQuantity} + ${delta}`,
        updatedAt: new Date(),
      })
      .where(eq(stock.id, before.id))
      .returning();
    await tryAudit(tx, {
      entityType: 'stock',
      entityId:   after.id,
      action:     'update',
      before:     { 'Current Quantity': before.currentQuantity },
      after:      { 'Current Quantity': after.currentQuantity },
      ...actor,
    });
    return {
      stockId: after.airtableId || after.id,
      previousQty: before.currentQuantity,
      newQty: after.currentQuantity,
    };
  });
}

// ── Soft delete ──
// Stamps deleted_at in PG. Idempotent. `opts.tx`: see Create.
export async function softDelete(id, opts = {}) {
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };

  if (opts.tx) {
    const before = await findPgByAirtableOrUuid(id, opts.tx);
    if (!before) {
      const err = new Error(`Stock record not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    const [after] = await opts.tx.update(stock)
      .set({ deletedAt: new Date(), active: false, updatedAt: new Date() })
      .where(eq(stock.id, before.id))
      .returning();
    await tryAudit(opts.tx, {
      entityType: 'stock', entityId: after.id, action: 'delete',
      before: pgToResponse(before), after: null, ...actor,
    });
    return pgToResponse(after);
  }

  if (!db) throw new Error('stockRepo.softDelete: postgres backend but DATABASE_URL not configured');
  return await db.transaction(async (tx) => {
    const before = await findPgByAirtableOrUuid(id, tx);
    if (!before) {
      const err = new Error(`Stock record not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    const [after] = await tx
      .update(stock)
      .set({ deletedAt: new Date(), active: false, updatedAt: new Date() })
      .where(eq(stock.id, before.id))
      .returning();
    await tryAudit(tx, {
      entityType: 'stock',
      entityId:   after.id,
      action:     'delete',
      before:     pgToResponse(before),
      after:      null,
      ...actor,
    });
    return pgToResponse(after);
  });
}

// ── Restore (Admin-mode only) ──
export async function restore(id, opts = {}) {
  if (!db) throw new Error('stockRepo.restore: postgres backend not configured');
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };
  return await db.transaction(async (tx) => {
    // Restore must include soft-deleted rows in the lookup — that's the
    // whole point. findPgByAirtableOrUuid filters them out, so we use a
    // direct query here.
    const isAirtableId = typeof id === 'string' && id.startsWith('rec');
    const where = isAirtableId ? eq(stock.airtableId, id) : eq(stock.id, id);
    const [before] = await tx.select().from(stock).where(where).limit(1);
    if (!before) {
      const err = new Error(`Stock record not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    const [after] = await tx
      .update(stock)
      .set({ deletedAt: null, active: true, updatedAt: new Date() })
      .where(eq(stock.id, before.id))
      .returning();
    await tryAudit(tx, {
      entityType: 'stock',
      entityId:   after.id,
      action:     'restore',
      before:     pgToResponse(before),
      after:      pgToResponse(after),
      ...actor,
    });
    return pgToResponse(after);
  });
}

// ── Purge (Admin-mode only — owner confirmation gated at the route layer) ──
export async function purge(id, opts = {}) {
  if (!db) throw new Error('stockRepo.purge: postgres backend not configured');
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };
  return await db.transaction(async (tx) => {
    const isAirtableId = typeof id === 'string' && id.startsWith('rec');
    const where = isAirtableId ? eq(stock.airtableId, id) : eq(stock.id, id);
    const [before] = await tx.select().from(stock).where(where).limit(1);
    if (!before) {
      const err = new Error(`Stock record not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    await tx.delete(stock).where(eq(stock.id, before.id));
    await tryAudit(tx, {
      entityType: 'stock',
      entityId:   before.id,
      action:     'purge',
      before:     pgToResponse(before),
      after:      null,
      ...actor,
    });
    return { id: before.airtableId || before.id, purged: true };
  });
}

// ── Variety backfill helpers (issue #292) ──

// Allowed column names for distinctValues — prevents SQL injection via
// untrusted :column param. The route validates against this set before calling.
export const VARIETY_COLUMNS = ['typeName', 'colour', 'sizeCm', 'cultivar'];

const VARIETY_COLUMN_MAP = {
  typeName: stock.typeName,
  colour:   stock.colour,
  sizeCm:   stock.sizeCm,
  cultivar: stock.cultivar,
};

// findByTypeNameNull — list stock items that still need Variety backfill.
// Default sort: display_name ASC. When includeBackfilled=true, returns all
// non-deleted rows (used by "Show backfilled" toggle).
export async function findByTypeNameNull(opts = {}) {
  if (!db) throw new Error('stockRepo.findByTypeNameNull: db not configured');
  const filters = [isNull(stock.deletedAt)];
  if (!opts.includeBackfilled) filters.push(isNull(stock.typeName));
  const rows = await db
    .select()
    .from(stock)
    .where(and(...filters))
    .orderBy(sql`${stock.displayName} ASC NULLS LAST`);
  return rows.map(pgToResponse);
}

// distinctValues — SELECT DISTINCT for one of the four Variety columns.
// Used by the autocomplete inputs in the backfill UI. Only the four identity
// columns are allowed; anything else throws so the route can 400 cleanly.
export async function distinctValues(column) {
  if (!VARIETY_COLUMNS.includes(column)) {
    const err = new Error(`distinctValues: column "${column}" is not allowed`);
    err.statusCode = 400;
    throw err;
  }
  if (!db) throw new Error('stockRepo.distinctValues: db not configured');
  const col = VARIETY_COLUMN_MAP[column];
  const rows = await db
    .selectDistinct({ value: col })
    .from(stock)
    .where(and(isNull(stock.deletedAt), sql`${col} IS NOT NULL`))
    .orderBy(sql`${col} ASC`);
  return rows.map(r => r.value).filter(Boolean);
}

// updateVarietyAttrs — sets the four Variety identity columns on one stock
// row. Type is required (non-empty); the others are optional (null clears them).
// Audit action is 'variety_backfill' (distinct from generic 'update') so the
// admin log can filter backfill activity separately.
export async function updateVarietyAttrs(id, attrs, opts = {}) {
  const { typeName, colour, sizeCm, cultivar } = attrs;
  if (!typeName || !String(typeName).trim()) {
    const err = new Error('Type is required for variety backfill');
    err.statusCode = 400;
    throw err;
  }
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };
  if (!db) throw new Error('stockRepo.updateVarietyAttrs: db not configured');

  return await db.transaction(async (tx) => {
    const before = await findPgByAirtableOrUuid(id, tx);
    if (!before) {
      const err = new Error(`Stock record not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    const patch = {
      typeName: String(typeName).trim(),
      colour:   colour != null ? String(colour).trim() || null : null,
      sizeCm:   sizeCm != null ? Number(sizeCm) || null : null,
      cultivar: cultivar != null ? String(cultivar).trim() || null : null,
      updatedAt: new Date(),
    };
    const [after] = await tx.update(stock).set(patch).where(eq(stock.id, before.id)).returning();
    await tryAudit(tx, {
      entityType: 'stock',
      entityId:   after.id,
      action:     'variety_backfill',
      before:     { Type: before.typeName, Colour: before.colour, Size: before.sizeCm, Cultivar: before.cultivar },
      after:      { Type: after.typeName, Colour: after.colour, Size: after.sizeCm, Cultivar: after.cultivar },
      ...actor,
    });
    return varietyResponse(after);
  });
}

// bulkUpdateVarietyAttrs — applies attrs to a list of ids in one transaction.
// If any id is not found, the whole batch is rolled back (partial commits are
// worse than a full failure — the Owner can retry the batch).
export async function bulkUpdateVarietyAttrs(ids, attrs, opts = {}) {
  const { typeName, colour, sizeCm, cultivar } = attrs;
  if (!typeName || !String(typeName).trim()) {
    const err = new Error('Type is required for variety backfill');
    err.statusCode = 400;
    throw err;
  }
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };
  if (!db) throw new Error('stockRepo.bulkUpdateVarietyAttrs: db not configured');

  return await db.transaction(async (tx) => {
    const results = [];
    for (const id of ids) {
      const before = await findPgByAirtableOrUuid(id, tx);
      if (!before) {
        const err = new Error(`Stock record not found: ${id}`);
        err.statusCode = 404;
        throw err;
      }
      const patch = {
        typeName: String(typeName).trim(),
        colour:   colour != null ? String(colour).trim() || null : null,
        sizeCm:   sizeCm != null ? Number(sizeCm) || null : null,
        cultivar: cultivar != null ? String(cultivar).trim() || null : null,
        updatedAt: new Date(),
      };
      const [after] = await tx.update(stock).set(patch).where(eq(stock.id, before.id)).returning();
      await tryAudit(tx, {
        entityType: 'stock',
        entityId:   after.id,
        action:     'variety_backfill',
        before:     { Type: before.typeName, Colour: before.colour, Size: before.sizeCm, Cultivar: before.cultivar },
        after:      { Type: after.typeName, Colour: after.colour, Size: after.sizeCm, Cultivar: after.cultivar },
        ...actor,
      });
      results.push(varietyResponse(after));
    }
    return results;
  });
}

// varietyResponse — minimal wire format for backfill endpoint responses.
// Returns the display-name identity fields the UI needs to update its local state.
function varietyResponse(row) {
  return {
    id:          row.id,
    _pgId:       row.id,
    'Display Name': row.displayName,
    'Type':      row.typeName,
    'Colour':    row.colour,
    'Size':      row.sizeCm,
    'Cultivar':  row.cultivar,
  };
}

// ── getPremadeReservations (Stock Y-model, issue #285) ──
// Returns Map<stockId, summed qty> for premade_bouquet_lines whose stockId
// is in the given list. Pass `tx` when called inside a transaction so reads
// see the same snapshot as concurrent locks.
export async function getPremadeReservations(stockIds, tx = null) {
  if (!Array.isArray(stockIds) || stockIds.length === 0) return new Map();
  const handle = tx || db;
  if (!handle) return new Map();
  const rows = await handle
    .select({
      stockId:  premadeBouquetLines.stockId,
      totalQty: sql`SUM(${premadeBouquetLines.quantity})`,
    })
    .from(premadeBouquetLines)
    .where(inArray(premadeBouquetLines.stockId, stockIds))
    .groupBy(premadeBouquetLines.stockId);
  const out = new Map();
  for (const r of rows) {
    if (r.stockId) out.set(r.stockId, Number(r.totalQty) || 0);
  }
  return out;
}

// ── validateFreeQty (Stock Y-model, issue #285) ──
// Inside an outer transaction (caller holds BEGIN): locks the Batch row via
// SELECT FOR UPDATE in production Postgres, computes
//   freeQty = current_quantity - SUM(existing reservations)
// throws 400 if freeQty < requestedQty.
//
// pglite (test harness) is single-connection WASM and ignores FOR UPDATE.
// Concurrency tests rely on sequential calls — the first call's reservation
// is visible to the second call's free-qty check.
export async function validateFreeQty(stockId, requestedQty, tx) {
  if (!tx) throw new Error('validateFreeQty: must be called inside a transaction');
  const rows = await tx.execute(
    sql`SELECT current_quantity FROM stock WHERE id = ${stockId} FOR UPDATE`
  );
  const batchQty = Number(rows.rows?.[0]?.current_quantity ?? rows[0]?.current_quantity ?? 0);
  const reservations = await getPremadeReservations([stockId], tx);
  const reserved = reservations.get(stockId) ?? 0;
  const freeQty = batchQty - reserved;
  if (freeQty < requestedQty) {
    const err = new Error(
      `Insufficient free stems: ${freeQty} available (${batchQty} on hand minus ${reserved} reserved for premades), ${requestedQty} requested.`
    );
    err.statusCode = 400;
    throw err;
  }
}

// ── Internal exports for tests ──
export const _internal = {
  STOCK_WRITE_ALLOWED,
  pgToResponse,
  responseToPg,
};
