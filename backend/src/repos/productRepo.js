// Product repository — persistence boundary for the product image URL cache.
//
// The bouquet image asset lives in Wix Media. This repo only persists the
// URL string in the local cache (Airtable Product Config today, Postgres
// product_config.image_url after Phase 6) so the florist + delivery apps
// can render images without calling Wix on every read.
//
// One Wix product → many Airtable Product Config rows (one per variant).
// All variants of a single bouquet share the same image — setImage writes
// the same URL to every row whose 'Wix Product ID' equals the input.
//
// Phase 6 dispatch: when PRODUCT_BACKEND === 'postgres', methods will read
// and write product_config in PG instead. The shape of the public methods
// is identical so callers don't change. (Not implemented in this task —
// added when Phase 6 lands; see backend/CLAUDE.md migration table.)

import * as airtable from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';

async function listVariants(wixProductId) {
  return airtable.list(TABLES.PRODUCT_CONFIG, {
    filterByFormula: `{Wix Product ID} = '${sanitizeFormulaValue(wixProductId)}'`,
    fields: ['Wix Product ID', 'Wix Variant ID', 'Image URL'],
  });
}

/**
 * Writes imageUrl to every Product Config row matching wixProductId.
 * @returns {Promise<{ updatedCount: number }>}
 */
export async function setImage(wixProductId, imageUrl) {
  const rows = await listVariants(wixProductId);
  if (rows.length === 0) return { updatedCount: 0 };
  // Sequential by design — services/airtable.js already serializes writes
  // via p-queue (5/sec). Promise.all here wouldn't add parallelism and
  // would obscure which row failed on a partial outage.
  for (const row of rows) {
    await airtable.update(TABLES.PRODUCT_CONFIG, row.id, { 'Image URL': imageUrl });
  }
  return { updatedCount: rows.length };
}

/**
 * Returns the Image URL of the first matching variant, or '' if none.
 */
export async function getImage(wixProductId) {
  const rows = await listVariants(wixProductId);
  return rows[0]?.['Image URL'] || '';
}

/**
 * Batch lookup. Returns Map<wixProductId, imageUrl> for the subset that
 * has both a Product Config row and a non-empty Image URL.
 * @param {string[]} wixProductIds
 * @returns {Promise<Map<string, string>>}
 */
export async function getImagesBatch(wixProductIds) {
  const map = new Map();
  if (!wixProductIds || wixProductIds.length === 0) return map;
  // Airtable's filterByFormula has a ~16KB limit. Chunk OR clauses to stay safely under it.
  const CHUNK_SIZE = 100;
  for (let i = 0; i < wixProductIds.length; i += CHUNK_SIZE) {
    const chunk = wixProductIds.slice(i, i + CHUNK_SIZE);
    const orClauses = chunk
      .map(id => `{Wix Product ID} = '${sanitizeFormulaValue(id)}'`)
      .join(',');
    const rows = await airtable.list(TABLES.PRODUCT_CONFIG, {
      filterByFormula: `OR(${orClauses})`,
      fields: ['Wix Product ID', 'Image URL'],
    });
    for (const row of rows) {
      const pid = row['Wix Product ID'];
      const url = row['Image URL'];
      if (pid && url && !map.has(pid)) map.set(pid, url);
    }
  }
  return map;
}
