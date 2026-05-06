// Stock repository — the persistence boundary for Stock records.
//
// Phase 3 of the SQL migration. Three modes selectable via STOCK_BACKEND:
//
//   'airtable' (default) → today's behaviour. Reads + writes go straight to
//                         Airtable via services/airtable.js. No PG involvement.
//   'shadow'             → reads from Airtable (the trusted store). Writes
//                         to BOTH stores: Airtable first (must succeed),
//                         then Postgres (best-effort; failures land in
//                         parity_log with kind='write_failed', the request
//                         still returns 200). Audit log populates from
//                         every PG write so we can reconstruct anything.
//                         A separate runParityCheck() function does bulk
//                         diff of the full stock table — driven by the
//                         admin endpoint, not per-request.
//   'postgres'           → writes go to PG only. Airtable becomes a frozen
//                         legacy snapshot. The Airtable serialised stock
//                         queue is bypassed because PG handles atomic
//                         increments natively (UPDATE ... SET qty = qty + $1
//                         RETURNING current_quantity, in a single statement).
//
// Wire format: methods return Airtable-shaped records ({ id, 'Display Name',
// 'Current Quantity', ... }) regardless of backend, so routes + frontends are
// unchanged across the cutover. The PG row's UUID is exposed as `_pgId`.
//
// `id` semantics:
//   - airtable + shadow modes: returned `id` is the recXXX (Airtable id).
//   - postgres mode: returned `id` is the airtableId if known (so existing
//     callers carrying recXXX values keep working), else the PG uuid.
//   - getById(id) accepts either form in postgres mode and disambiguates by
//     the `rec` prefix.

import * as airtable from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { pickAllowed } from '../utils/fields.js';
import { db } from '../db/index.js';
import { stock, parityLog } from '../db/schema.js';
import { recordAudit } from '../db/audit.js';
import { and, eq, isNull, inArray, gt, sql } from 'drizzle-orm';

// ── Backend mode ──
const VALID_MODES = new Set(['airtable', 'shadow', 'postgres']);
function readMode() {
  const m = (process.env.STOCK_BACKEND || 'airtable').toLowerCase();
  return VALID_MODES.has(m) ? m : 'airtable';
}
// Cache the value at module load. The mode flips via deploy, not at runtime,
// so caching it lets tests stub `readMode` cheaply via `_setMode`.
let MODE = readMode();
export function getBackendMode() { return MODE; }
export function _setMode(m) {
  // Test-only — not exported from the package boundary in production code.
  if (!VALID_MODES.has(m)) throw new Error(`Invalid STOCK_BACKEND: ${m}`);
  MODE = m;
}
export function _resetMode() { MODE = readMode(); }

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
// Used in postgres-mode read/write paths and in shadow-mode parity checks.
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

// Parity-log helper — best effort. Never throws. Used to record write-side
// failures in shadow mode and bulk-diff mismatches in runParityCheck().
async function logParity({ entityId, kind, field = null, airtableValue = null, postgresValue = null, context = {} }) {
  if (!db) return;
  try {
    await db.insert(parityLog).values({
      entityType: 'stock',
      entityId:   String(entityId),
      kind,
      field,
      airtableValue: airtableValue === undefined ? null : airtableValue,
      postgresValue: postgresValue === undefined ? null : postgresValue,
      context,
    });
  } catch (err) {
    console.error('[stockRepo] parity log failed:', err.message);
  }
}

// Audit helper that swallows missing-actor errors during shadow (when callers
// haven't been threaded with `req` yet). Production callers should always
// pass a real actor.
async function tryAudit(tx, args) {
  try {
    await recordAudit(tx, args);
  } catch (err) {
    console.error('[stockRepo] audit write failed:', err.message);
  }
}

// ── List ──
//
// Two calling shapes:
//   • Airtable shape (current code): `{ filterByFormula, sort, fields, maxRecords }`.
//     Honoured by airtable + shadow modes (which read from Airtable). Ignored
//     in postgres mode if `pg` filter not provided.
//   • PG shape: `{ pg: { active?, includeEmpty?, includeInactive?, category?,
//     ids? }, sort?: [{ field, direction }] }`. Honoured in postgres mode.
//     Ignored in airtable + shadow modes.
//
// During shadow we read from Airtable so legacy filterByFormula keeps working
// untouched. Migrating callers to `pg` shape happens incrementally as we get
// closer to flipping STOCK_BACKEND=postgres.
export async function list(options = {}) {
  if (MODE === 'postgres') {
    return listFromPg(options);
  }
  // airtable + shadow → Airtable is the source of truth for reads.
  return airtable.list(TABLES.STOCK, options);
}

async function listFromPg(options = {}) {
  if (!db) throw new Error('stockRepo.list: postgres backend selected but DATABASE_URL not configured');

  const filters = [isNull(stock.deletedAt)];
  const pg = options.pg || {};
  if (pg.includeInactive !== true) filters.push(eq(stock.active, true));
  if (pg.includeEmpty !== true)    filters.push(gt(stock.currentQuantity, 0));
  if (pg.category)                 filters.push(eq(stock.category, String(pg.category)));
  if (pg.displayName)              filters.push(eq(stock.displayName, String(pg.displayName)));
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

// ── listByIds — bulk fetch by Airtable record id (or PG uuid in PG mode) ──
//
// Mirrors utils/batchQuery.js#listByIds for the Stock table. Routes that need
// to resolve many ids at once (substitute reconciliation, premade rollups)
// use this so cutover is cleanly localised.
export async function listByIds(ids, options = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  if (MODE === 'postgres') {
    return listFromPg({ pg: { ids, includeInactive: true, includeEmpty: true } });
  }
  // airtable + shadow — chunked OR-of-RECORD_ID through batchQuery util.
  const { listByIds: airtableListByIds } = await import('../utils/batchQuery.js');
  return airtableListByIds(TABLES.STOCK, ids, options);
}

// ── getById ──
export async function getById(id) {
  if (MODE === 'postgres') {
    const row = await findPgByAirtableOrUuid(id);
    if (!row) {
      const err = new Error(`Stock record not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    return pgToResponse(row);
  }
  return airtable.getById(TABLES.STOCK, id);
}

// ── Create ──
//
// `opts.tx` (Phase 4): when passed, the caller is inside an outer
// transaction (typically `orderRepo.createOrder`'s `db.transaction(...)`).
// We do PG-only work on the parent tx — Airtable is the caller's concern.
// This keeps stock adjustments + order writes atomic together.
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

  if (MODE === 'airtable') {
    return airtable.create(TABLES.STOCK, safe);
  }

  if (MODE === 'shadow') {
    // Airtable first — it's the source of truth.
    const at = await airtable.create(TABLES.STOCK, safe);
    // PG best-effort.
    if (db) {
      try {
        await db.transaction(async (tx) => {
          const [row] = await tx.insert(stock).values({
            airtableId: at.id,
            ...responseToPg(at),  // snapshot what Airtable accepted, not what we sent
          }).returning();
          await tryAudit(tx, {
            entityType: 'stock',
            entityId:   row.id,
            action:     'create',
            before:     null,
            after:      pgToResponse(row),
            ...actor,
          });
        });
      } catch (err) {
        console.error('[stockRepo] shadow PG create failed:', err.message);
        await logParity({
          entityId: at.id, kind: 'write_failed',
          context: { mode: 'shadow', op: 'create', error: err.message },
        });
      }
    }
    return at;
  }

  // postgres mode
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

  if (MODE === 'airtable') {
    return airtable.update(TABLES.STOCK, id, safe);
  }

  if (MODE === 'shadow') {
    const at = await airtable.update(TABLES.STOCK, id, safe);
    if (db) {
      try {
        await db.transaction(async (tx) => {
          const [before] = await tx.select().from(stock).where(eq(stock.airtableId, id)).limit(1);
          if (!before) {
            // Airtable has the row but PG doesn't — surface as missing_pg parity issue.
            // Don't attempt to insert here; the backfill script handles seeding.
            return;
          }
          const [after] = await tx
            .update(stock)
            .set({ ...responseToPg(at), updatedAt: new Date() })
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
        });
      } catch (err) {
        console.error('[stockRepo] shadow PG update failed:', err.message);
        await logParity({
          entityId: id, kind: 'write_failed',
          context: { mode: 'shadow', op: 'update', error: err.message },
        });
      }
    }
    return at;
  }

  // postgres mode
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

// ── adjustQuantity (replaces airtable.atomicStockAdjust for stockRepo callers) ──
//
// In airtable mode: delegates to atomicStockAdjust (existing serialised queue).
// In shadow mode: same as airtable, then async best-effort PG adjust.
// In postgres mode: single-statement atomic UPDATE — no serialised queue
//                   needed because PG row locking handles concurrency.
//
// Returns { stockId, previousQty, newQty } regardless of mode for callers
// that compare to airtable.atomicStockAdjust's shape.
export async function adjustQuantity(id, delta, opts = {}) {
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };

  // Phase 4: when called from inside an outer transaction (orderRepo
  // mutating an order + its lines + adjusting stock atomically), do
  // PG-only work on the parent tx. Airtable-side adjustment is the
  // caller's responsibility.
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

  if (MODE === 'airtable') {
    return airtable.atomicStockAdjust(id, delta);
  }

  if (MODE === 'shadow') {
    const result = await airtable.atomicStockAdjust(id, delta);
    if (db) {
      try {
        await db.transaction(async (tx) => {
          const [before] = await tx.select().from(stock).where(eq(stock.airtableId, id)).limit(1);
          if (!before) return; // covered by parity check; backfill seeds the row
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
        });
      } catch (err) {
        console.error('[stockRepo] shadow PG adjust failed:', err.message);
        await logParity({
          entityId: id, kind: 'write_failed',
          context: { mode: 'shadow', op: 'adjust', delta, error: err.message },
        });
      }
    }
    return result;
  }

  // postgres mode — single-statement atomic
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

// ── Soft delete (Phase 2.5 contract) ──
// On Airtable side: set Active=false (the closest analogue, since Airtable
// has no soft-delete concept). On PG side: stamp deleted_at. Idempotent.
// `opts.tx`: see Create.
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

  if (MODE === 'airtable') {
    return airtable.update(TABLES.STOCK, id, { Active: false });
  }

  if (MODE === 'shadow') {
    const at = await airtable.update(TABLES.STOCK, id, { Active: false });
    if (db) {
      try {
        await db.transaction(async (tx) => {
          const [before] = await tx.select().from(stock).where(eq(stock.airtableId, id)).limit(1);
          if (!before) return;
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
        });
      } catch (err) {
        console.error('[stockRepo] shadow PG soft-delete failed:', err.message);
        await logParity({
          entityId: id, kind: 'write_failed',
          context: { mode: 'shadow', op: 'softDelete', error: err.message },
        });
      }
    }
    return at;
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
  if (MODE !== 'postgres' && MODE !== 'shadow') {
    const err = new Error('restore is only supported when STOCK_BACKEND is shadow or postgres');
    err.statusCode = 400;
    throw err;
  }
  if (!db) throw new Error('stockRepo.restore: postgres backend not configured');
  const actor = opts.actor || { actorRole: 'system', actorPinLabel: null };
  return await db.transaction(async (tx) => {
    // Restore must include soft-deleted rows in the lookup — that's the
    // whole point. findPgByAirtableOrUuid filters them out, so we use a
    // direct query here for both modes.
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
    if (MODE === 'shadow' && before.airtableId) {
      // Reactivate in Airtable too so the source of truth matches.
      airtable.update(TABLES.STOCK, before.airtableId, { Active: true })
        .catch(err => console.error('[stockRepo] shadow restore Airtable update failed:', err.message));
    }
    return pgToResponse(after);
  });
}

// ── Purge (Admin-mode only — owner confirmation gated at the route layer) ──
export async function purge(id, opts = {}) {
  if (MODE !== 'postgres' && MODE !== 'shadow') {
    const err = new Error('purge is only supported when STOCK_BACKEND is shadow or postgres');
    err.statusCode = 400;
    throw err;
  }
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
    if (MODE === 'shadow' && before.airtableId) {
      airtable.deleteRecord(TABLES.STOCK, before.airtableId)
        .catch(err => console.error('[stockRepo] shadow purge Airtable delete failed:', err.message));
    }
    return { id: before.airtableId || before.id, purged: true };
  });
}

// ── Bulk parity check ──
//
// Driven by `GET /api/admin/parity/stock?recheck=true`. Pulls the full active
// Airtable Stock table and the full PG `stock` table (non-deleted), compares
// them by airtable_id, and writes one parity_log entry per problem found.
// Returns a summary { airtableCount, postgresCount, mismatches: { kind: N, ... } }.
//
// Safe to run any time. Slow during peak Saturday traffic — the owner runs
// it from the Admin tab during quiet hours.
const PARITY_FIELDS = [
  'Display Name', 'Purchase Name', 'Category', 'Current Quantity', 'Unit',
  'Current Cost Price', 'Current Sell Price', 'Supplier', 'Reorder Threshold',
  'Active', 'Dead/Unsold Stems', 'Lot Size', 'Farmer', 'Last Restocked',
];

function valuesEqual(a, b) {
  // Treat null/undefined/empty-string as the same — Airtable returns missing
  // fields as undefined, PG as null. Numbers compared as Number().
  const norm = (v) => {
    if (v == null) return null;
    if (v === '') return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v;
    if (Array.isArray(v)) return JSON.stringify(v);
    return String(v);
  };
  return norm(a) === norm(b);
}

export async function runParityCheck() {
  if (!db) {
    return { ran: false, reason: 'DATABASE_URL not configured' };
  }
  const [airtableRows, pgRows] = await Promise.all([
    airtable.list(TABLES.STOCK, { fields: PARITY_FIELDS }),
    db.select().from(stock).where(isNull(stock.deletedAt)),
  ]);

  const pgByAirtableId = new Map(pgRows.filter(r => r.airtableId).map(r => [r.airtableId, r]));
  const airtableIds = new Set(airtableRows.map(r => r.id));

  const summary = { airtableCount: airtableRows.length, postgresCount: pgRows.length, mismatches: {} };
  const bump = (k) => { summary.mismatches[k] = (summary.mismatches[k] || 0) + 1; };

  // Airtable rows missing from PG.
  for (const at of airtableRows) {
    const pg = pgByAirtableId.get(at.id);
    if (!pg) {
      bump('missing_pg');
      await logParity({
        entityId: at.id, kind: 'missing_pg',
        airtableValue: at,
        context: { source: 'runParityCheck' },
      });
      continue;
    }
    const pgResp = pgToResponse(pg);
    for (const field of PARITY_FIELDS) {
      if (!valuesEqual(at[field], pgResp[field])) {
        bump('field_mismatch');
        await logParity({
          entityId: at.id, kind: 'field_mismatch',
          field,
          airtableValue: at[field] ?? null,
          postgresValue: pgResp[field] ?? null,
          context: { source: 'runParityCheck' },
        });
      }
    }
  }
  // PG rows missing from Airtable (deleted upstream, never seeded, etc).
  for (const pg of pgRows) {
    if (pg.airtableId && !airtableIds.has(pg.airtableId)) {
      bump('missing_at');
      await logParity({
        entityId: pg.airtableId, kind: 'missing_at',
        postgresValue: pgToResponse(pg),
        context: { source: 'runParityCheck' },
      });
    }
  }

  return { ran: true, ...summary };
}

// ── Internal exports for tests ──
export const _internal = {
  STOCK_WRITE_ALLOWED,
  pgToResponse,
  responseToPg,
  valuesEqual,
};
