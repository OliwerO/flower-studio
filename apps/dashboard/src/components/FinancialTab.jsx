// FinancialTab — strategic business intelligence dashboard.
// Think of it as a factory performance report: focuses on actionable metrics
// that drive decisions — profitability, pricing efficiency, and growth signals.

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';

// ── Date range presets ──
function getPresetRange(preset) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${y}-${pad(m + 1)}-${pad(now.getDate())}`;

  switch (preset) {
    case 'thisMonth':
      return { from: `${y}-${pad(m + 1)}-01`, to: today };
    case 'lastMonth': {
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      const lastDay = new Date(py, pm + 1, 0).getDate();
      return { from: `${py}-${pad(pm + 1)}-01`, to: `${py}-${pad(pm + 1)}-${pad(lastDay)}` };
    }
    case 'last3Months': {
      const d = new Date(y, m - 2, 1);
      return { from: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, to: today };
    }
    case 'last12Months': {
      const d = new Date(y - 1, m + 1, 1);
      return { from: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, to: today };
    }
    default:
      return { from: `${y}-${pad(m + 1)}-01`, to: today };
  }
}

const PRESETS = [
  { key: 'thisMonth',   label: t.thisMonth },
  { key: 'lastMonth',   label: t.lastMonth },
  { key: 'last3Months', label: t.last3Months },
  { key: 'last12Months',label: t.last12Months },
  { key: 'custom',      label: t.customRange },
];

const PIE_COLORS = ['#db2777', '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF3B30', '#8E8E93'];
const SEGMENT_COLORS = {
  Constant: '#34C759', New: '#007AFF', Rare: '#FF9500',
  'DO NOT CONTACT': '#FF3B30', Unassigned: '#8E8E93',
};

export default function FinancialTab({ onNavigate }) {
  const [preset, setPreset]       = useState('thisMonth');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]   = useState('');
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [collapsed, setCollapsed] = useState({});
  const { showToast } = useToast();

  const toggle = (key) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  const range = useMemo(() => {
    if (preset === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo };
    return getPresetRange(preset);
  }, [preset, customFrom, customTo]);

  // Navigate to another tab with filters + current date range.
  // Financial always excludes cancelled orders, so pass that through.
  const nav = useCallback((tab, filter = {}) => {
    onNavigate?.({ tab, filter: { ...filter, dateFrom: range.from, dateTo: range.to, excludeCancelled: true } });
  }, [onNavigate, range]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('/analytics', { params: range });
      setData(res.data);
    } catch {
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [range, showToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  const { revenue, costs, waste, delivery, monthly, customers, orders } = data;

  // ── Derived metrics for strategic insights ──
  // Markup compares flower sell revenue to flower cost (not total revenue which includes delivery + PO premium)
  const markupAchieved = costs.totalFlowerCost > 0
    ? (revenue.flowers / costs.totalFlowerCost).toFixed(1)
    : '—';
  const targetMarkup = 2.2;
  const markupOnTrack = costs.totalFlowerCost > 0 && (revenue.flowers / costs.totalFlowerCost) >= targetMarkup;

  // Revenue by source for chart
  const revenueSourceData = Object.entries(orders?.revenueBySource || {})
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // Segment data
  const segmentData = Object.entries(customers?.segments || {}).map(([name, value]) => ({ name, value }));

  // Unpaid ratio
  const unpaidCount = revenue.orderCount - revenue.paidOrderCount;
  const unpaidPercent = revenue.orderCount > 0
    ? Math.round((unpaidCount / revenue.orderCount) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* ── Date range selector ── */}
      <div className="bg-white rounded-2xl shadow-sm px-4 py-3 flex flex-wrap items-center gap-2">
        {PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              preset === p.key
                ? 'bg-brand-600 text-white'
                : 'text-ios-secondary hover:bg-gray-100'
            }`}
          >
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1" />
            <span className="text-ios-tertiary">→</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1" />
          </div>
        )}
      </div>

      {/* ── 1. Profitability Overview (the #1 strategic question: are we making money?) ── */}
      <Section title="Profitability" sectionKey="profit" collapsed={collapsed} onToggle={toggle}>
        {/* Revenue Gap — the owner's #1 pricing question */}
        {costs.totalFlowerCost > 0 && (
          <div className={`rounded-xl px-4 py-3 mb-4 flex items-center justify-between ${
            costs.revenueGap >= 0 ? 'bg-emerald-50 border border-emerald-200'
            : Math.abs(costs.revenueGap) / costs.estimatedRevenueAt2_2x < 0.1 ? 'bg-amber-50 border border-amber-200'
            : 'bg-rose-50 border border-rose-200'
          }`}>
            <div>
              <p className="text-xs font-medium text-ios-tertiary">{t.revenueGapCard}</p>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-sm text-ios-secondary">{t.actualRevenue}: <b>{revenue.total.toFixed(0)} {t.zl}</b></span>
                <span className="text-sm text-ios-secondary">{t.expectedRevenue}: <b>{costs.estimatedRevenueAt2_2x.toFixed(0)} {t.zl}</b></span>
              </div>
            </div>
            <div className="text-right">
              <p className={`text-2xl font-bold ${
                costs.revenueGap >= 0 ? 'text-emerald-600'
                : Math.abs(costs.revenueGap) / costs.estimatedRevenueAt2_2x < 0.1 ? 'text-amber-600'
                : 'text-rose-600'
              }`}>
                {costs.revenueGap >= 0 ? '+' : ''}{costs.revenueGap.toFixed(0)} {t.zl}
              </p>
              <p className="text-[11px] text-ios-tertiary">
                {costs.revenueGap >= 0 ? t.aboveTarget : costs.revenueGap / costs.estimatedRevenueAt2_2x > -0.1 ? t.onTarget : t.belowTarget}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <KPI label={t.totalRevenue} value={`${revenue.total.toFixed(0)} ${t.zl}`}
               onClick={() => nav('orders', { payment: 'Paid' })} />
          <KPI label={t.flowerCost} value={`${costs.totalFlowerCost.toFixed(0)} ${t.zl}`}
               sub={costs.totalFlowerCost > 0 ? `Markup: ${markupAchieved}×` : null}
               color={markupOnTrack ? 'text-emerald-600' : costs.totalFlowerCost > 0 ? 'text-amber-600' : 'text-ios-label'}
               onClick={() => nav('stock')} />
          <KPI label={t.flowerMargin}
               value={`${costs.flowerMarginPercent.toFixed(1)}%`}
               sub={costs.totalFlowerCost > 0 ? `Target: ≥55%` : 'No cost data'}
               color={costs.flowerMarginPercent >= 55 ? 'text-emerald-600' : costs.flowerMarginPercent >= 40 ? 'text-amber-600' : 'text-rose-600'} />
          <KPI label={t.avgOrderValue} value={`${revenue.avgOrderValue.toFixed(0)} ${t.zl}`} />
        </div>

        {/* Margin trend — only useful with multi-month data */}
        {monthly.length > 1 && (
          <div>
            <p className="text-xs text-ios-tertiary font-medium mb-2">{t.marginTrend}</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
                <Line type="monotone" dataKey="flowerMarginPercent" name={t.flowerMargin} stroke="#059669" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      {/* ── 2. Revenue Breakdown (where does money come from?) ── */}
      <Section title={t.revenueAndOrders} sectionKey="revenue" collapsed={collapsed} onToggle={toggle}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <KPI label={t.orders} value={revenue.orderCount}
               onClick={() => nav('orders')} />
          <KPI label={t.paidOrders} value={revenue.paidOrderCount}
               onClick={() => nav('orders', { payment: 'Paid' })} />
          <KPI label={t.unpaidOrders}
               value={`${unpaidCount}`}
               sub={unpaidPercent > 0 ? `${unpaidPercent}% of orders` : null}
               color={unpaidPercent > 30 ? 'text-rose-600' : unpaidPercent > 15 ? 'text-amber-600' : 'text-ios-label'}
               onClick={() => nav('orders', { payment: 'Unpaid' })} />
          <KPI label={t.flowerRevenue} value={`${revenue.flowers.toFixed(0)} ${t.zl}`} />
        </div>

        {data.orders?.funnel && (
          <div className="grid grid-cols-3 gap-3 mt-3">
            <KPI label={t.created} value={data.orders.funnel.totalCreated} />
            <KPI label={t.completed} value={`${data.orders.funnel.completionRate}%`}
              sub={`${data.orders.funnel.completed} orders`}
              color={data.orders.funnel.completionRate >= 80 ? 'text-emerald-600' : 'text-amber-600'} />
            <KPI label={t.cancelled} value={data.orders.funnel.cancelled}
              sub={`${data.orders.funnel.cancellationRate}%`}
              color={data.orders.funnel.cancellationRate > 5 ? 'text-rose-600' : 'text-emerald-600'} />
          </div>
        )}

        {/* Monthly revenue stacked bar */}
        {monthly.length > 1 && (
          <div className="mb-4">
            <p className="text-xs text-ios-tertiary font-medium mb-2">{t.revenueByMonth}</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => `${v.toFixed(0)} ${t.zl}`} />
                <Legend />
                <Bar dataKey="flowerRevenue" name={t.flowers} fill="#db2777" stackId="rev" />
                <Bar dataKey="deliveryRevenue" name={t.delivery} fill="#007AFF" stackId="rev" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Revenue by source */}
        {revenueSourceData.length > 0 && (
          <div>
            <p className="text-xs text-ios-tertiary font-medium mb-2">{t.revenueBySource}</p>
            <ResponsiveContainer width="100%" height={Math.max(120, revenueSourceData.length * 40)}>
              <BarChart data={revenueSourceData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                <Tooltip formatter={(v) => `${v.toFixed(0)} ${t.zl}`} />
                <Bar dataKey="value" fill="#db2777" radius={[0, 4, 4, 0]} cursor="pointer"
                     onClick={(entry) => nav('orders', { source: entry.name })} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Source efficiency breakdown */}
        {data.orders?.sourceEfficiency?.length > 0 && (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-ios-tertiary border-b border-gray-100">
                  <th className="text-left px-3 py-2 font-medium">{t.source}</th>
                  <th className="text-right px-3 py-2 font-medium">{t.orders}</th>
                  <th className="text-right px-3 py-2 font-medium">{t.revenue}</th>
                  <th className="text-right px-3 py-2 font-medium">{t.avgOrderVal}</th>
                  <th className="text-right px-3 py-2 font-medium">{t.marginPercent}</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.sourceEfficiency.map(s => (
                  <tr key={s.source} className="border-b border-gray-50">
                    <td className="px-3 py-2 font-medium text-ios-label">{s.source}</td>
                    <td className="px-3 py-2 text-right text-ios-secondary">{s.orderCount}</td>
                    <td className="px-3 py-2 text-right text-ios-label">{s.revenue} {t.zl}</td>
                    <td className="px-3 py-2 text-right text-ios-secondary">{s.avgOrderValue} {t.zl}</td>
                    <td className={`px-3 py-2 text-right font-medium ${
                      s.marginPercent >= 55 ? 'text-emerald-600' :
                      s.marginPercent >= 40 ? 'text-amber-600' : 'text-rose-600'
                    }`}>{s.marginPercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Weekly rhythm — which days are busiest? */}
        {data.weeklyRhythm?.length > 0 && (() => {
          const DAY_NAMES = [t.daySun, t.dayMon, t.dayTue, t.dayWed, t.dayThu, t.dayFri, t.daySat];
          const rhythmData = (data.weeklyRhythm || []).map(d => ({
            ...d,
            dayName: DAY_NAMES[d.dayIndex],
          }));
          return (
            <div className="mt-4">
              <p className="text-xs text-ios-tertiary font-medium mb-2">{t.weeklyRhythm}</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={rhythmData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="dayName" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, name) => name === 'orderCount' ? `${v} orders` : `${v.toFixed(0)} ${t.zl}`} />
                  <Bar dataKey="orderCount" name={t.orders} fill="#db2777" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        })()}
      </Section>

      {/* ── 3. Delivery & Logistics ── */}
      <Section title={t.deliveryProfit} sectionKey="delivery" collapsed={collapsed} onToggle={toggle}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <KPI label={t.deliveryCount} value={delivery.deliveryCount}
               onClick={() => nav('orders', { deliveryType: 'Delivery' })} />
          <KPI label={t.pickupCount} value={delivery.pickupCount}
               onClick={() => nav('orders', { deliveryType: 'Pickup' })} />
          <KPI label={t.deliveryRevTotal} value={`${(delivery.deliveryRevenue || 0).toFixed(0)} ${t.zl}`} />
          <KPI label={t.avgDeliveryFee} value={`${(delivery.avgDeliveryFee || 0).toFixed(0)} ${t.zl}`} />
        </div>

        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs text-ios-tertiary font-medium mb-2">{t.deliveryPnL}</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-ios-secondary">{t.deliveryRevTotal}</p>
              <p className="text-lg font-bold text-ios-label">{(delivery.deliveryRevenue || 0).toFixed(0)} {t.zl}</p>
            </div>
            <div className="text-center px-4">
              <p className="text-sm text-ios-secondary">{t.costPrice}</p>
              <p className="text-lg font-bold text-ios-tertiary">—</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-ios-secondary">{t.deliveryNet}</p>
              <p className="text-lg font-bold text-emerald-600">{(delivery.deliveryRevenue || 0).toFixed(0)} {t.zl}</p>
            </div>
          </div>
          <p className="text-[10px] text-ios-tertiary mt-2 italic">{t.addDriverCosts}</p>
        </div>
      </Section>

      {/* ── Payment collection ── */}
      <Section title={t.paymentAnalysis} sectionKey="payments" collapsed={collapsed} onToggle={toggle}>
        {data.paymentAnalysis?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-ios-tertiary border-b border-gray-100">
                  <th className="text-left px-3 py-2 font-medium">{t.paymentMethod}</th>
                  <th className="text-right px-3 py-2 font-medium">{t.orders}</th>
                  <th className="text-right px-3 py-2 font-medium">{t.revenue}</th>
                  <th className="text-right px-3 py-2 font-medium">{t.unpaidRate}</th>
                  <th className="text-right px-3 py-2 font-medium">{t.outstanding}</th>
                </tr>
              </thead>
              <tbody>
                {data.paymentAnalysis.map(p => (
                  <tr key={p.method}
                    onClick={() => nav('orders', { paymentMethod: p.method })}
                    className={`border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${
                    p.method === 'Not recorded' ? 'bg-amber-50/50 hover:bg-amber-100/50' : ''
                  }`}>
                    <td className="px-3 py-2 font-medium text-ios-label">
                      {p.method === 'Not recorded' ? t.notRecorded : p.method}
                    </td>
                    <td className="px-3 py-2 text-right text-ios-secondary">{p.count}</td>
                    <td className="px-3 py-2 text-right text-ios-label">{Math.round(p.revenue)} {t.zl}</td>
                    <td className={`px-3 py-2 text-right font-medium ${
                      p.unpaidCount > 0 ? 'text-rose-600' : 'text-emerald-600'
                    }`}>{p.count > 0 ? Math.round((p.unpaidCount / p.count) * 100) : 0}%</td>
                    <td className={`px-3 py-2 text-right ${
                      p.unpaidAmount > 0 ? 'text-rose-600 font-medium' : 'text-ios-tertiary'
                    }`}>{p.unpaidAmount > 0 ? `${Math.round(p.unpaidAmount)} ${t.zl}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-ios-tertiary text-sm italic">No payment data</p>}
      </Section>

      {/* ── 4. Waste (only show if there's data worth acting on) ── */}
      {(waste.totalDeadStems > 0 || costs.totalFlowerCost > 0) && (
        <Section title={t.wasteEfficiency} sectionKey="waste" collapsed={collapsed} onToggle={toggle}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
            <KPI label={t.deadStems} value={waste.totalDeadStems}
                 onClick={() => nav('stock')} />
            <KPI label={t.unrealisedRevenue} value={`${waste.unrealisedRevenuePLN.toFixed(0)} ${t.zl}`} color="text-rose-600" />
            <KPI label={t.wastePercent}
                 value={`${waste.wastePercent.toFixed(1)}%`}
                 sub={waste.wastePercent <= 10 ? 'Healthy' : waste.wastePercent <= 20 ? 'Monitor' : 'High'}
                 color={waste.wastePercent <= 10 ? 'text-emerald-600' : waste.wastePercent <= 20 ? 'text-amber-600' : 'text-rose-600'} />
            {data.inventoryTurnover && (
              <KPI
                label={t.inventoryTurnover}
                value={`${data.inventoryTurnover.turnsPerYear}×`}
                sub={t.healthyRange}
                color={data.inventoryTurnover.turnsPerYear >= 6 && data.inventoryTurnover.turnsPerYear <= 12 ? 'text-emerald-600' : 'text-amber-600'}
              />
            )}
          </div>
          <p className="text-[11px] text-ios-tertiary italic">{t.wasteNote}</p>
        </Section>
      )}

      {/* ── 5. Customer Insights ── */}
      <Section title={t.customerMetrics} sectionKey="customers" collapsed={collapsed} onToggle={toggle}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <KPI label={t.newCustomers} value={customers.newCount} color="text-sky-600"
               onClick={() => nav('customers')} />
          <KPI label={t.returningCust} value={customers.returningCount} color="text-emerald-600"
               onClick={() => nav('customers')} />
          <KPI label={t.newVsReturning} value={
            customers.newCount + customers.returningCount > 0
              ? `${Math.round((customers.returningCount / (customers.newCount + customers.returningCount)) * 100)}% returning`
              : '—'
          } />
          <KPI
            label={t.repeatRate}
            value={`${customers.newCount + customers.returningCount > 0
              ? Math.round((customers.returningCount / (customers.newCount + customers.returningCount)) * 100)
              : 0}%`}
            sub={t.repeatRateBench}
            color={customers.returningCount / (customers.newCount + customers.returningCount) >= 0.3 ? 'text-emerald-600'
              : customers.returningCount / (customers.newCount + customers.returningCount) >= 0.15 ? 'text-amber-600' : 'text-rose-600'}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {segmentData.length > 0 && (
            <div>
              <p className="text-xs text-ios-tertiary font-medium mb-2">{t.segmentDistribution}</p>
              {segmentData.length === 1 && segmentData[0].name === 'Unassigned' ? (
                <div className="flex items-center justify-center h-40 text-sm text-ios-tertiary">
                  All {segmentData[0].value} customers unassigned
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={segmentData} cx="50%" cy="50%"
                         innerRadius={40} outerRadius={70} dataKey="value">
                      {segmentData.map((entry, i) => (
                        <Cell key={entry.name} fill={SEGMENT_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {customers.topSpenders?.filter(c => c.name && c.name !== '—' && c.spend > 0).length > 0 && (
            <div>
              <p className="text-xs text-ios-tertiary font-medium mb-2">{t.topSpenders}</p>
              <div className="bg-gray-50 rounded-xl overflow-hidden divide-y divide-gray-100">
                {customers.topSpenders.filter(c => c.name && c.name !== '—' && c.spend > 0).map((c, i) => (
                  <div key={c.id}
                    onClick={() => nav('customers', { search: c.name })}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-100 transition-colors">
                    <span className="text-xs font-bold text-ios-tertiary w-5">#{i + 1}</span>
                    <span className="text-sm text-ios-label flex-1 truncate">{c.name}</span>
                    {c.segment && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: (SEGMENT_COLORS[c.segment] || '#8E8E93') + '20', color: SEGMENT_COLORS[c.segment] || '#8E8E93' }}>
                        {c.segment}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-brand-700">{c.spend.toFixed(0)} {t.zl}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ── Top Products (what sells best?) ── */}
      {orders.topProducts?.length > 0 && (
        <Section title={t.bestSellers} sectionKey="products" collapsed={collapsed} onToggle={toggle}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-ios-tertiary border-b border-gray-100">
                  <th className="text-left px-3 py-2 font-medium">{t.stockName}</th>
                  <th className="text-center px-2 py-2 font-medium w-8"></th>
                  <th className="text-right px-3 py-2 font-medium">{t.quantity}</th>
                  <th className="text-right px-3 py-2 font-medium">{t.revenue}</th>
                  <th className="text-right px-3 py-2 font-medium">{t.costPrice}</th>
                  <th className="text-right px-3 py-2 font-medium">{t.markup}</th>
                  <th className="text-right px-3 py-2 font-medium">{t.productMargin}</th>
                </tr>
              </thead>
              <tbody>
                {orders.topProducts.slice(0, 10).map(p => {
                  const m = p.cost > 0 ? (p.revenue / p.cost).toFixed(1) : '—';
                  const marginPct = p.revenue > 0 ? Math.round(((p.revenue - p.cost) / p.revenue) * 100) : 0;
                  return (
                    <tr key={p.name} className="border-b border-gray-50">
                      <td className="px-3 py-2 font-medium text-ios-label">{p.name}</td>
                      <td className={`px-2 py-2 text-center font-medium ${
                        p.trend === 'up' ? 'text-emerald-500' : p.trend === 'down' ? 'text-rose-500' : 'text-ios-tertiary'
                      }`}>
                        {p.trend === 'up' ? '↑' : p.trend === 'down' ? '↓' : '→'}
                      </td>
                      <td className="px-3 py-2 text-right text-ios-secondary">{p.totalQty}</td>
                      <td className="px-3 py-2 text-right font-medium text-brand-700">{p.revenue.toFixed(0)} {t.zl}</td>
                      <td className="px-3 py-2 text-right text-ios-secondary">{p.cost.toFixed(0)} {t.zl}</td>
                      <td className={`px-3 py-2 text-right font-medium ${
                        m !== '—' && parseFloat(m) >= 2.2 ? 'text-emerald-600' : m !== '—' ? 'text-amber-600' : 'text-ios-tertiary'
                      }`}>{m}×</td>
                      <td className={`px-3 py-2 text-right font-medium ${
                        marginPct >= 55 ? 'text-emerald-600' : marginPct >= 40 ? 'text-amber-600' : 'text-rose-600'
                      }`}>{marginPct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Collapsible section wrapper ──
function Section({ title, sectionKey, collapsed, onToggle, children }) {
  const isCollapsed = collapsed[sectionKey];
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <button onClick={() => onToggle(sectionKey)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
        <h3 className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">{title}</h3>
        <span className="text-ios-tertiary text-sm">{isCollapsed ? '▼' : '▲'}</span>
      </button>
      {!isCollapsed && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ── KPI metric card with optional sub-label ──
function KPI({ label, value, sub, color, onClick }) {
  return (
    <div onClick={onClick}
      className={`bg-gray-50 rounded-xl px-3 py-2.5 text-center transition-all ${
        onClick ? 'cursor-pointer hover:bg-gray-100 hover:shadow-sm active:scale-[0.98]' : ''
      }`}>
      <p className={`text-xl font-bold ${color || 'text-ios-label'}`}>{value}</p>
      <p className="text-[11px] text-ios-tertiary mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-ios-tertiary mt-0.5">{sub}</p>}
    </div>
  );
}
