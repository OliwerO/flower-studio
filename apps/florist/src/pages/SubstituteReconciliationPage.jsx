// SubstituteReconciliationPage — reconcile orders after PO substitution.
// Reads substitute pairs from /stock/reconciliation (Phase B Commit 3 server
// shape) and lets the florist swap affected bouquet lines onto the substitute
// card via POST /orders/:id/swap-bouquet-line.
//
// Migrated 2026-04-22 (Phase B Commit 4) from the previous in-memory pairing
// against /stock/committed. The backend now owns the join via the
// `Substitute For` link, so the UI doesn't need to figure out pairs itself.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext.jsx';
import client from '../api/client.js';
import t from '../translations.js';

export default function SubstituteReconciliationPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  // Track in-flight swap keyed by `${orderId}-${lineId}` so only the pressed
  // row shows a spinner.
  const [swapping, setSwapping] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await client.get('/stock/reconciliation');
      setItems(data.items || []);
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSwap(item, line, substituteStockId) {
    setSwapping(`${line.orderId}-${line.lineId}`);
    try {
      await client.post(`/orders/${line.orderId}/swap-bouquet-line`, {
        fromStockItemId: item.originalStockId,
        toStockItemId: substituteStockId,
        lineId: line.lineId,
        newQty: line.suggestedSwapQty,
      });
      showToast(t.swapComplete, 'success');
      // Refresh — swapped line drops off, pair disappears when all lines are gone.
      await load();
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    } finally {
      setSwapping(null);
    }
  }

  return (
    <div className="min-h-screen bg-ios-bg">
      <header className="glass-nav sticky top-0 z-30">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => navigate('/stock')} className="text-brand-600 text-sm font-medium">
            ← {t.stockTitle}
          </button>
          <h1 className="text-base font-semibold text-ios-label">{t.reconcileSubstitutes}</h1>
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 pb-28">
        {loading ? (
          <p className="text-center text-ios-tertiary py-10">{t.loading}</p>
        ) : items.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-ios-tertiary">{t.noMismatches}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map(item => (
              <ReconcileCard
                key={item.originalStockId}
                item={item}
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

// Card: one original → substitute(s) pair + its still-affected order lines.
// When multiple substitutes exist for the same original (same flower substituted
// more than once), the florist picks which one to use. The first substitute is
// pre-selected as the sensible default.
function ReconcileCard({ item, swapping, onSwap, onOrderClick }) {
  const [selectedSub, setSelectedSub] = useState(item.substitutes[0]?.stockId || '');
  const substitute = item.substitutes.find(s => s.stockId === selectedSub);

  return (
    <div className="ios-card overflow-hidden">
      {/* Original header — red for negative, muted otherwise */}
      <div className="bg-red-50 px-4 py-2.5">
        <p className="text-sm font-semibold text-red-700">{item.originalName}</p>
        <p className="text-[10px] text-red-500">
          {t.currentStock}: {item.originalQty}
        </p>
      </div>

      {/* Substitute selector — single substitute collapses to plain text, >1
          renders a dropdown so the florist picks which to apply per card. */}
      <div className="px-4 py-2 bg-indigo-50/50 border-b border-indigo-100">
        {item.substitutes.length === 0 ? (
          <p className="text-[11px] text-red-500">{t.noSubstitutes}</p>
        ) : item.substitutes.length === 1 ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-indigo-600 uppercase font-semibold">
              {t.swapFlower} →
            </span>
            <span className="text-sm font-medium text-indigo-700">
              {item.substitutes[0].name}
            </span>
            <span className="text-[10px] text-indigo-500">
              ({item.substitutes[0].availableQty} {t.stems})
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-indigo-600 uppercase font-semibold">
              {t.swapFlower} →
            </label>
            <select
              value={selectedSub}
              onChange={e => setSelectedSub(e.target.value)}
              className="text-sm px-2 py-1 border rounded-lg"
            >
              {item.substitutes.map(s => (
                <option key={s.stockId} value={s.stockId}>
                  {s.name} ({s.availableQty})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Affected order lines — FIFO by delivery date, one Swap button each.
          Tap the row body to jump to the order; tap Swap to move the line. */}
      <div className="divide-y divide-gray-50">
        {item.affectedLines.map(line => {
          const key = `${line.orderId}-${line.lineId}`;
          const isSwapping = swapping === key;
          // Disable Swap if no substitute picked or the substitute doesn't have
          // enough stems to cover this specific line.
          const canSwap = !!substitute && substitute.availableQty >= line.quantity;
          return (
            <div key={key} className="flex items-center justify-between px-4 py-2.5">
              <div
                className="cursor-pointer active:underline min-w-0 flex-1"
                onClick={() => onOrderClick(line.orderId)}
              >
                <p className="text-sm font-medium text-ios-label">
                  #{line.appOrderId} — {line.customerName || '—'}
                </p>
                <p className="text-[10px] text-ios-tertiary">
                  {line.requiredBy || '—'} · {line.quantity} {t.stems}
                </p>
              </div>
              <button
                disabled={isSwapping || !canSwap}
                onClick={() => onSwap(item, line, selectedSub)}
                className="px-3 py-1 rounded-lg text-xs font-semibold bg-brand-600 text-white active:bg-brand-700 disabled:opacity-40"
              >
                {isSwapping ? '...' : t.swapFlower}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
