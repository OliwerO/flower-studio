import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { LangToggle } from '../context/LanguageContext.jsx';
import client from '../api/client.js';
import OrderCard from '../components/OrderCard.jsx';
import DatePicker from '../components/DatePicker.jsx';
import TextImportModal from '../components/TextImportModal.jsx';
import t from '../translations.js';
import fmtDate from '../utils/formatDate.js';

// Key for dismissing stock alerts per session
const ALERTS_DISMISSED_KEY = 'blossom-alerts-dismissed';

// View modes: 'active' (default) shows non-terminal orders, 'completed' shows past orders
const VIEW_MODES = { ACTIVE: 'active', COMPLETED: 'completed' };

// Status filters for active view (non-terminal statuses)
const ACTIVE_STATUSES = ['', 'New', 'Ready', 'Out for Delivery'];

// Status filters for completed view
const COMPLETED_STATUSES = ['', 'Delivered', 'Picked Up', 'Cancelled'];

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

// Sort by Required By / Delivery Date ascending (earliest needed first),
// then by status priority within same date
function sortByEarliestNeeded(orders) {
  return [...orders].sort((a, b) => {
    const dateA = a['Delivery Date'] || a['Required By'] || '9999-12-31';
    const dateB = b['Delivery Date'] || b['Required By'] || '9999-12-31';
    if (dateA !== dateB) return dateA.localeCompare(dateB);
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
  const { role } = useAuth();
  const isOwner = role === 'owner';
  const [orders, setOrders]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [viewMode, setViewMode]     = useState(VIEW_MODES.ACTIVE);
  const [date, setDate]             = useState(''); // only used in completed view
  const [status, setStatus]         = useState('');
  const [fabOpen, setFabOpen]       = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Stock shortfall data: { stockId: { committed, name, currentQty, effective, orders } }
  const [stockShortfalls, setStockShortfalls] = useState({});

  // Stock evaluation pending count (florist) / shopping POs count (owner)
  const [evalCount, setEvalCount] = useState(0);
  const [shoppingCount, setShoppingCount] = useState(0);

  // Owner-only: dashboard summary data
  const [dashData, setDashData]       = useState(null);
  const [alertsDismissed, setAlertsDismissed] = useState(
    () => sessionStorage.getItem(ALERTS_DISMISSED_KEY) === 'true'
  );
  // Config lists now handled inside OrderCard via useConfigLists hook
  const [flowerNeeds, setFlowerNeeds] = useState(null);
  const [showFlowerNeeds, setShowFlowerNeeds] = useState(false);

  // Track whether we've done the initial load (show spinner only on first load)
  const initialLoaded = useRef(false);

  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = {};
      if (status) params.status = status;

      if (viewMode === VIEW_MODES.ACTIVE) {
        // Active view: all non-terminal orders, sorted by earliest needed
        params.activeOnly = true;
      } else {
        // Completed view: use date filter to browse past orders
        if (date) params.forDate = date;
        // If no specific status selected in completed view, exclude active statuses
        if (!status) params.excludeCancelled = false; // show all including cancelled
      }
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
  }, [viewMode, date, status]);

  useEffect(() => {
    initialLoaded.current = false;
    fetchOrders();
    // Silent poll every 30s — merges data without resetting expanded cards
    const interval = setInterval(() => { if (!document.hidden) fetchOrders(true); }, 30000);
    function onVisible() { if (!document.hidden) fetchOrders(true); }
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [fetchOrders]);


  // Owner: fetch dashboard data for today's summary + stock alerts
  useEffect(() => {
    if (!isOwner) return;
    client.get('/dashboard', { params: { date: todayISO() } })
      .then(r => setDashData(r.data))
      .catch(() => {}); // non-critical — silently ignore
  }, [isOwner]);

  // Fetch committed stock data for shortfall warnings
  useEffect(() => {
    async function fetchShortfalls() {
      try {
        const [stockRes, committedRes] = await Promise.all([
          client.get('/stock'),
          client.get('/stock/committed'),
        ]);
        const stockMap = {};
        for (const s of stockRes.data) stockMap[s.id] = s;

        const shortfalls = {};
        for (const [stockId, data] of Object.entries(committedRes.data)) {
          const item = stockMap[stockId];
          if (!item) continue;
          const currentQty = Number(item['Current Quantity'] || 0);
          const effective = currentQty - data.committed;
          shortfalls[stockId] = {
            committed: data.committed,
            name: item['Display Name'] || '?',
            currentQty,
            effective,
            orders: data.orders,
          };
        }
        setStockShortfalls(shortfalls);
      } catch {
        // non-critical
      }
    }
    fetchShortfalls();
  }, [orders]); // re-fetch when orders change

  // #36: Compute flowers needed from loaded orders (grouped by today/tomorrow/later)
  useEffect(() => {
    if (orders.length === 0) { setFlowerNeeds(null); return; }
    const today = todayISO();
    const tmrw = new Date();
    tmrw.setDate(tmrw.getDate() + 1);
    const tomorrowISO = tmrw.toISOString().split('T')[0];

    function aggregateFlowers(filtered) {
      const map = {};
      for (const o of filtered) {
        if (o.Status === 'Cancelled') continue;
        const summary = o['Bouquet Summary'] || '';
        const parts = summary.split(',').map(s => s.trim()).filter(Boolean);
        for (const part of parts) {
          const match = part.match(/^(\d+)\s*[×x]\s*(.+)$/i);
          if (match) {
            const qty = Number(match[1]);
            const name = match[2].trim();
            map[name] = (map[name] || 0) + qty;
          }
        }
      }
      return Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .map(([name, qty]) => `${qty}× ${name}`);
    }

    const todayOrders = orders.filter(o => {
      const d = o['Delivery Date'] || o['Required By'];
      return d === today;
    });
    const tmrwOrders = orders.filter(o => {
      const d = o['Delivery Date'] || o['Required By'];
      return d === tomorrowISO;
    });

    const todayFlowers = aggregateFlowers(todayOrders);
    const tmrwFlowers = aggregateFlowers(tmrwOrders);
    if (todayFlowers.length > 0 || tmrwFlowers.length > 0) {
      setFlowerNeeds({ today: todayFlowers, tomorrow: tmrwFlowers });
    } else {
      setFlowerNeeds(null);
    }
  }, [orders]);

  // Check for pending stock evaluations (florist) or active shopping POs (owner)
  useEffect(() => {
    if (isOwner) {
      // Owner sees shopping support banner
      Promise.all([
        client.get('/stock-orders?status=Sent'),
        client.get('/stock-orders?status=Shopping'),
      ]).then(([s, sh]) => setShoppingCount(s.data.length + sh.data.length))
        .catch(() => {});
    } else {
      // Florist sees evaluation banner
      client.get('/stock-orders?status=Evaluating')
        .then(r => setEvalCount(r.data.length))
        .catch(() => {});
    }
  }, [isOwner]);

  function dismissAlerts() {
    setAlertsDismissed(true);
    sessionStorage.setItem(ALERTS_DISMISSED_KEY, 'true');
  }

  return (
    <div className="min-h-screen dark:bg-dark-bg dark:text-dark-label">

      {/* Navigation bar */}
      <header className="glass-nav px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <img src="/logo.png" alt="Blossom" className="h-7" />
          <div className="flex items-center gap-2">
            <LangToggle />
          </div>
        </div>
      </header>

      {/* Stock evaluation banner — florist only */}
      {!isOwner && evalCount > 0 && (
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

      {/* Shopping support banner — owner only */}
      {isOwner && shoppingCount > 0 && (
        <div className="px-4 pt-3 max-w-2xl mx-auto">
          <button
            onClick={() => navigate('/shopping-support')}
            className="w-full flex items-center justify-between bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 active-scale"
          >
            <span className="text-sm font-semibold text-amber-700">
              🛒 {t.shopping.banner} ({shoppingCount})
            </span>
            <span className="text-amber-600 text-sm font-medium">→</span>
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

      {/* #36 — Flowers needed today/tomorrow */}
      {flowerNeeds && (flowerNeeds.today.length > 0 || flowerNeeds.tomorrow.length > 0) && (
        <div className="px-4 pt-2 max-w-2xl mx-auto">
          <button
            onClick={() => setShowFlowerNeeds(v => !v)}
            className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-2.5 text-left active-scale"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">{t.flowersNeeded}</span>
              <span className="text-xs text-ios-tertiary">{showFlowerNeeds ? '▲' : '▼'}</span>
            </div>
            {!showFlowerNeeds && (
              <p className="text-xs text-ios-secondary mt-1 line-clamp-1">
                {flowerNeeds.today.length > 0 && `${t.flowersToday}: ${flowerNeeds.today.join(', ')}`}
              </p>
            )}
            {showFlowerNeeds && (
              <div className="mt-2 space-y-2">
                {flowerNeeds.today.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-brand-600 mb-0.5">{t.flowersToday}</p>
                    <p className="text-sm text-ios-label">{flowerNeeds.today.join(', ')}</p>
                  </div>
                )}
                {flowerNeeds.tomorrow.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-purple-600 mb-0.5">{t.flowersTomorrow}</p>
                    <p className="text-sm text-ios-label">{flowerNeeds.tomorrow.join(', ')}</p>
                  </div>
                )}
              </div>
            )}
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="px-4 py-3 max-w-2xl mx-auto flex flex-col gap-2">
        {/* View mode toggle: Active / Completed */}
        <div className="flex gap-2 items-center">
          <div className="flex gap-1.5 bg-white rounded-full border border-ios-separator shadow-sm p-1">
            <button
              onClick={() => { setViewMode(VIEW_MODES.ACTIVE); setStatus(''); }}
              className={`px-4 h-7 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                viewMode === VIEW_MODES.ACTIVE
                  ? 'bg-brand-600 text-white'
                  : 'text-ios-secondary active:bg-ios-fill'
              }`}
            >
              {t.activeOrders}
            </button>
            <button
              onClick={() => { setViewMode(VIEW_MODES.COMPLETED); setStatus(''); setDate(todayISO()); }}
              className={`px-4 h-7 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                viewMode === VIEW_MODES.COMPLETED
                  ? 'bg-brand-600 text-white'
                  : 'text-ios-secondary active:bg-ios-fill'
              }`}
            >
              {t.completedOrders}
            </button>
          </div>
          <button onClick={fetchOrders} className="h-9 w-9 rounded-full bg-white border border-ios-separator shadow-sm flex items-center justify-center text-ios-tertiary active:bg-ios-fill">
            ↻
          </button>
        </div>

        {/* Status sub-filters + date picker for completed view */}
        <div className="flex gap-2 items-center flex-wrap">
          {viewMode === VIEW_MODES.COMPLETED && (
            <div className="bg-white rounded-full border border-ios-separator shadow-sm px-3 h-9 flex items-center">
              <DatePicker
                value={date}
                onChange={setDate}
                placeholder="Date"
              />
            </div>
          )}
          <div className="flex gap-1.5 bg-white rounded-full border border-ios-separator shadow-sm p-1 overflow-x-auto">
            {(viewMode === VIEW_MODES.ACTIVE ? ACTIVE_STATUSES : COMPLETED_STATUSES).map(s => (
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
        </div>
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

      {/* Stock shortfall warning banner */}
      {(() => {
        const shortfallItems = Object.values(stockShortfalls).filter(s => s.effective < 0);
        if (shortfallItems.length === 0) return null;
        return (
          <div className="px-4 pt-2 max-w-2xl mx-auto">
            <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-red-800 uppercase tracking-wide">{t.stockShortfall}</span>
              </div>
              <div className="flex flex-col gap-1">
                {shortfallItems
                  .sort((a, b) => a.effective - b.effective)
                  .map((item, i) => (
                    <button
                      key={i}
                      onClick={() => navigate('/stock')}
                      className="text-left text-xs py-0.5 active-scale"
                    >
                      <span className="text-red-600">
                        {item.name}: {item.currentQty} {t.stems} ({t.committed}: {item.committed}, {t.effectiveStock}: {item.effective})
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        );
      })()}

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
            {(viewMode === VIEW_MODES.ACTIVE ? sortByEarliestNeeded(orders) : sortByStatus(orders)).map(order => (
              <OrderCard
                key={order.id}
                order={order}
                isOwner={isOwner}
                stockShortfalls={stockShortfalls}
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
      <div className="fixed bottom-20 right-5 z-50 flex flex-col items-end gap-3">
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

    </div>
  );
}
