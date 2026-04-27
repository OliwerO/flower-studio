import PQueue from 'p-queue';
import base, { TABLES } from '../config/airtable.js';

// Rate-limit queue: Airtable allows 5 req/sec.
// Like a loading dock with 5 bays — 5 trucks can unload at once, then the next batch.
const queue = new PQueue({ concurrency: 5, intervalCap: 5, interval: 1000 });

// Stock-specific queue: concurrency 1 — serializes ALL stock quantity changes.
// Like a single-lane loading dock: only one adjustment at a time,
// so two simultaneous orders can't read the same quantity and clobber each other.
const stockQueue = new PQueue({ concurrency: 1 });

// Wraps every Airtable call so it flows through the queue automatically.
const enqueue = (fn) => queue.add(fn);

/**
 * Converts an Airtable record object to a plain JS object.
 * { id, fields: { Name: "Anna", ... } } → { id: "recXXX", Name: "Anna", ... }
 */
function toPlain(record) {
  return { id: record.id, ...record.fields };
}

/**
 * List records from a table.
 * @param {string} tableId - Use TABLES.CUSTOMERS etc.
 * @param {object} options
 * @param {string} [options.filterByFormula] - Airtable formula string
 * @param {Array}  [options.sort]            - [{ field, direction }]
 * @param {number} [options.maxRecords]
 * @param {number} [options.pageSize]        - Max 100
 * @param {Array}  [options.fields]          - Column whitelist
 */
export async function list(tableId, options = {}) {
  return enqueue(() =>
    new Promise((resolve, reject) => {
      const records = [];
      // Only pass options that have real values — Airtable SDK rejects empty strings/arrays
      const selectOptions = {};
      if (options.filterByFormula)   selectOptions.filterByFormula = options.filterByFormula;
      if (options.sort?.length)      selectOptions.sort            = options.sort;
      if (options.pageSize)          selectOptions.pageSize        = options.pageSize;
      if (options.maxRecords)        selectOptions.maxRecords      = options.maxRecords;
      if (options.fields?.length)    selectOptions.fields          = options.fields;

      base(tableId)
        .select(selectOptions)
        .eachPage(
          (page, fetchNext) => {
            page.forEach((r) => records.push(toPlain(r)));
            fetchNext();
          },
          (err) => {
            if (err) reject(err);
            else resolve(records);
          }
        );
    })
  );
}

/**
 * Fetch a single record by its Airtable record ID.
 */
export async function getById(tableId, recordId) {
  return enqueue(async () => {
    const record = await base(tableId).find(recordId);
    return toPlain(record);
  });
}

/**
 * Create a new record. Returns the created record as a plain object.
 */
export async function create(tableId, fields) {
  return enqueue(async () => {
    const record = await base(tableId).create(fields, { typecast: true });
    return toPlain(record);
  });
}

/**
 * Update fields on an existing record (PATCH — only sends changed fields).
 */
export async function update(tableId, recordId, fields) {
  return enqueue(async () => {
    const record = await base(tableId).update(recordId, fields, { typecast: true });
    return toPlain(record);
  });
}

/**
 * Delete a record permanently.
 */
export async function deleteRecord(tableId, recordId) {
  return enqueue(async () => {
    const record = await base(tableId).destroy(recordId);
    return { id: record.id, deleted: true };
  });
}

/**
 * Atomically adjust a stock item's quantity by a delta (negative = deduct, positive = add).
 * Runs through stockQueue (concurrency 1) so concurrent orders are serialized.
 * Returns { previousQty, newQty } for rollback tracking.
 *
 * @param {string} stockId
 * @param {number} delta
 * @param {object} [ctx] - ledger context. Optional for back-compat, but every
 *   new call site should pass it. Without ctx the row still writes (reason
 *   defaults to 'unknown') so the ledger never silently drops a change.
 * @param {string} [ctx.reason]      - enum: order_create | order_cancel_return |
 *                                     order_edit_remove | order_edit_swap |
 *                                     po_receive | loss_writeoff |
 *                                     manual_correction | premade_create |
 *                                     premade_edit | premade_delete | rollback
 * @param {string} [ctx.sourceType]  - enum: order | order_line | stock_order |
 *                                     stock_loss | premade_bouquet | manual
 * @param {string} [ctx.sourceId]    - Airtable record ID of the source record
 * @param {string} [ctx.actor]       - role/name (e.g. 'owner', 'florist', driver name)
 * @param {string} [ctx.note]        - free-text human-readable context
 */
export async function atomicStockAdjust(stockId, delta, ctx = {}) {
  return stockQueue.add(async () => {
    // 1. Read current quantity — fresh, not from a stale snapshot
    const item = await enqueue(async () => {
      const r = await base(TABLES.STOCK).find(stockId);
      return { id: r.id, ...r.fields };
    });
    const previousQty = Number(item['Current Quantity'] || 0);
    const newQty = previousQty + delta;

    // 2. Write new quantity
    await enqueue(() =>
      base(TABLES.STOCK).update(stockId, { 'Current Quantity': newQty }, { typecast: true })
    );

    // 3. Append ledger row (best-effort — never fails the parent operation).
    // If the ledger table isn't configured yet, skip silently. If the write
    // itself fails, log loudly so the gap is visible but don't roll back the
    // stock change (rolling back makes the inconsistency worse, not better).
    // We DO await the write so callers have stable timing — "best-effort"
    // means failures don't propagate, not that we abandon the write.
    if (TABLES.STOCK_LEDGER) {
      const fields = {
        'Stock Item': [stockId],
        'Delta': delta,
        'Previous Quantity': previousQty,
        'New Quantity': newQty,
        'Reason': ctx.reason || 'unknown',
        'Source Type': ctx.sourceType || 'manual',
      };
      if (ctx.sourceId) fields['Source ID'] = ctx.sourceId;
      if (ctx.actor)    fields['Actor'] = ctx.actor;
      if (ctx.note)     fields['Note'] = ctx.note;

      try {
        await enqueue(() => base(TABLES.STOCK_LEDGER).create(fields, { typecast: true }));
      } catch (err) {
        console.error(
          `[STOCK LEDGER] Failed to record adjustment for ${stockId} ` +
          `(delta=${delta}, reason=${ctx.reason || 'unknown'}): ${err.message}`
        );
      }
    }

    return { stockId, previousQty, newQty };
  });
}
