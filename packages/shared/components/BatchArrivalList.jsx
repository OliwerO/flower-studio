/**
 * BatchArrivalList — flat sortable Stock table.
 *
 * Rows are merged stems grouped by (Type · Colour · Size · Cultivar · Sell).
 * Stems with the same Variety AND the same sell price collapse into one row
 * regardless of arrival date, supplier, or cost — they share a physical bucket
 * and are fungible from the florist's perspective. Cost / supplier divergence
 * folds into the row (cost shows the newest receive; supplier badge shows
 * "mixed" when more than one).
 *
 * Columns: Type · Variety · Available · Cost · Sell · Markup · Supplier.
 *
 * Props:
 *   groups      — Variety groups (same shape consumed by VarietyListItem)
 *   t           — translations
 *   onRowClick  — callback(stockIds[]) — host opens trace / detail.
 *                 Receives the array of underlying stock_ids in the merged row.
 *   today       — optional ISO date override
 */
import { useMemo, useState } from 'react';
import { byDateDesc } from '../utils/sortByDate.js';
import InlinePriceField from './InlinePriceField.jsx';
import ColumnFilterPopover from './ColumnFilterPopover.jsx';
import { EMPTY_STOCK_FILTER, stockRowMatchesFilter } from '../utils/stockFilters.js';

// Variety identity gets the widest range so long cultivar names (e.g. "Hawaiian
// Coral", "Sarah Bernhardt") render in full; long names wrap a second line
// rather than truncating. `arrived` shows the newest receive date of the
// merged row — visible label + sortable, even though Tag-per-Batch is gone.
//
// CR-05 lock-step note: the FIRST THREE column tokens here (6rem, minmax(9rem,1.5fr),
// 3.5rem) are mirrored as the Type / Variety / amount columns in
// packages/shared/components/stockRowGrid.js (STOCK_CARD_GRID_DASHBOARD).
// If you change these widths, update stockRowGrid.js in the same PR so the
// ShortfallSummary and PendingArrivalsPanel cards stay aligned with this table.
const GRID_COLS = 'grid-cols-[6rem_minmax(9rem,13rem)_4.75rem_3rem_3rem_3rem_3.5rem_minmax(4rem,1fr)]';

const COLS = [
  { key: 'type',       label: 'type',       align: 'left'   },
  { key: 'variety',    label: 'variety',    align: 'left'   },
  { key: 'qty',        label: 'available',  align: 'right'  },
  { key: 'cost',       label: 'cost',       align: 'right'  },
  { key: 'sell',       label: 'sell',       align: 'right'  },
  { key: 'markup',     label: 'markup',     align: 'right'  },
  { key: 'arrived',    label: 'arrived',    align: 'right'  },
  { key: 'supplier',   label: 'supplier',   align: 'left'   },
];

export default function BatchArrivalList({ groups, reservations = new Map(), t, onRowClick, onPatchPriceBulk, today, traceStockIds, traceNode, hideEmpty = false, filter = EMPTY_STOCK_FILTER, onFilterChange, footer = false }) {
  const today_ = today ?? new Date().toISOString().slice(0, 10);
  const [sortKey, setSortKey] = useState('type');
  const [sortDir, setSortDir] = useState('asc');

  // E1: per-column filtering is client-side (the grouped set is already loaded).
  // A column popover patches one field; the host owns the filter object so a
  // single "Filters (n)" badge + reset can live next to the view pills.
  const filterable = typeof onFilterChange === 'function';
  const setField = (patch) => onFilterChange && onFilterChange({ ...filter, ...patch });

  // hideEmpty (the dashboard "In stock" filter): drop merged rows with no
  // on-hand stems and no premade reservation. The group-level filter keeps a
  // Variety alive as long as ONE of its sell tiers has stock, but each other
  // (0-qty, different-sell-price) tier still flattened to its own row here —
  // that's the pile of "0 available" duplicates the owner saw. (issue A)
  const rows = useMemo(() => {
    let all = flatten(groups, reservations, today_);
    if (hideEmpty) all = all.filter(r => r.qty > 0 || r.reserved > 0);
    // E1: per-column filter, applied in memory on the flattened rows.
    all = all.filter(r => stockRowMatchesFilter(r, filter));
    return all;
  }, [groups, reservations, today_, hideEmpty, filter]);

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    const dir = sortDir === 'asc' ? 1 : -1;
    function cmp(av, bv, d) {
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * d;
      return String(av).localeCompare(String(bv)) * d;
    }
    arr.sort((a, b) => {
      const primary = cmp(a[sortKey], b[sortKey], dir);
      if (primary !== 0) return primary;
      // Stable secondary sort by (type, variety) asc so same-key ties read
      // alphabetically — matters most for the default Type sort where every
      // Peony / Rose / Hydrangea ties on Type alone.
      const t = cmp(a.type, b.type, 1);
      if (t !== 0) return t;
      return cmp(a.variety, b.variety, 1);
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  function clickHeader(key) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(['qty', 'cost', 'sell', 'markup', 'arrived'].includes(key) ? 'desc' : 'asc');
    }
  }

  // E2: totals across the currently-visible (filtered + sorted) rows.
  const totals = useMemo(() => {
    let count = 0, qty = 0, cost = 0, sell = 0;
    for (const r of sortedRows) {
      count += 1;
      qty += Number(r.qty) || 0;
      if (r.cost != null) cost += (Number(r.cost) || 0) * (Number(r.qty) || 0);
      if (r.sell != null) sell += (Number(r.sell) || 0) * (Number(r.qty) || 0);
    }
    return { count, qty, cost, sell };
  }, [sortedRows]);

  return (
    <div data-testid="batch-arrival-list" className="ios-card overflow-hidden">
      <div className={`grid ${GRID_COLS} gap-3 px-4 py-2 text-[10px] uppercase tracking-wide bg-gray-50 border-b border-gray-100 select-none`}>
        {COLS.map(c => {
          const active = sortKey === c.key;
          const arrow = active ? (sortDir === 'asc' ? '↑' : '↓') : '';
          const fActive = filterable && columnFilterActive(c.key, filter);
          return (
            <div key={c.key} className={`group flex items-center gap-0.5 ${c.align === 'right' ? 'justify-end' : c.align === 'center' ? 'justify-center' : ''}`}>
              <button
                type="button"
                data-testid={`sort-${c.key}`}
                onClick={() => clickHeader(c.key)}
                className={`flex items-center gap-1 ${active ? 'text-gray-700 font-semibold' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <span>{t[c.label] ?? c.label}</span>
                {arrow && <span className="text-[9px]">{arrow}</span>}
              </button>
              {filterable && (
                <ColumnFilterPopover active={fActive} title={t[c.label] ?? c.label} align={c.align === 'right' ? 'right' : 'left'}>
                  <ColumnFilterControl colKey={c.key} filter={filter} setField={setField} t={t} />
                </ColumnFilterPopover>
              )}
            </div>
          );
        })}
      </div>

      {sortedRows.length === 0 ? (
        <p data-testid="batch-arrival-empty" className="text-center text-sm text-gray-400 py-12">
          {t.noStockFound ?? 'No batches'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {sortedRows.map(b => {
            const joinedIds = b.stockIds.join(',');
            const isTraceActive = traceStockIds && joinedIds === traceStockIds;
            return (
              <BatchRow
                key={b.id}
                b={b}
                t={t}
                onRowClick={onRowClick}
                onPatchPriceBulk={onPatchPriceBulk}
                traceNode={isTraceActive ? traceNode : null}
              />
            );
          })}
        </ul>
      )}

      {/* E2: totals footer (item count · qty sum · cost value · sell value)
          over the visible rows — restores the number the owner lost moving off
          the legacy flat table. */}
      {footer && sortedRows.length > 0 && (
        <div data-testid="batch-arrival-footer" className={`grid ${GRID_COLS} gap-3 px-4 py-2 text-xs font-semibold bg-gray-50/80 border-t-2 border-gray-200`}>
          <span className="uppercase tracking-wide text-gray-500">{t.total ?? 'Total'} ({totals.count})</span>
          <span></span>
          <span className="text-right tabular-nums text-gray-900">{totals.qty}</span>
          <span className="text-right tabular-nums text-gray-700">{totals.cost.toFixed(0)}</span>
          <span className="text-right tabular-nums text-gray-700">{totals.sell.toFixed(0)}</span>
          <span></span><span></span><span></span>
        </div>
      )}
    </div>
  );
}

// Whether a given column has an active filter dimension.
function columnFilterActive(key, f) {
  if (!f) return false;
  switch (key) {
    case 'type':     return !!f.typeQuery;
    case 'variety':  return !!f.varietyQuery;
    case 'supplier': return !!f.supplierQuery;
    case 'qty':      return f.qtyMin != null || f.qtyMax != null;
    case 'cost':     return f.costMin != null || f.costMax != null;
    case 'sell':     return f.sellMin != null || f.sellMax != null;
    case 'markup':   return f.markupMin != null || f.markupMax != null;
    case 'arrived':  return !!f.arrivedFrom || !!f.arrivedTo;
    default:         return false;
  }
}

// The control rendered inside a column's filter popover.
function ColumnFilterControl({ colKey, filter, setField, t }) {
  const inputCls = 'w-full text-xs px-2 py-1 rounded-md border border-gray-200 focus:outline-none focus:ring-1 focus:ring-brand-300';
  const num = (v) => (v === '' || v == null ? null : Number(v));
  switch (colKey) {
    case 'type':
    case 'variety':
    case 'supplier': {
      const field = colKey === 'type' ? 'typeQuery' : colKey === 'variety' ? 'varietyQuery' : 'supplierQuery';
      return (
        <input
          type="text"
          autoFocus
          value={filter[field]}
          onChange={(e) => setField({ [field]: e.target.value })}
          placeholder={t.filterContains ?? 'contains…'}
          className={inputCls}
        />
      );
    }
    case 'qty':
    case 'cost':
    case 'sell':
    case 'markup': {
      const minF = `${colKey}Min`, maxF = `${colKey}Max`;
      return (
        <div className="flex items-center gap-1">
          <input type="number" inputMode="decimal" value={filter[minF] ?? ''} onChange={(e) => setField({ [minF]: num(e.target.value) })} placeholder={t.filterMin ?? 'min'} className={inputCls} />
          <span className="text-gray-300">–</span>
          <input type="number" inputMode="decimal" value={filter[maxF] ?? ''} onChange={(e) => setField({ [maxF]: num(e.target.value) })} placeholder={t.filterMax ?? 'max'} className={inputCls} />
        </div>
      );
    }
    case 'arrived':
      return (
        <div className="space-y-1">
          <input type="date" value={filter.arrivedFrom} onChange={(e) => setField({ arrivedFrom: e.target.value })} className={inputCls} />
          <input type="date" value={filter.arrivedTo} onChange={(e) => setField({ arrivedTo: e.target.value })} className={inputCls} />
        </div>
      );
    default:
      return null;
  }
}

function BatchRow({ b, t, onRowClick, onPatchPriceBulk, traceNode }) {
  const markup = b.cost > 0 && b.sell > 0 ? (b.sell / b.cost) : null;
  const editable = !!onPatchPriceBulk;
  const expandable = b.underlying.length > 1;
  const [expanded, setExpanded] = useState(false);

  function save(field, next) {
    if (next === b[field]) return;
    onPatchPriceBulk(b.stockIds, { [field]: next });
  }

  function toggleExpand(e) {
    e.stopPropagation();
    setExpanded(v => !v);
  }

  return (
    <li>
      <div
        className={`relative w-full grid ${GRID_COLS} gap-3 px-4 py-2 text-sm text-left items-baseline active:bg-gray-50 transition-colors`}
      >
        {/* Background tap-target opens trace; price + chevron live above it via z-stacking */}
        <button
          type="button"
          data-testid="batch-arrival-row"
          data-stock-ids={b.stockIds.join(',')}
          onClick={() => onRowClick && onRowClick(b.stockIds)}
          className="absolute inset-0 z-0"
          aria-label={t.batchTraceTitle || 'Open trace'}
        />
        {expandable && (
          <button
            type="button"
            data-testid="batch-row-expand"
            data-expanded={String(expanded)}
            onClick={toggleExpand}
            aria-label={expanded ? (t.collapse ?? 'Collapse') : (t.expand ?? 'Expand')}
            className="absolute left-0 top-0 bottom-0 w-6 z-10 flex items-center justify-center text-gray-400 hover:text-gray-700"
          >
            <span className={`inline-block transition-transform text-xs ${expanded ? 'rotate-90' : ''}`}>›</span>
          </button>
        )}
        <span className="relative z-10 font-semibold text-gray-900 break-words pointer-events-none">

          {b.type || '—'}
        </span>
        <span className="relative z-10 flex flex-wrap items-baseline gap-x-1.5 gap-y-0 min-w-0 pointer-events-none">
          {b.colour && <span className="font-semibold text-gray-900">{b.colour}</span>}
          {b.size_cm != null && <span className="text-xs text-gray-600 tabular-nums shrink-0">{b.size_cm}cm</span>}
          {b.cultivar && <span className="text-xs text-gray-400 italic break-words">{b.cultivar}</span>}
          {!b.colour && !b.size_cm && !b.cultivar && <span className="text-gray-400">—</span>}
        </span>
        <span className="relative z-10 text-right flex flex-col items-end leading-tight pointer-events-none">
          <span className="text-base font-bold tabular-nums text-gray-900">{b.reserved > 0 ? b.qty - b.reserved : b.qty}</span>
          {b.reserved > 0 && (
            <span className="text-[10px] text-indigo-600 tabular-nums whitespace-nowrap">· {b.reserved} {t.inPremade ?? 'in premade'}</span>
          )}
        </span>
        <span className="relative z-10 text-right tabular-nums text-gray-700" title={b.costMixed ? (t.costMixedTooltip ?? 'Mixed costs across receives — showing newest') : undefined}>
          {editable
            ? <InlinePriceField value={b.cost} testid="batch-edit-cost" onSave={(v) => save('cost', v)} suffix={b.costMixed ? <span className="text-gray-400 text-[10px] ml-0.5">·{t.costMixedShort ?? 'mixed'}</span> : null} />
            : (b.cost != null
                ? <>{b.cost.toFixed(2)}{b.costMixed && <span className="text-gray-400 text-[10px] ml-0.5">·{t.costMixedShort ?? 'mixed'}</span>}</>
                : '—')}
        </span>
        <span className="relative z-10 text-right tabular-nums text-gray-700">
          {editable
            ? <InlinePriceField value={b.sell} testid="batch-edit-sell" onSave={(v) => save('sell', v)} />
            : (b.sell != null ? b.sell.toFixed(2) : '—')}
        </span>
        <span className="relative z-10 text-right pointer-events-none">
          {markup ? (
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums ${
              markup >= 2.5 ? 'bg-emerald-100 text-emerald-700' : markup >= 1.8 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
            }`}>
              ×{markup.toFixed(1)}
            </span>
          ) : <span className="text-gray-300">—</span>}
        </span>
        <span className="relative z-10 text-right text-[10px] tabular-nums text-gray-500 pointer-events-none">
          {formatArrived(b.arrived) || '—'}
        </span>
        <span className="relative z-10 text-xs text-gray-600 truncate pointer-events-none" title={b.supplierAll && b.supplierAll.length > 1 ? b.supplierAll.join(', ') : undefined}>
          {b.supplier || '—'}
        </span>
      </div>
      {expandable && expanded && (
        <ExpandedDetails underlying={b.underlying} t={t} />
      )}
      {traceNode && (
        <div data-testid="batch-row-trace" className="bg-blue-50/60 border-t border-blue-100">
          {traceNode}
        </div>
      )}
    </li>
  );
}

function ExpandedDetails({ underlying, t }) {
  const sorted = useMemo(
    () => [...underlying].sort(byDateDesc),
    [underlying],
  );

  return (
    <div data-testid="batch-row-detail" className="bg-gray-50 border-t border-gray-100 px-4 py-2">
      <div className="grid grid-cols-[5rem_3rem_3.5rem_minmax(4rem,1fr)] gap-2 text-[10px] uppercase tracking-wide text-gray-400 pb-1">
        <span>{t.arrived ?? 'arrived'}</span>
        <span className="text-right">{t.qty ?? 'qty'}</span>
        <span className="text-right">{t.cost ?? 'cost'}</span>
        <span className="truncate">{t.supplier ?? 'supplier'}</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {sorted.map(u => (
          <li
            key={u.id}
            className="grid grid-cols-[5rem_3rem_3.5rem_minmax(4rem,1fr)] gap-2 py-1.5 text-xs text-gray-700"
          >
            <span className="tabular-nums">{formatDMY(u.date) || '—'}</span>
            <span className="text-right tabular-nums">{u.qty}</span>
            <span className="text-right tabular-nums">{u.cost != null ? u.cost.toFixed(2) : '—'}</span>
            <span className="truncate" title={u.supplier ?? undefined}>{u.supplier || '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatDMY(iso) {
  if (!iso) return '';
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso);
}

function formatArrived(iso) {
  if (!iso) return null;
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}` : null;
}

// Merge rule (owner-confirmed 2026-05-31): rows collapse into one display row
// when Type · Colour · Size · Cultivar · Sell all match. Cost differences,
// supplier differences, farmer differences, and arrival-date differences fold
// into the merged row (stems are fungible in one physical bucket). Different
// sell prices stay separate so the florist can still see what to charge.
function flatten(groups, reservations, today) {
  const merged = new Map();
  for (const g of groups ?? []) {
    for (const row of g.rows ?? []) {
      const qty = Number(row.current_quantity);
      if (qty < 0) continue;
      const sell = readNum(row, 'Current Sell Price', 'current_sell_price');
      const cost = readNum(row, 'Current Cost Price', 'current_cost_price');
      const supplier = row.Supplier ?? row.supplier ?? null;
      const date = row.date ?? null;
      const key = [
        g.type_name ?? '',
        g.colour ?? '',
        g.size_cm != null ? String(g.size_cm) : '',
        g.cultivar ?? '',
        sell != null ? sell.toFixed(2) : '',
      ].join('|');

      let m = merged.get(key);
      if (!m) {
        const varietyLabel = [g.colour, g.size_cm, g.cultivar].filter(v => v != null).join(' ');
        m = {
          stockIds:  [],
          type:      g.type_name ?? '—',
          colour:    g.colour ?? null,
          size_cm:   g.size_cm ?? null,
          cultivar:  g.cultivar ?? null,
          variety:   varietyLabel,
          qty:       0,
          reserved:  0,
          newestDate: null,
          newestCost: null,
          costsSeen: new Set(),
          suppliersSeen: new Set(),
          underlying: [],
          sell,
        };
        merged.set(key, m);
      }
      m.stockIds.push(row.id);
      m.qty += qty;
      m.reserved += reservations.get(row.id) ?? 0;
      m.underlying.push({ id: row.id, qty, cost, supplier, date });
      // CR-14: only POSITIVE-qty receives carry a cost basis. A zero-qty row
      // (an absorbed demand entry, qty 0 — it clears the qty<0 guard above)
      // holds a stray cost that must NOT count toward the mixed-cost badge or
      // the displayed (newest) cost / supplier.
      if (qty > 0) {
        if (cost != null) m.costsSeen.add(cost.toFixed(2));
        if (supplier) m.suppliersSeen.add(supplier);
        // Track the newest receive — its cost wins as the displayed cost.
        if (date && (!m.newestDate || date > m.newestDate)) {
          m.newestDate = date;
          m.newestCost = cost;
        } else if (!m.newestDate && cost != null && m.newestCost == null) {
          m.newestCost = cost;
        }
      }
    }
  }

  const out = [];
  for (const m of merged.values()) {
    const supplierAll = [...m.suppliersSeen];
    const supplier =
      supplierAll.length === 0 ? null :
      supplierAll.length === 1 ? supplierAll[0] :
      supplierAll.length === 2 ? supplierAll.join(', ') :
      `${supplierAll[0]} +${supplierAll.length - 1}`;
    const cost = m.newestCost;
    out.push({
      id:        m.stockIds[0],            // stable React key
      stockIds:  m.stockIds,
      type:      m.type,
      colour:    m.colour,
      size_cm:   m.size_cm,
      cultivar:  m.cultivar,
      variety:   m.variety,
      qty:       m.qty,
      reserved:  m.reserved,
      cost,
      costMixed: m.costsSeen.size > 1,
      sell:      m.sell,
      markup:    null,
      arrived:   m.newestDate,
      supplier,
      supplierAll,
      underlying: m.underlying,
    });
  }
  for (const r of out) {
    if (r.cost > 0 && r.sell > 0) r.markup = r.sell / r.cost;
  }
  return out;
}

function readNum(row, displayKey, snakeKey) {
  const v = row[displayKey] ?? row[snakeKey];
  if (v == null || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
