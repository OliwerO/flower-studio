/**
 * PendingArrivalsPanel — Y-model incoming arrivals grouped by Variety.
 *
 * Reads /stock/pending-po (keyed by stockId), joins each entry to its Stock
 * row's Variety attrs (type_name/colour/size_cm/cultivar), buckets by the
 * 4-tuple, then renders one row per Variety with a date strip showing
 * "+N stems → DD.Mon." for each planned arrival.
 *
 * Props:
 *   pendingPO  — { [stockId]: { ordered, plannedDate, pos[], flowerName } }
 *                 from GET /stock/pending-po
 *   stock      — full /stock list (Y-model rows carry Type/Colour/Size/Cultivar)
 *   t          — translations
 *   today      — optional ISO date override
 */
import { useMemo, useState } from 'react';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateTag(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const day = Number(m[3]);
  const month = MONTHS_SHORT[Number(m[2]) - 1] || m[2];
  return `${day}.${month}.`;
}

function diffDays(iso, today) {
  if (!iso) return null;
  const a = Date.parse(today);
  const b = Date.parse(iso);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

function ageCls(days) {
  if (days == null) return 'bg-gray-100 text-gray-500';
  if (days <= 2)  return 'bg-emerald-100 text-emerald-800';
  if (days <= 7)  return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-700';
}

/** Bucket pendingPO entries by Variety 4-tuple. */
function bucketByVariety(pendingPO, stockById) {
  const map = new Map();
  for (const [stockId, po] of Object.entries(pendingPO || {})) {
    const stockRow = stockById.get(stockId);
    if (!stockRow) continue;
    const type = stockRow.Type ?? stockRow.type_name ?? null;
    const colour = stockRow.Colour ?? stockRow.colour ?? null;
    const size = stockRow.Size ?? stockRow.size_cm ?? null;
    const cultivar = stockRow.Cultivar ?? stockRow.cultivar ?? null;
    // Stock row without Type — surface under a generic bucket using its name
    // so legacy stock items don't disappear from the panel.
    const key = type
      ? [type, colour ?? '', size ?? '', cultivar ?? ''].join('|')
      : `__legacy__|${po.flowerName || stockRow['Display Name'] || stockId}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        type,
        colour,
        size,
        cultivar,
        fallbackName: type ? null : (po.flowerName || stockRow['Display Name'] || '—'),
        totalOrdered: 0,
        // arrivals: array of { date: ISO, qty }
        arrivals: [],
        // pos: dedup by id so duplicate rows under the same Variety merge
        poIds: new Set(),
        pos: [],
      });
    }
    const g = map.get(key);
    g.totalOrdered += Number(po.ordered) || 0;
    for (const p of po.pos || []) {
      const arrival = {
        date: p.plannedDate || po.plannedDate || null,
        qty: Number(p.quantity) || 0,
        poNumber: p.number || `PO-${String(p.id || '').slice(-4)}`,
      };
      if (arrival.qty > 0) g.arrivals.push(arrival);
      if (p.id && !g.poIds.has(p.id)) { g.poIds.add(p.id); g.pos.push(p); }
    }
  }
  // Sort each group's arrivals by date (undated last)
  for (const g of map.values()) {
    g.arrivals.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });
  }
  // Sort groups by earliest arrival date (most urgent first)
  return [...map.values()].sort((a, b) => {
    const ad = a.arrivals[0]?.date ?? '9999';
    const bd = b.arrivals[0]?.date ?? '9999';
    return ad.localeCompare(bd);
  });
}

export default function PendingArrivalsPanel({ pendingPO = {}, stock = [], t = {}, today }) {
  const today_ = today ?? new Date().toISOString().slice(0, 10);
  const [collapsed, setCollapsed] = useState(false);

  const stockById = useMemo(() => {
    const m = new Map();
    for (const s of stock) m.set(s.id, s);
    return m;
  }, [stock]);

  const groups = useMemo(
    () => bucketByVariety(pendingPO, stockById),
    [pendingPO, stockById],
  );

  if (groups.length === 0) return null;

  const totalStems = groups.reduce((s, g) => s + g.totalOrdered, 0);

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
        <div className="flex items-center gap-3">
          <div className="text-xs text-indigo-700">
            <span data-testid="pending-arrivals-varieties" className="font-semibold tabular-nums">{groups.length}</span>
            <span className="mx-1">{t.pendingArrivalsVarieties ?? t.shortfallsVarieties ?? 'varieties'}</span>
            <span className="mx-1">·</span>
            <span data-testid="pending-arrivals-stems" className="font-semibold tabular-nums">{totalStems}</span>
            <span className="ml-1">{t.pendingArrivalsStems ?? 'stems incoming'}</span>
          </div>
          <span
            data-testid="pending-arrivals-chevron"
            data-collapsed={String(collapsed)}
            className={`text-indigo-500 text-xs transition-transform ${collapsed ? '' : 'rotate-180'}`}
          >
            ▾
          </span>
        </div>
      </button>

      {!collapsed && (
        <ul className="divide-y divide-indigo-100">
          {groups.map(g => (
            <li key={g.key} data-testid="pending-arrivals-row" className="px-4 py-2">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <div className="flex items-baseline gap-2 truncate min-w-0">
                  {g.type
                    ? <>
                        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold shrink-0">{g.type}</span>
                        {g.colour && <span className="font-medium text-gray-800">{g.colour}</span>}
                        {g.size != null && <span className="text-xs text-gray-600 tabular-nums">{g.size}cm</span>}
                        {g.cultivar && <span className="text-xs text-gray-400 italic truncate">{g.cultivar}</span>}
                      </>
                    : <span className="font-medium text-gray-700 truncate">{g.fallbackName}</span>}
                </div>
                <span className="text-sm text-indigo-700 font-semibold tabular-nums shrink-0">
                  +{g.totalOrdered} {t.stems ?? 'stems'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.arrivals.map((a, i) => {
                  const tag = dateTag(a.date) ?? (t.undatedShort ?? '—');
                  const days = diffDays(a.date, today_);
                  const friendly = days == null
                    ? tag
                    : days === 0 ? (t.today ?? 'Today')
                    : days === 1 ? (t.tomorrow ?? 'Tomorrow')
                    : days > 0 ? `+${days}${t.daysSuffix ?? 'd'}`
                    : `${days}${t.daysSuffix ?? 'd'}`;
                  return (
                    <span
                      key={i}
                      data-testid="pending-arrivals-arrival"
                      title={a.date ?? ''}
                      className={`inline-flex items-baseline gap-1 px-2 py-0.5 rounded text-[11px] font-medium tabular-nums ${ageCls(days)}`}
                    >
                      <span>+{a.qty}</span>
                      <span className="opacity-70">·</span>
                      <span>{friendly}</span>
                    </span>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
