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

const STATUS_OPTIONS = [
  { value: '',                label: t.allStatuses },
  { value: 'New',             label: t.statusNew },
  { value: 'Ready',           label: t.statusReady },
  { value: 'Out for Delivery', label: t.statusOutForDel },
  { value: 'Delivered',       label: t.statusDelivered },
  { value: 'Picked Up',       label: t.statusPickedUp },
  { value: 'Cancelled',       label: t.statusCancelled },
];

const STATUS_COLORS = {
  New:              'bg-indigo-100 text-indigo-700',
  Ready:            'bg-amber-100 text-amber-700',
  'Out for Delivery':'bg-sky-100 text-sky-700',
  Delivered:        'bg-emerald-100 text-emerald-700',
  'Picked Up':      'bg-teal-100 text-teal-700',
  Cancelled:        'bg-rose-100 text-rose-700',
};

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function OrdersTab({ initialFilter }) {
  // Initialize state from initialFilter to avoid double-fetch race condition.
  // If a filter is passed from another tab (e.g., Financial), use it from the start.
  const f = initialFilter || {};
  // When navigating with a specific orderId (e.g., from Today tab), use broad date range
  // so the order is found regardless of which day it was created.
  const defaultFrom = f.dateFrom || (f.orderId ? monthStart() : todayStr());
  const defaultTo   = f.dateTo   || todayStr();
  const [orders, setOrders]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatus] = useState(f.status || '');
  const [dateFrom, setDateFrom]   = useState(defaultFrom);
  const [dateTo, setDateTo]       = useState(defaultTo);
  const [unpaidOnly, setUnpaid]   = useState(f.payment === 'Unpaid');
  const [paidOnly, setPaidOnly]   = useState(f.payment === 'Paid');
  const [deliveryTypeFilter, setDeliveryType] = useState(f.deliveryType || '');
  const [sourceFilter, setSourceFilter] = useState(f.source || '');
  const [excludeCancelled, setExcludeCancelled] = useState(!!f.excludeCancelled);
  const [expandedId, setExpanded] = useState(f.orderId || null);
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
      if (excludeCancelled) params.excludeCancelled = '1';
      const res = await client.get('/orders', { params });
      setOrders(res.data);
    } catch {
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, dateFrom, dateTo, unpaidOnly, paidOnly, deliveryTypeFilter, sourceFilter, excludeCancelled, showToast]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Client-side search filter
  const filtered = search
    ? orders.filter(o => {
        const q = search.toLowerCase();
        return (o['Customer Name'] || '').toLowerCase().includes(q)
          || (o['Customer Request'] || '').toLowerCase().includes(q);
      })
    : orders;

  // Sort unpaid orders by age when unpaid filter is active
  const sorted = unpaidOnly
    ? [...filtered].sort((a, b) => new Date(a['Order Date']) - new Date(b['Order Date']))
    : filtered;

  function daysSince(dateStr) {
    if (!dateStr) return 0;
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
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
      </div>

      {/* Active filter badges — show when cross-tab filters are active */}
      {(sourceFilter || paidOnly || deliveryTypeFilter || excludeCancelled) && (
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
          {excludeCancelled && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
              {t.statusCancelled} ✗
              <button onClick={() => setExcludeCancelled(false)} className="ml-0.5 text-gray-400 hover:text-gray-700">×</button>
            </span>
          )}
          <button
            onClick={() => { setSourceFilter(''); setPaidOnly(false); setUnpaid(false); setDeliveryType(''); setStatus(''); setExcludeCancelled(false); }}
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
        <p className="text-xs text-ios-tertiary px-1">
          {sorted.length} {t.orders.toLowerCase()}
        </p>
      )}

      {!loading && sorted.length === 0 && (
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
    </div>
  );
}
