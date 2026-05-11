/**
 * ShortfallSummary — date-grouped panel of every Variety that is short on stems.
 *
 * Surfaces above the Variety list so the owner can answer the single most
 * important question without scrolling or clicking:
 *
 *   "Which flowers am I short on, and when do I need them?"
 *
 * Input: same `groups` array the Variety list consumes. We FIRST filter to
 * Varieties whose net bucket is < 0 (the row is red in the Variety list), THEN
 * inside each shortfall Variety bucket its Demand-Entry rows by row.date so the
 * owner can read "Pink 50cm — 7 stems on 2026-05-13".
 *
 * Varieties with positive Net (stems already cover total demand) are excluded
 * even if they have individual dated DEs — those are scheduled consumption, not
 * a shortfall. Filtering matches the red border in VarietyListItem.
 *
 * Props:
 *   groups          — Variety groups [{ key, type_name, colour, size_cm,
 *                      cultivar, rows: [{ id, current_quantity, date }, ...] }]
 *   reservations    — Map<stockRowId, reservedQty> (drives net calculation;
 *                      same Map the Variety list consumes)
 *   t               — translations: stems, shortfallsTitle, noShortfalls,
 *                      shortfallsVarieties, shortfallsStems, today, tomorrow,
 *                      daysSuffix
 *   onVarietyClick  — optional callback(key) — host can expand/scroll to that row
 *   today           — optional ISO date override (defaults to today). Tests inject.
 */
import { useMemo } from 'react';
import { getVarietyTotals } from '../utils/stockMath.js';

export default function ShortfallSummary({ groups, reservations = new Map(), t, onVarietyClick, today }) {
  const today_ = today ?? new Date().toISOString().slice(0, 10);

  const { byDate, totalStems, varietyCount } = useMemo(
    () => bucket(groups, reservations, today_),
    [groups, reservations, today_],
  );

  if (byDate.length === 0) return null;

  return (
    <section
      data-testid="shortfall-summary"
      className="mb-4 rounded-2xl border border-red-200 bg-red-50/60 overflow-hidden"
    >
      <header className="flex items-center justify-between px-4 py-2.5 bg-red-100/60 border-b border-red-200">
        <div className="flex items-center gap-2">
          <span className="text-base">⚠</span>
          <span className="text-sm font-semibold text-red-800 uppercase tracking-wide">
            {t.shortfallsTitle ?? 'Shortfalls'}
          </span>
        </div>
        <div className="text-xs text-red-700">
          <span data-testid="shortfall-varieties" className="font-semibold tabular-nums">{varietyCount}</span>
          <span className="mx-1">{t.shortfallsVarieties ?? 'varieties'}</span>
          <span className="mx-1">·</span>
          <span data-testid="shortfall-stems" className="font-semibold tabular-nums">{totalStems}</span>
          <span className="ml-1">{t.shortfallsStems ?? 'stems'}</span>
        </div>
      </header>

      <ul className="divide-y divide-red-100">
        {byDate.map(({ date, rows }) => (
          <li key={date} data-testid={`shortfall-date-${date}`}>
            <DateRow date={date} today={today_} rows={rows} t={t} onVarietyClick={onVarietyClick} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DateRow({ date, today, rows, t, onVarietyClick }) {
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
          const inner = (
            <span className="flex items-baseline justify-between text-sm">
              <span className="flex items-baseline gap-2 truncate">
                {r.colour && <span className="font-medium text-gray-800">{r.colour}</span>}
                {r.size_cm != null && <span className="text-xs text-gray-600 tabular-nums">{r.size_cm}cm</span>}
                {r.cultivar && <span className="text-xs text-gray-400 italic truncate">{r.cultivar}</span>}
                {!r.colour && !r.size_cm && !r.cultivar && r.type_name && (
                  <span className="font-medium text-gray-800">{r.type_name}</span>
                )}
              </span>
              <span className="text-red-700 font-semibold tabular-nums ml-2">
                −{r.qty} {t.stems}
              </span>
            </span>
          );
          return (
            <li key={`${r.key}-${date}`}>
              {onVarietyClick ? (
                <button
                  type="button"
                  data-testid="shortfall-row"
                  onClick={() => onVarietyClick(r.key)}
                  className="w-full text-left px-2 py-1 rounded-md hover:bg-red-100/50 active:bg-red-100 transition-colors"
                >
                  {inner}
                </button>
              ) : (
                <div data-testid="shortfall-row" className="px-2 py-1">{inner}</div>
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
    // Filter at the Variety level: only include groups whose net is < 0.
    // Positive-net Varieties have stems to cover their total demand — their
    // dated DEs are scheduled consumption, not shortfalls.
    const { net } = getVarietyTotals(g.rows ?? [], reservations);
    if (net >= 0) continue;

    for (const row of g.rows ?? []) {
      if (typeof row.current_quantity === 'number' && row.current_quantity < 0) {
        const date = row.date ?? today;
        const qty = Math.abs(row.current_quantity);
        const entry = {
          key:       g.key,
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

function friendlyDate(date, today, t) {
  if (date === today) return t.today ?? 'Today';
  const diffDays = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
  if (diffDays === 1) return `${t.tomorrow ?? 'Tomorrow'} (${date})`;
  if (diffDays > 1)  return `+${diffDays}${t.daysSuffix ?? 'd'} (${date})`;
  if (diffDays < 0)  return `${diffDays}${t.daysSuffix ?? 'd'} (${date})`;
  return date;
}
