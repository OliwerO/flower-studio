// airtable-mock.js — in-memory replacement for airtable-real.js.
// Same surface area: list, getById, create, update, deleteRecord,
// atomicStockAdjust. Backed by a Map<tableId, Map<recordId, record>>
// seeded from JSON fixtures and mutated in place by callers — so a
// florist creating an order, then a driver fetching it, sees the same
// state across requests. State resets only when the process restarts
// or POST /api/test/reset is called from a Playwright spec.
//
// Wire format mirrors what airtable-real.js returns: a plain object
// `{ id: 'recXXX', ...fields }`. Linked record fields are arrays of
// rec ids. Display names are the keys (matching Airtable's API output
// when you pass `fields: [...]`).
//
// Why a Map and not a SQL store: Airtable IS schemaless from the SDK's
// point of view (typed at the table-definition level), and the routes
// happily accept any subset of fields. A Map matches that semantics
// exactly, with zero schema work. The pglite side handles the
// structured data — this side handles the legacy passthrough.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { TABLES } from '../config/airtable.js';
import { evaluateFormula } from './airtable-mock-formula.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, '__fixtures__', 'airtable-test-base.json');

// Deep clone via JSON — safe for the fixture (strings/numbers/arrays of strings).
const deepClone = (x) => JSON.parse(JSON.stringify(x));

// ── In-memory state ──
//
// `tables` is a Map<tableId, Map<recordId, record>>. `tableId` is the
// resolved env-var value (e.g. 'tblOrders' or whatever
// AIRTABLE_ORDERS_TABLE expands to). The fixture stores rows keyed by
// the SAME ids the env vars resolve to in the test backend — this
// works because start-test-backend.js sets AIRTABLE_*_TABLE to the
// known mock ids.
let tables = new Map();
let idCounter = 1;

// ── Reverse-link mirroring ──
//
// In real Airtable, when a child record is created with a forward link
// like `Order: [recOrd1]`, Airtable automatically appends the child's id
// to the parent's reverse-link array (`Orders.Order Lines`). Without
// this, code paths that read `order['Order Lines']` after creating
// lines see an empty array — even though the lines exist. The backend
// relies on these reverse fields in cancelWithStockReturn,
// editBouquetLines, deleteOrder, convert-to-delivery, the dashboard
// list endpoints — basically everywhere.
//
// The map below declares { childTable, childField → parentTable, parentField }.
// On every create + update (and delete, to remove stale links), we
// reconcile the parent's reverse-link array. Tables not in this map
// behave as today (forward links only, no reverse mirroring).
function getReverseLinks() {
  return [
    { childTable: TABLES.ORDER_LINES, childField: 'Order',         parentTable: TABLES.ORDERS,        parentField: 'Order Lines' },
    { childTable: TABLES.DELIVERIES,  childField: 'Linked Order',  parentTable: TABLES.ORDERS,        parentField: 'Deliveries' },
    { childTable: TABLES.STOCK_ORDER_LINES, childField: 'Stock Orders', parentTable: TABLES.STOCK_ORDERS, parentField: 'Stock Order Lines' },
    { childTable: TABLES.ORDER_LINES, childField: 'Stock Item',    parentTable: TABLES.STOCK,         parentField: 'Order Lines' },
  ];
}

function appendToParent(parentTableId, parentId, parentField, childId) {
  const parentTbl = tables.get(parentTableId);
  if (!parentTbl) return;
  const parent = parentTbl.get(parentId);
  if (!parent) return;
  const existing = Array.isArray(parent[parentField]) ? parent[parentField] : [];
  if (!existing.includes(childId)) parent[parentField] = [...existing, childId];
}

function removeFromParent(parentTableId, parentId, parentField, childId) {
  const parentTbl = tables.get(parentTableId);
  if (!parentTbl) return;
  const parent = parentTbl.get(parentId);
  if (!parent) return;
  const existing = Array.isArray(parent[parentField]) ? parent[parentField] : [];
  parent[parentField] = existing.filter(id => id !== childId);
}

function syncReverseLinks(childTableId, childId, prevFields, newFields) {
  const links = getReverseLinks().filter(l => l.childTable === childTableId);
  for (const link of links) {
    const prevParents = Array.isArray(prevFields?.[link.childField]) ? prevFields[link.childField] : [];
    const newParents  = Array.isArray(newFields?.[link.childField])  ? newFields[link.childField]  : [];
    // Removed parents — clean up their reverse arrays.
    for (const p of prevParents) {
      if (!newParents.includes(p)) removeFromParent(link.parentTable, p, link.parentField, childId);
    }
    // Added parents — append child id to their reverse arrays.
    for (const p of newParents) {
      if (!prevParents.includes(p)) appendToParent(link.parentTable, p, link.parentField, childId);
    }
  }
}

// ── Fixture loading ──

function loadFixtureFromFile() {
  const raw = readFileSync(FIXTURE_PATH, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Reset the in-memory state to the JSON fixture. Used at boot and from
 * the test-only POST /api/test/reset endpoint between Playwright specs.
 */
export function resetToFixture(fixtureData) {
  const data = fixtureData || loadFixtureFromFile();
  tables = new Map();
  idCounter = 1;
  for (const [tableId, records] of Object.entries(data)) {
    const m = new Map();
    for (const rec of records) {
      if (!rec.id) throw new Error(`fixture record missing id in table ${tableId}`);
      m.set(rec.id, deepClone(rec));
      // Bump idCounter past any seeded recMockX{N} so generated ids stay unique.
      const match = /^recMockX(\d+)$/.exec(rec.id);
      if (match) {
        const n = Number(match[1]);
        if (n >= idCounter) idCounter = n + 1;
      }
    }
    tables.set(tableId, m);
  }
}

/** Test-only: peek at a table's full Map. */
export function _getTable(tableId) {
  return tables.get(tableId) || new Map();
}

/** Test-only: peek at every table (for /api/test/state). */
export function _snapshotAllTables() {
  const out = {};
  for (const [tableId, recs] of tables.entries()) {
    out[tableId] = [...recs.values()].map(deepClone);
  }
  return out;
}

// Boot-load: pre-populate state so the first request after import sees data.
resetToFixture();

// ── Id generation ──

function nextRecId() {
  return `recMockX${idCounter++}`;
}

// ── Public API (mirrors airtable-real.js) ──

export async function list(tableId, options = {}) {
  const tbl = ensureTable(tableId);
  let rows = [...tbl.values()].map(deepClone);

  if (options.filterByFormula) {
    rows = rows.filter(r => evaluateFormula(options.filterByFormula, r));
  }

  if (Array.isArray(options.sort) && options.sort.length) {
    rows.sort((a, b) => {
      for (const s of options.sort) {
        const av = a[s.field];
        const bv = b[s.field];
        const cmp = compareForSort(av, bv);
        if (cmp !== 0) return s.direction === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }

  if (Array.isArray(options.fields) && options.fields.length) {
    rows = rows.map(r => projectFields(r, options.fields));
  }

  if (options.maxRecords) rows = rows.slice(0, Number(options.maxRecords));

  return rows;
}

export async function getById(tableId, recordId) {
  const tbl = ensureTable(tableId);
  const r = tbl.get(recordId);
  if (!r) {
    const err = new Error(`Record not found: ${recordId} in ${tableId}`);
    err.statusCode = 404;
    throw err;
  }
  return deepClone(r);
}

export async function create(tableId, fields) {
  const tbl = ensureTable(tableId);
  const id = nextRecId();
  const rec = { id, ...deepClone(fields) };
  tbl.set(id, rec);
  // Mirror forward links into parents' reverse-link arrays. Without this,
  // code that reads `order['Order Lines']` after creating lines sees [].
  syncReverseLinks(tableId, id, {}, rec);
  return deepClone(rec);
}

export async function update(tableId, recordId, fields) {
  const tbl = ensureTable(tableId);
  const existing = tbl.get(recordId);
  if (!existing) {
    const err = new Error(`Record not found: ${recordId} in ${tableId}`);
    err.statusCode = 404;
    throw err;
  }
  const prev = deepClone(existing);
  // PATCH semantics — only overwrite the keys present in `fields`.
  for (const [k, v] of Object.entries(fields)) {
    existing[k] = deepClone(v);
  }
  // If a forward-link field changed, fix up parents' reverse arrays.
  syncReverseLinks(tableId, recordId, prev, existing);
  return deepClone(existing);
}

export async function deleteRecord(tableId, recordId) {
  const tbl = ensureTable(tableId);
  const existing = tbl.get(recordId);
  if (!existing) {
    const err = new Error(`Record not found: ${recordId} in ${tableId}`);
    err.statusCode = 404;
    throw err;
  }
  // Remove this id from every parent's reverse-link array first.
  syncReverseLinks(tableId, recordId, existing, {});
  tbl.delete(recordId);
  return { id: recordId, deleted: true };
}

/**
 * Mirrors the stockQueue-serialised atomicStockAdjust on the real client.
 * Single-threaded JS event loop already gives us atomicity here, so the
 * read-then-write isn't a race — but we keep the same return shape for
 * caller compatibility.
 */
export async function atomicStockAdjust(stockId, delta) {
  const tbl = ensureTable(TABLES.STOCK);
  const item = tbl.get(stockId);
  if (!item) {
    const err = new Error(`Stock record not found: ${stockId}`);
    err.statusCode = 404;
    throw err;
  }
  const previousQty = Number(item['Current Quantity'] || 0);
  const newQty = previousQty + delta;
  item['Current Quantity'] = newQty;
  return { stockId, previousQty, newQty };
}

// ── Internal helpers ──

function ensureTable(tableId) {
  if (!tableId) throw new Error('Mock airtable: table id is undefined (check TABLES env vars)');
  if (!tables.has(tableId)) tables.set(tableId, new Map());
  return tables.get(tableId);
}

function compareForSort(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;   // nulls last (matches airtable.js's NULLS LAST default)
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function projectFields(rec, fields) {
  const out = { id: rec.id };
  for (const f of fields) {
    if (f in rec) out[f] = rec[f];
  }
  return out;
}
