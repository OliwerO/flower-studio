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

// Pick the label for the current dashboard language. The descriptor ships both
// `label` (Russian) and `labelEn`; everything downstream (columns, drills,
// entity picker, breadcrumb) reads the single `label` field, so we localize the
// whole schema up front and let the rest of the code stay language-agnostic.
export function localizeSchema(schema, lang) {
  if (!schema || !Array.isArray(schema.entities)) return schema;
  const pick = (o) => (lang === 'en' && o.labelEn ? o.labelEn : o.label);
  return {
    ...schema,
    entities: schema.entities.map((e) => ({
      ...e,
      label: pick(e),
      fields: (e.fields || []).map((f) => ({ ...f, label: pick(f) })),
      drills: (e.drills || []).map((d) => ({ ...d, label: pick(d) })),
    })),
  };
}

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

// ── Deep-join chain (Explorer v2 Wave 2, ADR-0011) ──
// A chain is an ordered edge path (each edge on the previous hop's entity). The
// engine returns rows nested per SQL table name; these helpers translate a chain
// spec + descriptor into hop-prefixed columns and read the nested cells. The UI
// can only ever emit the same validated `chain` spec the engine + Ask Blossom use.

export const EXPLORER_MAX_CHAIN = 4; // mirrors MAX_CHAIN in dataQueryPack.js

export function isChainSpec(spec) {
  return Array.isArray(spec?.chain);
}

// A blank chain rooted at an entity (no hops yet — renders as a plain grid).
export function EMPTY_CHAIN_SPEC(entity) {
  return { entity, chain: [], filters: [], sort: [] };
}

function entityByKey(schema, key) {
  return (schema?.entities || []).find(e => e.key === key) || null;
}

// The ordered entity descriptors on a chain path: [primary, ...hop targets].
// Walks spec.chain against each entity's drills; stops if an edge can't resolve
// (defensive — validateSpec is the real gate).
export function chainPathEntities(schema, spec) {
  const primary = entityByKey(schema, spec?.entity);
  if (!primary) return [];
  const path = [primary];
  let current = primary;
  for (const edge of (spec?.chain || [])) {
    const drill = (current.drills || []).find(d => d.join === edge);
    const next = drill && entityByKey(schema, drill.to);
    if (!next) break;
    path.push(next);
    current = next;
  }
  return path;
}

// Qualified column identity used in spec.columns + the picker: "entity.field"
// (model names — what the engine validates + the assistant emits).
export function columnId(col) {
  return `${col.entityKey}.${col.name}`;
}

// Flat columns across every entity on the path (0 hops = just the primary — the
// unified grid; see #504). Each column:
//   hop        — path index (0 = primary)
//   table      — SQL table name (how the engine nests this entity in a joined row)
//   key        — runtime row key within row[table]
//   name       — model field name (for filters/sort/selection)
//   label      — "Entity · Field" ONLY when the path spans >1 table (so a single
//                table grid stays clean); plain field label otherwise
//   type, colId ("entity.field"), primary (curated default), agg
export function resolveChainColumns(schema, spec) {
  const path = chainPathEntities(schema, spec);
  const multi = path.length > 1;
  const cols = [];
  path.forEach((entity, hop) => {
    for (const f of (entity.fields || [])) {
      cols.push({
        hop,
        entityKey: entity.key,
        table: entity.table || entity.key,
        key: f.key,
        name: f.name,
        label: multi ? `${entity.label} · ${f.label}` : f.label,
        type: f.type,
        colId: `${entity.key}.${f.name}`,
        primary: !!f.primary,
        agg: false,
      });
    }
  });
  return cols;
}

// Read a cell: multi-hop rows nest each hop under its SQL table name; a 0-hop
// plain query returns a flat row → fall back to the runtime key directly.
export function chainCellValue(row, col) {
  if (!row || !col) return undefined;
  const bucket = row[col.table];
  if (bucket && typeof bucket === 'object') return bucket[col.key];
  return row[col.key];
}

// The columns actually shown: the selected set (spec.columns) if any, else the
// curated primary defaults. Keeps path order. An empty/absent selection → defaults
// so the grid never opens blank.
export function visibleColumns(schema, spec) {
  const all = resolveChainColumns(schema, spec);
  if (Array.isArray(spec?.columns) && spec.columns.length) {
    const sel = new Set(spec.columns);
    return all.filter((c) => sel.has(c.colId) || sel.has(c.name));
  }
  return all.filter((c) => c.primary);
}

// Add/remove a column from the selection. Seeds from the current primary
// defaults the first time (so toggling from the default view is predictable).
export function toggleColumn(schema, spec, colId) {
  const base = (Array.isArray(spec?.columns) && spec.columns.length)
    ? spec.columns
    : resolveChainColumns(schema, spec).filter((c) => c.primary).map((c) => c.colId);
  const set = new Set(base);
  if (set.has(colId)) set.delete(colId); else set.add(colId);
  return { ...spec, columns: [...set] };
}

// CSV of a chain grid — reads nested cells via chainCellValue.
export function chainRowsToCsv(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = (columns || []).map(c => esc(c.label)).join(',');
  const body = (rows || []).map(row =>
    (columns || []).map(c => esc(formatExplorerValue(chainCellValue(row, c), c.type))).join(',')
  );
  return [header, ...body].join('\r\n');
}

// Edges the owner can append at the tail of the current chain: the last hop
// entity's drills, minus any that would revisit an entity already on the path
// (cycle guard) — and none once the chain is at max length.
export function availableChainEdges(schema, spec) {
  const path = chainPathEntities(schema, spec);
  if (path.length === 0 || (spec?.chain || []).length >= EXPLORER_MAX_CHAIN) return [];
  const visited = new Set(path.map(e => e.key));
  const tail = path[path.length - 1];
  return (tail.drills || [])
    .filter(d => !visited.has(d.to))
    .map(d => ({ join: d.join, to: d.to, label: d.label, cardinality: d.cardinality }));
}

// True if any hop on the path is a "many" edge → the grid warns about fan-out.
export function chainHasFanOut(schema, spec) {
  const primary = entityByKey(schema, spec?.entity);
  if (!primary) return false;
  let current = primary;
  for (const edge of (spec?.chain || [])) {
    const drill = (current.drills || []).find(d => d.join === edge);
    if (!drill) return false;
    if (drill.cardinality === 'many') return true;
    current = entityByKey(schema, drill.to);
    if (!current) return false;
  }
  return false;
}

// Append a hop. A chain is flat-rows-only, so adding a hop drops any
// groupBy/aggregate (summarize) the 0-hop grid had.
export function chainAppendEdge(spec, join) {
  const { groupBy, aggregate, ...rest } = spec || {};
  return { ...rest, chain: [...(spec?.chain || []), join] };
}

// Drop the last hop. Resets sort (it may reference the removed entity). When the
// chain empties, remove the key entirely so the spec is a clean 0-hop plain grid
// (re-enables summarize/sort/filter).
export function chainRemoveLast(spec) {
  const chain = (spec?.chain || []).slice(0, -1);
  const next = { ...spec, sort: [] };
  if (chain.length) next.chain = chain; else delete next.chain;
  return next;
}
