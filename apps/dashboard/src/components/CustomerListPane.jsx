// CustomerListPane — left side of the Customer Tab v2.0 split-view.
// Universal search + composable filters + sortable virtualized list.

import { useMemo, useState, useEffect } from 'react';
import { List } from 'react-window';
import t from '../translations.js';
import CustomerFilterBar from './CustomerFilterBar.jsx';
import { matchesSearch, matchesFilters } from '@flower-studio/shared';

const SEGMENT_COLORS = {
  Constant:         'bg-ios-green/15 text-ios-green',
  New:              'bg-ios-blue/15 text-ios-blue',
  Rare:             'bg-ios-orange/15 text-ios-orange',
  'DO NOT CONTACT': 'bg-ios-red/15 text-ios-red',
};

const SORTS = [
  { key: 'lastOrderDesc', label: 'lastOrderDesc', compare: (a, b) => (b._agg?.lastOrderDate || '').localeCompare(a._agg?.lastOrderDate || '') },
  { key: 'totalSpendDesc', label: 'totalSpendDesc', compare: (a, b) => (b._agg?.totalSpend || 0) - (a._agg?.totalSpend || 0) },
  { key: 'orderCountDesc', label: 'orderCountDesc', compare: (a, b) => (b._agg?.orderCount || 0) - (a._agg?.orderCount || 0) },
  { key: 'nameAsc', label: 'nameAsc', compare: (a, b) => (a.Name || a.Nickname || '').localeCompare(b.Name || b.Nickname || '') },
];

function formatLastOrder(dateStr) {
  if (!dateStr) return { label: '\u2014', color: 'text-ios-tertiary' };
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (isNaN(days)) return { label: dateStr, color: 'text-ios-secondary' };
  const color = days > 120 ? 'text-rose-600' : days > 60 ? 'text-amber-600' : 'text-ios-secondary';
  const label = days === 0 ? t.today
    : days < 30 ? `${days}d`
    : days < 365 ? `${Math.floor(days / 30)}mo`
    : `${Math.floor(days / 365)}y`;
  return { label, color };
}

export default function CustomerListPane({
  customers,
  filters,
  setFilters,
  search,
  setSearch,
  selectedId,
  onSelect,
  onClearAll,
}) {
  const [sortKey, setSortKey] = useState('lastOrderDesc');

  // Debounce search for 150ms — re-renders a 1094-row filter on every keystroke
  // feel sluggish otherwise, even though the underlying work is <5ms.
  const [effectiveSearch, setEffectiveSearch] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setEffectiveSearch(search), 150);
    return () => clearTimeout(timer);
  }, [search]);

  const filtered = useMemo(() => {
    const sort = SORTS.find(s => s.key === sortKey) || SORTS[0];
    return customers
      .filter(c => c.Name || c.Nickname || c.Phone)
      .filter(c => matchesSearch(c, effectiveSearch))
      .filter(c => matchesFilters(c, filters))
      .sort(sort.compare);
  }, [customers, effectiveSearch, filters, sortKey]);

  return (
    <div className="bg-white rounded-2xl shadow-sm flex flex-col h-full overflow-hidden">
      {/* Search */}
      <div className="px-3 py-2 border-b border-gray-100">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t.searchAnyField}
            className="field-input w-full pr-8"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gray-200 text-gray-500 hover:bg-gray-300 text-xs flex items-center justify-center"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-3 py-2 border-b border-gray-100">
        <CustomerFilterBar
          filters={filters}
          setFilters={setFilters}
          customers={customers}
          onClearAll={onClearAll}
        />
      </div>

      {/* Sort + count */}
      <div className="px-3 py-1.5 border-b border-gray-100 flex items-center justify-between text-xs">
        <span className="text-ios-tertiary">
          {filtered.length === customers.length
            ? `${customers.length} ${t.customers}`
            : `${filtered.length} / ${customers.length}`}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-ios-tertiary">{t.sortBy}:</span>
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value)}
            className="text-xs bg-transparent border-0 outline-none text-ios-label cursor-pointer"
          >
            {SORTS.map(s => <option key={s.key} value={s.key}>{t[s.label] || s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Virtualized list */}
      <div className="flex-1 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-ios-tertiary text-sm">{t.noResults}</div>
        ) : (
          <List
            rowCount={filtered.length}
            rowHeight={60}
            rowComponent={Row}
            rowProps={{ items: filtered, onSelect, selectedId }}
          />
        )}
      </div>
    </div>
  );
}

function Row({ index, style, items, onSelect, selectedId }) {
  const c = items[index];
  const lastOrder = formatLastOrder(c._agg?.lastOrderDate);
  const isSelected = c.id === selectedId;
  const isDNC = c.Segment === 'DO NOT CONTACT';

  return (
    <div
      style={style}
      onClick={() => onSelect(c.id)}
      className={`px-3 py-2 border-b border-gray-50 cursor-pointer flex flex-col justify-center gap-0.5 ${
        isSelected ? 'bg-brand-50 border-l-4 border-l-brand-500' :
        isDNC ? 'bg-rose-50/50 hover:bg-rose-50' :
        'hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium text-ios-label truncate flex-1">
          {c.Nickname ? `@${c.Nickname.replace(/^@/, '')}` : c.Name || '\u2014'}
        </span>
        {c.Segment && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${SEGMENT_COLORS[c.Segment] || 'bg-gray-100 text-gray-600'}`}>
            {isDNC ? '\u26D4' : c.Segment}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-[11px] text-ios-tertiary">
        {c.Name && c.Nickname && <span className="truncate max-w-[140px]">{c.Name}</span>}
        <span className={`${lastOrder.color} shrink-0`}>{lastOrder.label}</span>
        {c._agg?.orderCount > 0 && (
          <span className="shrink-0">{c._agg.orderCount} {t.orders}</span>
        )}
        {c._agg?.totalSpend > 0 && (
          <span className="ml-auto font-medium text-ios-secondary shrink-0">
            {Math.round(c._agg.totalSpend)} {t.zl}
          </span>
        )}
      </div>
    </div>
  );
}
