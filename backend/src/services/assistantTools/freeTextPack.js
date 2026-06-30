// backend/src/services/assistantTools/freeTextPack.js
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ SKELETON — NOT REGISTERED in index.js yet. Inert until wired + tested.    │
// └─────────────────────────────────────────────────────────────────────────┘
//
// The open-ended / unstructured layer. The 20 structured tools answer "what are my
// numbers"; this answers questions over FREE TEXT the owner typed into records —
// card messages, customer requests, florist/driver notes, customer notes. These are
// prose, not aggregates, so a structured tool can't model them.
//
// PHASE 1 (this skeleton): Postgres substring / full-text search — zero new infra.
//   ILIKE '%query%' (or to_tsvector/plainto_tsquery) across an allow-listed set of
//   text columns; return a snippet + the record to open. Good for "find the order
//   where the customer asked for blue hydrangeas", "which orders mention a wedding".
//
// PHASE 2 (optional, see RFC): semantic search via pgvector embeddings — true RAG.
//   Embed the text fields, retrieve by cosine similarity for fuzzy/conceptual queries
//   ("complaints about late delivery"). Only worth it if Phase-1 keyword search proves
//   too literal. Adds an embedding pipeline + an index to maintain.
//
// See RFC: docs/superpowers/plans/2026-06-30-assistant-extensions-rfc.md

// import { db } from '../../db/index.js';
// import { sql } from 'drizzle-orm';

const SNIPPET_RADIUS = 80;  // chars of context around the match
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;

// Allow-listed free-text fields per scope. Only these columns are ever searched —
// keeps the tool away from structured/sensitive columns.
const TEXT_FIELDS = {
  orders: [
    { col: 'customer_request', label: 'Customer request' },
    { col: 'card_message',     label: 'Card message' },
    { col: 'florist_note',     label: 'Florist note' },
    { col: 'driver_note',      label: 'Driver note' },
  ],
  customers: [
    { col: 'notes', label: 'Customer notes' },
  ],
};

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
 *   results: Array<{ entity:string, id:string, field:string, snippet:string, link:string }>,
 * }>}
 */
export async function searchTextHandler(/* input */) {
  // 1. Resolve scopes → the TEXT_FIELDS columns to search.
  // 2. For each column: WHERE <col> ILIKE '%' || :query || '%' (parameterized),
  //    select id + a snippet (substring around the match) + build a link (/orders/:id etc).
  //    Run as one UNION-style pass or per-column queries; cap at min(limit, MAX_LIMIT).
  // 3. return { query, scope, matchedCount, truncated, results }.
  // NOTE: this returns WHERE the text was found + a snippet — the model then summarizes;
  //       it never fabricates content not present in a snippet.
  throw new Error('freeTextPack.searchTextHandler not implemented (skeleton)');
}

// When ready, register in index.js, e.g.:
//   {
//     name: 'search_text',
//     description: 'Search the free-text the owner/florists/drivers typed on records — card messages, ' +
//       'customer requests, florist/driver notes, customer notes. Use for "find the order that mentions X", ' +
//       '"which customers asked about weddings", "any notes about late delivery". Returns matching snippets + ' +
//       'the record to open; it does not invent text that is not in a snippet.',
//     input_schema: { /* query (required), scope, limit */ },
//     handler: searchTextHandler,
//   }
