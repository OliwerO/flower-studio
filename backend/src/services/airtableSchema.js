// Startup-time Airtable schema validator.
//
// Why this exists:
// Twice now we've shipped silent bugs caused by Airtable field-name drift —
// once a trailing space ("Driver Payment ") and once a renamed field. The
// Airtable SDK does not validate field names on write: an unknown field
// rejects the ENTIRE PATCH with a generic 422, and the user sees nothing
// useful. By the time it reaches the UI it looks like a save bug.
//
// This module fetches the base schema from the Airtable Meta API at boot
// and asserts that every field the backend intends to write actually exists
// under the exact name we expect. Missing field → loud crash → caught
// during deploy, not during a customer's shopping run.
//
// IE analogy: incoming-goods inspection at the factory gate, instead of
// finding the defect three stations downstream.
//
// Failure modes:
// - Meta API unreachable / PAT lacks `schema.bases:read` scope → log a
//   warning and continue boot (don't block prod for a guard tool)
// - Field genuinely missing → log clearly and exit(1)

import { TABLES } from '../config/airtable.js';

// Hand-curated list of fields the backend writes to. Reads are NOT
// validated — missing read fields degrade gracefully (undefined), but
// missing write fields fail the whole PATCH.
//
// Add a table here when you start writing to it. Add a field when a route
// or service starts writing it. Stale entries are harmless (they just
// mean "still expected to exist") but missing entries defeat the guard.
const EXPECTED_WRITE_FIELDS = {
  [TABLES.STOCK_ORDER_LINES]: [
    'Stock Orders', 'Stock Item', 'Flower Name', 'Quantity Needed',
    'Supplier', 'Cost Price', 'Sell Price', 'Lot Size', 'Farmer',
    'Driver Status', 'Quantity Found',
    'Alt Supplier', 'Alt Quantity Found', 'Alt Flower Name', 'Alt Cost',
    'Quantity Accepted', 'Write Off Qty', 'Notes',
    'Price Needs Review', 'Eval Status',
  ],
  [TABLES.STOCK_ORDERS]: [
    'Status', 'Assigned Driver', 'Created Date', 'Planned Date',
    'Stock Order ID', 'Supplier Payments', 'Driver Payment',
  ],
  [TABLES.STOCK]: [
    'Display Name', 'Purchase Name', 'Category',
    'Current Quantity', 'Current Cost Price', 'Current Sell Price',
    'Supplier', 'Unit', 'Reorder Threshold', 'Active', 'Last Restocked',
  ],
  [TABLES.PREMADE_BOUQUETS]: [
    'Name', 'Created By', 'Price Override', 'Notes', 'Lines',
  ],
  [TABLES.PREMADE_BOUQUET_LINES]: [
    'Premade Bouquet', 'Stock Item', 'Flower Name', 'Quantity',
    'Cost Price Per Unit', 'Sell Price Per Unit',
  ],
};

/**
 * Fetches the base schema from the Airtable Meta API.
 * Returns a Map<tableId, Set<fieldName>> for fast lookup.
 * Throws on network/auth failure — caller decides whether to block boot.
 */
async function fetchBaseSchema() {
  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;
  const url = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Meta API returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const { tables } = await res.json();
  const schema = new Map();
  for (const table of tables) {
    const fields = new Set(table.fields.map(f => f.name));
    schema.set(table.id, fields);
  }
  return schema;
}

/**
 * Compares EXPECTED_WRITE_FIELDS against the live schema.
 * Returns an array of human-readable problems (empty = all good).
 */
function findMissingFields(schema) {
  const problems = [];
  for (const [tableId, expectedFields] of Object.entries(EXPECTED_WRITE_FIELDS)) {
    if (!tableId) {
      problems.push(`Table ID missing from env vars (check AIRTABLE_*_TABLE)`);
      continue;
    }
    const liveFields = schema.get(tableId);
    if (!liveFields) {
      problems.push(`Table "${tableId}" not found in base schema`);
      continue;
    }
    for (const field of expectedFields) {
      if (!liveFields.has(field)) {
        // Hunt for near-misses (trailing space, capitalization) to make
        // the error message maximally actionable.
        const candidates = [...liveFields].filter(f =>
          f.trim() === field.trim() || f.toLowerCase() === field.toLowerCase()
        );
        const hint = candidates.length > 0
          ? ` — did you mean ${candidates.map(c => `"${c}"`).join(' or ')}?`
          : '';
        problems.push(`Table "${tableId}" missing field "${field}"${hint}`);
      }
    }
  }
  return problems;
}

/**
 * Public entry point. Call once during boot.
 * - All good → logs success and returns
 * - Field missing → logs problems + exits with code 1
 * - Meta API failure → logs warning and returns (does NOT block boot)
 */
export async function validateAirtableSchema() {
  let schema;
  try {
    schema = await fetchBaseSchema();
  } catch (err) {
    console.warn(
      `[SCHEMA CHECK] Skipped — could not reach Airtable Meta API: ${err.message}\n` +
      `              (PAT may lack schema.bases:read scope. Boot continuing.)`
    );
    return;
  }

  const problems = findMissingFields(schema);
  if (problems.length === 0) {
    const totalFields = Object.values(EXPECTED_WRITE_FIELDS)
      .reduce((sum, list) => sum + list.length, 0);
    console.log(`[SCHEMA CHECK] OK — ${totalFields} expected fields verified across ${Object.keys(EXPECTED_WRITE_FIELDS).length} tables`);
    return;
  }

  console.error(`[FATAL] Airtable schema mismatch — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error(`\nFix the field names in Airtable, or update EXPECTED_WRITE_FIELDS in backend/src/services/airtableSchema.js`);
  process.exit(1);
}
