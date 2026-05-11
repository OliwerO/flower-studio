/**
 * BatchArrivalList — flat list of Batches grouped by arrival date (newest first),
 * rendered as an aligned grid table with full per-Batch detail.
 *
 * Columns: Type · Variety identity · Date tag · Available · Cost · Sell · Markup · Supplier.
 * Sibling to <VarietyListItem>; host toggles between the two views.
 *
 * Visual goals (owner feedback):
 *   - Columns vertically aligned across rows (CSS grid, not flex).
 *   - All numbers tabular-nums + right-aligned.
 *   - Section header per arrival date + relative age; older sections amber-tinted.
 *
 * Props:
 *   groups      — Variety groups (same shape consumed by VarietyListItem)
 *   t           — translations: stems, cost, sell, markup, supplier, batchTag,
 *                  available, today, etc.
 *   onRowClick  — optional callback(stockId) — host can open trace / detail
 *   today       — optional ISO date override
 */
import { useMemo } from 'react';

const GRID_COLS = 'grid-cols-[7rem_minmax(0,1fr)_4rem_4rem_4rem_4rem_3.5rem_6rem]';

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
      {/* Column header — rendered once at top, sticky-eligible */}
      <div className={`grid ${GRID_COLS} gap-3 px-4 py-2 text-[10px] uppercase tracking-wide text-gray-400 bg-gray-50 border-b border-gray-100`}>
        <span>{t.type ?? 'Type'}</span>
        <span>{t.variety ?? 'Variety'}</span>
        <span className="text-center">{t.batchTag ?? 'Tag'}</span>
        <span className="text-right">{t.available ?? 'Avail'}</span>
        <span className="text-right">{t.cost ?? 'Cost'}</span>
        <span className="text-right">{t.sell ?? 'Sell'}</span>
        <span className="text-right">{t.markup ?? '×'}</span>
        <span>{t.supplier ?? 'Supplier'}</span>
      </div>

      {sections.map(({ date, rows, ageLabel, isOld }) => (
        <section key={date} data-testid={`batch-arrival-date-${date}`}>
          <header
            className={`px-4 py-2 flex items-baseline justify-between border-b border-gray-100 ${
              isOld ? 'bg-amber-50' : 'bg-gray-50/60'
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
            {rows.map(b => <BatchRow key={b.id} b={b} t={t} onRowClick={onRowClick} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function BatchRow({ b, t, onRowClick }) {
  const markup = b.cost > 0 && b.sell > 0 ? (b.sell / b.cost) : null;
  return (
    <li>
      <button
        type="button"
        data-testid="batch-arrival-row"
        onClick={() => onRowClick && onRowClick(b.id)}
        className={`w-full grid ${GRID_COLS} gap-3 px-4 py-2 text-sm text-left items-baseline active:bg-gray-50 transition-colors`}
      >
        <span className="text-[10px] uppercase tracking-wide text-gray-400 truncate">
          {b.type_name || '—'}
        </span>
        <span className="flex items-baseline gap-1.5 truncate min-w-0">
          {b.colour && <span className="font-semibold text-gray-900 truncate">{b.colour}</span>}
          {b.size_cm != null && <span className="text-xs text-gray-600 tabular-nums shrink-0">{b.size_cm}cm</span>}
          {b.cultivar && <span className="text-xs text-gray-400 italic truncate">{b.cultivar}</span>}
          {!b.colour && !b.size_cm && !b.cultivar && <span className="text-gray-400">—</span>}
        </span>
        <span className="text-center">
          {b.tag
            ? <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-medium tabular-nums">{b.tag}</span>
            : <span className="text-gray-300">—</span>}
        </span>
        <span className="text-right font-semibold tabular-nums text-gray-900">{b.qty}</span>
        <span className="text-right tabular-nums text-gray-700">
          {b.cost != null ? b.cost.toFixed(2) : '—'}
        </span>
        <span className="text-right tabular-nums text-gray-700">
          {b.sell != null ? b.sell.toFixed(2) : '—'}
        </span>
        <span className="text-right">
          {markup ? (
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums ${
              markup >= 2.5 ? 'bg-emerald-100 text-emerald-700' : markup >= 1.8 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
            }`}>
              ×{markup.toFixed(1)}
            </span>
          ) : <span className="text-gray-300">—</span>}
        </span>
        <span className="text-xs text-gray-600 truncate">{b.supplier || '—'}</span>
      </button>
    </li>
  );
}

function buildSections(groups, today) {
  const batches = [];
  for (const g of groups ?? []) {
    for (const row of g.rows ?? []) {
      const qty = Number(row.current_quantity);
      if (qty >= 0) {
        batches.push({
          id:        row.id,
          date:      row.date ?? null,
          type_name: g.type_name ?? '—',
          colour:    g.colour ?? null,
          size_cm:   g.size_cm ?? null,
          cultivar:  g.cultivar ?? null,
          qty,
          cost:      readNum(row, 'Current Cost Price', 'current_cost_price'),
          sell:      readNum(row, 'Current Sell Price', 'current_sell_price'),
          supplier:  row.Supplier ?? row.supplier ?? null,
          tag:       row.date ? dateTag(row.date) : null,
        });
      }
    }
  }

  const map = new Map();
  for (const b of batches) {
    const k = b.date ?? '—';
    const list = map.get(k) ?? [];
    list.push(b);
    map.set(k, list);
  }

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

function readNum(row, displayKey, snakeKey) {
  const v = row[displayKey] ?? row[snakeKey];
  if (v == null || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function dateTag(d) {
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  const day = dt.getUTCDate();
  const month = dt.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const cap = month.charAt(0).toUpperCase() + month.slice(1);
  return `${day}.${cap}.`;
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
