import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import StockItem from '../components/StockItem.jsx';
import ReceiveStockForm from '../components/ReceiveStockForm.jsx';
import HelpPanel from '../components/HelpPanel.jsx';
import t from '../translations.js';

const SORT_OPTIONS = [
  { key: 'name',     label: () => t.sortByName },
  { key: 'qty',      label: () => t.sortByQty },
  { key: 'sell',     label: () => t.sortBySell },
  { key: 'supplier', label: () => t.sortBySupplier },
  { key: 'received', label: () => t.sortByReceived || 'Date' },
];

const VIEW_OPTIONS = [
  { key: 'all',       label: () => t.viewAll },
  { key: 'shortfall', label: () => t.viewShortfall },
  { key: 'negative',  label: () => t.viewNegative },
  { key: 'low',       label: () => t.viewLow },
  { key: 'slow',      label: () => t.viewSlowMovers },
];

const SORT_FNS = {
  name:     (a, b) => (a['Display Name'] || '').localeCompare(b['Display Name'] || ''),
  qty:      (a, b) => (Number(a['Current Quantity']) || 0) - (Number(b['Current Quantity']) || 0),
  sell:     (a, b) => (Number(a['Current Sell Price']) || 0) - (Number(b['Current Sell Price']) || 0),
  supplier: (a, b) => (a.Supplier || '').localeCompare(b.Supplier || ''),
  received: (a, b) => (a['Last Restocked'] || '').localeCompare(b['Last Restocked'] || ''),
};

export default function StockPanelPage() {
  const navigate          = useNavigate();
  const { showToast }     = useToast();
  const { role }          = useAuth();
  const [stock, setStock] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showReceive, setShowReceive] = useState(false);
  const [editMode, setEditMode]       = useState(false);
  const [showHelp, setShowHelp]       = useState(false);
  const [committedMap, setCommittedMap] = useState({}); // stockId → { committed, orders }

  // Search, sort, view
  const [search, setSearch]   = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [view, setView]       = useState('all');

  async function fetchStock() {
    setLoading(true);
    try {
      const [stockRes, committedRes] = await Promise.all([
        client.get('/stock'),
        client.get('/stock/committed'),
      ]);
      setStock(stockRes.data);
      setCommittedMap(committedRes.data);
    } catch { showToast(t.adjustError, 'error'); }
    finally   { setLoading(false); }
  }

  useEffect(() => { fetchStock(); }, []);

  async function handleAdjust(id, delta) {
    try {
      const res = await client.post(`/stock/${id}/adjust`, { delta });
      setStock(prev => prev.map(s => s.id === id ? { ...s, ...res.data } : s));
    } catch { showToast(t.adjustError, 'error'); }
  }

  async function handleWriteOff(id, quantity, reason) {
    try {
      const res = await client.post(`/stock/${id}/write-off`, { quantity, reason: reason || undefined });
      setStock(prev => prev.map(s => s.id === id ? { ...s, ...res.data } : s));
      showToast(`${quantity} stems written off`, 'success');
    } catch { showToast(t.writeOffError, 'error'); }
  }

  async function handleReceive(data) {
    try {
      await client.post('/stock-purchases', data);
      showToast(t.success, 'success');
      setShowReceive(false);
      fetchStock();
    } catch { showToast(t.receiveError, 'error'); }
  }

  function toggleSort(key) {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  // Filtered + sorted stock
  const filteredStock = useMemo(() => {
    const now = Date.now();
    const SLOW_DAYS = 14;

    let items = stock;

    // View filter
    if (view === 'shortfall') {
      items = items.filter(s => {
        const cd = committedMap[s.id];
        if (!cd) return false;
        const qty = Number(s['Current Quantity'] || 0);
        return qty - cd.committed < 0;
      });
    } else if (view === 'negative') {
      items = items.filter(s => (Number(s['Current Quantity']) || 0) < 0);
    } else if (view === 'low') {
      items = items.filter(s => {
        const qty = Number(s['Current Quantity']) || 0;
        const threshold = Number(s['Reorder Threshold']) || 5;
        return qty > 0 && qty <= threshold;
      });
    } else if (view === 'slow') {
      items = items.filter(s => {
        const qty = Number(s['Current Quantity']) || 0;
        if (qty <= 0) return false;
        const last = s['Last Restocked'];
        if (!last) return true; // never restocked = slow
        const age = now - new Date(last).getTime();
        return age > SLOW_DAYS * 86400000;
      });
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      items = items.filter(s =>
        (s['Display Name'] || '').toLowerCase().includes(q) ||
        (s.Supplier || '').toLowerCase().includes(q) ||
        (s.Farmer || '').toLowerCase().includes(q)
      );
    }

    // Sort — negative items always pinned to top
    const sortFn = SORT_FNS[sortKey] || SORT_FNS.name;
    const sorted = [...items].sort((a, b) => {
      const aNeg = (Number(a['Current Quantity']) || 0) < 0;
      const bNeg = (Number(b['Current Quantity']) || 0) < 0;
      if (aNeg !== bNeg) return aNeg ? -1 : 1;
      const cmp = sortFn(a, b);
      return sortAsc ? cmp : -cmp;
    });

    return sorted;
  }, [stock, search, sortKey, sortAsc, view, committedMap]);

  // Counts for view badges
  const shortfallCount = useMemo(() => stock.filter(s => {
    const cd = committedMap[s.id];
    if (!cd) return false;
    return (Number(s['Current Quantity'] || 0) - cd.committed) < 0;
  }).length, [stock, committedMap]);
  const negativeCount = useMemo(() => stock.filter(s => (Number(s['Current Quantity']) || 0) < 0).length, [stock]);
  const lowCount = useMemo(() => stock.filter(s => {
    const qty = Number(s['Current Quantity']) || 0;
    return qty > 0 && qty <= (Number(s['Reorder Threshold']) || 5);
  }).length, [stock]);

  return (
    <div className="min-h-screen">

      {/* Nav */}
      <header className="glass-nav px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <button onClick={() => navigate('/orders')} className="text-brand-600 font-medium text-base active-scale">
            ‹ {t.navOrders}
          </button>
          <h1 className="text-base font-semibold text-ios-label">{t.stockTitle}</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHelp(true)}
              className="text-xs font-bold w-7 h-7 rounded-lg bg-gray-100 text-ios-secondary
                         hover:bg-gray-200 active-scale flex items-center justify-center"
            >?</button>
            <button onClick={fetchStock} className="text-ios-tertiary text-base active-scale">↻</button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 pb-28">

        {/* Owner: Purchase Orders button */}
        {role === 'owner' && (
          <button
            onClick={() => navigate('/purchase-orders')}
            className="w-full mb-3 h-12 rounded-2xl bg-indigo-600 text-white text-base font-semibold shadow-sm active:bg-indigo-700 active-scale"
          >
            {t.po?.title || 'Purchase Orders'}
          </button>
        )}

        {/* Receive stock */}
        <button
          onClick={() => setShowReceive(!showReceive)}
          className={`w-full mb-4 h-12 rounded-2xl text-base font-semibold transition-colors ${
            showReceive
              ? 'bg-ios-fill2 text-ios-secondary'
              : 'bg-brand-600 text-white shadow-sm active:bg-brand-700'
          }`}
        >
          {showReceive ? `✕ ${t.cancel}` : `+ ${t.receiveStock}`}
        </button>

        {showReceive && (
          <div className="mb-5">
            <ReceiveStockForm stock={stock} onSave={handleReceive} onCancel={() => setShowReceive(false)} />
          </div>
        )}

        {/* Search */}
        <div className="ios-card flex items-center px-4 gap-3 mb-3">
          <span className="text-ios-tertiary text-sm">🔍</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t.searchStock}
            className="flex-1 py-3 text-base bg-transparent outline-none placeholder-ios-tertiary/50"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-ios-tertiary text-sm">✕</button>
          )}
        </div>

        {/* View filter pills */}
        <div className="flex gap-2 mb-3 overflow-x-auto">
          {VIEW_OPTIONS.map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors active-scale ${
                view === v.key
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 text-ios-secondary'
              }`}
            >
              {v.label()}
              {v.key === 'shortfall' && shortfallCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">{shortfallCount}</span>
              )}
              {v.key === 'negative' && negativeCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">{negativeCount}</span>
              )}
              {v.key === 'low' && lowCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">{lowCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* Sort pills */}
        <div className="flex gap-2 mb-4 overflow-x-auto">
          {SORT_OPTIONS.map(s => (
            <button
              key={s.key}
              onClick={() => toggleSort(s.key)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors active-scale ${
                sortKey === s.key
                  ? 'bg-brand-100 text-brand-700'
                  : 'bg-gray-50 text-ios-tertiary'
              }`}
            >
              {s.label()} {sortKey === s.key && (sortAsc ? '↑' : '↓')}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center mt-20">
            <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : filteredStock.length === 0 ? (
          <p className="text-ios-tertiary text-sm text-center py-12">{t.noStockFound || 'No items found'}</p>
        ) : (
          <div className="ios-card overflow-hidden divide-y divide-ios-separator/40">
            {filteredStock.map(item => (
              <StockItem
                key={item.id}
                item={item}
                editMode={editMode}
                onAdjust={delta => handleAdjust(item.id, delta)}
                onWriteOff={(qty, reason) => handleWriteOff(item.id, qty, reason)}
                committedData={committedMap[item.id]}
              />
            ))}
          </div>
        )}

        {/* Summary bar */}
        {!loading && filteredStock.length > 0 && (
          <div className="mt-3 flex items-center justify-between px-2 text-xs text-ios-tertiary">
            <span>{filteredStock.length} {t.stems}</span>
            <span>
              {filteredStock.reduce((s, i) => s + (Number(i['Current Quantity']) || 0), 0)} {t.stems} {t.sortByQty?.toLowerCase()}
            </span>
          </div>
        )}

        {/* Owner-only edit mode toggle */}
        {role === 'owner' && !loading && (
          <button
            onClick={() => setEditMode(!editMode)}
            className={`w-full mt-4 h-11 rounded-2xl text-sm font-semibold transition-colors ${
              editMode
                ? 'bg-brand-600 text-white active:bg-brand-700'
                : 'bg-ios-fill2 text-ios-secondary active:bg-ios-separator'
            }`}
          >
            {editMode ? `✓ ${t.doneEditing}` : `✎ ${t.editStock}`}
          </button>
        )}
      </main>

      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
    </div>
  );
}
