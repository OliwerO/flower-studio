// OrdersTab — full order management table for the owner.
// Think of it as the master production board: every order visible,
// filterable, and editable from one screen.
// Accepts initialFilter from cross-tab navigation (Today tab clicks).

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import OrderDetailPanel from './OrderDetailPanel.jsx';
import PremadeBouquetList from './PremadeBouquetList.jsx';
import { SkeletonTable } from './Skeleton.jsx';
import DatePicker from './DatePicker.jsx';
import ColumnFilterPopover from './order/ColumnFilterPopover.jsx';
import {
  EMPTY_ORDER_FILTER, buildOrderQueryParams, orderMatchesClientFilter,
  activeOrderFilterCount, clearOrderFilter,
} from '@flower-studio/shared';

// "2026-03-08" → "Mar 8"
function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00'); // noon prevents timezone rollover
  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}

function getStatusOptions() {
  return [
    { value: '',                label: t.allStatuses },
    { value: 'New',             label: t.statusNew },
    { value: 'Ready',           label: t.statusReady },
    { value: 'Out for Delivery', label: t.statusOutForDel },
    { value: 'Delivered',       label: t.statusDelivered },
    { value: 'Picked Up',       label: t.statusPickedUp },
    { value: 'Cancelled',       label: t.statusCancelled },
  ];
}

const STATUS_COLORS = {
  New:              'bg-indigo-100 text-indigo-700',
  Ready:            'bg-amber-100 text-amber-700',
  'Out for Delivery':'bg-sky-100 text-sky-700',
  Delivered:        'bg-emerald-100 text-emerald-700',
  'Picked Up':      'bg-teal-100 text-teal-700',
  Cancelled:        'bg-rose-100 text-rose-700',
};

// Priority: actionable statuses first, completed/cancelled last
const STATUS_PRIORITY = {
  New: 0, Ready: 1, 'Out for Delivery': 2,
  Delivered: 3, 'Picked Up': 4, Cancelled: 5,
};

function getSortOptions() {
  return [
    { value: 'status',       label: t.sortByStatus || 'Status' },
    { value: 'deliveryDate', label: t.sortByDelivery || 'Delivery date' },
    { value: 'type',         label: t.sortByType || 'Delivery/Pickup' },
    { value: 'orderDate',    label: t.sortByOrderDate || 'Order date' },
  ];
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function OrdersTab({ initialFilter, onNavigate, isActive = true }) {
  const STATUS_OPTIONS = getStatusOptions();
  // Seed filter from cross-tab initialFilter to avoid a double-fetch race —
  // state is set before the first render so the first fetch uses the right params.
  const f = initialFilter || {};
  const [orders, setOrders]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch]       = useState('');
  const [filter, setFilter] = useState(() => ({
    ...EMPTY_ORDER_FILTER,
    status: f.status || '',
    source: f.source || '',
    deliveryType: f.deliveryType || '',
    paymentStatus: f.payment || '',            // legacy cross-tab key was `payment`
    paymentMethod: f.paymentMethod || '',
    excludeCancelled: !!f.excludeCancelled,
    requiredByFrom: f.dateFrom || monthStart(), // current default range = fulfilment date
    requiredByTo: f.dateTo || todayStr(),
  }));
  const setFilterField = useCallback((key, value) => setFilter(prev => ({ ...prev, [key]: value })), []);
  // Editing a date-column filter switches off upcoming mode so the new date
  // range actually takes effect (upcoming owns the date scope; they're mutually exclusive).
  const setDateField = useCallback((key, value) => {
    setUpcoming(false);
    setFilterField(key, value);
  }, [setFilterField]);
  const [expandedId, setExpanded] = useState(f.orderId || null);
  // When the owner navigates here from a customer timeline, only the clicked
  // order should be visible — otherwise it's buried among all other orders
  // in the date range. A dismissable banner lets them return to the full list.
  const [focusOrderId, setFocusOrderId] = useState(f.orderId || null);
  const [selected, setSelected]   = useState(new Set());
  const [upcomingMode, setUpcoming] = useState(!f.dateFrom && !f.orderId);
  const [showPremade, setShowPremade] = useState(false);
  const [sortBy, setSortBy]       = useState('deliveryDate');
  const [sortDir, setSortDir]     = useState('asc'); // 'asc' | 'desc' — bidirectional sort
  const [noDateOnly, setNoDateOnly] = useState(false); // surface orphan-date orders
  const { showToast }             = useToast();

  const initialLoaded = useRef(false);
  const fetchKeyRef = useRef('');

  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // In upcoming mode, fetch by the backend's "upcoming" shortcut — but
      // status still applies (it was sent regardless of mode pre-refactor).
      // Otherwise, route through the shared param builder so all filter
      // fields (date range, status, payment, delivery type, etc.) are sent
      // consistently. Filter by delivery/pickup date (Required By), not
      // submission date — the owner thinks in terms of "when does this go
      // out", not "when was it placed" — #337.
      // In upcoming mode, let `upcoming` own the date scope by blanking date fields
      // before building params — all non-date server filters (status, paymentStatus,
      // source, deliveryType, paymentMethod, excludeCancelled) still apply.
      const params = upcomingMode
        ? { upcoming: '1', ...buildOrderQueryParams({ ...filter, requiredByFrom: '', requiredByTo: '', orderDateFrom: '', orderDateTo: '' }) }
        : buildOrderQueryParams(filter);
      const res = await client.get('/orders', { params });
      setOrders(prev => {
        if (!initialLoaded.current) return res.data;
        const newMap = new Map(res.data.map(o => [o.id, o]));
        const merged = prev.map(o => newMap.get(o.id) || o).filter(o => newMap.has(o.id));
        for (const o of res.data) {
          if (!merged.find(m => m.id === o.id)) merged.push(o);
        }
        return merged;
      });
      initialLoaded.current = true;
      setFetchError(false);
    } catch {
      setFetchError(true);
      if (!silent) showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [filter, upcomingMode, showToast]);

  const fetchKey = JSON.stringify({ filter, upcomingMode });

  useEffect(() => {
    if (!isActive) return undefined;
    const queryChanged = fetchKeyRef.current !== fetchKey;
    if (queryChanged) {
      fetchKeyRef.current = fetchKey;
      initialLoaded.current = false;
    }
    fetchOrders(!queryChanged && initialLoaded.current);
    const interval = setInterval(() => { if (!document.hidden) fetchOrders(true); }, 60000);
    function onVisible() { if (!document.hidden) fetchOrders(true); }
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [fetchOrders, fetchKey, isActive]);

  // Derive distinct payment-method and source values from the loaded orders for
  // use in the Status column's bundled popover. No memoization needed — only
  // recomputed when orders change (same cadence as the rest of the render).
  const paymentMethods = useMemo(
    () => [...new Set(orders.map(o => o['Payment Method']).filter(Boolean))],
    [orders]
  );
  const sources = useMemo(
    () => [...new Set(orders.map(o => o['Source']).filter(Boolean))],
    [orders]
  );

  // Orders with no delivery/pickup date — these get sorted to the bottom of
  // every default view and become "lost". Counted from the unfiltered list so
  // the banner reflects reality even after the user narrows by search.
  const noDateCount = orders.filter(o => !o['Delivery Date'] && !o['Required By']).length;

  // Derive unpaidOnly from the unified filter so JSX below keeps working unchanged.
  const unpaidOnly = filter.paymentStatus === 'Unpaid';

  // Client-side filter — applies the shared predicate (orderIdQuery, customerQuery,
  // bouquetQuery, priceMin/Max) then the free-text search box (Customer Name +
  // Customer Request). Server-side fields were already applied by the fetch query.
  let filtered = orders.filter(o => orderMatchesClientFilter(o, filter));
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(o =>
      (o['Customer Name'] || '').toLowerCase().includes(q) ||
      (o['Customer Request'] || '').toLowerCase().includes(q));
  }
  if (noDateOnly) {
    filtered = filtered.filter(o => !o['Delivery Date'] && !o['Required By']);
  }
  if (focusOrderId) {
    filtered = filtered.filter(o => o.id === focusOrderId);
  }

  // Sort orders based on selected sort option + direction (bidirectional)
  const dirMul = sortDir === 'desc' ? -1 : 1;
  const sorted = [...filtered].sort((a, b) => {
    if (unpaidOnly) return (new Date(a['Order Date']) - new Date(b['Order Date'])) * dirMul;
    let result = 0;
    switch (sortBy) {
      case 'status':
        result = (STATUS_PRIORITY[a['Status']] ?? 99) - (STATUS_PRIORITY[b['Status']] ?? 99);
        break;
      case 'deliveryDate': {
        const da = a['Delivery Date'] || a['Required By'] || '9999';
        const db = b['Delivery Date'] || b['Required By'] || '9999';
        result = da.localeCompare(db) || (a['Delivery Time'] || '').localeCompare(b['Delivery Time'] || '');
        break;
      }
      case 'type': {
        const ta = a['Delivery Type'] === 'Delivery' ? 0 : 1;
        const tb = b['Delivery Type'] === 'Delivery' ? 0 : 1;
        result = ta - tb || (STATUS_PRIORITY[a['Status']] ?? 99) - (STATUS_PRIORITY[b['Status']] ?? 99);
        break;
      }
      case 'orderDate':
        result = (a['Order Date'] || '').localeCompare(b['Order Date'] || '');
        break;
      default:
        result = 0;
    }
    return result * dirMul;
  });

  function daysSince(dateStr) {
    if (!dateStr) return 0;
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  }

  // Selection helpers
  function toggleSelect(id, e) {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    if (selected.size === sorted.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sorted.map(o => o.id)));
    }
  }

  // Bulk actions
  async function bulkUpdateField(field, value) {
    const ids = [...selected];
    let ok = 0;
    for (const id of ids) {
      try {
        await client.patch(`/orders/${id}`, { [field]: value });
        ok++;
      } catch { /* skip failures */ }
    }
    showToast(`${ok}/${ids.length} ${t.updated}`);
    setSelected(new Set());
    fetchOrders();
  }

  return (
    <div className="space-y-4">
      {/* Filters bar */}
      <div className="glass-card px-4 py-3 flex flex-wrap items-center gap-3">
        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t.search + '...'}
          className="field-input w-48"
        />

        {/* Status pills */}
        <div className="flex gap-1 flex-wrap">
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setFilterField('status', opt.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter.status === opt.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 text-ios-secondary hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Premade toggle — switches the list to premade-bouquet inventory */}
        <button
          onClick={() => {
            // Cross-mode guard: drop noDateOnly when switching to Premade so
            // the filter doesn't silently persist when the user returns.
            setNoDateOnly(false);
            setShowPremade(v => !v);
          }}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            showPremade ? 'bg-pink-600 text-white' : 'bg-gray-100 text-ios-secondary hover:bg-gray-200'
          }`}
        >
          💐 {t.premadeBouquets}
        </button>

        {/* Upcoming toggle + Date range */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setUpcoming(u => !u)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              upcomingMode ? 'bg-brand-600 text-white' : 'bg-gray-100 text-ios-secondary hover:bg-gray-200'
            }`}
          >
            {t.upcoming || 'Today & upcoming'}
          </button>
          {!upcomingMode && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-ios-tertiary">{t.byFulfilmentDate}</span>
              <DatePicker value={filter.requiredByFrom} onChange={v => setFilterField('requiredByFrom', v)} placeholder={t.dateFrom} />
              <span className="text-xs text-ios-tertiary">—</span>
              <DatePicker value={filter.requiredByTo} onChange={v => setFilterField('requiredByTo', v)} placeholder={t.dateTo} />
            </div>
          )}
        </div>

        {/* Unpaid toggle */}
        <button
          onClick={() => setFilterField('paymentStatus', filter.paymentStatus === 'Unpaid' ? '' : 'Unpaid')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            unpaidOnly ? 'bg-ios-red text-white' : 'bg-gray-100 text-ios-secondary hover:bg-gray-200'
          }`}
        >
          {t.showUnpaid}
        </button>

        {/* Sort selector */}
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="px-2 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs text-ios-secondary"
        >
          {getSortOptions().map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {/* Sort direction toggle — bidirectional */}
        <button
          onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          className="px-2 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs text-ios-secondary hover:bg-gray-100"
          title={sortDir === 'asc' ? 'Ascending (click to reverse)' : 'Descending (click to reverse)'}
        >
          {sortDir === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      {/* Focused-order banner — when navigating from a customer timeline, we
          hide every other order so the target row is always visible without
          scrolling. The banner keeps an obvious escape hatch back to the full
          list (otherwise the list would look mysteriously empty). */}
      {focusOrderId && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-brand-50 border border-brand-200">
          <span className="text-sm text-brand-700 font-medium">
            📌 {t.showingSingleOrder || 'Focused on a single order from customer profile'}
          </span>
          <button
            onClick={() => setFocusOrderId(null)}
            className="text-xs text-brand-700 hover:text-brand-800 font-medium underline"
          >
            {t.showAllOrders || 'Show all orders'}
          </button>
        </div>
      )}

      {/* Active filter badges — show when any filter is active so the user
          always has a path to undo state. Dates (requiredByFrom/To) are
          excluded from this gate since they're always set — they surface
          instead through the column-header popover ▾ affordance. */}
      {(filter.source || filter.paymentStatus || filter.deliveryType || filter.paymentMethod || filter.excludeCancelled || filter.status || filter.orderIdQuery || filter.customerQuery || filter.bouquetQuery || filter.priceMin != null || filter.priceMax != null || filter.orderDateFrom || filter.orderDateTo || search || noDateOnly) && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-[11px] text-ios-tertiary">{t.activeFilters}:</span>
          {filter.orderIdQuery && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
              #{filter.orderIdQuery}
              <button onClick={() => setFilterField('orderIdQuery', '')} className="ml-0.5 text-gray-400 hover:text-gray-700">×</button>
            </span>
          )}
          {filter.customerQuery && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
              {t.colCustomer || t.customer}: {filter.customerQuery}
              <button onClick={() => setFilterField('customerQuery', '')} className="ml-0.5 text-gray-400 hover:text-gray-700">×</button>
            </span>
          )}
          {filter.bouquetQuery && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
              {t.colBouquet}: {filter.bouquetQuery}
              <button onClick={() => setFilterField('bouquetQuery', '')} className="ml-0.5 text-gray-400 hover:text-gray-700">×</button>
            </span>
          )}
          {(filter.priceMin != null || filter.priceMax != null) && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
              {t.orderTotal || 'Total'}: {filter.priceMin ?? '…'}–{filter.priceMax ?? '…'} {t.zl}
              <button onClick={() => { setFilterField('priceMin', null); setFilterField('priceMax', null); }} className="ml-0.5 text-gray-400 hover:text-gray-700">×</button>
            </span>
          )}
          {(filter.orderDateFrom || filter.orderDateTo) && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
              {t.orderDate}: {filter.orderDateFrom || '…'}–{filter.orderDateTo || '…'}
              <button onClick={() => { setFilterField('orderDateFrom', ''); setFilterField('orderDateTo', ''); }} className="ml-0.5 text-gray-400 hover:text-gray-700">×</button>
            </span>
          )}
          {filter.status && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-medium">
              {t.labelStatus}: {filter.status}
              <button onClick={() => setFilterField('status', '')} className="ml-0.5 text-indigo-400 hover:text-indigo-700">×</button>
            </span>
          )}
          {filter.paymentStatus === 'Paid' && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
              {t.paymentStatus}: {t.paid}
              <button onClick={() => setFilterField('paymentStatus', '')} className="ml-0.5 text-emerald-400 hover:text-emerald-700">×</button>
            </span>
          )}
          {filter.paymentStatus === 'Unpaid' && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-medium">
              {t.paymentStatus}: {t.unpaid}
              <button onClick={() => setFilterField('paymentStatus', '')} className="ml-0.5 text-red-400 hover:text-red-700">×</button>
            </span>
          )}
          {filter.paymentStatus === 'Partial' && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-orange-100 text-orange-700 text-xs font-medium">
              {t.paymentStatus}: {t.partial}
              <button onClick={() => setFilterField('paymentStatus', '')} className="ml-0.5 text-orange-400 hover:text-orange-700">×</button>
            </span>
          )}
          {filter.paymentMethod && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-purple-100 text-purple-700 text-xs font-medium">
              {t.paymentMethod}: {filter.paymentMethod}
              <button onClick={() => setFilterField('paymentMethod', '')} className="ml-0.5 text-purple-400 hover:text-purple-700">×</button>
            </span>
          )}
          {filter.source && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-brand-100 text-brand-700 text-xs font-medium">
              {t.source}: {filter.source}
              <button onClick={() => setFilterField('source', '')} className="ml-0.5 text-brand-400 hover:text-brand-700">×</button>
            </span>
          )}
          {filter.deliveryType && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-sky-100 text-sky-700 text-xs font-medium">
              {filter.deliveryType}
              <button onClick={() => setFilterField('deliveryType', '')} className="ml-0.5 text-sky-400 hover:text-sky-700">×</button>
            </span>
          )}
          {filter.excludeCancelled && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
              {t.statusCancelled} ✗
              <button onClick={() => setFilterField('excludeCancelled', false)} className="ml-0.5 text-gray-400 hover:text-gray-700">×</button>
            </span>
          )}
          {search && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
              {t.search}: "{search}"
              <button onClick={() => setSearch('')} className="ml-0.5 text-gray-400 hover:text-gray-700">×</button>
            </span>
          )}
          {noDateOnly && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">
              {t.ordersWithoutDate || 'No date'}
              <button onClick={() => setNoDateOnly(false)} className="ml-0.5 text-amber-400 hover:text-amber-700">×</button>
            </span>
          )}
          <button
            onClick={() => {
              // Preserve the fulfilment date range on reset — dates are always
              // active and clearing them would show all-time orders unexpectedly.
              setFilter(prev => ({
                ...clearOrderFilter(),
                requiredByFrom: prev.requiredByFrom,
                requiredByTo: prev.requiredByTo,
              }));
              setSearch('');
              setNoDateOnly(false);
            }}
            className="text-xs text-ios-secondary hover:text-ios-red underline font-medium"
          >
            {t.resetFilters || t.clearAll}
          </button>
        </div>
      )}

      {/* Orphan-date filter. Visible whenever noDateOnly is on OR any orders
          lack a date — never hidden while the filter is silently active
          (that was the "stuck filter" bug). */}
      {!showPremade && (noDateCount > 0 || noDateOnly) && (
        <button
          onClick={() => setNoDateOnly(v => !v)}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border text-sm font-medium transition-colors ${
            noDateOnly
              ? 'bg-amber-100 border-amber-300 text-amber-900'
              : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
          }`}
        >
          <span>⚠️ {t.ordersWithoutDate || 'Orders without a date'}: {noDateCount}</span>
          <span className="text-xs underline">
            {noDateOnly ? (t.showAll || 'Show all') : (t.showOnlyTheseOrders || 'Show only these')}
          </span>
        </button>
      )}

      {/* Premade inventory — replaces the orders list when the chip is active */}
      {showPremade && (
        <PremadeBouquetList
          onMatchClicked={(id) => onNavigate?.({ tab: 'newOrder', filter: { matchPremadeId: id } })}
        />
      )}

      {/* Loading */}
      {!showPremade && loading && <SkeletonTable rows={8} cols={5} />}

      {/* Order list */}
      {/* Results count */}
      {!showPremade && !loading && (
        <div className="flex items-center gap-3 px-1">
          <label className="flex items-center gap-1.5 cursor-pointer" onClick={e => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={sorted.length > 0 && selected.size === sorted.length}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-xs text-ios-tertiary">
              {selected.size > 0 ? `${selected.size} / ` : ''}{sorted.length} {t.orders.toLowerCase()}
            </span>
          </label>
          <button onClick={fetchOrders}
            className="ml-auto text-xs text-ios-secondary hover:text-brand-600 transition-colors"
            title={t.refresh}
          >↻ {t.refresh}</button>
        </div>
      )}

      {!showPremade && !loading && fetchError && (
        <div className="text-center py-12">
          <p className="text-ios-tertiary mb-3">{t.error}</p>
          <button onClick={fetchOrders}
            className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium"
          >{t.refresh}</button>
        </div>
      )}

      {!showPremade && !loading && !fetchError && sorted.length === 0 && (
        <div className="text-center py-12 text-ios-tertiary">{t.noResults}</div>
      )}

      {/* Column headers — mirror the collapsed-row flex widths below. Until
          now the order rows had no labels, so users had to guess what each
          column represented. */}
      {!showPremade && !loading && sorted.length > 0 && (
        <div className="px-4 py-2 flex items-center gap-4 text-[10px] font-semibold uppercase tracking-wide text-ios-tertiary">
          <span className="w-4 shrink-0" />
          {/* # — Order ID */}
          <span className="w-10 shrink-0 flex items-center">
            {t.colOrderId || '#'}
            <ColumnFilterPopover active={!!filter.orderIdQuery} title={t.colOrderId || '#'}>
              <input
                className="w-full px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs"
                value={filter.orderIdQuery}
                onChange={e => setFilterField('orderIdQuery', e.target.value)}
                placeholder="#"
              />
            </ColumnFilterPopover>
          </span>
          {/* Order date */}
          <span className="w-20 shrink-0 flex items-center">
            {t.orderDate || 'Order date'}
            <ColumnFilterPopover active={!!(filter.orderDateFrom || filter.orderDateTo)} title={t.orderDate || 'Order date'}>
              <div className="space-y-1.5 min-w-[160px]">
                <div>
                  <p className="text-[10px] text-ios-tertiary mb-0.5">{t.dateFrom}</p>
                  <DatePicker value={filter.orderDateFrom} onChange={v => setDateField('orderDateFrom', v)} placeholder={t.dateFrom} />
                </div>
                <div>
                  <p className="text-[10px] text-ios-tertiary mb-0.5">{t.dateTo}</p>
                  <DatePicker value={filter.orderDateTo} onChange={v => setDateField('orderDateTo', v)} placeholder={t.dateTo} />
                </div>
              </div>
            </ColumnFilterPopover>
          </span>
          {/* Customer */}
          <span className="w-36 flex items-center">
            {t.colCustomer || t.customer || 'Customer'}
            <ColumnFilterPopover active={!!filter.customerQuery} title={t.colCustomer || t.customer || 'Customer'}>
              <input
                className="w-full px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs"
                value={filter.customerQuery}
                onChange={e => setFilterField('customerQuery', e.target.value)}
                placeholder={t.colCustomer || t.customer || 'Customer'}
              />
            </ColumnFilterPopover>
          </span>
          {/* Bouquet */}
          <span className="flex-1 flex items-center">
            {t.colBouquet || t.bouquetComposition || 'Bouquet'}
            <ColumnFilterPopover active={!!filter.bouquetQuery} title={t.colBouquet || t.bouquetComposition || 'Bouquet'}>
              <input
                className="w-full px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs"
                value={filter.bouquetQuery}
                onChange={e => setFilterField('bouquetQuery', e.target.value)}
                placeholder={t.colBouquet || 'Bouquet'}
              />
            </ColumnFilterPopover>
          </span>
          {/* Status (bundled: status + payment status + payment method + source) */}
          <span className="shrink-0 w-20 text-right flex items-center justify-end">
            {t.labelStatus}
            <ColumnFilterPopover
              active={!!(filter.status || filter.paymentStatus || filter.paymentMethod || filter.source)}
              title={t.labelStatus}
            >
              <div className="space-y-3 min-w-[200px]">
                {/* Status */}
                <div>
                  <p className="text-[10px] text-ios-tertiary mb-1">{t.labelStatus}</p>
                  <select
                    className="w-full px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs"
                    value={filter.status}
                    onChange={e => setFilterField('status', e.target.value)}
                  >
                    {getStatusOptions().map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                {/* Payment status */}
                <div>
                  <p className="text-[10px] text-ios-tertiary mb-1">{t.paymentStatus}</p>
                  <div className="flex gap-1 flex-wrap">
                    {['', 'Paid', 'Unpaid', 'Partial'].map(v => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setFilterField('paymentStatus', v)}
                        className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                          filter.paymentStatus === v
                            ? 'bg-brand-600 text-white'
                            : 'bg-gray-100 text-ios-secondary hover:bg-gray-200'
                        }`}
                      >
                        {v || t.allStatuses}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Payment method */}
                <div>
                  <p className="text-[10px] text-ios-tertiary mb-1">{t.paymentMethod}</p>
                  <select
                    className="w-full px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs"
                    value={filter.paymentMethod}
                    onChange={e => setFilterField('paymentMethod', e.target.value)}
                  >
                    <option value="">{t.allStatuses}</option>
                    {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                {/* Source */}
                <div>
                  <p className="text-[10px] text-ios-tertiary mb-1">{t.source}</p>
                  <select
                    className="w-full px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs"
                    value={filter.source}
                    onChange={e => setFilterField('source', e.target.value)}
                  >
                    <option value="">{t.allStatuses}</option>
                    {sources.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </ColumnFilterPopover>
          </span>
          {/* Type — split from Fulfilment (w-12 matches body cell) */}
          <span className="shrink-0 w-12 flex items-center">
            {t.deliveryType}
            <ColumnFilterPopover active={!!filter.deliveryType} title={t.deliveryType}>
              <div className="flex gap-1 flex-wrap">
                {[['', t.allStatuses], ['Delivery', t.delivery || 'Delivery'], ['Pickup', t.pickup || 'Pickup']].map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setFilterField('deliveryType', v)}
                    className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                      filter.deliveryType === v
                        ? 'bg-brand-600 text-white'
                        : 'bg-gray-100 text-ios-secondary hover:bg-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </ColumnFilterPopover>
          </span>
          {/* Fulfilment date — split from Type (w-24 matches body cell).
              Active compares against the initial defaults (monthStart/today)
              since those are always set — comparing to "set at all" would keep
              the dot permanently lit and stop signalling "filtered here". */}
          <span className="shrink-0 w-24 text-right flex items-center justify-end">
            {t.colFulfillment}
            <ColumnFilterPopover active={filter.requiredByFrom !== monthStart() || filter.requiredByTo !== todayStr()} title={t.byFulfilmentDate}>
              <div className="space-y-1.5 min-w-[160px]">
                <div>
                  <p className="text-[10px] text-ios-tertiary mb-0.5">{t.dateFrom}</p>
                  <DatePicker value={filter.requiredByFrom} onChange={v => setDateField('requiredByFrom', v)} placeholder={t.dateFrom} />
                </div>
                <div>
                  <p className="text-[10px] text-ios-tertiary mb-0.5">{t.dateTo}</p>
                  <DatePicker value={filter.requiredByTo} onChange={v => setDateField('requiredByTo', v)} placeholder={t.dateTo} />
                </div>
              </div>
            </ColumnFilterPopover>
          </span>
          <span className="shrink-0 w-2" />{/* margin dot column */}
          {/* Total */}
          <span className="shrink-0 w-20 text-right flex items-center justify-end">
            {t.orderTotal || t.total || 'Total'}
            <ColumnFilterPopover active={filter.priceMin != null || filter.priceMax != null} title={t.orderTotal || 'Total'}>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] text-ios-tertiary w-6 shrink-0">{t.filterMin}</label>
                  <input
                    type="number"
                    className="flex-1 px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs"
                    value={filter.priceMin ?? ''}
                    placeholder={t.filterMin}
                    onChange={e => setFilterField('priceMin', Number(e.target.value) || null)}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] text-ios-tertiary w-6 shrink-0">{t.filterMax}</label>
                  <input
                    type="number"
                    className="flex-1 px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs"
                    value={filter.priceMax ?? ''}
                    placeholder={t.filterMax}
                    onChange={e => setFilterField('priceMax', Number(e.target.value) || null)}
                  />
                </div>
              </div>
            </ColumnFilterPopover>
          </span>
          {unpaidOnly && <span className="shrink-0 w-16 text-right">{t.colAge || t.daysOld || 'Age'}</span>}
          <span className="shrink-0 w-4" />{/* chevron */}
        </div>
      )}

      {!showPremade && !loading && sorted.map(order => {
        const isExpanded = expandedId === order.id;
        const days = daysSince(order['Order Date']);
        const isOverdue = unpaidOnly && days > 7;
        const isCritical = unpaidOnly && days > 14;

        return (
          <div key={order.id} className={`glass-card overflow-hidden transition-all ${
            isCritical ? 'ring-2 ring-ios-red/40' : isOverdue ? 'ring-2 ring-ios-orange/40' : ''
          }`}>
            {/* Compact row */}
            <div
              onClick={() => setExpanded(isExpanded ? null : order.id)}
              className="px-4 py-3 flex items-center gap-4 cursor-pointer hover:bg-gray-50 transition-colors"
            >
              <input
                type="checkbox"
                checked={selected.has(order.id)}
                onChange={e => toggleSelect(order.id, e)}
                className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 shrink-0"
              />
              {order['App Order ID'] && (
                <span className="text-[11px] font-mono text-ios-tertiary w-10 shrink-0">#{order['App Order ID']}</span>
              )}
              {/* Order Date — when the order was placed. The due date lives
                  on the Fulfilment column (right of the row, next to the
                  icon) so a single glance answers both "when was this
                  logged" and "when does it go out". */}
              <span className="text-xs text-ios-tertiary w-20 shrink-0">
                {fmtDate(order['Order Date']) || '—'}
              </span>
              <span className="text-sm font-medium text-ios-label w-36 truncate">
                {order['Customer Name'] || '—'}
              </span>
              <span className="text-xs text-ios-secondary flex-1 truncate">
                {order['Customer Request'] || '—'}
              </span>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium shrink-0 ${
                STATUS_COLORS[order.Status] || 'bg-gray-100 text-gray-600'
              }`}>
                {order.Status}
              </span>
              {/* Type — split from Fulfilment, w-12 matches header */}
              <span className="text-xs shrink-0 w-12">
                {order['Delivery Type'] === 'Delivery' ? '🚗' : '🏪'}
              </span>
              {/* Fulfilment date — split from Type, w-24 matches header */}
              <span className="text-xs shrink-0 w-24 text-ios-tertiary">
                {(() => {
                  const dueDate = order['Delivery Date'] || order['Required By'];
                  const dueTime = order['Delivery Time'];
                  if (!dueDate && !dueTime) return '—';
                  return `${fmtDate(dueDate) || ''}${dueTime ? ` · ${dueTime}` : ''}`;
                })()}
              </span>
              {/* Margin dot — green ≥55%, amber ≥40%, red <40%, gray if unknown */}
              {(() => {
                const cost = order['Flowers Cost Total'] || 0;
                const rev  = order['Final Price'] || order['Price Override'] || order['Sell Total'] || 0;
                const margin = rev > 0 && cost > 0 ? ((rev - cost) / rev) * 100 : null;
                const dotColor = margin === null ? 'bg-gray-300'
                  : margin >= 55 ? 'bg-emerald-400'
                  : margin >= 40 ? 'bg-amber-400'
                  : 'bg-rose-400';
                return <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} title={margin !== null ? `${t.margin}: ${margin.toFixed(0)}%` : ''} />;
              })()}
              {/* Price column — for Partial, show remaining underneath so the owner
                  sees outstanding money without expanding the row. */}
              {(() => {
                const total = Number(order['Final Price'] || order['Price Override'] || order['Sell Total'] || 0);
                const isPartial = order['Payment Status'] === 'Partial';
                const paid = Number(order['Payment 1 Amount'] || 0) + Number(order['Payment 2 Amount'] || 0);
                const remaining = isPartial ? Math.max(0, total - paid) : 0;
                return (
                  <span className={`w-20 text-right shrink-0 flex flex-col ${
                    order['Payment Status'] === 'Unpaid' ? 'text-ios-red' : 'text-ios-label'
                  }`}>
                    <span className="text-sm font-semibold leading-tight">{total.toFixed(0)} {t.zl}</span>
                    {isPartial && remaining > 0 && (
                      <span className="text-[10px] font-medium text-orange-600 leading-tight">
                        −{remaining.toFixed(0)} {t.zl}
                      </span>
                    )}
                  </span>
                );
              })()}
              {unpaidOnly && (
                <span className={`text-xs font-medium w-16 text-right shrink-0 ${
                  isCritical ? 'text-ios-red' : isOverdue ? 'text-ios-orange' : 'text-ios-tertiary'
                }`}>
                  {days} {t.daysOld}
                </span>
              )}
              <span className="text-ios-tertiary text-sm">{isExpanded ? '▲' : '▼'}</span>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <OrderDetailPanel
                orderId={order.id}
                onUpdate={fetchOrders}
                onNavigate={onNavigate}
              />
            )}
          </div>
        );
      })}

      {/* Floating bulk action bar — like a batch processing control panel */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40
                        bg-white rounded-2xl shadow-2xl border border-gray-200
                        px-5 py-3 flex items-center gap-3 animate-slide-up">
          <span className="text-sm font-semibold text-ios-label">
            {selected.size} {t.selected}
          </span>
          <div className="w-px h-6 bg-gray-200" />
          <button
            onClick={() => bulkUpdateField('Payment Status', 'Paid')}
            className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-medium
                       hover:bg-emerald-200 active-scale"
          >
            {t.markPaid}
          </button>
          <button
            onClick={() => bulkUpdateField('Status', 'Cancelled')}
            className="px-3 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-xs font-medium
                       hover:bg-rose-200 active-scale"
          >
            {t.bulkCancel}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="px-3 py-1.5 rounded-lg bg-gray-100 text-ios-secondary text-xs font-medium
                       hover:bg-gray-200 active-scale"
          >
            {t.clearSelection}
          </button>
        </div>
      )}
    </div>
  );
}
