/**
 * BatchArrivalList — flat sortable Batch table.
 *
 * One flat table (no date section headers); the Tag column carries the date
 * pill, age-tinted to flag old stock. Column headers are clickable to sort.
 *
 * Columns: Type · Variety · Tag · Available · Cost · Sell · Markup · Supplier.
 *
 * Props:
 *   groups      — Variety groups (same shape consumed by VarietyListItem)
 *   t           — translations
 *   onRowClick  — callback(stockId) — host opens trace / detail
 *   today       — optional ISO date override
 */
import { useMemo, useState } from 'react';

const GRID_COLS = 'grid-cols-[7rem_minmax(0,1fr)_4.5rem_4rem_4rem_4rem_3.5rem_6rem]';

const COLS = [
  { key: 'type',       label: 'type',       align: 'left'   },
  { key: 'variety',    label: 'variety',    align: 'left'   },
  { key: 'date',       label: 'batchTag',   align: 'center' },
  { key: 'qty',        label: 'available',  align: 'right'  },
  { key: 'cost',       label: 'cost',       align: 'right'  },
  { key: 'sell',       label: 'sell',       align: 'right'  },
  { key: 'markup',     label: 'markup',     align: 'right'  },
  { key: 'supplier',   label: 'supplier',   align: 'left'   },
];

export default function BatchArrivalList({ groups, t, onRowClick, today }) {
  const today_ = today ?? new Date().toISOString().slice(0, 10);
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  const rows = useMemo(() => flatten(groups, today_), [groups, today_]);

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) {
    return (
      <p data-testid="batch-arrival-empty" className="text-center text-sm text-gray-400 py-12">
        {t.noStockFound ?? 'No batches'}
      </p>
    );
  }

  function clickHeader(key) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'date' || key === 'qty' || key === 'cost' || key === 'sell' || key === 'markup' ? 'desc' : 'asc');
    }
  }

  return (
    <div data-testid="batch-arrival-list" className="ios-card overflow-hidden">
      <div className={`grid ${GRID_COLS} gap-3 px-4 py-2 text-[10px] uppercase tracking-wide bg-gray-50 border-b border-gray-100 select-none`}>
        {COLS.map(c => {
          const active = sortKey === c.key;
          const arrow = active ? (sortDir === 'asc' ? '↑' : '↓') : '';
          return (
            <button
              key={c.key}
              type="button"
              data-testid={`sort-${c.key}`}
              onClick={() => clickHeader(c.key)}
              className={`flex items-center gap-1 ${c.align === 'right' ? 'justify-end' : c.align === 'center' ? 'justify-center' : ''} ${active ? 'text-gray-700 font-semibold' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <span>{t[c.label] ?? c.label}</span>
              {arrow && <span className="text-[9px]">{arrow}</span>}
            </button>
          );
        })}
      </div>

      <ul className="divide-y divide-gray-100">
        {sortedRows.map(b => <BatchRow key={b.id} b={b} t={t} onRowClick={onRowClick} />)}
      </ul>
    </div>
  );
}

function BatchRow({ b, t, onRowClick }) {
  const markup = b.cost > 0 && b.sell > 0 ? (b.sell / b.cost) : null;
  // Age-tint the tag pill: ≤3d gray, ≤7d gray, ≤14d amber, older = red.
  const ageCls =
    b.ageDays == null ? 'bg-gray-100 text-gray-500' :
    b.ageDays <= 7    ? 'bg-gray-100 text-gray-700' :
    b.ageDays <= 14   ? 'bg-amber-100 text-amber-800' :
                         'bg-red-100 text-red-700';

  return (
    <li>
      <button
        type="button"
        data-testid="batch-arrival-row"
        onClick={() => onRowClick && onRowClick(b.id)}
        className={`w-full grid ${GRID_COLS} gap-3 px-4 py-2 text-sm text-left items-baseline active:bg-gray-50 transition-colors`}
      >
        <span className="text-[10px] uppercase tracking-wide text-gray-400 truncate">
          {b.type || '—'}
        </span>
        <span className="flex items-baseline gap-1.5 truncate min-w-0">
          {b.colour && <span className="font-semibold text-gray-900 truncate">{b.colour}</span>}
          {b.size_cm != null && <span className="text-xs text-gray-600 tabular-nums shrink-0">{b.size_cm}cm</span>}
          {b.cultivar && <span className="text-xs text-gray-400 italic truncate">{b.cultivar}</span>}
          {!b.colour && !b.size_cm && !b.cultivar && <span className="text-gray-400">—</span>}
        </span>
        <span className="text-center">
          {b.tag
            ? <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums ${ageCls}`} title={b.date}>{b.tag}</span>
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

function flatten(groups, today) {
  const out = [];
  for (const g of groups ?? []) {
    for (const row of g.rows ?? []) {
      const qty = Number(row.current_quantity);
      if (qty >= 0) {
        const date = row.date ?? null;
        const ageDays = date ? Math.round((Date.parse(today) - Date.parse(date)) / 86400000) : null;
        // Sortable variety key for column sort: stable concat of identity attrs.
        const varietyKey = [g.colour, g.size_cm, g.cultivar].filter(v => v != null).join(' ');
        out.push({
          id:        row.id,
          date,
          ageDays,
          type:      g.type_name ?? '—',
          colour:    g.colour ?? null,
          size_cm:   g.size_cm ?? null,
          cultivar:  g.cultivar ?? null,
          variety:   varietyKey,
          qty,
          cost:      readNum(row, 'Current Cost Price', 'current_cost_price'),
          sell:      readNum(row, 'Current Sell Price', 'current_sell_price'),
          markup:    null,
          supplier:  row.Supplier ?? row.supplier ?? null,
          tag:       date ? dateTag(date) : null,
        });
      }
    }
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

function dateTag(d) {
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  const day = dt.getUTCDate();
  const month = dt.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const cap = month.charAt(0).toUpperCase() + month.slice(1);
  return `${day}.${cap}.`;
}
