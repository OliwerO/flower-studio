/**
 * PendingArrivalsPanel — Y-model incoming arrivals grouped by ARRIVAL DATE.
 *
 * Reads /stock/pending-po (keyed by stockId), joins each entry to its Stock
 * row's Variety attrs, then buckets every PO line by its planned arrival date.
 * Each date is headed by a DateTag (kind="arriving") and lists the flowers
 * landing that day with their incoming quantity. (CR-33, decision D6.)
 *
 * Mirrors ShortfallSummary's date-grouped layout so "what's coming" and
 * "what's missing" read the same way.
 *
 * Props:
 *   pendingPO  — { [stockId]: { ordered, plannedDate, pos[], flowerName } }
 *                 from GET /stock/pending-po
 *   stock      — full /stock list (Y-model rows carry Type/Colour/Size/Cultivar)
 *   t          — translations
 *   today      — optional ISO date override (unused now; kept for API stability)
 *   splitType  — dashboard mode: grid layout matching BatchArrivalList.
 *                Mobile (default): flex layout.
 */
import { useMemo, useState } from 'react';
import DateTag from './DateTag.jsx';
import { byDateAsc } from '../utils/sortByDate.js';
import { STOCK_GRID_FULL } from './stockRowGrid.js';
import { varietyFinancials } from '../utils/varietyFinancials.js';
import InlinePriceField from './InlinePriceField.jsx';
import { useVarietyTraceExpand } from '../hooks/useVarietyTraceExpand.js';
import VarietyTracePanel from './VarietyTracePanel.jsx';

/** Bucket every pending PO line by its arrival date, then by Variety within a date. */
function bucketByDate(pendingPO, stockById) {
  const byDate = new Map(); // dateKey → { date, total, flowers: Map<varietyKey, row> }

  for (const [stockId, po] of Object.entries(pendingPO || {})) {
    const stockRow = stockById.get(stockId);
    if (!stockRow) continue;
    const type = stockRow.Type ?? stockRow.type_name ?? null;
    const colour = stockRow.Colour ?? stockRow.colour ?? null;
    const size = stockRow.Size ?? stockRow.size_cm ?? null;
    const cultivar = stockRow.Cultivar ?? stockRow.cultivar ?? null;
    const key = type
      ? [type, colour ?? '', size ?? '', cultivar ?? ''].join('|')
      : `__legacy__|${po.flowerName || stockRow['Display Name'] || stockId}`;
    const fallbackName = type ? null : (po.flowerName || stockRow['Display Name'] || '—');

    for (const p of po.pos || []) {
      const qty = Number(p.quantity) || 0;
      if (qty <= 0) continue;
      const date = p.plannedDate || po.plannedDate || null;
      const dKey = date ?? '__undated__';

      if (!byDate.has(dKey)) byDate.set(dKey, { date, total: 0, flowers: new Map() });
      const sec = byDate.get(dKey);
      sec.total += qty;

      const f = sec.flowers.get(key) ?? { key, type, colour, size, cultivar, fallbackName, qty: 0 };
      f.qty += qty;
      sec.flowers.set(key, f);
    }
  }

  return [...byDate.values()]
    .map(sec => ({ ...sec, flowers: [...sec.flowers.values()] }))
    .sort(byDateAsc);
}

export default function PendingArrivalsPanel({ pendingPO = {}, stock = [], t = {}, splitType = false, onPatchPriceBulk, fetchVarietyUsage, onOrderClick }) {
  const [collapsed, setCollapsed] = useState(false);
  const { isOpen, toggle, getTrace } = useVarietyTraceExpand(fetchVarietyUsage);

  const stockById = useMemo(() => {
    const m = new Map();
    for (const s of stock) m.set(s.id, s);
    return m;
  }, [stock]);

  const byDate = useMemo(() => bucketByDate(pendingPO, stockById), [pendingPO, stockById]);

  // CR-05 follow-on: group stock rows by the same Variety key bucketByDate uses,
  // then derive per-Variety financials for dashboard column cells.
  // Legacy (untyped) rows get the __legacy__ key and will show '—' for financials
  // if no matching stock row carries price data — acceptable per spec.
  // Also build idsByKey for bulk price patching.
  const { finByKey, idsByKey } = useMemo(() => {
    const groups = new Map(); // varietyKey → stock rows[]
    for (const s of stock) {
      const type = s.Type ?? s.type_name ?? null;
      const colour = s.Colour ?? s.colour ?? null;
      const size = s.Size ?? s.size_cm ?? null;
      const cultivar = s.Cultivar ?? s.cultivar ?? null;
      const key = type
        ? [type, colour ?? '', size ?? '', cultivar ?? ''].join('|')
        : `__legacy__|${s['Display Name'] || s.id}`;
      const existing = groups.get(key) ?? [];
      existing.push(s);
      groups.set(key, existing);
    }
    const finMap = new Map();
    const idsMap = new Map();
    for (const [key, rows] of groups) {
      finMap.set(key, varietyFinancials(rows));
      idsMap.set(key, rows.map(r => r.id).filter(Boolean));
    }
    return { finByKey: finMap, idsByKey: idsMap };
  }, [stock]);

  if (byDate.length === 0) return null;

  return (
    <section
      data-testid="pending-arrivals-panel"
      className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50/60 overflow-hidden"
    >
      <button
        type="button"
        data-testid="pending-arrivals-header"
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-indigo-100/60 border-b border-indigo-200 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">📦</span>
          <span className="text-sm font-semibold text-indigo-800 uppercase tracking-wide">
            {t.pendingArrivals ?? 'Incoming'}
          </span>
        </div>
        <span
          data-testid="pending-arrivals-chevron"
          data-collapsed={String(collapsed)}
          className={`text-indigo-500 text-xs transition-transform ${collapsed ? '' : 'rotate-180'}`}
        >
          ▾
        </span>
      </button>

      {!collapsed && (
        <ul className="divide-y divide-indigo-100">
          {byDate.map(sec => (
            <li key={sec.date ?? 'undated'} data-testid={`pending-arrival-date-${sec.date ?? 'undated'}`} className="px-4 py-1">
              <div className="mb-0.5">
                <DateTag date={sec.date} kind="arriving" t={t} />
              </div>
              <ul className="space-y-0.5">
                {sec.flowers.map(f => {
                  const rowId = `${sec.date ?? 'undated'}@${f.key}`;
                  const canTrace = !!fetchVarietyUsage && !f.key.startsWith('__legacy__');
                  const open = canTrace && isOpen(rowId);
                  const trace = getTrace(f.key);

                  if (splitType) {
                    /* Dashboard: grid layout matching BatchArrivalList.
                       Exactly 8 grid children:
                         col1 Type · col2 Variety · col3 amount
                         col4 Cost · col5 Sell · col6 Markup · col7 Arrived(empty) · col8 Supplier */
                    const fin = finByKey.get(f.key) ?? {};
                    const ids = idsByKey.get(f.key) ?? [];
                    return (
                      <li key={f.key}>
                        <button
                          type="button"
                          data-testid="pending-arrival-row"
                          onClick={(e) => { e.stopPropagation(); if (canTrace) toggle(rowId, f.key); }}
                          className={`w-full grid items-baseline gap-3 text-sm py-1 text-left ${canTrace ? 'cursor-pointer hover:bg-indigo-50/40' : 'cursor-default'}`}
                          style={{ gridTemplateColumns: STOCK_GRID_FULL }}
                        >
                          {/* col 1: Type (or fallback name) — chevron inside col 1 for traceable rows */}
                          {f.type ? (
                            <span className="flex items-baseline gap-1 min-w-0">
                              {canTrace && (
                                <span className={`text-indigo-400 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
                              )}
                              <span className="font-semibold text-gray-900 truncate">{f.type}</span>
                            </span>
                          ) : (
                            <span className="font-medium text-gray-700 truncate">{f.fallbackName}</span>
                          )}
                          {/* col 2: Colour / Size / Cultivar (empty span when no type so amount stays in col 3) */}
                          {f.type ? (
                            <span className="flex items-baseline gap-1.5 min-w-0 truncate">
                              {f.colour && <span className="font-semibold text-gray-900">{f.colour}</span>}
                              {f.size != null && <span className="text-xs text-gray-600 tabular-nums">{f.size}cm</span>}
                              {f.cultivar && <span className="text-xs text-gray-400 italic truncate">{f.cultivar}</span>}
                              {!f.colour && f.size == null && !f.cultivar && <span className="text-gray-400">—</span>}
                            </span>
                          ) : (
                            <span />
                          )}
                          {/* col 3: amount — BARE number, right-aligned */}
                          <span className="text-indigo-700 font-semibold tabular-nums text-right">+{f.qty}</span>
                          {/* col 4: Cost */}
                          <span className="text-right tabular-nums text-gray-700">
                            {onPatchPriceBulk && ids.length > 0 ? (
                              <InlinePriceField
                                value={fin.cost}
                                testid="pending-edit-cost"
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
                                testid="pending-edit-sell"
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
                        </button>
                        {open && (
                          <div className="ml-6 mt-1 mb-2">
                            {trace.loading && <p className="text-indigo-400 italic text-xs">{t.loading ?? 'Loading…'}</p>}
                            {!trace.loading && (
                              <VarietyTracePanel events={trace.events} unaccountedStems={trace.unaccountedStems} drift={trace.drift} openingBalance={trace.openingBalance} t={t} onOrderClick={onOrderClick} />
                            )}
                          </div>
                        )}
                      </li>
                    );
                  }

                  /* Mobile: flex layout */
                  return (
                    <li key={f.key}>
                      <button
                        type="button"
                        data-testid="pending-arrival-row"
                        onClick={(e) => { e.stopPropagation(); if (canTrace) toggle(rowId, f.key); }}
                        className={`w-full flex items-baseline justify-between text-sm px-2 py-1 text-left ${canTrace ? 'cursor-pointer hover:bg-indigo-50/40' : 'cursor-default'}`}
                      >
                        <span className="flex items-baseline gap-2 truncate min-w-0">
                          {canTrace && (
                            <span className={`text-indigo-400 text-xs transition-transform shrink-0 ${open ? 'rotate-90' : ''}`}>▸</span>
                          )}
                          {f.type ? (
                            <>
                              <span className="font-semibold text-gray-900 shrink-0">{f.type}</span>
                              {f.colour && <span className="font-semibold text-gray-900">{f.colour}</span>}
                              {f.size != null && <span className="text-xs text-gray-600 tabular-nums">{f.size}cm</span>}
                              {f.cultivar && <span className="text-xs text-gray-400 italic truncate">{f.cultivar}</span>}
                            </>
                          ) : (
                            <span className="font-medium text-gray-700 truncate">{f.fallbackName}</span>
                          )}
                        </span>
                        <span className="text-sm text-indigo-700 font-semibold tabular-nums shrink-0 ml-2">+{f.qty}</span>
                      </button>
                      {open && (
                        <div className="ml-6 mt-1 mb-2">
                          {trace.loading && <p className="text-indigo-400 italic text-xs">{t.loading ?? 'Loading…'}</p>}
                          {!trace.loading && (
                            <VarietyTracePanel events={trace.events} unaccountedStems={trace.unaccountedStems} openingBalance={trace.openingBalance} t={t} onOrderClick={onOrderClick} />
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
