// backend/src/services/assistantTools/freeTextPack.js
//
// Open-ended free-text search across allow-listed prose fields on orders.
//
// Phase 1: Postgres ILIKE keyword search — zero new infra.
//   Searches customer_request / florist_note / greeting_card_text on orders.
//   Returns a snippet around the match + a link to open the record.
//   The model summarises; it never invents text not present in a snippet.
//
// Phase 2 (optional): pgvector semantic search if keyword search proves too
//   literal. See RFC: docs/superpowers/plans/2026-06-30-assistant-extensions-rfc.md
//
// CUSTOMERS NOTE: the customers table (Phase 5) has no free-text notes column.
//   When one lands (e.g. a `notes` column), add a customerRepo.searchNotes call
//   here and uncomment the customers entry in TEXT_FIELDS.

import * as orderRepo from '../../repos/orderRepo.js';

const SNIPPET_RADIUS = 80;  // chars of context around the match
const DEFAULT_LIMIT  = 15;
const MAX_LIMIT      = 50;

// Allow-listed free-text fields per scope. Only these columns are ever searched.
// Must match columns that ACTUALLY exist in backend/src/db/schema.js.
const TEXT_FIELDS = {
  orders: [
    { col: 'customerRequest',  label: 'Customer request' },
    { col: 'floristNote',      label: 'Florist note'     },
    { col: 'greetingCardText', label: 'Card message'     },
  ],
  // customers: (no notes column in Phase 5 schema — add here when it lands)
};

/**
 * Extract a short snippet around the first occurrence of `query` in `text`.
 * Adds ellipsis when the snippet doesn't start/end at the string boundaries.
 */
function makeSnippet(text, query, radius = SNIPPET_RADIUS) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2);
  const start  = Math.max(0, idx - radius);
  const end    = Math.min(text.length, idx + query.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return prefix + text.slice(start, end) + suffix;
}

/**
 * search_text — keyword search across allow-listed free-text fields.
 *
 * @param {{
 *   query: string,                       // the phrase to find
 *   scope?: 'orders'|'customers'|'all',  // default 'all'
 *   limit?: number,
 * }} input
 * @returns {Promise<{
 *   query: string, scope: string, matchedCount: number, truncated: boolean,
 *   results: Array<{ entity:string, id:string, appOrderId?:string, field:string, snippet:string, link:string }>,
 * }>}
 */
export async function searchTextHandler({ query, scope, limit } = {}) {
  const q = (query ?? '').trim();

  // Empty query → empty result (no error).
  if (!q) {
    return { query: q, scope: scope ?? 'all', matchedCount: 0, truncated: false, results: [] };
  }

  const normalizedScope = ['orders', 'customers', 'all'].includes(scope) ? scope : 'all';
  const cap = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const results = [];

  // ── Orders scope ──
  if (normalizedScope === 'orders' || normalizedScope === 'all') {
    // Fetch cap+1 rows so we can detect whether there are more results in the DB.
    const rows = await orderRepo.searchFreeText({ query: q, limit: cap + 1 });
    const truncated = rows.length > cap;
    const sliced = truncated ? rows.slice(0, cap) : rows;

    for (const row of sliced) {
      const orderId = row.airtableId || row.id;
      for (const { col, label } of TEXT_FIELDS.orders) {
        const text = row[col];
        if (text && text.toLowerCase().includes(q.toLowerCase())) {
          results.push({
            entity:     'order',
            id:         orderId,
            appOrderId: row.appOrderId,
            field:      label,
            snippet:    makeSnippet(text, q),
            link:       `/orders/${orderId}`,
          });
        }
      }
    }

    if (truncated) {
      return {
        query: q,
        scope: normalizedScope,
        matchedCount: results.length,
        truncated: true,
        results,
      };
    }
  }

  // ── Customers scope ──
  // No free-text notes column in Phase 5 — always returns empty.
  // Future: add customerRepo.searchNotes({ query: q, limit: cap }) here.

  return {
    query:        q,
    scope:        normalizedScope,
    matchedCount: results.length,
    truncated:    false,
    results,
  };
}
