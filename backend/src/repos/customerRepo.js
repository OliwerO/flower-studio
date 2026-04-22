// Customer repository — the persistence boundary for Customer records.
//
// Routes call these methods; this module owns all Airtable specifics
// (field-name aliases, PATCH allowlist, formula quirks, cross-table joins
// for order history, aggregate caching). When Postgres replaces Airtable,
// only this file changes.

import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { pickAllowed } from '../utils/fields.js';
import { listByIds } from '../utils/batchQuery.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';

// ── Field-name translation ──
// Airtable stores some fields under verbose names ("Segment (client)") but the
// rest of the stack reads/writes short aliases ("Segment") for ergonomics.
// Translate at the repo boundary so everything else stays clean.
const CUSTOMERS_FIELD_ALIASES = {
  'Segment':           'Segment (client)',
  'Key person 1':      'Key person 1 (Name + Contact details)',
  'Key person 2':      'Key person 2 (Name + Contact details)',
  'Connected people':  'Connected people (TO SORT into Key 1 & Key 2 person)',
};

// PATCH allowlist uses REAL Airtable field names (not aliases).
// Remap aliases → real names BEFORE pickAllowed runs.
// Omitted fields that don't exist in the live Customers table:
// "Notes / Preferences", "WhatsApp Contact", "Default Delivery Address".
// Prior PATCHes to those silently no-op'd before the startup schema guard.
const CUSTOMERS_PATCH_ALLOWED = [
  'Name', 'Nickname', 'Phone', 'Email', 'Link', 'Language',
  'Home address', 'Sex / Business', 'Segment (client)',
  'Found us from',
  'Connected people (TO SORT into Key 1 & Key 2 person)',
  'Key person 1 (Name + Contact details)',
  'Key person 2 (Name + Contact details)',
  'Key person 1 (important DATE)', 'Key person 2 (important DATE)',
  'Communication method', 'Order Source',
];

// Incoming body { Segment: 'Rare' } → { 'Segment (client)': 'Rare' } so the
// write lands on the real field.
function remapAliasesToReal(body) {
  const out = { ...body };
  for (const [alias, real] of Object.entries(CUSTOMERS_FIELD_ALIASES)) {
    if (alias in out) {
      out[real] = out[alias];
      delete out[alias];
    }
  }
  return out;
}

// Outgoing customer record: expose both the real field and the short alias
// so callers can read c.Segment without caring about the Airtable name.
function addResponseAliases(customer) {
  for (const [alias, real] of Object.entries(CUSTOMERS_FIELD_ALIASES)) {
    if (real in customer && !(alias in customer)) {
      customer[alias] = customer[real];
    }
  }
  return customer;
}

// ── Legacy order date resolution ──
// Legacy Oder Numbers follow YYYYMM-<code>-<DD><Mmm>-<seq>,
// e.g. "202304-WS-Bouquets-15Apr-1". On 2023-era records the dedicated date
// fields are often empty, so the Oder Number IS the authoritative date.
const LEGACY_ODER_DATE_RE = /^(\d{4})(\d{2})-.*-(\d{1,2})[A-Za-z]{3}-\d+$/;

function parseLegacyOderDate(oderNumber) {
  if (!oderNumber || typeof oderNumber !== 'string') return null;
  const m = LEGACY_ODER_DATE_RE.exec(oderNumber);
  if (!m) return null;
  const [, year, month, day] = m;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

function legacyOrderDate(o) {
  return o['Order Delivery Date'] || o['Order date'] || parseLegacyOderDate(o['Oder Number']);
}

// ── Aggregate cache ──
// GET /customers fires on every dashboard mount. Recomputing the full
// legacy+app join each time would cost ~4 Airtable requests and ~2s.
// Cache for 60s — stale-by-at-most-a-minute is fine for "last order date".
const AGG_TTL_MS = 60 * 1000;
let aggCache = { data: null, computedAt: 0 };

// Exposed so tests can reset between runs.
export function _resetAggregateCache() {
  aggCache = { data: null, computedAt: 0 };
}

async function computeAggregateMap() {
  // Trust the customer's linked-record fields (auto-populated by Airtable
  // from nickname matches during owner entry) rather than re-deriving via
  // text match. Orders (list) is a formula returning legacy-order IDs;
  // App Orders is the native linked-record array.
  //
  // Note: 'Final Price' and 'Sell Total' are computed in code (see
  // dashboard.js, orders.js) — they aren't stored Airtable fields in this
  // base. For the aggregate spend we use Price Override as the best
  // available approximation.
  const [legacyOrders, appOrders, customers] = await Promise.all([
    db.list(TABLES.LEGACY_ORDERS, {
      fields: ['Oder Number', 'Order Delivery Date', 'Order date', 'Price (with Delivery)'],
    }),
    db.list(TABLES.ORDERS, {
      fields: ['Order Date', 'Price Override'],
    }),
    db.list(TABLES.CUSTOMERS, {
      fields: ['Orders (list)', 'App Orders'],
    }),
  ]);

  const legacyById = Object.fromEntries(legacyOrders.map(o => [o.id, o]));
  const appById = Object.fromEntries(appOrders.map(o => [o.id, o]));

  const agg = {};
  for (const c of customers) {
    let lastOrderDate = null;
    let orderCount = 0;
    let totalSpend = 0;

    for (const lid of (c['Orders (list)'] || [])) {
      const o = legacyById[lid];
      if (!o) continue;
      const date = legacyOrderDate(o);
      const amount = Number(o['Price (with Delivery)'] || 0);
      orderCount += 1;
      totalSpend += amount;
      if (date && (!lastOrderDate || date > lastOrderDate)) lastOrderDate = date;
    }
    for (const aid of (c['App Orders'] || [])) {
      const o = appById[aid];
      if (!o) continue;
      const date = o['Order Date'];
      const amount = Number(o['Price Override'] || 0);
      orderCount += 1;
      totalSpend += amount;
      if (date && (!lastOrderDate || date > lastOrderDate)) lastOrderDate = date;
    }

    if (orderCount > 0) agg[c.id] = { lastOrderDate, orderCount, totalSpend };
  }

  return agg;
}

// ── Public API ──

/**
 * Per-customer aggregate map { customerId → { lastOrderDate, orderCount, totalSpend } }.
 * Joins legacy + app orders. Cached in-process for 60s.
 */
export async function getAggregateMap() {
  if (aggCache.data && Date.now() - aggCache.computedAt < AGG_TTL_MS) {
    return aggCache.data;
  }
  const data = await computeAggregateMap();
  aggCache = { data, computedAt: Date.now() };
  return data;
}

/**
 * List customers.
 *   - options.search: substring matched case-insensitively across
 *     Name, Nickname, Phone, Link, Email (server-side OR of SEARCH()).
 *   - options.withAggregates (default true): enrich each customer with
 *     `_agg: { lastOrderDate, orderCount, totalSpend }`.
 * Response aliases are always applied.
 */
export async function list({ search, withAggregates = true } = {}) {
  const listOptions = { sort: [{ field: 'Name', direction: 'asc' }] };
  if (search) {
    const q = sanitizeFormulaValue(search);
    listOptions.filterByFormula = `OR(
      SEARCH(LOWER('${q}'), LOWER({Name})),
      SEARCH(LOWER('${q}'), LOWER({Nickname})),
      SEARCH('${q}', {Phone}),
      SEARCH(LOWER('${q}'), LOWER({Link})),
      SEARCH(LOWER('${q}'), LOWER({Email}))
    )`;
  }

  const [customers, aggMap] = await Promise.all([
    db.list(TABLES.CUSTOMERS, listOptions),
    withAggregates ? getAggregateMap() : Promise.resolve({}),
  ]);

  const emptyAgg = { lastOrderDate: null, orderCount: 0, totalSpend: 0 };
  for (const c of customers) {
    addResponseAliases(c);
    if (withAggregates) {
      c._agg = aggMap[c.id] || emptyAgg;
    }
  }
  return customers;
}

/**
 * Fetch a single customer by Airtable record ID.
 * Returns with response aliases + computedSegment (read-only hint based on
 * order count — not written to Airtable).
 */
export async function getById(id) {
  const customer = await db.getById(TABLES.CUSTOMERS, id);
  addResponseAliases(customer);
  const count = customer['App Order Count'] || 0;
  customer.computedSegment =
    count >= 10 ? 'Constant' :
    count >= 2  ? 'Rare' :
    count >= 1  ? 'New' : null;
  return customer;
}

/**
 * Create a new customer. Field aliases are remapped, then the payload runs
 * through the PATCH allowlist so unknown / unsafe keys are rejected silently.
 * Response carries aliases applied.
 */
export async function create(fields) {
  const remapped = remapAliasesToReal(fields);
  const safeFields = pickAllowed(remapped, CUSTOMERS_PATCH_ALLOWED);
  const customer = await db.create(TABLES.CUSTOMERS, safeFields);
  addResponseAliases(customer);
  return customer;
}

/**
 * Update an existing customer. Same alias + allowlist pipeline as create.
 * Throws { statusCode: 400 } if no allowed fields survive filtering — the
 * caller (route) surfaces that as a 400 error to the HTTP client.
 */
export async function update(id, fields) {
  const remapped = remapAliasesToReal(fields);
  const safeFields = pickAllowed(remapped, CUSTOMERS_PATCH_ALLOWED);
  if (Object.keys(safeFields).length === 0) {
    const err = new Error('No valid fields to update.');
    err.statusCode = 400;
    throw err;
  }
  const customer = await db.update(TABLES.CUSTOMERS, id, safeFields);
  addResponseAliases(customer);
  return customer;
}

/**
 * Merged legacy + app order history for one customer, sorted date-desc.
 * Each entry is normalized to:
 *   { id, source: 'legacy'|'app', date, description, amount, status, link, lines, raw }
 *
 * Legacy orders link via the customer's `Orders (list)` formula field (which
 * returns linked record IDs). App orders link via `App Orders`. Both are
 * fetched in parallel via `listByIds` (chunked OR-of-RECORD_ID).
 */
export async function listOrders(customerId) {
  const customer = await db.getById(TABLES.CUSTOMERS, customerId);
  const legacyIds = customer['Orders (list)'] || [];
  const appIds = customer['App Orders'] || [];

  const [legacyOrders, appOrders] = await Promise.all([
    listByIds(TABLES.LEGACY_ORDERS, legacyIds, {
      // 'Oder Number' is misspelled in the live base (sic). If the owner ever
      // renames it to 'Order Number', add that here — the normalizer already
      // checks both via ||.
      fields: [
        'Oder Number',
        'Flowers+Details of order',
        'Order Reason',
        'Order Delivery Date',
        'Order date',
        'Price (with Delivery)',
      ],
    }),
    listByIds(TABLES.ORDERS, appIds, {
      // Bouquet Summary / Final Price / Sell Total are computed in code, not
      // stored Airtable fields. Timeline uses Price Override as a lower-bound
      // amount and falls back to Customer Request for the description.
      fields: [
        'Order Date', 'Customer Request',
        'Price Override', 'Status', 'Order Lines',
      ],
    }),
  ]);

  const normalizedLegacy = legacyOrders.map(o => ({
    id: o.id,
    source: 'legacy',
    date: legacyOrderDate(o),
    description: [
      o['Oder Number'],
      o['Flowers+Details of order'],
      o['Order Reason'],
    ].filter(Boolean).join(' — '),
    // 0 means "price not recorded" on pre-app records. The frontend can check
    // raw['Price (with Delivery)'] if it needs to distinguish 0 zł from missing.
    amount: Number(o['Price (with Delivery)'] || 0),
    status: null,
    link: null,
    lines: null,
    raw: o,
  }));

  const normalizedApp = appOrders.map(o => ({
    id: o.id,
    source: 'app',
    date: o['Order Date'] || null,
    description: o['Customer Request'] || '',
    amount: Number(o['Price Override'] || 0),
    status: o.Status || null,
    link: `/orders/${o.id}`,
    lines: o['Order Lines'] || null,
    raw: o,
  }));

  return [...normalizedLegacy, ...normalizedApp].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
}

// ── Internal exports for tests ──
// Not part of the public API, but pinned here so tests can import them without
// duplicating the constants. If the repo is later split into impl + interface,
// these move with the impl.
export const _internal = {
  CUSTOMERS_FIELD_ALIASES,
  CUSTOMERS_PATCH_ALLOWED,
  remapAliasesToReal,
  addResponseAliases,
  parseLegacyOderDate,
  legacyOrderDate,
};
