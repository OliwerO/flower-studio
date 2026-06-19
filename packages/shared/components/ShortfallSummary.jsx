/**
 * ShortfallSummary — collapsible date-grouped panel of Varieties whose net is < 0.
 *
 * Each shortfall row expands to show which orders are driving the demand
 * (lazy-fetched via the host-provided fetchUsage callback, which wraps
 * GET /stock/:id/usage). The owner can see "Pink 50cm short 7 → driven by
 * Order #202605-00018 (Jane Doe, 5 stems) + Order #...".
 *
 * Props:
 *   groups          — Variety groups
 *   reservations    — Map<stockRowId, reservedQty> (drives net)
 *   t               — translations
 *   onVarietyClick  — optional (key) => void
 *   fetchUsage      — optional async (stockId) => trail[]; when provided the
 *                      shortfall row can be tapped to expand and lazy-load
 *                      its order list. Trail format mirrors /stock/:id/usage.
 *   today           — optional ISO date override
 */
import { useMemo, useState } from 'react';
import { allocateVarietyCoverage, arrivalsForVariety } from '../utils/stockMath.js';
import DateTag from './DateTag.jsx';

export default function ShortfallSummary({
  groups,
  reservations = new Map(),
  pendingPO = {},
  t,
  onVarietyClick,
  fetchUsage,
  today,
}) {
  const today_ = today ?? new Date().toISOString().slice(0, 10);
  const [collapsed, setCollapsed] = useState(false);
  const [openRow, setOpenRow] = useState(null); // stockId currently expanded
  const [trails, setTrails] = useState(new Map()); // stockId → trail[]
  const [loadingId, setLoadingId] = useState(null);

  const { byDate } = useMemo(
    () => bucket(groups, reservations, today_, pendingPO),
    [groups, reservations, today_, pendingPO],
  );

  if (byDate.length === 0) return null;

  async function toggleRow(stockId) {
    if (openRow === stockId) {
      setOpenRow(null);
      return;
    }
    setOpenRow(stockId);
    if (!trails.has(stockId) && fetchUsage) {
      setLoadingId(stockId);
      try {
        const trail = await fetchUsage(stockId);
        setTrails(m => new Map(m).set(stockId, trail || []));
      } finally {
        setLoadingId(null);
      }
    }
  }

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
                openRow={openRow}
                trails={trails}
                loadingId={loadingId}
                onToggleRow={toggleRow}
                onVarietyClick={onVarietyClick}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DateRow({ date, rows, t, openRow, trails, loadingId, onToggleRow, onVarietyClick }) {
  const total = rows.reduce((s, r) => s + r.qty, 0);

  return (
    <div className="px-4 py-2">
      <div className="flex items-baseline justify-between mb-1">
        <DateTag date={date} kind="needed" t={t} />
        <span className="text-[10px] text-red-500 tabular-nums">
          {total} {t.stems}
        </span>
      </div>
      <ul className="space-y-1">
        {rows.map(r => {
          const isOpen = openRow === r.stockId;
          const trail = trails.get(r.stockId);
          const isLoading = loadingId === r.stockId;
          return (
            <li key={`${r.key}-${date}-${r.stockId}`}>
              <button
                type="button"
                data-testid="shortfall-row"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleRow(r.stockId);
                }}
                onDoubleClick={() => onVarietyClick && onVarietyClick(r.key)}
                className="w-full text-left px-2 py-1 rounded-md hover:bg-red-100/50 active:bg-red-100 transition-colors"
              >
                <span className="flex items-baseline justify-between text-sm">
                  <span className="flex items-baseline gap-2 truncate">
                    <span className={`text-red-400 text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                    {r.type_name && (
                      <span className="font-semibold text-gray-900 shrink-0">{r.type_name}</span>
                    )}
                    {r.colour && <span className="font-semibold text-gray-900">{r.colour}</span>}
                    {r.size_cm != null && <span className="text-xs text-gray-600 tabular-nums">{r.size_cm}cm</span>}
                    {r.cultivar && <span className="text-xs text-gray-400 italic truncate">{r.cultivar}</span>}
                    {!r.type_name && !r.colour && !r.size_cm && !r.cultivar && (
                      <span className="font-medium text-gray-400 italic">—</span>
                    )}
                  </span>
                  <span className="flex items-baseline gap-2 ml-2 shrink-0">
                    {/* CR-39: a late PO is signalled (amber) but does NOT clear the shortfall. */}
                    {r.latePoQty > 0 && (
                      <span
                        data-testid="shortfall-late"
                        className="text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded"
                        title={t.poLate ?? 'PO arriving after needed date'}
                      >
                        +{r.latePoQty} {t.poLateShort ?? 'late'}
                      </span>
                    )}
                    <span className="text-red-700 font-semibold tabular-nums">
                      −{r.qty} {t.stems}
                    </span>
                  </span>
                </span>
              </button>
              {isOpen && (
                <div className="ml-6 mt-1 mb-2 text-xs">
                  {isLoading && <p className="text-red-400 italic">{t.loading ?? 'Loading…'}</p>}
                  {!isLoading && trail && trail.length === 0 && (
                    <p className="text-red-400 italic">{t.traceEmpty ?? 'No linked orders'}</p>
                  )}
                  {!isLoading && trail && trail.length > 0 && (
                    <ul className="space-y-0.5">
                      {trail.filter(e => e.type === 'order').map((e, i) => (
                        <li key={i} className="flex items-baseline justify-between gap-2 py-0.5 px-2 rounded bg-white/50">
                          <span className="truncate">
                            <span className="text-gray-500 tabular-nums">{e.orderId ?? '#?'}</span>
                            {e.customer && <span className="ml-2 text-gray-700">{e.customer}</span>}
                          </span>
                          <span className="text-red-700 font-semibold tabular-nums shrink-0">
                            {Math.abs(e.quantity ?? e.qty ?? 0)} {t.stems}
                          </span>
                        </li>
                      ))}
                    </ul>
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

