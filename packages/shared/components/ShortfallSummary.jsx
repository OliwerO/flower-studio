/**
 * ShortfallSummary — collapsible date-grouped panel of Varieties whose net is < 0.
 *
 * Each shortfall row expands to the full VarietyTracePanel (lazy-fetched via
 * the host-provided fetchVarietyUsage callback, which wraps
 * GET /stock/varieties/:key/usage). The owner can see "Pink 50cm short 7 →
 * driven by Order #202605-00018 (Jane Doe, 5 stems) + Purchase (FarmCo) + …".
 *
 * Props:
 *   groups              — Variety groups
 *   reservations        — Map<stockRowId, reservedQty> (drives net)
 *   t                   — translations
 *   onVarietyClick      — optional (key) => void
 *   fetchVarietyUsage   — optional async (key) => { events, unaccountedStems };
 *                          when provided the shortfall row can be tapped to
 *                          expand and lazy-load its full Variety usage trace.
 *   today               — optional ISO date override
 *   splitType           — dashboard mode: grid layout matching BatchArrivalList.
 *                          Mobile (default): flex layout with "stems" label.
 */
import { useMemo, useState } from 'react';
import { useVarietyTraceExpand } from '../hooks/useVarietyTraceExpand.js';
import VarietyTracePanel from './VarietyTracePanel.jsx';
import { allocateVarietyCoverage, arrivalsForVariety } from '../utils/stockMath.js';
import { varietyFinancials } from '../utils/varietyFinancials.js';
import DateTag from './DateTag.jsx';
import { STOCK_GRID_FULL } from './stockRowGrid.js';
import InlinePriceField from './InlinePriceField.jsx';

export default function ShortfallSummary({
  groups,
  reservations = new Map(),
  pendingPO = {},
  t,
  onVarietyClick,
  fetchVarietyUsage,
  today,
  splitType = false,
  onPatchPriceBulk,
  onOrderClick,
}) {
  const today_ = today ?? new Date().toISOString().slice(0, 10);
  const [collapsed, setCollapsed] = useState(false);
  const { isOpen, toggle, getTrace } = useVarietyTraceExpand(fetchVarietyUsage);

  const { byDate } = useMemo(
    () => bucket(groups, reservations, today_, pendingPO),
    [groups, reservations, today_, pendingPO],
  );

  // CR-05 follow-on: per-Variety financials for dashboard column cells.
  const finByKey = useMemo(() => {
    const m = new Map();
    for (const g of groups ?? []) m.set(g.key, varietyFinancials(g.rows ?? []));
    return m;
  }, [groups]);

  // idsByKey: Variety key → array of all underlying stock row ids (for bulk price patch).
  const idsByKey = useMemo(() => {
    const m = new Map();
    for (const g of groups ?? []) m.set(g.key, (g.rows ?? []).map(r => r.id).filter(Boolean));
    return m;
  }, [groups]);

  if (byDate.length === 0) return null;

  return (
    <section
      data-testid="shortfall-summary"
      className="mb-4 rounded-2xl border border-red-200 bg-red-50/60 overflow-hidden"
    >
      <button
        type="button"
        data-testid="shortfall-header"
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-red-100/60 border-b border-red-200 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">⚠</span>
          <span className="text-sm font-semibold text-red-800 uppercase tracking-wide">
            {t.shortfallsTitle ?? 'Shortfalls'}
          </span>
        </div>
        {/* CR-38: dropped the "N varieties · N stems short" summary — the per-date
            rows already carry the detail; the roll-up was noise (matches pending). */}
        <span
          data-testid="shortfall-chevron"
          data-collapsed={String(collapsed)}
          className={`text-red-500 text-xs transition-transform ${collapsed ? '' : 'rotate-180'}`}
        >
          ▾
        </span>
      </button>

      {!collapsed && (
        <ul className="divide-y divide-red-100">
          {byDate.map(({ date, rows }) => (
            <li key={date} data-testid={`shortfall-date-${date}`}>
              <DateRow
                date={date}
                rows={rows}
                t={t}
                isOpen={isOpen}
                toggle={toggle}
                getTrace={getTrace}
                onVarietyClick={onVarietyClick}
                splitType={splitType}
                finByKey={finByKey}
                idsByKey={idsByKey}
                onPatchPriceBulk={onPatchPriceBulk}
                onOrderClick={onOrderClick}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DateRow({ date, rows, t, isOpen, toggle, getTrace, onVarietyClick, splitType, finByKey = new Map(), idsByKey = new Map(), onPatchPriceBulk, onOrderClick }) {
  return (
    <div className="px-4 py-1">
      <div className="mb-0.5">
        <DateTag date={date} kind="needed" t={t} />
      </div>
      <ul className="space-y-0.5">
        {rows.map(r => {
          const rowId = `${r.key}@${date}`;
          const open = isOpen(rowId);
          return (
            <li key={`${r.key}-${date}-${r.stockId}`}>
              {splitType ? (
                /* Dashboard: grid layout — chevron lives INSIDE the Type cell so it
                   never shifts column boundaries. No leading marker column.
                   The parent DateRow div already has px-4, so the grid starts at the
                   same 16px inset as BatchArrivalList (no extra px on the button).
                   Exactly 8 grid children in order:
                     col1 Type(+chevron) · col2 Variety · col3 amount
                     col4 Cost · col5 Sell · col6 Markup · col7 Arrived(empty) · col8 Supplier */
                <button
                  type="button"
                  data-testid="shortfall-row"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(rowId, r.key);
                  }}
                  onDoubleClick={() => onVarietyClick && onVarietyClick(r.key)}
                  className="relative w-full text-left py-1 rounded-md hover:bg-red-100/50 active:bg-red-100 transition-colors"
                >
                  {(() => {
                    const fin = finByKey.get(r.key) ?? {};
                    const ids = idsByKey.get(r.key) ?? [];
                    return (
                      <span
                        className="grid items-baseline gap-3 text-sm"
                        style={{ gridTemplateColumns: STOCK_GRID_FULL }}
                      >
                        {/* col 1: Type — chevron inside so it never shifts column boundaries */}
                        <span className="flex items-baseline gap-1 min-w-0">
                          <span className={`text-red-400 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
                          <span className="font-semibold text-gray-900 truncate">{r.type_name || '—'}</span>
                        </span>
                        {/* col 2: Colour / Size / Cultivar */}
                        <span className="flex items-baseline gap-1.5 min-w-0 truncate">
                          {r.colour && <span className="font-semibold text-gray-900">{r.colour}</span>}
                          {r.size_cm != null && <span className="text-xs text-gray-600 tabular-nums">{r.size_cm}cm</span>}
                          {r.cultivar && <span className="text-xs text-gray-400 italic truncate">{r.cultivar}</span>}
                          {!r.colour && r.size_cm == null && !r.cultivar && <span className="text-gray-400">—</span>}
                        </span>
                        {/* col 3: amount (right-aligned) — stems still needed for the date */}
                        <span className="text-right">
                          <span className="text-red-700 font-semibold tabular-nums">−{r.qty}</span>
                        </span>
                        {/* col 4: Cost */}
                        <span className="text-right tabular-nums text-gray-700">
                          {onPatchPriceBulk && ids.length > 0 ? (
                            <InlinePriceField
                              value={fin.cost}
                              testid="shortfall-edit-cost"
                              onSave={(v) => onPatchPriceBulk(ids, { cost: v })}
                            />
                          ) : (
                            fin.cost != null ? fin.cost.toFixed(2) : '—'
                          )}
                        </span>
                        {/* col 5: Sell */}
                        <span className="text-right tabular-nums text-gray-700">
                          {onPatchPriceBulk && ids.length > 0 ? (
                            <InlinePriceField
                              value={fin.sell}
                              testid="shortfall-edit-sell"
                              onSave={(v) => onPatchPriceBulk(ids, { sell: v })}
                            />
                          ) : (
                            fin.sell != null ? fin.sell.toFixed(2) : '—'
                          )}
                        </span>
                        {/* col 6: Markup badge */}
                        <span className="flex justify-end">
                          {fin.markup ? (
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums ${
                              fin.markup >= 2.5 ? 'bg-emerald-100 text-emerald-700' :
                              fin.markup >= 1.8 ? 'bg-amber-100 text-amber-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              ×{fin.markup.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </span>
                        {/* col 7: Arrived — intentionally empty in cards */}
                        <span aria-hidden="true" />
                        {/* col 8: Supplier */}
                        <span className="text-xs text-gray-600 truncate" title={fin.supplier ?? undefined}>
                          {fin.supplier || '—'}
                        </span>
                      </span>
                    );
                  })()}
                </button>
              ) : (
                /* Mobile: flex layout with "stems" label */
                <button
                  type="button"
                  data-testid="shortfall-row"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(rowId, r.key);
                  }}
                  onDoubleClick={() => onVarietyClick && onVarietyClick(r.key)}
                  className="w-full text-left px-2 py-1 rounded-md hover:bg-red-100/50 active:bg-red-100 transition-colors"
                >
                  <span className="flex items-baseline justify-between text-sm">
                    <span className="flex items-baseline gap-2 truncate">
                      <span className={`text-red-400 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
                      {r.type_name && <span className="font-semibold text-gray-900 shrink-0">{r.type_name}</span>}
                      {r.colour && <span className="font-semibold text-gray-900">{r.colour}</span>}
                      {r.size_cm != null && <span className="text-xs text-gray-600 tabular-nums">{r.size_cm}cm</span>}
                      {r.cultivar && <span className="text-xs text-gray-400 italic truncate">{r.cultivar}</span>}
                      {!r.type_name && !r.colour && r.size_cm == null && !r.cultivar && (
                        <span className="font-medium text-gray-400 italic">—</span>
                      )}
                    </span>
                    <span className="flex items-baseline gap-2 ml-2 shrink-0">
                      <span className="text-red-700 font-semibold tabular-nums">−{r.qty} {t.stems}</span>
                    </span>
                  </span>
                </button>
              )}
              {open && (
                <div className="ml-6 mt-1 mb-2">
                  {getTrace(r.key).loading && (
                    <p className="text-red-400 italic text-xs">{t.loading ?? 'Loading…'}</p>
                  )}
                  {!getTrace(r.key).loading && (
                    <VarietyTracePanel
                      events={getTrace(r.key).events}
                      unaccountedStems={getTrace(r.key).unaccountedStems}
                      drift={getTrace(r.key).drift}
                      openingBalance={getTrace(r.key).openingBalance}
                      t={t}
                      onOrderClick={onOrderClick}
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function bucket(groups, reservations, today, pendingPO) {
  const byDateMap = new Map();
  let totalStems = 0;
  const varietyKeys = new Set();

  for (const g of groups ?? []) {
    // CR-39: net each dated demand against IN-TIME pending arrivals. A demand
    // covered before its needed-by date drops out; a late arrival leaves the
    // shortfall but is surfaced via latePoQty.
    const arrivals = arrivalsForVariety(g.rows, pendingPO);
    const { demands } = allocateVarietyCoverage(g.rows ?? [], reservations, arrivals);

    for (const d of demands) {
      if (d.shortQty <= 0) continue; // covered in time — not a shortfall
      const date = d.date ?? today;
      const entry = {
        key:       g.key,
        stockId:   d.id,
        type_name: g.type_name,
        colour:    g.colour,
        size_cm:   g.size_cm,
        cultivar:  g.cultivar,
        qty:       d.shortQty,
        latePoQty: d.latePoQty,
      };
      const list = byDateMap.get(date) ?? [];
      list.push(entry);
      byDateMap.set(date, list);
      totalStems += d.shortQty;
      varietyKeys.add(g.key);
    }
  }

  const byDate = [...byDateMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, rows]) => ({ date, rows }));

  return { byDate, totalStems, varietyCount: varietyKeys.size };
}
