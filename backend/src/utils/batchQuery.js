// Batch large OR(RECORD_ID()=...) queries to stay within Airtable's ~16KB formula limit.
// Splits ID lists into chunks and fetches in parallel.

import * as db from '../services/airtable.js';

const CHUNK_SIZE = 100;

/**
 * Fetch records by IDs in batches.
 * @param {string} tableId - Airtable table ID
 * @param {string[]} ids - Record IDs to fetch
 * @param {object} opts - Additional options (fields, maxRecords, etc.)
 * @returns {Promise<object[]>} All matching records
 */
export async function listByIds(tableId, ids, opts = {}) {
  if (!ids || ids.length === 0) return [];

  const results = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const formula = `OR(${chunk.map(id => `RECORD_ID() = "${id}"`).join(',')})`;
    const records = await db.list(tableId, { ...opts, filterByFormula: formula });
    results.push(...records);
  }
  return results;
}
