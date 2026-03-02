import PQueue from 'p-queue';
import base, { TABLES } from '../config/airtable.js';

// Rate-limit queue: Airtable allows 5 req/sec.
// Like a loading dock with 5 bays — 5 trucks can unload at once, then the next batch.
const queue = new PQueue({ concurrency: 5, intervalCap: 5, interval: 1000 });

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
      base(tableId)
        .select({
          filterByFormula: options.filterByFormula || '',
          sort: options.sort || [],
          maxRecords: options.maxRecords,
          pageSize: options.pageSize || 100,
          fields: options.fields,
        })
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
    const record = await base(tableId).create(fields);
    return toPlain(record);
  });
}

/**
 * Update fields on an existing record (PATCH — only sends changed fields).
 */
export async function update(tableId, recordId, fields) {
  return enqueue(async () => {
    const record = await base(tableId).update(recordId, fields);
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
