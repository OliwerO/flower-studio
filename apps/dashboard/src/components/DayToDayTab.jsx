// DayToDayTab — real-time operational overview for the owner.
// Like a factory floor control panel: what's happening right now,
// what needs attention, and key metrics at a glance.
// Every widget is clickable — navigates to the relevant tab with filters.

import { useState, useEffect, useCallback } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import SummaryCard from './SummaryCard.jsx';
import SourceChart from './SourceChart.jsx';
import TopProductsWidget from './TopProductsWidget.jsx';

const ALL_STATUSES = [
  { key: 'New',              color: 'text-ios-blue' },
  { key: 'Ready',            color: 'text-brand-600' },
  { key: 'Out for Delivery', color: 'text-purple-600' },
  { key: 'Delivered',        color: 'text-ios-green' },
  { key: 'Picked Up',        color: 'text-ios-green' },
  { key: 'Cancelled',        color: 'text-ios-red' },
];

export default function DayToDayTab({ onNavigate }) {
  const [data, setData]           = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading]     = useState(true);
  const { showToast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const firstOfMonth = today.slice(0, 8) + '01';

      const [dashRes, analyticsRes] = await Promise.all([
        client.get('/dashboard', { params: { date: today } }),
        client.get('/analytics', { params: { from: firstOfMonth, to: today } }).catch(() => ({ data: null })),
      ]);
      setData(dashRes.data);
      setAnalytics(analyticsRes.data);
    } catch {
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  const nav = (tab, filter) => onNavigate?.({ tab, filter });

  // Compute unpaid totals from recent orders
  const unpaidOrders = (data.recentOrders || []).filter(o => o['Payment Status'] === 'Unpaid');
  const unpaidTotal = unpaidOrders.reduce((sum, o) => sum + (o['Final Price'] || 0), 0);

  // Build status counts map with all statuses (fill zeros)
  const statusCounts = {};
  for (const s of ALL_STATUSES) statusCounts[s.key] = 0;
  if (data.statusCounts) {
    for (const [k, v] of Object.entries(data.statusCounts)) statusCounts[k] = v;
  }

  return (
    <div className="space-y-6">
      {/* Summary cards row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label={t.orders}
          value={data.orderCount}
          detail={t.tabToday}
          color="brand"
          onClick={() => nav('orders')}
        />
        <SummaryCard
          label={t.revenue}
          value={`${data.todayRevenue.toFixed(0)} ${t.zl}`}
          detail={t.paid}
          color="green"
          onClick={() => nav('orders', { payment: 'Paid' })}
        />
        <SummaryCard
          label={t.pendingDeliveries}
          value={data.pendingDeliveries?.length || 0}
          detail={t.tabToday}
          color="blue"
          onClick={() => nav('orders', { deliveryType: 'Delivery' })}
        />
        <SummaryCard
          label={t.unpaid}
          value={unpaidOrders.length > 0 ? `${unpaidOrders.length}` : '✓'}
          detail={unpaidTotal > 0 ? `${unpaidTotal.toFixed(0)} ${t.zl}` : t.paid}
          color={unpaidOrders.length > 0 ? 'red' : 'green'}
          onClick={() => nav('orders', { payment: 'Unpaid' })}
        />
      </div>

      {/* Status breakdown — all statuses shown, clickable */}
      <div className="glass-card px-4 py-3">
        <h3 className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-3">
          {t.status}
        </h3>
        <div className="flex flex-wrap gap-3">
          {ALL_STATUSES.map(({ key, color }) => (
            <div
              key={key}
              onClick={() => nav('orders', { status: key })}
              className="flex items-center gap-2 cursor-pointer hover:bg-white/40 rounded-lg px-2 py-1 -mx-2 transition-colors"
            >
              <span className={`text-2xl font-bold ${statusCounts[key] > 0 ? color : 'text-ios-tertiary/30'}`}>
                {statusCounts[key]}
              </span>
              <span className={`text-xs ${statusCounts[key] > 0 ? 'text-ios-secondary' : 'text-ios-tertiary/50'}`}>
                {key}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Source chart (this month) */}
        {analytics && (
          <SourceChart
            bySource={analytics.orders?.bySource || {}}
            revenueBySource={analytics.orders?.revenueBySource || {}}
          />
        )}

        {/* Top products (this month) */}
        {analytics?.orders?.topProducts && (
          <TopProductsWidget products={analytics.orders.topProducts} />
        )}
      </div>

      {/* Pending deliveries */}
      {data.pendingDeliveries?.length > 0 && (
        <div className="glass-card px-4 py-3">
          <h3 className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-3">
            {t.pendingDeliveries}
          </h3>
          <div className="space-y-1">
            {data.pendingDeliveries.map(d => (
              <div
                key={d.id}
                onClick={() => nav('orders', { orderId: d['Linked Order']?.[0] || d.id })}
                className="flex items-center gap-4 py-2 border-b border-white/20 last:border-0 cursor-pointer hover:bg-white/30 rounded-lg px-2 -mx-2 transition-colors"
              >
                <span className="text-sm font-medium text-ios-label w-32 truncate">
                  {d['Recipient Name'] || '—'}
                </span>
                <span className="text-xs text-ios-secondary flex-1 truncate">
                  {d['Delivery Address'] || '—'}
                </span>
                <span className="text-xs text-brand-600 font-medium shrink-0">
                  {d['Delivery Time'] || '—'}
                </span>
                <span className="text-xs text-ios-tertiary shrink-0">
                  {d['Assigned Driver'] || '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Low stock alerts */}
      {data.lowStockAlerts?.length > 0 && (
        <div className="glass-card px-4 py-3">
          <h3 className="text-xs font-semibold text-ios-orange uppercase tracking-wide mb-3">
            {t.lowStockAlerts}
          </h3>
          <div className="flex flex-wrap gap-2">
            {data.lowStockAlerts.map(item => (
              <span
                key={item.id}
                onClick={() => nav('stock')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ios-orange/10 text-xs cursor-pointer hover:bg-ios-orange/20 transition-colors"
              >
                <span className="font-semibold text-ios-orange">{item['Current Quantity'] || 0}</span>
                <span className="text-ios-label">{item['Display Name']}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent orders feed */}
      {data.recentOrders?.length > 0 && (
        <div className="glass-card px-4 py-3">
          <h3 className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-3">
            {t.recentOrders}
          </h3>
          <div className="space-y-1">
            {data.recentOrders.map(o => {
              const statusObj = ALL_STATUSES.find(s => s.key === o.Status);
              return (
                <div
                  key={o.id}
                  onClick={() => nav('orders', { orderId: o.id })}
                  className="flex items-center gap-4 py-2 border-b border-white/20 last:border-0 cursor-pointer hover:bg-white/30 rounded-lg px-2 -mx-2 transition-colors"
                >
                  <span className="text-xs text-ios-tertiary w-16 shrink-0">
                    {o['Order Date']}
                  </span>
                  <span className="text-sm font-medium text-ios-label w-32 truncate">
                    {o['Customer Name'] || '—'}
                  </span>
                  <span className="text-xs text-ios-secondary flex-1 truncate">
                    {o['Customer Request'] || '—'}
                  </span>
                  <span className={`text-xs font-medium ${statusObj?.color || ''}`}>
                    {o.Status}
                  </span>
                  <span className={`text-sm font-semibold w-16 text-right ${
                    o['Payment Status'] === 'Unpaid' ? 'text-ios-red' : 'text-ios-label'
                  }`}>
                    {(o['Final Price'] || 0).toFixed(0)} {t.zl}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
