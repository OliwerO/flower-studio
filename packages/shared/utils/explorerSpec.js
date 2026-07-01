// explorerSpec — pure helpers for the Explorer grid (ADR-0010).
//
// The Explorer UI can only ever emit the SAME validated declarative
// `query_records` spec Ask Blossom emits. These helpers build and manipulate
// that spec from UI state, and translate a query result into display columns —
// keeping the ExplorerTab component thin and this logic unit-tested.
//
// Row-shape contract (from dataQueryPack.queryRecordsHandler):
//   - Plain query (no groupBy/aggregate): rows are keyed by the Drizzle jsKey
//     (the descriptor's field.key), which diverges from the model name for
//     renamed columns (e.g. `price` → `priceOverride`).
//   - groupBy/aggregate query: rows are keyed by the groupBy model field names
//     and the aggregate aliases.

export const EXPLORER_ROW_CAP = 200; // mirrors ROW_CAP in dataQueryPack.js

// A blank spec for a chosen entity. limit is left unset so the engine applies
// its own ROW_CAP; sort/filters start empty.
export function EMPTY_EXPLORER_SPEC(entity) {
  return { entity, filters: [], sort: [] };
}

export function activeExplorerFilterCount(spec) {
  return Array.isArray(spec?.filters) ? spec.filters.length : 0;
}

// Ordered display columns for a result set. Each column carries:
//   name  — the MODEL field name (what sort/filter ops must reference; the
//           engine's validateSpec resolves model names, never runtime keys)
//   key   — the RUNTIME row key (how to read the value out of a result row)
//   label — Russian header
//   type  — coarse type hint for the filter control
//   agg   — true for aggregate columns (not sortable/filterable — the engine
//           can't order/filter by an aggregate alias)
//   plain query        → the entity descriptor's fields.
//   groupBy/aggregate  → groupBy field columns + aggregate alias columns.
export function resolveColumns(entityDescriptor, spec) {
  const hasAgg = Array.isArray(spec?.aggregate) && spec.aggregate.length > 0;
  const hasGroup = Array.isArray(spec?.groupBy) && spec.groupBy.length > 0;

  if (!hasAgg && !hasGroup) {
    return (entityDescriptor?.fields || []).map(f => ({
      name: f.name, key: f.key, label: f.label, type: f.type, agg: false,
    }));
  }

  const fieldByName = Object.fromEntries((entityDescriptor?.fields || []).map(f => [f.name, f]));
  const cols = [];
  for (const g of (spec.groupBy || [])) {
    const f = fieldByName[g];
    // groupBy result rows are keyed by the MODEL field name (see handler)
    cols.push({ name: g, key: g, label: f?.label || g, type: f?.type || 'text', agg: false });
  }
  for (const a of (spec.aggregate || [])) {
    cols.push({ name: a.as, key: a.as, label: a.as, type: 'number', agg: true });
  }
  return cols;
}

// Build a fresh single-hop drill query from a clicked row + a descriptor drill.
// Reads the clicked row's value at drill.localKey, then filters the target
// entity's drill.foreignField by it. Returns null when the row has no value to
// drill on (a null FK — nothing to show).
export function buildDrillSpec(drill, row) {
  if (!drill || !row || !drill.to || !drill.foreignField || !drill.localKey) return null;
  const value = row[drill.localKey];
  if (value === null || value === undefined || value === '') return null;
  return {
    entity: drill.to,
    filters: [{ field: drill.foreignField, op: 'eq', value }],
    sort: [],
  };
}

// Format a raw cell value for display given its column type hint. Dates render
// DMY (owner-facing convention); null/undefined render blank.
export function formatExplorerValue(value, type) {
  if (value === null || value === undefined) return '';
  if (type === 'date') {
    const s = value instanceof Date ? value.toISOString() : String(value);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(value);
  }
  if (typeof value === 'boolean') return value ? '✓' : '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ── Sort: Explorer sorts by one column at a time (like the Orders table) ──
// Cycles a column asc → desc → off.
export function toggleSort(spec, field) {
  const current = (spec?.sort || [])[0];
  let next;
  if (!current || current.field !== field) next = [{ field, dir: 'asc' }];
  else if (current.dir === 'asc') next = [{ field, dir: 'desc' }];
  else next = [];
  return { ...spec, sort: next };
}

export function getSortDir(spec, field) {
  const current = (spec?.sort || [])[0];
  return current && current.field === field ? current.dir : null;
}

// ── Filters ──
// Replace every filter on `field` with the supplied entries (already shaped as
// {field, op, value}). The component owns choosing ops per column type; this
// keeps the list surgery pure and idempotent.
export function applyColumnFilter(spec, field, filters) {
  const kept = (spec?.filters || []).filter(f => f.field !== field);
  return { ...spec, filters: [...kept, ...(filters || [])] };
}

// Current filter values on a field, for re-hydrating a popover's inputs.
export function columnFilterValues(spec, field) {
  const out = {};
  for (const f of (spec?.filters || [])) {
    if (f.field !== field) continue;
    if (f.op === 'like') out.like = f.value;
    else if (f.op === 'gte') out.gte = f.value;
    else if (f.op === 'lte') out.lte = f.value;
    else if (f.op === 'eq') out.eq = f.value;
  }
  return out;
}

// CSV of the current grid — header labels + formatted cells, RFC-4180 escaped.
// Respects the loaded row set (which the engine already capped at ROW_CAP).
export function explorerRowsToCsv(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = (columns || []).map(c => esc(c.label)).join(',');
  const body = (rows || []).map(row =>
    (columns || []).map(c => esc(formatExplorerValue(row[c.key], c.type))).join(',')
  );
  return [header, ...body].join('\r\n');
}
