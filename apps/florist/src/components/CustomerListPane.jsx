// CustomerListPane — mobile variant of the dashboard's same-named component.
// Full-width list with search at the top, a "Filters (N)" button that opens
// a bottom sheet, sort dropdown, and a react-window virtualized list of 1094
// rows. Tap a row → `onSelect(customerId)` is called; the parent page
// navigates to `/customers/:id`.
//
// Shared filter + search logic: @flower-studio/shared exports matchesSearch
// and matchesFilters so both this pane and its dashboard counterpart reuse
// the exact same predicates. Changes to filter-rule semantics propagate to
// both apps in one edit.

import { useMemo, useState, useEffect } from 'react';
import { List } from 'react-window';
import { matchesSearch, matchesFilters, activeFilterCount } from '@flower-studio/shared';
import { Filter, Search, X } from 'lucide-react';
import CustomerFilterSheet from './CustomerFilterSheet.jsx';
import t from '../translations.js';

const SEGMENT_COLORS = {
  Constant:         'bg-ios-green/15 text-ios-green',
  New:              'bg-ios-blue/15 text-ios-blue',
  Rare:             'bg-ios-orange/15 text-ios-orange',
  'DO NOT CONTACT': 'bg-ios-red/15 text-ios-red',
};

const SORTS = [
  { key: 'lastOrderDesc',  label: 'lastOrderDesc',  compare: (a, b) => (b._agg?.lastOrderDate || '').localeCompare(a._agg?.lastOrderDate || '') },
  { key: 'totalSpendDesc', label: 'totalSpendDesc', compare: (a, b) => (b._agg?.totalSpend || 0) - (a._agg?.totalSpend || 0) },
  { key: 'orderCountDesc', label: 'orderCountDesc', compare: (a, b) => (b._agg?.orderCount || 0) - (a._agg?.orderCount || 0) },
  { key: 'nameAsc',        label: 'nameAsc',        compare: (a, b) => (a.Name || a.Nickname || '').localeCompare(b.Name || b.Nickname || '') },
];

function formatLastOrder(dateStr) {
  if (!dateStr) return { label: '\u2014', color: 'text-ios-tertiary' };
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (isNaN(days)) return { label: dateStr, color: 'text-ios-secondary' };
  const color = days > 120 ? 'text-rose-600' : days > 60 ? 'text-amber-600' : 'text-ios-secondary';
  const label = days === 0 ? (t.today || 'Today')
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
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  // Debounce search for 150ms — re-renders a 1094-row filter on every
  // keystroke feel sluggish otherwise, even though the underlying work
  // is <5ms. Same threshold the dashboard uses.
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

  const count = activeFilterCount(filters);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-dark-bg">
      {/* Search bar */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-dark-separator">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ios-tertiary" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t.searchAnyField || 'Search…'}
            className="w-full pl-9 pr-9 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-dark-separator
                       bg-white dark:bg-dark-elevated text-ios-label dark:text-dark-label outline-none
                       focus:border-brand-400"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ios-tertiary"
              aria-label={t.clear || 'Clear'}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Filter button + sort + count row */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-dark-separator flex items-center gap-2">
        <button
          onClick={() => setFilterSheetOpen(true)}
          className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-semibold transition-colors ${
            count > 0
              ? 'bg-brand-600 text-white'
              : 'bg-gray-100 text-ios-secondary dark:bg-dark-elevated dark:text-dark-secondary'
          }`}
        >
          <Filter size={14} />
          <span>{t.filters || 'Filters'}{count > 0 ? ` (${count})` : ''}</span>
        </button>
        <span className="text-xs text-ios-tertiary">
          {filtered.length === customers.length
            ? `${customers.length}`
            : `${filtered.length} / ${customers.length}`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <span className="text-xs text-ios-tertiary">{t.sortBy || 'Sort'}:</span>
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value)}
            className="text-xs bg-transparent border-0 outline-none text-ios-label dark:text-dark-label cursor-pointer"
          >
            {SORTS.map(s => (
              <option key={s.key} value={s.key}>{t[s.label] || s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Virtualized list */}
      <div className="flex-1 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-ios-tertiary text-sm">
            {t.noResults || 'No results'}
          </div>
        ) : (
          <List
            rowCount={filtered.length}
            rowHeight={60}
            rowComponent={Row}
            rowProps={{ items: filtered, onSelect, selectedId }}
          />
        )}
      </div>

      <CustomerFilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        filters={filters}
        setFilters={setFilters}
        customers={customers}
        onClearAll={onClearAll}
      />
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
      className={`px-3 py-2 border-b border-gray-50 dark:border-dark-separator cursor-pointer flex flex-col justify-center gap-0.5 active-scale ${
        isSelected ? 'bg-brand-50 dark:bg-brand-900/20 border-l-4 border-l-brand-500' :
        isDNC ? 'bg-rose-50/50 dark:bg-rose-900/10' :
        ''
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium text-ios-label dark:text-dark-label truncate flex-1">
          {c.Nickname ? `@${c.Nickname.replace(/^@/, '')}` : c.Name || '\u2014'}
        </span>
        {c.Segment && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
            SEGMENT_COLORS[c.Segment] || 'bg-gray-100 text-gray-600'
          }`}>
            {isDNC ? '\u26D4' : c.Segment}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-[11px] text-ios-tertiary">
        {c.Name && c.Nickname && (
          <span className="truncate max-w-[140px]">{c.Name}</span>
        )}
        <span className={`${lastOrder.color} shrink-0`}>{lastOrder.label}</span>
        {c._agg?.orderCount > 0 && (
          <span className="shrink-0">{c._agg.orderCount} {t.orders || 'orders'}</span>
        )}
        {c._agg?.totalSpend > 0 && (
          <span className="ml-auto font-medium text-ios-secondary shrink-0">
            {Math.round(c._agg.totalSpend)} {t.zl || 'zł'}
          </span>
        )}
      </div>
    </div>
  );
}
