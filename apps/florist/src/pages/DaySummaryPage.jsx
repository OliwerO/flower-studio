// DaySummaryPage — lightweight mobile dashboard for the owner.
// Single scrollable screen showing today's operations at a glance.
// All data comes from one GET /api/dashboard call — no extra endpoints.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import t from '../translations.js';

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function Section({ title, children }) {
  return (
    <div>
      <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">{title}</p>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3">
        {children}
      </div>
    </div>
  );
}

export default function DaySummaryPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('/dashboard', { params: { date: todayISO() } })
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-ios-tertiary">{t.loadError}</p>
      </div>
    );
  }

  const unpaidToday = data.unpaidAging?.today || { count: 0, total: 0 };
  const sc = data.statusCounts || {};
  const alerts = data.lowStockAlerts || [];
  const deliveries = data.pendingDeliveries || [];
  // Find unpaid orders from recentOrders
  const unpaidOrders = (data.recentOrders || []).filter(o => o['Payment Status'] === 'Unpaid');

  return (
    <div className="min-h-screen pb-8">
      {/* Header */}
      <header className="glass-nav px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <button onClick={() => navigate('/orders')} className="text-brand-600 text-sm font-medium">
            ← {t.navOrders}
          </button>
          <span className="font-semibold text-ios-label">{t.owner.daySummary}</span>
          <span className="w-16" />
        </div>
      </header>

      <div className="px-4 max-w-2xl mx-auto flex flex-col gap-4 mt-4">

        {/* Revenue card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-4">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-brand-600">{Math.round(data.todayRevenue)} zł</p>
              <p className="text-xs text-ios-tertiary">{t.owner.revenue}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-ios-label">{data.orderCount}</p>
              <p className="text-xs text-ios-tertiary">{t.owner.orders}</p>
            </div>
          </div>
          <div className="flex justify-center gap-6 mt-3 text-xs">
            <span className="text-green-600">{t.owner.paidLabel}: {Math.round(data.todayRevenue)} zł</span>
            <span className="text-red-500">{t.owner.unpaidLabel}: {Math.round(unpaidToday.total)} zł</span>
          </div>
        </div>

        {/* Status breakdown */}
        <Section title={t.owner.statusBreakdown}>
          <div className="flex flex-wrap gap-2">
            {Object.entries(sc).map(([status, count]) => (
              <span key={status} className="text-xs bg-gray-100 rounded-full px-3 py-1 text-ios-label">
                {status}: <b>{count}</b>
              </span>
            ))}
          </div>
        </Section>

        {/* Pending deliveries */}
        <Section title={t.owner.pendingDeliveries}>
          {deliveries.length === 0 ? (
            <p className="text-xs text-ios-tertiary">{t.owner.noDeliveries}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {deliveries.map((d, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-ios-label">
                    {d['Delivery Time'] || '—'} {d['Customer Name'] || d['Recipient Name'] || '—'}
                  </span>
                  <span className="text-ios-tertiary truncate ml-2 max-w-[50%] text-right">
                    {d['Delivery Address'] || ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Unpaid orders */}
        <Section title={t.owner.unpaidOrders}>
          {unpaidOrders.length === 0 ? (
            <p className="text-xs text-ios-tertiary">{t.owner.noUnpaid}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {unpaidOrders.map((o, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-ios-label">
                    #{o['App Order ID'] || '?'} — {o['Effective Price'] || o['Sell Total'] || 0} zł
                  </span>
                  <span className="text-ios-tertiary">{o['Order Source'] || o.Source || ''}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Stock alerts */}
        <Section title={t.owner.stockAlerts}>
          {alerts.length === 0 ? (
            <p className="text-xs text-ios-tertiary">{t.owner.noAlerts}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {alerts
                .sort((a, b) => (a['Current Quantity'] || 0) - (b['Current Quantity'] || 0))
                .map((item, i) => {
                  const qty = item['Current Quantity'] || 0;
                  const isOut = qty === 0;
                  return (
                    <p key={i} className={`text-xs ${isOut ? 'text-red-600' : 'text-orange-600'}`}>
                      {isOut ? '🔴' : '🟠'} {item['Display Name']} — {isOut ? t.owner.outOfStock : `${qty} ${t.owner.left}`}
                    </p>
                  );
                })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
