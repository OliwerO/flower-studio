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
 */
export async function atomicStockAdjust(stockId, delta) {
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

    return { stockId, previousQty, newQty };
  });
}
