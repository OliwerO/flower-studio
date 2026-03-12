import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { LangToggle } from '../context/LanguageContext.jsx';
import client from '../api/client.js';
import OrderCard from '../components/OrderCard.jsx';
import DatePicker from '../components/DatePicker.jsx';
import TextImportModal from '../components/TextImportModal.jsx';
import HelpPanel from '../components/HelpPanel.jsx';
import t from '../translations.js';

// Key for dismissing stock alerts per session
const ALERTS_DISMISSED_KEY = 'blossom-alerts-dismissed';

const STATUSES = ['', 'New', 'Ready', 'Delivered', 'Picked Up', 'Cancelled'];

// Map Airtable status values → translated display labels
function statusLabel(s) {
  const map = {
    'New':              () => t.statusNew,
    'In Progress':      () => t.statusInProgress,
    'Ready':            () => t.statusReady,
    'Out for Delivery': () => t.statusOutForDelivery,
    'Delivered':        () => t.statusDelivered,
    'Picked Up':        () => t.statusPickedUp,
    'Cancelled':        () => t.statusCancelled,
  };
  return map[s]?.() || s;
}

// Priority order: actionable statuses first, completed/cancelled last
const STATUS_PRIORITY = {
  'New': 0,
  'Accepted': 1,
  'In Preparation': 2,
  'Ready': 3,
  'Out for Delivery': 4,
  'Delivered': 5,
  'Picked Up': 6,
  'Cancelled': 7,
};

function sortByStatus(orders) {
  return [...orders].sort((a, b) => {
    const pa = STATUS_PRIORITY[a['Status']] ?? 99;
    const pb = STATUS_PRIORITY[b['Status']] ?? 99;
    return pa - pb;
  });
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

export default function OrderListPage() {
  const navigate         = useNavigate();
  const { logout, role } = useAuth();
  const isOwner = role === 'owner';
  const [orders, setOrders]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [date, setDate]             = useState(todayISO());
  const [status, setStatus]         = useState('');
  const [fabOpen, setFabOpen]       = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showHelp, setShowHelp]     = useState(false);

  // Stock evaluation pending count
  const [evalCount, setEvalCount] = useState(0);

  // Owner-only: dashboard summary data
  const [dashData, setDashData]       = useState(null);
  const [alertsDismissed, setAlertsDismissed] = useState(
    () => sessionStorage.getItem(ALERTS_DISMISSED_KEY) === 'true'
  );
  // Config lists shared with OrderCard (payment methods, time slots)
  const [payMethods, setPayMethods] = useState(null);
  const [timeSlots, setTimeSlots]   = useState(null);

  // Track whether we've done the initial load (show spinner only on first load)
  const initialLoaded = useRef(false);

  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = {};
      if (status) params.status = status;
      if (date)   { params.dateFrom = date; params.dateTo = date; }
      const res = await client.get('/orders', { params });
      // Merge: update existing orders in place, add new ones, remove deleted.
      // This preserves React state (expanded cards, scroll position).
      setOrders(prev => {
        if (!initialLoaded.current) return res.data;
        const newMap = new Map(res.data.map(o => [o.id, o]));
        const merged = prev.map(o => newMap.get(o.id) || o).filter(o => newMap.has(o.id));
        // Add any truly new orders not in previous list
        for (const o of res.data) {
          if (!merged.find(m => m.id === o.id)) merged.push(o);
        }
        return merged;
      });
      initialLoaded.current = true;
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [date, status]);

  useEffect(() => {
    initialLoaded.current = false;
    fetchOrders();
    // Silent poll every 30s — merges data without resetting expanded cards
    const interval = setInterval(() => { if (!document.hidden) fetchOrders(true); }, 30000);
    function onVisible() { if (!document.hidden) fetchOrders(true); }
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [fetchOrders]);

  // Load config once (payment methods, delivery time slots)
  useEffect(() => {
    client.get('/settings/lists')
      .then(r => { if (r.data.paymentMethods?.length) setPayMethods(r.data.paymentMethods); })
      .catch(() => {});
    client.get('/settings')
      .then(r => { if (r.data.config?.deliveryTimeSlots?.length) setTimeSlots(r.data.config.deliveryTimeSlots); })
      .catch(() => {});
  }, []);

  // Owner: fetch dashboard data for today's summary + stock alerts
  useEffect(() => {
    if (!isOwner) return;
    client.get('/dashboard', { params: { date: date || todayISO() } })
      .then(r => setDashData(r.data))
      .catch(() => {}); // non-critical — silently ignore
  }, [isOwner, date]);

  // Check for pending stock evaluations
  useEffect(() => {
    client.get('/stock-orders?status=Evaluating')
      .then(r => setEvalCount(r.data.length))
      .catch(() => {});
  }, []);

  function dismissAlerts() {
    setAlertsDismissed(true);
    sessionStorage.setItem(ALERTS_DISMISSED_KEY, 'true');
  }

  return (
    <div className="min-h-screen">

      {/* Navigation bar */}
      <header className="glass-nav px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <img src="/logo.png" alt="Blossom" className="h-7" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHelp(true)}
              className="text-xs font-bold w-7 h-7 rounded-lg bg-gray-100 text-ios-secondary
                         hover:bg-gray-200 active-scale flex items-center justify-center"
            >?</button>
            <LangToggle />
            {isOwner && (
              <button
                onClick={() => navigate('/day-summary')}
                className="text-brand-600 text-sm font-medium w-8 h-8 rounded-full bg-brand-50 active:bg-brand-100 flex items-center justify-center"
                title={t.owner.daySummary}
              >📊</button>
            )}
            <button
              onClick={() => navigate('/stock')}
              className="text-brand-600 text-sm font-medium px-3 py-1.5 rounded-full bg-brand-50 active:bg-brand-100"
            >
              {t.navStock}
            </button>
            <button
              onClick={logout}
              className="text-ios-tertiary text-sm px-2 py-1.5"
            >
              {t.logout}
            </button>
          </div>
        </div>
      </header>

      {/* Stock evaluation banner */}
      {evalCount > 0 && (
        <div className="px-4 pt-3 max-w-2xl mx-auto">
          <button
            onClick={() => navigate('/stock-evaluation')}
            className="w-full flex items-center justify-between bg-purple-50 border border-purple-200 rounded-2xl px-4 py-3 active-scale"
          >
            <span className="text-sm font-semibold text-purple-700">
              {t.stockEvalBanner} ({evalCount})
            </span>
            <span className="text-purple-600 text-sm font-medium">→</span>
          </button>
        </div>
      )}

      {/* Owner: Revenue summary card */}
      {isOwner && dashData && (
        <div className="px-4 pt-3 max-w-2xl mx-auto">
          <div className="bg-white rounded-2xl shadow-sm px-4 py-3 border border-gray-100">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">{t.owner.today}</span>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-ios-secondary">{dashData.orderCount} {t.owner.orders}</span>
                <span className="font-bold text-brand-600">{Math.round(dashData.todayRevenue)} zł</span>
              </div>
            </div>
            <div className="flex gap-4 text-xs">
              <span className="text-green-600">{t.owner.paidLabel}: {Math.round(dashData.todayRevenue)} zł</span>
              <span className="text-red-500">{t.owner.unpaidLabel}: {Math.round(dashData.unpaidAging?.today?.total || 0)} zł</span>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="px-4 py-3 max-w-2xl mx-auto flex gap-2 items-center flex-wrap">
        <div className="bg-white rounded-full border border-ios-separator shadow-sm px-3 h-9 flex items-center">
          <DatePicker
            value={date}
            onChange={setDate}
            placeholder="Date"
          />
        </div>
        <div className="flex gap-1.5 bg-white rounded-full border border-ios-separator shadow-sm p-1 overflow-x-auto">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 h-7 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                status === s
                  ? 'bg-brand-600 text-white'
                  : 'text-ios-secondary active:bg-ios-fill'
              }`}
            >
              {s ? statusLabel(s) : t.allStatuses}
            </button>
          ))}
        </div>
        <button onClick={fetchOrders} className="h-9 w-9 rounded-full bg-white border border-ios-separator shadow-sm flex items-center justify-center text-ios-tertiary active:bg-ios-fill">
          ↻
        </button>
      </div>

      {/* Owner: Stock alerts banner */}
      {isOwner && dashData?.lowStockAlerts?.length > 0 && !alertsDismissed && (
        <div className="px-4 max-w-2xl mx-auto">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-amber-800 uppercase tracking-wide">{t.owner.stockAlerts}</span>
              <button onClick={dismissAlerts} className="text-xs text-amber-600 active-scale">{t.owner.dismissAlerts}</button>
            </div>
            <div className="flex flex-col gap-1">
              {dashData.lowStockAlerts
                .sort((a, b) => (a['Current Quantity'] || 0) - (b['Current Quantity'] || 0))
                .map((item, i) => {
                  const qty = item['Current Quantity'] || 0;
                  const isOut = qty === 0;
                  return (
                    <button
                      key={i}
                      onClick={() => navigate('/stock')}
                      className="text-left text-xs py-0.5 active-scale"
                    >
                      <span className={isOut ? 'text-red-600' : 'text-orange-600'}>
                        {isOut ? '🔴' : '🟠'} {item['Display Name']} — {isOut ? t.owner.outOfStock : `${qty} ${t.owner.left} (${t.owner.threshold}: ${item['Reorder Threshold']})`}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* List */}
      <main className="px-4 pb-28 max-w-2xl mx-auto">
        {loading ? (
          <div className="flex items-center justify-center mt-20">
            <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center mt-20">
            <p className="text-4xl mb-3">🌸</p>
            <p className="text-ios-tertiary">{t.noOrders}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 mt-1">
            {sortByStatus(orders).map(order => (
              <OrderCard
                key={order.id}
                order={order}
                isOwner={isOwner}
                payMethods={payMethods}
                timeSlots={timeSlots}
                onOrderUpdated={(id, patch) => {
                  setOrders(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));
                }}
              />
            ))}
          </div>
        )}
      </main>

      {/* Speed-dial FAB — tap "+" to expand, shows two options */}
      {fabOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setFabOpen(false)} />
      )}
      <div className="fixed bottom-8 right-5 z-50 flex flex-col items-end gap-3">
        {fabOpen && (
          <>
            {/* Paste import option */}
            <button
              onClick={() => { setFabOpen(false); setShowImport(true); }}
              className="flex items-center gap-2 bg-white shadow-lg rounded-full pl-4 pr-3 py-2.5 active-scale"
            >
              <span className="text-sm font-semibold text-ios-label">{t.intake.fabLabel}</span>
              <span className="w-10 h-10 rounded-full bg-amber-500 text-white text-lg flex items-center justify-center">📋</span>
            </button>
            {/* Manual new order option */}
            <button
              onClick={() => { setFabOpen(false); navigate('/orders/new'); }}
              className="flex items-center gap-2 bg-white shadow-lg rounded-full pl-4 pr-3 py-2.5 active-scale"
            >
              <span className="text-sm font-semibold text-ios-label">{t.intake.fabManual}</span>
              <span className="w-10 h-10 rounded-full bg-brand-600 text-white text-lg flex items-center justify-center">✏️</span>
            </button>
          </>
        )}
        {/* Main FAB */}
        <button
          onClick={() => setFabOpen(v => !v)}
          className={`w-14 h-14 bg-brand-600 text-white text-3xl rounded-full shadow-lg
                     flex items-center justify-center active:bg-brand-700 active-scale
                     transition-transform duration-200 ${fabOpen ? 'rotate-45' : ''}`}
          aria-label={t.newOrder}
        >
          +
        </button>
      </div>

      {/* Text import modal */}
      {showImport && (
        <TextImportModal
          onClose={() => setShowImport(false)}
          onParsed={(draft) => {
            navigate('/orders/new', { state: { importDraft: draft } });
          }}
        />
      )}

      {/* Help panel */}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
    </div>
  );
}
