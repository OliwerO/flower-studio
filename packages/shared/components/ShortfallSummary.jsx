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
import { getVarietyTotals } from '../utils/stockMath.js';

export default function ShortfallSummary({
  groups,
  reservations = new Map(),
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

  const { byDate, totalStems, varietyCount } = useMemo(
    () => bucket(groups, reservations, today_),
    [groups, reservations, today_],
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
        <div className="flex items-center gap-3">
          <div className="text-xs text-red-700">
            <span data-testid="shortfall-varieties" className="font-semibold tabular-nums">{varietyCount}</span>
            <span className="mx-1">{t.shortfallsVarieties ?? 'varieties'}</span>
            <span className="mx-1">·</span>
            <span data-testid="shortfall-stems" className="font-semibold tabular-nums">{totalStems}</span>
            <span className="ml-1">{t.shortfallsStems ?? 'stems'}</span>
          </div>
          <span
            data-testid="shortfall-chevron"
            data-collapsed={String(collapsed)}
            className={`text-red-500 text-xs transition-transform ${collapsed ? '' : 'rotate-180'}`}
          >
            ▾
          </span>
        </div>
      </button>

      {!collapsed && (
        <ul className="divide-y divide-red-100">
          {byDate.map(({ date, rows }) => (
            <li key={date} data-testid={`shortfall-date-${date}`}>
              <DateRow
                date={date}
                today={today_}
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

function DateRow({ date, today, rows, t, openRow, trails, loadingId, onToggleRow, onVarietyClick }) {
  const friendly = friendlyDate(date, today, t);
  const total = rows.reduce((s, r) => s + r.qty, 0);

  return (
    <div className="px-4 py-2">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-semibold text-red-700 tabular-nums">{friendly}</span>
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
                  <span className="text-red-700 font-semibold tabular-nums ml-2">
                    −{r.qty} {t.stems}
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

function bucket(groups, reservations, today) {
  const byDateMap = new Map();
  let totalStems = 0;
  const varietyKeys = new Set();

  for (const g of groups ?? []) {
    const { net } = getVarietyTotals(g.rows ?? [], reservations);
    if (net >= 0) continue;

    for (const row of g.rows ?? []) {
      if (typeof row.current_quantity === 'number' && row.current_quantity < 0) {
        const date = row.date ?? today;
        const qty = Math.abs(row.current_quantity);
        const entry = {
          key:       g.key,
          stockId:   row.id,
          type_name: g.type_name,
          colour:    g.colour,
          size_cm:   g.size_cm,
          cultivar:  g.cultivar,
          qty,
        };
        const list = byDateMap.get(date) ?? [];
        list.push(entry);
        byDateMap.set(date, list);
        totalStems += qty;
        varietyKeys.add(g.key);
      }
    }
  }

  const byDate = [...byDateMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, rows]) => ({ date, rows }));

  return { byDate, totalStems, varietyCount: varietyKeys.size };
}

// Owner ask 2026-05-31: drop the parenthetical absolute date when the
// relative label is already shown — "+3d (2026-06-03)" reads doubled-up.
// Within 7 days = relative only ("Today", "Tomorrow", "+3d"). Beyond
// that window the absolute date is more useful than counting days.
function friendlyDate(date, today, t) {
  if (date === today) return t.today ?? 'Today';
  const diffDays = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
  if (diffDays === 1) return t.tomorrow ?? 'Tomorrow';
  if (diffDays > 1 && diffDays <= 7) return `+${diffDays}${t.daysSuffix ?? 'd'}`;
  if (diffDays < 0 && diffDays >= -7) return `${diffDays}${t.daysSuffix ?? 'd'}`;
  return date;
}
