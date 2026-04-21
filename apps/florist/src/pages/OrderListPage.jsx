import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { LangToggle } from '../context/LanguageContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import client from '../api/client.js';
import OrderCard from '../components/OrderCard.jsx';
import PremadeBouquetCard from '../components/PremadeBouquetCard.jsx';
import DatePicker from '../components/DatePicker.jsx';
import TextImportModal from '../components/TextImportModal.jsx';
import { OrderListSkeleton } from '../components/Skeleton.jsx';
import t from '../translations.js';

// View modes:
//   active — non-terminal orders (florist's default view)
//   completed — past/terminal orders
//   premade — premade-bouquet inventory (composition without an order attached)
const VIEW_MODES = { ACTIVE: 'active', COMPLETED: 'completed', PREMADE: 'premade' };

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
  'In Progress': 1,
  'Ready': 2,
  'Out for Delivery': 3,
  'Delivered': 4,
  'Picked Up': 5,
  'Cancelled': 6,
};

function sortByStatus(orders) {
  return [...orders].sort((a, b) => {
    const pa = STATUS_PRIORITY[a['Status']] ?? 99;
    const pb = STATUS_PRIORITY[b['Status']] ?? 99;
    return pa - pb;
  });
}

// Sort by Required By / Delivery Date ascending (earliest needed first),
// then by delivery time slot, then by status priority within same date
function sortByEarliestNeeded(orders) {
  return [...orders].sort((a, b) => {
    const dateA = a['Delivery Date'] || a['Required By'] || '9999-12-31';
    const dateB = b['Delivery Date'] || b['Required By'] || '9999-12-31';
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    // Within same date, sort by time slot start numerically (e.g. "8-10" before "10-12")
    const timeA = parseInt((a['Delivery Time'] || '').split('-')[0], 10);
    const timeB = parseInt((b['Delivery Time'] || '').split('-')[0], 10);
    const tA = isNaN(timeA) ? 999 : timeA;
    const tB = isNaN(timeB) ? 999 : timeB;
    if (tA !== tB) return tA - tB;
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
  const { showToast } = useToast();
  const [orders, setOrders]         = useState([]);
  const [premadeBouquets, setPremadeBouquets] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode]     = useState(VIEW_MODES.ACTIVE);
  const [date, setDate]             = useState(''); // only used in completed view
  const [status, setStatus]         = useState('');
  const [noDateOnly, setNoDateOnly] = useState(false); // surface orphan-date orders
  const [fabOpen, setFabOpen]       = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Stock shortfall data: { stockId: { committed, name, currentQty, effective, orders } }
  const [stockShortfalls, setStockShortfalls] = useState({});

  // Stock evaluation pending count (florist) / shopping POs count (owner)
  const [evalCount, setEvalCount] = useState(0);
  const [shoppingCount, setShoppingCount] = useState(0);

  // Owner-only: dashboard summary data
  const [dashData, setDashData]       = useState(null);
  // Track whether we've done the initial load (show spinner only on first load)
  const initialLoaded = useRef(false);

  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Premade view fetches from a different endpoint — no status/date filters.
      if (viewMode === VIEW_MODES.PREMADE) {
        const res = await client.get('/premade-bouquets');
        setPremadeBouquets(res.data);
        initialLoaded.current = true;
        return;
      }

      const params = {};
      if (status) params.status = status;

      if (viewMode === VIEW_MODES.ACTIVE) {
        // Active view: all non-terminal orders, sorted by earliest needed
        params.activeOnly = true;
      } else {
        // Completed view: terminal orders (last 30 days by default)
        params.completedOnly = true;
        if (date) params.forDate = date;
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
      // Re-throw so the manual refresh handler can surface a toast.
      // Background polls still swallow via their own try/catch.
      throw err;
    } finally {
      setLoading(false);
    }
  }, [viewMode, date, status]);

  // Manual refresh — spin the icon, use silent-merge so the list doesn't
  // flash to the skeleton, and toast the outcome so the owner knows the
  // tap registered even when data is unchanged.
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchOrders(true);
      showToast(t.refreshed || 'Refreshed', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || t.refreshFailed || 'Refresh failed', 'error');
    } finally {
      setRefreshing(false);
    }
  }, [fetchOrders, refreshing, showToast]);

  // Premade count — shown as a badge on the filter chip even when not in premade view.
  const [premadeCount, setPremadeCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function fetchCount() {
      try {
        const res = await client.get('/premade-bouquets');
        if (!cancelled) setPremadeCount(res.data.length);
      } catch {
        // Non-critical — badge just won't appear
      }
    }
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [orders.length, premadeBouquets.length]);

  useEffect(() => {
    initialLoaded.current = false;
    // Background fetches swallow errors — fetchOrders now throws so the
    // manual Refresh handler can toast, but polls stay quiet.
    fetchOrders().catch(() => {});
    // Silent poll every 30s — merges data without resetting expanded cards
    const interval = setInterval(() => { if (!document.hidden) fetchOrders(true).catch(() => {}); }, 30000);
    function onVisible() { if (!document.hidden) fetchOrders(true).catch(() => {}); }
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

  return (
    <div className="min-h-screen dark:bg-dark-bg dark:text-dark-label">

      {/* Navigation bar */}
      <header className="glass-nav px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <img src="/logo.png" alt="Blossom" className="h-7" />
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label={t.refresh}
              className="h-8 w-8 rounded-full bg-white/80 border border-ios-separator flex items-center justify-center text-ios-tertiary active:bg-ios-fill disabled:opacity-60"
            >
              <span className={`inline-block ${refreshing ? 'animate-spin' : ''}`}>↻</span>
            </button>
            <LangToggle />
          </div>
        </div>
      </header>

      {/* Orphan-date warning — orders with no Required By / Delivery Date end up
          sorted unpredictably and are easy to miss. Surface them so they get
          a date assigned promptly. Only shown in Active view (Completed orders
          are by definition done — date doesn't matter for triage). */}
      {viewMode === VIEW_MODES.ACTIVE && (() => {
        const noDateCount = orders.filter(o => !o['Delivery Date'] && !o['Required By']).length;
        // Keep the banner visible while noDateOnly is on, even when the count
        // drops to 0, so the user always has a path to toggle the filter off.
        if (noDateCount === 0 && !noDateOnly) return null;
        return (
          <div className="px-4 pt-3 max-w-2xl mx-auto">
            <button
              onClick={() => setNoDateOnly(v => !v)}
              className={`w-full flex items-center justify-between rounded-2xl px-4 py-3 active-scale border ${
                noDateOnly
                  ? 'bg-amber-100 border-amber-300'
                  : 'bg-amber-50 border-amber-200'
              }`}
            >
              <span className="text-sm font-semibold text-amber-700">
                ⚠️ {t.ordersWithoutDate || 'Orders without a date'} ({noDateCount})
              </span>
              <span className="text-amber-600 text-sm font-medium">
                {noDateOnly ? (t.showAll || 'Show all') : (t.showOnlyTheseOrders || 'Show only')} →
              </span>
            </button>
          </div>
        );
      })()}

      {/* Stock evaluation banner — visible to florist and owner */}
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

      {/* Filters */}
      <div className="px-4 py-3 max-w-2xl mx-auto flex flex-col gap-2">
        {/* View mode toggle: Active / Completed / Premade */}
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
            onClick={() => { setViewMode(VIEW_MODES.COMPLETED); setStatus(''); setDate(''); setNoDateOnly(false); }}
            className={`px-4 h-7 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              viewMode === VIEW_MODES.COMPLETED
                ? 'bg-brand-600 text-white'
                : 'text-ios-secondary active:bg-ios-fill'
            }`}
          >
            {t.completedOrders}
          </button>
          <button
            onClick={() => { setViewMode(VIEW_MODES.PREMADE); setStatus(''); setDate(''); setNoDateOnly(false); }}
            className={`px-4 h-7 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              viewMode === VIEW_MODES.PREMADE
                ? 'bg-brand-600 text-white'
                : 'text-ios-secondary active:bg-ios-fill'
            }`}
          >
            {t.premadeBouquets}
            {premadeCount > 0 && (
              <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                viewMode === VIEW_MODES.PREMADE ? 'bg-white text-brand-600' : 'bg-brand-600 text-white'
              }`}>
                {premadeCount}
              </span>
            )}
          </button>
        </div>

        {/* Status sub-filters + date picker for completed view */}
        <div className="flex gap-2 items-center flex-wrap">
          {viewMode === VIEW_MODES.COMPLETED && (
            <div className="flex items-center gap-1.5">
              <div className="bg-white rounded-full border border-ios-separator shadow-sm px-3 h-9 flex items-center">
                <DatePicker
                  value={date}
                  onChange={setDate}
                  placeholder={t.filterByDate || 'Filter by date'}
                />
              </div>
              {date && (
                <button
                  onClick={() => setDate('')}
                  className="text-xs text-ios-tertiary bg-white rounded-full border border-ios-separator shadow-sm px-2 h-9 flex items-center active-scale"
                >✕</button>
              )}
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
          <OrderListSkeleton count={5} />
        ) : viewMode === VIEW_MODES.PREMADE ? (
          premadeBouquets.length === 0 ? (
            <div className="text-center mt-20">
              <p className="text-4xl mb-3">🌸</p>
              <p className="text-ios-tertiary">{t.premadeBouquetEmpty}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 mt-1">
              {premadeBouquets.map(bouquet => (
                <PremadeBouquetCard
                  key={bouquet.id}
                  bouquet={bouquet}
                  isOwner={isOwner}
                  onRemoved={(id) => setPremadeBouquets(prev => prev.filter(b => b.id !== id))}
                  onUpdated={(updated) => setPremadeBouquets(prev => prev.map(b => b.id === updated.id ? updated : b))}
                  onMatchClicked={(id) => navigate('/orders/new', { state: { matchPremadeId: id } })}
                />
              ))}
            </div>
          )
        ) : orders.length === 0 ? (
          <div className="text-center mt-20">
            <p className="text-4xl mb-3">🌸</p>
            <p className="text-ios-tertiary">{t.noOrders}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 mt-1">
            {(() => {
              const base = noDateOnly
                ? orders.filter(o => !o['Delivery Date'] && !o['Required By'])
                : orders;
              return viewMode === VIEW_MODES.ACTIVE ? sortByEarliestNeeded(base) : sortByStatus(base);
            })().map(order => (
              <OrderCard
                key={order.id}
                order={order}
                isOwner={isOwner}
                stockShortfalls={stockShortfalls}
                onOrderUpdated={(id, patch) => {
                  setOrders(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));
                }}
                onOrderDeleted={(id) => {
                  setOrders(prev => prev.filter(o => o.id !== id));
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
            {/* Premade bouquet option — compose without a customer */}
            <button
              onClick={() => { setFabOpen(false); navigate('/premade-bouquets/new'); }}
              className="flex items-center gap-2 bg-white shadow-lg rounded-full pl-4 pr-3 py-2.5 active-scale"
            >
              <span className="text-sm font-semibold text-ios-label">{t.fabPremade}</span>
              <span className="w-10 h-10 rounded-full bg-pink-500 text-white text-lg flex items-center justify-center">💐</span>
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
