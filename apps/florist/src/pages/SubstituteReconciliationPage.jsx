// SubstituteReconciliationPage — reconcile orders after PO substitution.
// When a flower was substituted during PO evaluation, orders that need the
// original flower are listed here for one-tap swap to the substitute.

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext.jsx';
import client from '../api/client.js';
import t from '../translations.js';

export default function SubstituteReconciliationPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [stock, setStock] = useState([]);
  const [committed, setCommitted] = useState({});
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [swapping, setSwapping] = useState(null);

  useEffect(() => {
    Promise.all([
      client.get('/stock?includeEmpty=true'),
      client.get('/stock/committed'),
    ]).then(([stockRes, comRes]) => {
      setStock(stockRes.data);
      setCommitted(comRes.data);
    }).catch(() => {})
    .finally(() => setLoading(false));
  }, []);

  const stockMap = useMemo(() => {
    const m = {};
    for (const s of stock) m[s.id] = s;
    return m;
  }, [stock]);

  // Find substitution pairs: stock items with negative qty that have committed orders,
  // AND a recently-created substitute stock card (detected by matching names or STOCK_PURCHASES).
  // Simpler approach: show all negative-stock items with committed orders — let the owner
  // manually pick which substitute to use from available positive-stock items.
  const reconcilableItems = useMemo(() => {
    const items = [];
    for (const [stockId, cd] of Object.entries(committed)) {
      if (!cd.orders?.length) continue;
      const item = stockMap[stockId];
      if (!item) continue;
      const qty = Number(item['Current Quantity'] || 0);
      if (qty >= 0) continue; // only show negative (unresolved) items
      items.push({
        stockId,
        name: item['Display Name'] || '',
        currentQty: qty,
        committed: cd.committed,
        orders: cd.orders.sort((a, b) => (a.requiredBy || '').localeCompare(b.requiredBy || '')),
      });
    }
    return items;
  }, [committed, stockMap]);

  // Find potential substitutes: positive-stock items that could replace the original
  const getSubstitutes = (originalName) => {
    return stock.filter(s => {
      const qty = Number(s['Current Quantity'] || 0);
      return qty > 0 && s.id; // any in-stock flower could be a substitute
    });
  };

  async function handleSwap(orderId, lineId, fromStockId, toStockId, qty) {
    setSwapping(`${orderId}-${lineId}`);
    try {
      await client.post(`/orders/${orderId}/swap-bouquet-line`, {
        fromStockItemId: fromStockId,
        toStockItemId: toStockId,
        lineId,
        newQty: qty,
      });
      showToast(t.swapComplete, 'success');
      // Refresh data
      const [stockRes, comRes] = await Promise.all([
        client.get('/stock?includeEmpty=true'),
        client.get('/stock/committed'),
      ]);
      setStock(stockRes.data);
      setCommitted(comRes.data);
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    }
    setSwapping(null);
  }

  return (
    <div className="min-h-screen bg-ios-bg">
      <header className="glass-nav sticky top-0 z-30">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => navigate('/stock')} className="text-brand-600 text-sm font-medium">
            ← {t.stockTitle || 'Stock'}
          </button>
          <h1 className="text-base font-semibold text-ios-label">{t.reconcileSubstitutes}</h1>
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 pb-28">
        {loading ? (
          <p className="text-center text-ios-tertiary py-10">{t.loading}...</p>
        ) : reconcilableItems.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-ios-tertiary">{t.noMismatches}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {reconcilableItems.map(item => (
              <ReconcileCard
                key={item.stockId}
                item={item}
                stockMap={stockMap}
                swapping={swapping}
                onSwap={handleSwap}
                onOrderClick={(id) => navigate(`/orders/${id}`)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ReconcileCard({ item, stockMap, swapping, onSwap, onOrderClick }) {
  const [selectedSub, setSelectedSub] = useState('');

  const subStock = selectedSub ? stockMap[selectedSub] : null;
  const subQty = subStock ? Number(subStock['Current Quantity'] || 0) : 0;

  return (
    <div className="ios-card overflow-hidden">
      <div className="bg-red-50 px-4 py-2.5 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-red-700">{item.name}</p>
          <p className="text-[10px] text-red-500">
            {t.currentStock}: {item.currentQty} · {t.committedToOrders}: {item.committed}
          </p>
        </div>
      </div>

      {/* Substitute selector */}
      <div className="px-4 py-2 bg-indigo-50/50 border-b border-indigo-100">
        <label className="text-[10px] text-indigo-600 uppercase font-semibold">{t.swapFlower} →</label>
        <select
          value={selectedSub}
          onChange={e => setSelectedSub(e.target.value)}
          className="ml-2 text-sm px-2 py-1 border rounded-lg"
        >
          <option value="">— select substitute —</option>
          {Object.values(stockMap)
            .filter(s => Number(s['Current Quantity'] || 0) > 0 && s.id !== item.stockId)
            .sort((a, b) => (a['Display Name'] || '').localeCompare(b['Display Name'] || ''))
            .map(s => (
              <option key={s.id} value={s.id}>
                {s['Display Name']} ({s['Current Quantity']} {t.stems})
              </option>
            ))
          }
        </select>
        {subStock && (
          <span className="ml-2 text-xs text-indigo-600">{subQty} {t.stems} {t.remainingAfterSwap}</span>
        )}
      </div>

      {/* Affected orders (FIFO by date) */}
      <div className="divide-y divide-gray-50">
        {item.orders.map(order => {
          // Find the specific order line that references this stock item
          // For now, show the order with a swap button
          const isSwapping = swapping === `${order.orderId}-swap`;
          return (
            <div key={order.orderId} className="flex items-center justify-between px-4 py-2.5">
              <div
                className="cursor-pointer active:underline min-w-0"
                onClick={() => onOrderClick(order.orderId)}
              >
                <p className="text-sm font-medium text-ios-label">
                  #{order.appOrderId} — {order.customerName}
                </p>
                <p className="text-[10px] text-ios-tertiary">
                  {order.requiredBy || '—'} · {order.qty} {t.stems}
                </p>
              </div>
              {selectedSub && (
                <button
                  disabled={isSwapping || subQty < order.qty}
                  onClick={() => onSwap(order.orderId, null, item.stockId, selectedSub, order.qty)}
                  className="px-3 py-1 rounded-lg text-xs font-semibold bg-brand-600 text-white active:bg-brand-700 disabled:opacity-40"
                >
                  {isSwapping ? '...' : t.swapFlower}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
