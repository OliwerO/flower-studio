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
 */
import { useMemo, useState } from 'react';
import DateTag from './DateTag.jsx';
import { byDateAsc } from '../utils/sortByDate.js';

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

export default function PendingArrivalsPanel({ pendingPO = {}, stock = [], t = {} }) {
  const [collapsed, setCollapsed] = useState(false);

  const stockById = useMemo(() => {
    const m = new Map();
    for (const s of stock) m.set(s.id, s);
    return m;
  }, [stock]);

  const byDate = useMemo(() => bucketByDate(pendingPO, stockById), [pendingPO, stockById]);

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
            <li key={sec.date ?? 'undated'} data-testid={`pending-arrival-date-${sec.date ?? 'undated'}`} className="px-4 py-2">
              <div className="flex items-baseline justify-between mb-1">
                <DateTag date={sec.date} kind="arriving" t={t} />
                <span className="text-[10px] text-indigo-500 tabular-nums">
                  +{sec.total} {t.stems ?? 'stems'}
                </span>
              </div>
              <ul className="space-y-1">
                {sec.flowers.map(f => (
                  <li
                    key={f.key}
                    data-testid="pending-arrival-row"
                    className="flex items-baseline justify-between text-sm px-2 py-1"
                  >
                    <span className="flex items-baseline gap-2 truncate min-w-0">
                      {f.type
                        ? <>
                            <span className="font-semibold text-gray-900 shrink-0">{f.type}</span>
                            {f.colour && <span className="font-semibold text-gray-900">{f.colour}</span>}
                            {f.size != null && <span className="text-xs text-gray-600 tabular-nums">{f.size}cm</span>}
                            {f.cultivar && <span className="text-xs text-gray-400 italic truncate">{f.cultivar}</span>}
                          </>
                        : <span className="font-medium text-gray-700 truncate">{f.fallbackName}</span>}
                    </span>
                    <span className="text-sm text-indigo-700 font-semibold tabular-nums shrink-0 ml-2">
                      +{f.qty}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
