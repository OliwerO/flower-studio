// OrdersTab — full order management table for the owner.
// Think of it as the master production board: every order visible,
// filterable, and editable from one screen.
// Accepts initialFilter from cross-tab navigation (Today tab clicks).

import { useState, useEffect, useCallback, useRef } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import OrderDetailPanel from './OrderDetailPanel.jsx';

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

export default function OrdersTab({ initialFilter }) {
  const STATUS_OPTIONS = getStatusOptions();
  // Initialize state from initialFilter to avoid double-fetch race condition.
  // If a filter is passed from another tab (e.g., Financial), use it from the start.
  const f = initialFilter || {};
  // When navigating with a specific orderId (e.g., from Today tab), use broad date range
  // so the order is found regardless of which day it was created.
  const defaultFrom = f.dateFrom || (f.orderId ? monthStart() : todayStr());
  const defaultTo   = f.dateTo   || todayStr();
  const [orders, setOrders]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatus] = useState(f.status || '');
  const [dateFrom, setDateFrom]   = useState(defaultFrom);
  const [dateTo, setDateTo]       = useState(defaultTo);
  const [unpaidOnly, setUnpaid]   = useState(f.payment === 'Unpaid');
  const [paidOnly, setPaidOnly]   = useState(f.payment === 'Paid');
  const [deliveryTypeFilter, setDeliveryType] = useState(f.deliveryType || '');
  const [sourceFilter, setSourceFilter] = useState(f.source || '');
  const [paymentMethodFilter, setPaymentMethod] = useState(f.paymentMethod || '');
  const [excludeCancelled, setExcludeCancelled] = useState(!!f.excludeCancelled);
  const [expandedId, setExpanded] = useState(f.orderId || null);
  const [selected, setSelected]   = useState(new Set());
  const [sortBy, setSortBy]       = useState('status');
  const { showToast }             = useToast();

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (unpaidOnly) params.paymentStatus = 'Unpaid';
      if (paidOnly) params.paymentStatus = 'Paid';
      if (deliveryTypeFilter) params.deliveryType = deliveryTypeFilter;
      if (sourceFilter) params.source = sourceFilter;
      if (paymentMethodFilter) params.paymentMethod = paymentMethodFilter;
      if (excludeCancelled) params.excludeCancelled = '1';
      const res = await client.get('/orders', { params });
      setOrders(res.data);
      setFetchError(false);
    } catch {
      setFetchError(true);
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, dateFrom, dateTo, unpaidOnly, paidOnly, deliveryTypeFilter, sourceFilter, paymentMethodFilter, excludeCancelled, showToast]);

  useEffect(() => {
    fetchOrders();
    // Poll every 30s when tab is visible — keeps data fresh
    const interval = setInterval(() => { if (!document.hidden) fetchOrders(); }, 30000);
    function onVisible() { if (!document.hidden) fetchOrders(); }
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [fetchOrders]);

  // Client-side search filter
  const filtered = search
    ? orders.filter(o => {
        const q = search.toLowerCase();
        return (o['Customer Name'] || '').toLowerCase().includes(q)
          || (o['Customer Request'] || '').toLowerCase().includes(q);
      })
    : orders;

  // Sort orders based on selected sort option
  const sorted = [...filtered].sort((a, b) => {
    if (unpaidOnly) return new Date(a['Order Date']) - new Date(b['Order Date']);
    switch (sortBy) {
      case 'status':
        return (STATUS_PRIORITY[a['Status']] ?? 99) - (STATUS_PRIORITY[b['Status']] ?? 99);
      case 'deliveryDate': {
        const da = a['Delivery Date'] || a['Required By'] || '9999';
        const db = b['Delivery Date'] || b['Required By'] || '9999';
        return da.localeCompare(db) || (a['Delivery Time'] || '').localeCompare(b['Delivery Time'] || '');
      }
      case 'type': {
        const ta = a['Delivery Type'] === 'Delivery' ? 0 : 1;
        const tb = b['Delivery Type'] === 'Delivery' ? 0 : 1;
        return ta - tb || (STATUS_PRIORITY[a['Status']] ?? 99) - (STATUS_PRIORITY[b['Status']] ?? 99);
      }
      case 'orderDate':
        return (b['Order Date'] || '').localeCompare(a['Order Date'] || '');
      default:
        return 0;
    }
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
              onClick={() => setStatus(opt.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                statusFilter === opt.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 text-ios-secondary hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2 ml-auto">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs" />
          <span className="text-xs text-ios-tertiary">—</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs" />
        </div>

        {/* Unpaid toggle */}
        <button
          onClick={() => { setUnpaid(u => !u); setPaidOnly(false); }}
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
      </div>

      {/* Active filter badges — show when cross-tab filters are active */}
      {(sourceFilter || paidOnly || deliveryTypeFilter || paymentMethodFilter || excludeCancelled) && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-[11px] text-ios-tertiary">{t.activeFilters}:</span>
          {sourceFilter && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-brand-100 text-brand-700 text-xs font-medium">
              {t.source}: {sourceFilter}
              <button onClick={() => setSourceFilter('')} className="ml-0.5 text-brand-400 hover:text-brand-700">×</button>
            </span>
          )}
          {paidOnly && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
              {t.paymentStatus}: {t.paid}
              <button onClick={() => setPaidOnly(false)} className="ml-0.5 text-emerald-400 hover:text-emerald-700">×</button>
            </span>
          )}
          {deliveryTypeFilter && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-sky-100 text-sky-700 text-xs font-medium">
              {deliveryTypeFilter}
              <button onClick={() => setDeliveryType('')} className="ml-0.5 text-sky-400 hover:text-sky-700">×</button>
            </span>
          )}
          {paymentMethodFilter && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-purple-100 text-purple-700 text-xs font-medium">
              {t.paymentMethod}: {paymentMethodFilter}
              <button onClick={() => setPaymentMethod('')} className="ml-0.5 text-purple-400 hover:text-purple-700">×</button>
            </span>
          )}
          {excludeCancelled && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
              {t.statusCancelled} ✗
              <button onClick={() => setExcludeCancelled(false)} className="ml-0.5 text-gray-400 hover:text-gray-700">×</button>
            </span>
          )}
          <button
            onClick={() => { setSourceFilter(''); setPaidOnly(false); setUnpaid(false); setDeliveryType(''); setPaymentMethod(''); setStatus(''); setExcludeCancelled(false); }}
            className="text-xs text-ios-secondary hover:text-ios-red underline"
          >
            {t.clearAll}
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
        </div>
      )}

      {/* Order list */}
      {/* Results count */}
      {!loading && (
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

      {!loading && fetchError && (
        <div className="text-center py-12">
          <p className="text-ios-tertiary mb-3">{t.error}</p>
          <button onClick={fetchOrders}
            className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium"
          >{t.refresh}</button>
        </div>
      )}

      {!loading && !fetchError && sorted.length === 0 && (
        <div className="text-center py-12 text-ios-tertiary">{t.noResults}</div>
      )}

      {!loading && sorted.map(order => {
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
              {order['Order ID'] && (
                <span className="text-[11px] font-mono text-ios-tertiary w-10 shrink-0">#{order['Order ID']}</span>
              )}
              <span className="text-xs text-ios-tertiary w-20 shrink-0">
                {order['Order Date'] || '—'}
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
              <span className="text-xs shrink-0 flex items-center gap-1">
                {order['Delivery Type'] === 'Delivery' ? '🚗' : '🏪'}
                {order['Delivery Type'] === 'Delivery' && (order['Delivery Date'] || order['Delivery Time']) && (
                  <span className="text-ios-tertiary">
                    {fmtDate(order['Delivery Date'])}
                    {order['Delivery Time'] ? ` · ${order['Delivery Time']}` : ''}
                  </span>
                )}
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
              <span className={`text-sm font-semibold w-20 text-right shrink-0 ${
                order['Payment Status'] === 'Unpaid' ? 'text-ios-red' : 'text-ios-label'
              }`}>
                {(order['Final Price'] || order['Price Override'] || order['Sell Total'] || 0).toFixed(0)} {t.zl}
              </span>
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
