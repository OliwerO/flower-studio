/**
 * BatchArrivalList — flat list of Batches grouped by arrival date (newest first).
 *
 * Alternative view of the Stock list for owners who think in batches first
 * ("what came in on Monday?", "what's the oldest stock?"). Sibling to
 * <VarietyListItem> / <TypeGroupHeader> — the host toggles between the two.
 *
 * Each section header shows the absolute date plus a relative age label so the
 * owner can spot old stock at a glance.
 *
 * Props:
 *   groups      — Variety groups (same shape consumed by VarietyListItem)
 *   t           — translations: stems, today, yesterday, daysAgoSuffix,
 *                  weekAgoLabel, olderLabel, weeksAgoSuffix, undatedLabel
 *   onRowClick  — optional callback(stockId) — host can open trace / detail
 *   today       — optional ISO date override (defaults to current day)
 */
import { useMemo } from 'react';

export default function BatchArrivalList({ groups, t, onRowClick, today }) {
  const today_ = today ?? new Date().toISOString().slice(0, 10);

  const sections = useMemo(() => buildSections(groups, today_), [groups, today_]);

  if (sections.length === 0) {
    return (
      <p data-testid="batch-arrival-empty" className="text-center text-sm text-gray-400 py-12">
        {t.noStockFound ?? 'No batches'}
      </p>
    );
  }

  return (
    <div data-testid="batch-arrival-list" className="ios-card overflow-hidden">
      {sections.map(({ date, rows, ageLabel, isOld }) => (
        <section key={date} data-testid={`batch-arrival-date-${date}`}>
          <header
            className={`px-4 py-2 flex items-baseline justify-between border-b border-gray-100 ${
              isOld ? 'bg-amber-50' : 'bg-gray-50'
            }`}
          >
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-gray-900 tabular-nums">{date}</span>
              <span className={`text-xs ${isOld ? 'text-amber-700' : 'text-gray-500'}`}>{ageLabel}</span>
            </div>
            <span className="text-xs text-gray-400 tabular-nums">
              {rows.reduce((s, r) => s + r.qty, 0)} {t.stems}
            </span>
          </header>
          <ul className="divide-y divide-gray-100">
            {rows.map(b => (
              <li key={b.id}>
                <button
                  type="button"
                  data-testid="batch-arrival-row"
                  onClick={() => onRowClick && onRowClick(b.id)}
                  className="w-full flex items-baseline justify-between px-4 py-2 text-left active:bg-gray-50 transition-colors"
                >
                  <span className="flex items-baseline gap-2 truncate">
                    <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">
                      {b.type_name}
                    </span>
                    {b.colour && (
                      <span className="text-sm font-semibold text-gray-900 truncate">{b.colour}</span>
                    )}
                    {b.size_cm != null && (
                      <span className="text-xs text-gray-600 tabular-nums shrink-0">{b.size_cm}cm</span>
                    )}
                    {b.cultivar && (
                      <span className="text-xs text-gray-400 italic truncate">{b.cultivar}</span>
                    )}
                  </span>
                  <span className="text-sm tabular-nums font-semibold text-gray-800 ml-2 shrink-0">
                    {b.qty} {t.stems}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function buildSections(groups, today) {
  const batches = [];
  for (const g of groups ?? []) {
    for (const row of g.rows ?? []) {
      const qty = Number(row.current_quantity);
      // Only Batches: positive (or zero) qty. Demand Entries are excluded —
      // they're not arrivals; they're commitments.
      if (qty >= 0) {
        batches.push({
          id: row.id,
          date: row.date ?? null,
          type_name: g.type_name ?? '—',
          colour: g.colour ?? null,
          size_cm: g.size_cm ?? null,
          cultivar: g.cultivar ?? null,
          qty,
        });
      }
    }
  }

  // Group by date.
  const map = new Map();
  for (const b of batches) {
    const k = b.date ?? '—';
    const list = map.get(k) ?? [];
    list.push(b);
    map.set(k, list);
  }

  // Newest first; undated (`—`) sinks to bottom.
  const sortedKeys = [...map.keys()].sort((a, b) => {
    if (a === '—') return 1;
    if (b === '—') return -1;
    return b.localeCompare(a);
  });

  return sortedKeys.map(date => {
    const rows = map.get(date).sort((a, b) => b.qty - a.qty);
    const { ageLabel, isOld } = relativeAge(date, today);
    return { date, rows, ageLabel, isOld };
  });
}

function relativeAge(date, today) {
  if (date === '—' || !date) return { ageLabel: '', isOld: false };
  const days = Math.round((Date.parse(today) - Date.parse(date)) / 86400000);
  if (days === 0)   return { ageLabel: 'today',          isOld: false };
  if (days === 1)   return { ageLabel: '1 day ago',      isOld: false };
  if (days < 7)     return { ageLabel: `${days} days ago`, isOld: false };
  if (days < 14)    return { ageLabel: '~1 week ago',    isOld: true };
  if (days < 30)    return { ageLabel: `${Math.round(days / 7)} weeks ago`, isOld: true };
  return { ageLabel: 'old', isOld: true };
}
