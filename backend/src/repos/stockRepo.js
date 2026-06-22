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
import {
  stock,
  orders,
  orderLines,
  customers,
  stockLossLog,
  stockPurchases,
  premadeBouquets,
  premadeBouquetLines,
  auditLog,
} from '../db/schema.js';
import { recordAudit } from '../db/audit.js';
import { and, eq, ilike, isNull, inArray, gt, sql, desc } from 'drizzle-orm';

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

  // C4: a cleared Required By (newDate == null) is a de-scheduling, not a
  // re-dating. Splitting needs a target date, so on a clear we set the DE's
  // date to NULL in place (even when shared) — the demand quantity is
  // conserved; only the date pin is removed (decision: no split on a clear).
  if (newDate == null) {
    const [after] = await tx.update(stock)
      .set({ date: null, updatedAt: new Date() })
      .where(eq(stock.id, de.id))
      .returning();
    await tryAudit(tx, {
      entityType: 'stock', entityId: after.id, action: 'update',
      before: { date: de.date }, after: { date: null }, ...actor,
    });
    return { demandEntryId: after.id, action: 'cleared-in-place' };
  }

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

/**
 * FEFO router: resolve a Variety to the oldest non-negative Batch that can
 * fully cover `lineQty`. Falls back to the oldest Batch (will go negative)
 * if none has enough cover. Returns null when no Batches exist.
 *
 * Demand Entries (`current_quantity < 0`) are intentionally excluded —
 * order_line FK rerouting to a DE is handled separately by step 3b in
 * `orderRepo.createOrder` via `getOrCreateDemandEntry`.
 *
 * Pglite limitation: no `SELECT FOR UPDATE`. Production PG gets row-level
 * lock isolation on the subsequent UPDATE in `stockRepo.adjustQuantity`.
 * The small read-modify race window is acceptable for single-studio use.
 *
 * @param {{ typeName: string, colour?: string|null, sizeCm?: number|null, cultivar?: string|null }} varietyKey
 * @param {number} lineQty - quantity the order line will consume
 * @param {object} tx      - Drizzle transaction handle (required)
 * @returns {Promise<string|null>} chosen stock_items.id (uuid), or null
 */
export async function resolveBatchByFEFO(varietyKey, lineQty, tx) {
  const { typeName, colour = null, sizeCm = null, cultivar = null } = varietyKey ?? {};
  if (!typeName) return null;

  const varietyWhere = and(
    eq(stock.typeName, typeName),
    colour   ? eq(stock.colour, colour)     : isNull(stock.colour),
    sizeCm   ? eq(stock.sizeCm, sizeCm)     : isNull(stock.sizeCm),
    cultivar ? eq(stock.cultivar, cultivar) : isNull(stock.cultivar),
    sql`${stock.currentQuantity} >= 0`,
    isNull(stock.deletedAt),
  );

  const candidates = await tx.select({
    id:              stock.id,
    currentQuantity: stock.currentQuantity,
  }).from(stock)
    .where(varietyWhere)
    .orderBy(sql`${stock.date} ASC NULLS LAST`, sql`${stock.createdAt} ASC`);

  if (candidates.length === 0) return null;

  const fullCover = candidates.find(c => Number(c.currentQuantity) >= Number(lineQty));
  return (fullCover ?? candidates[0]).id;
}

/**
 * Reverse an order line's stock effect when the line goes away
 * (cancel / delete / bouquet-edit remove). Y-model aware:
 *
 *  - DE-bound line (linked stock row has typeName set AND currentQuantity < 0):
 *    the line represented future DEMAND, not physical stems. BOTH 'return' and
 *    'writeoff' release that demand (+qty toward zero) — there are no stems to
 *    lose (C19). If the DE reaches >= 0 it is SOFT-DELETED so it can never
 *    become a phantom 0-qty FEFO candidate (C5; FEFO selects currentQuantity >= 0
 *    and would otherwise treat a depleted DE as an empty Batch).
 *
 *  - Batch / legacy line: 'return' adds the qty back to stock; 'writeoff' leaves
 *    the quantity decremented (the caller logs the physical loss) — unchanged.
 *
 * Must run inside the caller's db.transaction (tx required).
 *
 * @param {string} stockItemId
 * @param {number} quantity  - positive line quantity being reversed
 * @param {'return'|'writeoff'} mode
 * @param {object} tx        - Drizzle transaction handle (required)
 * @param {object} [actor]
 * @returns {Promise<{ kind: 'de'|'batch', stockId: string, newQty: number, released: boolean }>}
 */
export async function reverseLineStockEffect(stockItemId, quantity, mode, tx, actor = { actorRole: 'system', actorPinLabel: null }) {
  const qty = Number(quantity) || 0;
  // Resolve recXXX (legacy Airtable) OR uuid the same way adjustQuantity does —
  // a raw eq(stock.id, recXXX) errors against the uuid column.
  const row = await findPgByAirtableOrUuid(stockItemId, tx);

  const isDe = !!row && !!row.typeName && Number(row.currentQuantity) < 0;

  if (isDe) {
    // Release the demand regardless of mode — a DE has no physical stems.
    const [after] = await tx.update(stock)
      .set({ currentQuantity: sql`${stock.currentQuantity} + ${qty}`, updatedAt: new Date() })
      .where(eq(stock.id, row.id))
      .returning();
    await tryAudit(tx, {
      entityType: 'stock', entityId: after.id, action: 'update',
      before: { 'Current Quantity': row.currentQuantity },
      after:  { 'Current Quantity': after.currentQuantity }, ...actor,
    });
    const newQty = Number(after.currentQuantity);
    if (newQty >= 0) {
      // Demand fully satisfied/released — drop the row so it is never a phantom
      // 0-qty FEFO candidate.
      await tx.update(stock)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(stock.id, row.id));
      await tryAudit(tx, {
        entityType: 'stock', entityId: after.id, action: 'delete',
        before: { 'Current Quantity': after.currentQuantity }, after: null, ...actor,
      });
    }
    return { kind: 'de', stockId: after.airtableId || after.id, newQty, released: true };
  }

  // Batch / legacy row.
  if (mode === 'writeoff') {
    // Leave qty decremented — the caller logs the physical loss. No lookup throw
    // even if the row is missing (matches the prior write-off-then-log path).
    return { kind: 'batch', stockId: row?.airtableId || row?.id || stockItemId, newQty: row ? Number(row.currentQuantity) : 0, released: false };
  }
  // Return path: delegate to adjustQuantity — it handles dual id-lookup + 404.
  const result = await adjustQuantity(stockItemId, qty, { tx, actor });
  return { kind: 'batch', stockId: result.stockId, newQty: result.newQty, released: true };
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
  // Stock Y-model 4-tuple Variety attributes (issue #284 / #287)
  'Type', 'Colour', 'Size', 'Cultivar',
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
  // Stock Y-model 4-tuple Variety attributes (issue #284 / #287)
  // Empty strings normalised to null; sizeCm coerced to integer or null.
  if ('Type' in fields)     out.typeName = fields.Type    ? String(fields.Type).trim()    || null : null;
  if ('Colour' in fields)   out.colour   = fields.Colour  ? String(fields.Colour).trim()  || null : null;
  if ('Cultivar' in fields) out.cultivar = fields.Cultivar ? String(fields.Cultivar).trim() || null : null;
  if ('Size' in fields) {
    const n = parseInt(fields.Size, 10);
    out.sizeCm = Number.isFinite(n) ? n : null;
  }
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
  // Variety 4-tuple filter — used by PO evaluation to find existing Stock Items by identity.
  if (pg.typeName)                 filters.push(eq(stock.typeName, String(pg.typeName)));
  if ('colour' in pg)              filters.push(pg.colour ? eq(stock.colour, String(pg.colour)) : isNull(stock.colour));
  if ('sizeCm' in pg)              filters.push(pg.sizeCm != null ? eq(stock.sizeCm, Number(pg.sizeCm)) : isNull(stock.sizeCm));
  if ('cultivar' in pg)            filters.push(pg.cultivar ? eq(stock.cultivar, String(pg.cultivar)) : isNull(stock.cultivar));
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

// ── getPremadeReservationDetails (Stock Y-model, issue #288 follow-up) ──
// Like getPremadeReservations but returns full bouquet context per stock item.
// Returns Map<stockId, { totalQty, bouquets: [{ bouquetId, name, qty }] }>
// so the /stock/premade-committed Y-model branch can populate bouquets[].
// Joins premade_bouquet_lines → premade_bouquets, groups by (stockId, bouquetId, name).
// Does NOT accept a `tx` argument — this is a read-only endpoint, no transaction needed.
export async function getPremadeReservationDetails(stockIds) {
  if (!Array.isArray(stockIds) || stockIds.length === 0) return new Map();
  if (!db) return new Map();
  const rows = await db
    .select({
      stockId:     premadeBouquetLines.stockId,
      bouquetId:   premadeBouquetLines.bouquetId,
      bouquetName: premadeBouquets.name,
      lineQty:     sql`SUM(${premadeBouquetLines.quantity})`,
    })
    .from(premadeBouquetLines)
    .innerJoin(premadeBouquets, eq(premadeBouquetLines.bouquetId, premadeBouquets.id))
    .where(inArray(premadeBouquetLines.stockId, stockIds))
    .groupBy(premadeBouquetLines.stockId, premadeBouquetLines.bouquetId, premadeBouquets.name);

  const out = new Map();
  for (const r of rows) {
    if (!r.stockId) continue;
    const qty = Number(r.lineQty) || 0;
    if (!out.has(r.stockId)) {
      out.set(r.stockId, { totalQty: 0, bouquets: [] });
    }
    const entry = out.get(r.stockId);
    entry.totalQty += qty;
    entry.bouquets.push({ bouquetId: r.bouquetId, name: r.bouquetName, qty });
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

// ── listGroupedByVariety (Stock Y-model, issue #289) ──
//
// Groups all Y-model stock rows (type_name IS NOT NULL) by their 4-tuple
// (type_name, colour, size_cm, cultivar) using NULL-aware key serialization
// identical to the shared varietyKey util: "Type|Colour|Size|Cultivar".
// NULL attributes are serialized as '' so null-colour and "Green"-colour
// sort into distinct keys — SQL NULL = NULL is false; the key fixes that.
//
// Attaches reservedForPremades per group via getPremadeReservations.
//
// Returns:
//   [{ key, type_name, colour, size_cm, cultivar,
//      rows: StockItem[],          ← wire-format from pgToResponse
//      reservedForPremades: number }]
//
// Options:
//   includeEmpty (default false) — when false, hides groups where
//   totalQty === 0 AND reservedForPremades === 0. Keeps groups that
//   have reservations even when on-hand qty is zero (premades lock stems).
//
// Note: backend duplicates the 4-line varietyKey serialization inline
// to stay self-contained — backend does not import from packages/shared/.
function _varietyKey(typeName, colour, sizeCm, cultivar) {
  return [
    typeName  ?? '',
    colour    ?? '',
    sizeCm    != null ? String(sizeCm) : '',
    cultivar  ?? '',
  ].join('|');
}

export async function listGroupedByVariety({ includeEmpty = false } = {}) {
  if (!db) throw new Error('listGroupedByVariety: postgres backend not configured');

  // Fetch all Y-model stock rows (type_name IS NOT NULL, not deleted).
  // Include inactive + zero-qty rows so we can show groups with reservations
  // even when on-hand stock is depleted. We'll filter below per includeEmpty.
  const rows = await db
    .select()
    .from(stock)
    .where(and(
      sql`${stock.typeName} IS NOT NULL`,
      isNull(stock.deletedAt),
    ));

  // Group rows by 4-tuple key (JS-side grouping — small N in a flower shop).
  const groupMap = new Map(); // key → { meta, rows: pgRow[] }
  for (const row of rows) {
    const key = _varietyKey(row.typeName, row.colour, row.sizeCm, row.cultivar);
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        type_name: row.typeName,
        colour:    row.colour    ?? null,
        size_cm:   row.sizeCm   ?? null,
        cultivar:  row.cultivar ?? null,
        _pgIds:    [],
        _rows:     [],
      });
    }
    const g = groupMap.get(key);
    g._pgIds.push(row.id);
    g._rows.push(row);
  }

  if (groupMap.size === 0) return [];

  // Fetch premade reservations for all stock IDs in one query.
  const allStockIds = [...groupMap.values()].flatMap(g => g._pgIds);
  const reservations = await getPremadeReservations(allStockIds);

  // T5.3 — Fetch which stock IDs have at least one active order-line consumer
  // (non-deleted order_lines.stock_item_id reference). Used to keep qty=0
  // Varieties visible when they still have live demand (audit-marker case, #323).
  //
  // order_lines.stock_item_id is TEXT; UUIDs are stored as their string form.
  // One batched IN query for all group stock ids.
  const allStockIdStrings = allStockIds.map(id => String(id));
  const activeConsumerRows = allStockIdStrings.length > 0
    ? await db
        .selectDistinct({ stockItemId: orderLines.stockItemId })
        .from(orderLines)
        .where(and(
          inArray(orderLines.stockItemId, allStockIdStrings),
          isNull(orderLines.deletedAt),
        ))
    : [];
  const activeConsumerIds = new Set(activeConsumerRows.map(r => r.stockItemId));

  // Build final output.
  const result = [];
  for (const g of groupMap.values()) {
    // Sum totalQty across all rows in this group.
    const totalQty = g._rows.reduce((sum, r) => sum + (r.currentQuantity ?? 0), 0);
    // Sum reservations across all rows in this group.
    const reservedForPremades = g._pgIds.reduce(
      (sum, id) => sum + (reservations.get(id) ?? 0),
      0,
    );

    // Apply includeEmpty filter — relax to keep groups that still have active
    // order-line consumers (T5.3 / audit-marker case, issue #323).
    const hasActiveConsumer = g._pgIds.some(id => activeConsumerIds.has(String(id)));
    if (!includeEmpty && totalQty === 0 && reservedForPremades === 0 && !hasActiveConsumer) continue;

    result.push({
      key:                g.key,
      type_name:          g.type_name,
      colour:             g.colour,
      size_cm:            g.size_cm,
      cultivar:           g.cultivar,
      // Each row carries legacy display-case fields (pgToResponse) PLUS the
      // Y-model snake-case fields that VarietyListItem + getVarietyTotals
      // consume (`current_quantity`, `date`). Without these, the totals
      // collapse to 0 and the per-Batch label renders "NaN stems".
      rows: g._rows.map(r => ({
        ...pgToResponse(r),
        current_quantity: r.currentQuantity ?? 0,
        date:             r.date ?? null,
      })),
      reservedForPremades,
    });
  }

  return result;
}

// ── getUsageByExactId (Stock Y-model, issue #289, ADR-0007) ──
//
// Under STOCK_Y_MODEL=true, each Batch is an addressable identity — siblings
// of the same Variety that share a base display name must NOT be aggregated.
// This helper filters EVERY usage table by the exact stock UUID so the trace
// shows only events tied to this specific Batch.
//
// Trail event shapes mirror the legacy path exactly so frontend consumers
// (florist StockItem, dashboard StockTab) need no changes.
//
// Quantity sign convention (same as legacy):
//   order / writeoff / premade → negative (stems consumed / locked)
//   purchase                   → positive (stems received)
//
// Date convention:
//   All types use the domain date string (YYYY-MM-DD) except premade lines
//   which have no creation timestamp in the schema — they use null and sort
//   to the top of the chronological list (same as legacy).
//
// Sort: date DESC, null dates first (same as legacy localeCompare behaviour:
//   `(b.date || '').localeCompare(a.date || '')` — nulls become '' which is
//   lexicographically largest when other dates are '' too, but they sort
//   before real dates because '' < '2026-…').
//
// Note: stock_item_id on order_lines is TEXT (may hold UUID or legacy recXXX).
// Exact-ID comparison works because post-Phase-7 new lines write the PG uuid.
// Legacy recXXX-linked lines still appear on the sibling path; new Y-model
// order lines always carry the uuid from atomicStockAdjust.
export async function getUsageByExactId(stockItemId) {
  if (!db) throw new Error('getUsageByExactId: postgres backend not configured');
  if (!stockItemId) throw new Error('getUsageByExactId: stockItemId is required');

  // 1. Order lines — join to orders for date/status/appOrderId,
  //                  then join customers for name.
  //
  // orders.customerId is TEXT (holds UUID string or legacy recXXX).
  // customers.id is UUID. Drizzle doesn't handle the implicit TEXT↔UUID cast
  // on the join condition; we use sql`` to cast explicitly.
  const orderRows = await db
    .select({
      orderId:        orders.id,
      appOrderId:     orders.appOrderId,
      orderDate:      orders.orderDate,
      requiredBy:     orders.requiredBy,
      status:         orders.status,
      customerId:     orders.customerId,
      customerName:   customers.name,
      customerNick:   customers.nickname,
      lineQty:        orderLines.quantity,
      flowerName:     orderLines.flowerName,
    })
    .from(orderLines)
    .innerJoin(orders,    eq(orderLines.orderId, orders.id))
    .leftJoin(customers,  sql`${orders.customerId}::uuid = ${customers.id}`)
    .where(and(
      eq(orderLines.stockItemId, stockItemId),
      isNull(orderLines.deletedAt),
      isNull(orders.deletedAt),
    ));

  const usageOrders = orderRows.map(r => ({
    type:          'order',
    date:          r.requiredBy || r.orderDate || null,
    requiredBy:    r.requiredBy || null,
    orderRecordId: r.orderId    || '',
    orderId:       r.appOrderId || r.orderId || '',
    customer:      r.customerName || r.customerNick || '',
    status:        r.status      || '',
    quantity:      -(Number(r.lineQty) || 0),
    flowerName:    r.flowerName  || '',
  }));

  // 2. Write-offs — stock_loss_log.stock_id is UUID FK.
  const lossRows = await db
    .select()
    .from(stockLossLog)
    .where(and(
      eq(stockLossLog.stockId, stockItemId),
      isNull(stockLossLog.deletedAt),
    ));

  const usageLosses = lossRows.map(l => ({
    type:     'writeoff',
    date:     l.date    || null,
    reason:   l.reason  || '',
    notes:    l.notes   || '',
    quantity: -(Number(l.quantity) || 0),
  }));

  // 3. Purchases — stock_purchases.stock_id is UUID FK.
  //    The PO marker format (ADR-0003) is identical to the legacy path;
  //    resolving poDisplayId is skipped here because exact-ID mode is for
  //    new Y-model rows which embed the human-readable PO number directly
  //    in Notes ("PO #PO-20260508-1 L#<uuid> primary").
  //    The regex still handles the recXXX legacy form so old data is safe.
  const purchaseRows = await db
    .select()
    .from(stockPurchases)
    .where(eq(stockPurchases.stockId, stockItemId));

  const poMarkerRe = /PO #([A-Za-z0-9_\-]+)\s+L#([A-Za-z0-9_\-]+)\s+(primary|substitute|alt)/;
  const usagePurchases = purchaseRows.map(p => {
    const m    = p.notes?.match(poMarkerRe);
    const variant    = m?.[3] || '';
    const poRef      = m?.[1] || null;
    // For PG-era rows the PO ref IS the human-readable id; no lookup needed.
    const poDisplayId = poRef && !poRef.startsWith('rec') ? poRef : '';
    return {
      type:        'purchase',
      date:        p.purchaseDate || null,
      quantity:    Number(p.quantityPurchased) || 0,
      supplier:    p.supplier     || '',
      costPerUnit: p.pricePerUnit != null ? Number(p.pricePerUnit) : 0,
      notes:       p.notes        || '',
      poDisplayId,
      variant,
    };
  });

  // 4. Active premade bouquet lines — premade_bouquet_lines.stock_id is UUID FK.
  //    Join to premade_bouquets for name.
  const premadeRows = await db
    .select({
      bouquetId:   premadeBouquetLines.bouquetId,
      bouquetName: premadeBouquets.name,
      lineQty:     premadeBouquetLines.quantity,
      flowerName:  premadeBouquetLines.flowerName,
    })
    .from(premadeBouquetLines)
    .innerJoin(premadeBouquets, eq(premadeBouquetLines.bouquetId, premadeBouquets.id))
    .where(eq(premadeBouquetLines.stockId, stockItemId));

  const usagePremades = premadeRows.map(l => ({
    type:        'premade',
    date:        null,     // no creation timestamp on premade lines (same as legacy)
    quantity:    -(Number(l.lineQty) || 0),
    bouquetId:   l.bouquetId   || '',
    bouquetName: l.bouquetName || '?',
    flowerName:  l.flowerName  || '',
  }));

  // 5. Dissolve events — audit_log rows from the Y-model dissolve path.
  // Premade lines get CASCADE-deleted on dissolve so step 4 stops returning
  // them; the audit row is the only surviving record. Reservations don't
  // affect Batch qty under the Y-model, so qty=0 (event-only marker).
  const dissolveRows = await db
    .select({
      createdAt:   auditLog.createdAt,
      diff:        auditLog.diff,
      actorRole:   auditLog.actorRole,
    })
    .from(auditLog)
    .where(and(
      eq(auditLog.entityType, 'stock'),
      eq(auditLog.entityId,   stockItemId),
      eq(auditLog.action,     'premade_dissolved'),
    ));

  const usageDissolves = dissolveRows.map(d => {
    const after = d.diff?.after ?? {};
    return {
      type:        'dissolve',
      date:        d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : null,
      quantity:    0,
      releasedQty: Number(after.qty) || 0,
      bouquetId:   after.bouquet_id   || '',
      bouquetName: after.bouquet_name || '',
    };
  });

  // Combine + sort: newest first, null dates sort to top (same as legacy).
  const trail = [...usageOrders, ...usageLosses, ...usagePurchases, ...usagePremades, ...usageDissolves]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return trail;
}

// ── getUsageByVarietyKey (T5.2 — Per-Variety trace, ADR-0007 / PRD #324) ──
//
// Returns the union of all usage events across every non-deleted Stock row
// whose 4-tuple (type_name, colour, size_cm, cultivar) matches the given
// pipe-separated key.  Includes qty=0 Demand-Entry rows so the trace is
// complete even before physical stock arrives.
//
// Key format: "Type|Colour|SizeCm|Cultivar" — empty segment means NULL.
// This mirrors _varietyKey() and the shared packages/shared/utils/varietyKey.js.
//
// Return shape:
//   {
//     variety: { key, type_name, colour, size_cm, cultivar },
//     events:  TrailEvent[],  // sorted date ASC, null-dated last
//     unaccountedStems: number, // signed sum of ALL event quantities (kept for compat)
//     reservedStems: number,   // stems tied up in premade reservations (positive)
//     onHand: number,          // Σ current_quantity across all Variety rows
//     drift: number,           // predicted − actual: (unaccountedStems + reservedStems − onHand)
//                              // > 0 means stems vanished without a recorded event (real loss)
//                              // ≤ 0 means reconciled or untraced opening balance → hidden
//   }
//
// unaccountedStems = Σ purchase.quantity + Σ (order|writeoff|premade).quantity
// (order/writeoff/premade are already stored as negative; purchases positive).
// Absorption events are deferred — un-paired absorptions surface as drift.
//
// TRUE drift formula:
//   reservedStems = −Σ(quantity) for premade events   (premades are negative; this is positive)
//   onHand        = Σ(row.currentQuantity) across all Variety rows
//   drift         = unaccountedStems + reservedStems − onHand
// A healthy Variety (all stems accounted for) has drift === 0.
// Only drift > 0 is actionable (stems missing with no event explaining them).
export async function getUsageByVarietyKey(key) {
  if (!db) throw new Error('getUsageByVarietyKey: postgres backend not configured');
  if (!key) throw new Error('getUsageByVarietyKey: key is required');

  // Parse the 4-tuple from the pipe-separated key.
  const [typeName, colour, sizeCmStr, cultivar] = key.split('|');
  const sizeCm = sizeCmStr !== '' ? Number(sizeCmStr) : null;

  // Resolve all non-deleted rows in this Variety (including qty=0 DEs).
  const rows = await db
    .select()
    .from(stock)
    .where(and(
      isNull(stock.deletedAt),
      // Match 4-tuple with NULL-aware equality — NULL segment ↔ empty string in key.
      typeName  ? eq(stock.typeName, typeName)   : isNull(stock.typeName),
      colour    ? eq(stock.colour, colour)        : isNull(stock.colour),
      cultivar  ? eq(stock.cultivar, cultivar)   : isNull(stock.cultivar),
      sizeCm != null ? eq(stock.sizeCm, sizeCm)  : isNull(stock.sizeCm),
    ));

  // Variety metadata — use first row if any; fall back to parsed segments.
  const meta = rows[0] ?? null;

  if (rows.length === 0) {
    return {
      variety: {
        key,
        type_name: typeName || null,
        colour:    colour   || null,
        size_cm:   sizeCm,
        cultivar:  cultivar || null,
      },
      events:           [],
      unaccountedStems: 0,
      reservedStems:    0,
      onHand:           0,
      drift:            0,
    };
  }

  // Collect usage events from all rows, reusing the existing per-row mapper.
  let allEvents = [];
  for (const row of rows) {
    const trail = await getUsageByExactId(row.id);
    allEvents = allEvents.concat(trail);
  }

  // Sort ascending by date, null-dated last.
  // getUsageByExactId returns newest-first; we invert here.
  // null ↔ '' — empty string sorts before real dates in locale compare,
  // so we push null-dated events to the END by treating null as '9999-99-99'.
  allEvents.sort((a, b) => {
    const da = a.date || '9999-99-99';
    const db = b.date || '9999-99-99';
    return da.localeCompare(db);
  });

  // Tag first purchase and first order (chronologically earliest in sorted order).
  // Events are already sorted ascending; find the first match of each type.
  const firstPoIdx    = allEvents.findIndex(e => e.type === 'purchase');
  const firstDemandIdx = allEvents.findIndex(e => e.type === 'order');
  if (firstPoIdx    !== -1) allEvents[firstPoIdx].firstPo       = true;
  if (firstDemandIdx !== -1) allEvents[firstDemandIdx].firstDemand = true;

  // Compute unaccountedStems: signed sum across all events (kept for compat).
  const unaccountedStems = allEvents.reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);

  // Compute TRUE drift:
  //   reservedStems = stems locked in premade reservations (premade events are negative
  //                   in the ledger but do NOT reduce physical stock under the Y-model).
  //   onHand        = Σ current_quantity across all rows in this Variety.
  //   drift         = unaccountedStems + reservedStems − onHand
  //   drift > 0 → stems vanished without a recorded event (real loss, footer shown).
  //   drift ≤ 0 → reconciled or untraced opening balance (footer hidden).
  const reservedStems = allEvents
    .filter(e => e.type === 'premade')
    .reduce((sum, e) => sum + -(Number(e.quantity) || 0), 0); // premades are negative; negate → positive

  const onHand = rows.reduce((sum, row) => sum + (Number(row.currentQuantity) || 0), 0);

  const drift = unaccountedStems + reservedStems - onHand;

  return {
    variety: {
      key,
      type_name: meta.typeName ?? null,
      colour:    meta.colour   ?? null,
      size_cm:   meta.sizeCm  ?? null,
      cultivar:  meta.cultivar ?? null,
    },
    events:  allEvents,
    unaccountedStems,
    reservedStems,
    onHand,
    drift,
  };
}

// ── Internal exports for tests ──
export const _internal = {
  STOCK_WRITE_ALLOWED,
  pgToResponse,
  responseToPg,
};
