// DayToDayTab — real-time operational overview for the owner.
// Like a factory floor control panel: what's happening right now,
// what needs attention, and key metrics at a glance.
// Every widget is clickable — navigates to the relevant tab with filters.

import { useState, useEffect, useCallback } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import SummaryCard from './SummaryCard.jsx';
import KanbanBoard from './KanbanBoard.jsx';
import { DashboardSkeleton } from './Skeleton.jsx';

// "2026-03-08" → "Mar 8"
function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}

const ALL_STATUSES = [
  { key: 'New',              color: 'text-indigo-600' },
  { key: 'Ready',            color: 'text-amber-600' },
  { key: 'Out for Delivery', color: 'text-sky-600' },
  { key: 'Delivered',        color: 'text-emerald-600' },
  { key: 'Picked Up',        color: 'text-teal-600' },
  { key: 'Cancelled',        color: 'text-rose-600' },
];

export default function DayToDayTab({ onNavigate }) {
  const [data, setData]           = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [kanbanOpen, setKanbanOpen] = useState(false);
  const [driverOfDay, setDriverOfDay] = useState(null);
  const [drivers, setDrivers]     = useState([]);
  const { showToast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const firstOfMonth = today.slice(0, 8) + '01';

      const [dashRes, analyticsRes, settingsRes] = await Promise.all([
        client.get('/dashboard', { params: { date: today } }),
        client.get('/analytics', { params: { from: firstOfMonth, to: today } }).catch(() => ({ data: null })),
        client.get('/settings').catch(() => ({ data: {} })),
      ]);
      setData(dashRes.data);
      setAnalytics(analyticsRes.data);
      setDriverOfDay(settingsRes.data.driverOfDay || null);
      setDrivers(settingsRes.data.drivers || []);
      setFetchError(false);
    } catch {
      setFetchError(true);
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchData();

    // Poll every 60s, but skip when the browser tab is hidden (saves API calls)
    const interval = setInterval(() => {
      if (!document.hidden) fetchData();
    }, 60000);

    // Re-fetch immediately when the user switches back to this browser tab
    function handleVisibility() {
      if (!document.hidden) fetchData();
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchData]);

  if (loading) return <DashboardSkeleton />;

  if (fetchError || !data) return (
    <div className="text-center py-16">
      <p className="text-ios-tertiary mb-3">{t.error}</p>
      <button onClick={fetchData}
        className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium"
      >{t.refresh}</button>
    </div>
  );

  const nav = (tab, filter) => onNavigate?.({ tab, filter });

  async function handleDriverOfDay(name) {
    try {
      await client.put('/settings/driver-of-day', { driverName: name || null });
      setDriverOfDay(name || null);
      showToast(name ? `${t.driverOfDay}: ${name}` : t.driverOfDayCleared);
    } catch {
      showToast(t.error, 'error');
    }
  }

  // Compute paid/unpaid totals from recent orders (use Effective Price computed by backend)
  const paidOrders = (data.recentOrders || []).filter(o => o['Payment Status'] === 'Paid');
  const unpaidOrders = (data.recentOrders || []).filter(o => o['Payment Status'] === 'Unpaid');
  const unpaidTotal = unpaidOrders.reduce((sum, o) => sum + (o['Effective Price'] || 0), 0);

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
          label={t.pendingDeliveries}
          value={data.pendingDeliveries?.length || 0}
          detail={t.tabToday}
          color="blue"
          onClick={() => nav('orders', { deliveryType: 'Delivery' })}
        />
        <SummaryCard
          label={t.revenue}
          value={`${data.todayRevenue.toFixed(0)} ${t.zl}`}
          detail={`${paidOrders.length} orders`}
          color="green"
          onClick={() => nav('orders', { payment: 'Paid' })}
        />
        <SummaryCard
          label={t.unpaid}
          value={unpaidOrders.length > 0 ? `${unpaidTotal.toFixed(0)} ${t.zl}` : '✓'}
          detail={unpaidOrders.length > 0 ? `${unpaidOrders.length} orders` : 'All paid'}
          color={unpaidOrders.length > 0 ? 'red' : 'green'}
          onClick={() => nav('orders', { payment: 'Unpaid' })}
        />
      </div>

      {/* Driver of the day — quick toggle for auto-assigning deliveries */}
      {drivers.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm px-4 py-3">
          <h3 className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
            {t.driverOfDay}
          </h3>
          <div className="flex flex-wrap gap-2">
            {drivers.map(name => (
              <button
                key={name}
                onClick={() => handleDriverOfDay(driverOfDay === name ? null : name)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all active-scale ${
                  driverOfDay === name
                    ? 'bg-brand-600 text-white shadow-md'
                    : 'bg-gray-100 text-ios-secondary hover:bg-gray-200'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          {driverOfDay && (
            <p className="text-xs text-ios-secondary mt-2">
              {t.driverOfDayHint}
            </p>
          )}
        </div>
      )}

      {/* Unassigned deliveries — crisis alert */}
      {data.unassignedDeliveries?.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3">
          <h3 className="text-xs font-semibold text-rose-600 uppercase tracking-wide mb-2">
            {t.unassignedDeliveries} ({data.unassignedDeliveries.length})
          </h3>
          <div className="space-y-1">
            {data.unassignedDeliveries.map(d => (
              <div key={d.id}
                onClick={() => nav('orders', { orderId: d['Linked Order']?.[0] || d.id })}
                className="flex items-center justify-between text-sm cursor-pointer hover:bg-rose-100/50 rounded-lg px-2 py-1 transition-colors">
                <span className="text-ios-label font-medium">{d['Recipient Name'] || '—'}</span>
                <span className="text-rose-600 text-xs font-medium">{d['Delivery Time'] || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status breakdown — evenly spaced, click to expand kanban */}
      <div className="bg-white rounded-2xl shadow-sm px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">
            {t.status}
          </h3>
          <button
            onClick={() => setKanbanOpen(!kanbanOpen)}
            className="text-[11px] text-ios-secondary hover:text-ios-label transition-colors"
          >
            {kanbanOpen ? '✕ Close' : '▦ Board'}
          </button>
        </div>
        <div className="grid grid-cols-6 gap-1">
          {ALL_STATUSES.map(({ key, color }) => (
            <div
              key={key}
              onClick={() => setKanbanOpen(!kanbanOpen)}
              className="flex flex-col items-center gap-1 cursor-pointer hover:bg-white/40 rounded-lg py-2 transition-colors"
            >
              <span className={`text-2xl font-bold ${statusCounts[key] > 0 ? color : 'text-ios-tertiary/30'}`}>
                {statusCounts[key]}
              </span>
              <span className={`text-[11px] text-center ${statusCounts[key] > 0 ? 'text-ios-secondary' : 'text-ios-tertiary/50'}`}>
                {key}
              </span>
            </div>
          ))}
        </div>

        {/* Kanban board — slides open below the status counts */}
        {kanbanOpen && data.recentOrders?.length > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-100">
            <KanbanBoard
              orders={data.recentOrders}
              onOrderClick={(order) => nav('orders', { orderId: order.id })}
            />
          </div>
        )}
      </div>

      {/* Pending deliveries */}
      {data.pendingDeliveries?.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <h3 className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-3">
            {t.pendingDeliveries}
          </h3>
          <div className="bg-gray-50 rounded-xl overflow-hidden divide-y divide-gray-100">
            {data.pendingDeliveries.map(d => {
              const customerName = d['Customer Name'] || '—';
              const recipientName = d['Recipient Name'] || '—';
              // Only show "from → for" when customer differs from recipient (gift orders)
              const isGift = customerName !== recipientName && customerName !== '—';
              return (
                <div
                  key={d.id}
                  onClick={() => nav('orders', { orderId: d['Linked Order']?.[0] || d.id })}
                  className="flex items-center gap-4 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <div className="w-44 shrink-0">
                    {isGift ? (
                      <>
                        <div className="flex items-baseline gap-1">
                          <span className="text-[10px] text-ios-tertiary w-6 shrink-0">from</span>
                          <span className="text-xs text-ios-secondary truncate">{customerName}</span>
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-[10px] text-ios-tertiary w-6 shrink-0">for</span>
                          <span className="text-sm font-medium text-ios-label truncate">{recipientName}</span>
                        </div>
                      </>
                    ) : (
                      <span className="text-sm font-medium text-ios-label truncate block">{recipientName}</span>
                    )}
                  </div>
                  <span className="text-xs text-ios-secondary flex-1 truncate">
                    {d['Delivery Address'] || '—'}
                  </span>
                  <div className="text-right shrink-0">
                    {d['Delivery Date'] && (
                      <div className="text-xs font-semibold text-ios-label">
                        {fmtDate(d['Delivery Date'])}
                      </div>
                    )}
                    <div className="text-xs text-brand-600 font-medium">
                      {d['Delivery Time'] || '—'}
                    </div>
                  </div>
                  <span className="text-xs text-ios-tertiary shrink-0">
                    {d['Assigned Driver'] || '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Low stock alerts */}
      {data.lowStockAlerts?.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <h3 className="text-xs font-semibold text-ios-orange uppercase tracking-wide mb-3">
            {t.lowStockAlerts}
          </h3>
          <div className="flex flex-wrap gap-2">
            {data.lowStockAlerts.map(item => (
              <span
                key={item.id}
                onClick={() => nav('stock')}
                className="inline-flex items-center gap-1.5 bg-ios-orange/10 rounded-full px-3 py-1.5 text-xs cursor-pointer hover:bg-ios-orange/20 transition-all active-scale"
              >
                <span className="font-bold text-ios-orange">{item['Current Quantity'] || 0}</span>
                <span className="text-ios-label">{item['Display Name']}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Unpaid orders aging — clickable buckets drill down to filtered order list */}
      {data.unpaidAging && data.unpaidAging.grandTotal.count > 0 && (
        <div className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <h3 className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-3">
            {t.unpaidAging}
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
            {[
              { label: t.agingToday, data: data.unpaidAging.today, daysBack: 0 },
              { label: t.aging1to7, data: data.unpaidAging.week, daysBack: 7 },
              { label: t.aging8to30, data: data.unpaidAging.month, daysBack: 30 },
              { label: t.aging30plus, data: data.unpaidAging.older, daysBack: 365, alert: true },
              { label: t.totalOutstanding, data: data.unpaidAging.grandTotal, daysBack: 365, bold: true },
            ].map(bucket => (
              <div
                key={bucket.label}
                onClick={() => {
                  if (bucket.data.count === 0) return;
                  const today = new Date();
                  const to = new Date(today);
                  const from = new Date(today);
                  if (bucket.daysBack === 0) {
                    // Today only
                  } else if (bucket.bold) {
                    // Grand total — show all unpaid
                    from.setDate(from.getDate() - 365);
                  } else {
                    // Specific bucket range
                    to.setDate(to.getDate() - (bucket.daysBack === 7 ? 1 : bucket.daysBack === 30 ? 8 : 31));
                    from.setDate(from.getDate() - bucket.daysBack);
                  }
                  const fmt = d => d.toISOString().split('T')[0];
                  nav('orders', { payment: 'Unpaid', dateFrom: fmt(from), dateTo: fmt(to) });
                }}
                className={`rounded-xl px-3 py-2 text-center transition-all ${
                  bucket.data.count > 0 ? 'cursor-pointer hover:ring-2 hover:ring-brand-300 active-scale' : ''
                } ${
                  bucket.alert && bucket.data.count > 0 ? 'bg-rose-50' : bucket.bold ? 'bg-brand-50' : 'bg-gray-50'
                }`}
              >
                <p className={`text-lg font-bold ${
                  bucket.alert && bucket.data.count > 0 ? 'text-rose-600' : bucket.bold ? 'text-brand-700' : 'text-ios-label'
                }`}>
                  {bucket.data.total.toFixed(0)} {t.zl}
                </p>
                <p className="text-[10px] text-ios-tertiary">{bucket.data.count} orders</p>
                <p className="text-[11px] text-ios-secondary mt-0.5">{bucket.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Key date reminders — upcoming birthdays/anniversaries */}
      {data.keyDateReminders?.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <h3 className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-3">
            {t.upcomingDates}
          </h3>
          <div className="bg-gray-50 rounded-xl overflow-hidden divide-y divide-gray-100">
            {data.keyDateReminders.map((r, i) => (
              <div key={i}
                onClick={() => nav('customers', { search: r.customerName })}
                className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-gray-100 transition-colors">
                <div>
                  <span className="text-sm font-medium text-ios-label">{r.customerName}</span>
                  <span className="text-xs text-ios-tertiary ml-2">{r.keyPersonName}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-medium text-brand-600">
                    {r.daysUntil === 0 ? 'Today!' : `${r.daysUntil} ${t.daysUntil}`}
                  </span>
                  <span className="text-[10px] text-ios-tertiary ml-2">{r.date}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
