// ReconciliationSection — surface substitute pairs the owner hasn't swapped yet.
// Backed by `GET /stock/reconciliation` which joins `Substitute For` links on
// Stock cards with non-terminal order lines still pointing at the original.
//
// Flow: PO evaluation creates a substitute stock card with `Substitute For`
// pointing back at the original → this panel lists the affected orders →
// one click per line calls `POST /orders/:id/swap-bouquet-line` to move that
// line onto the substitute. Pair disappears once every affected line is swapped.

import { useState, useEffect } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';

export default function ReconciliationSection({ onClose }) {
  const { showToast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  // Track in-flight swap keyed by `${orderId}-${lineId}` so the pressed row
  // shows a spinner and other rows stay interactive.
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
      // Refresh — swapped line disappears, original card disappears once all lines are gone.
      await load();
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    } finally {
      setSwapping(null);
    }
  }

  return (
    <div className="glass-card overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50/80">
        <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">
          {t.reconcileSubstitutes}
        </span>
        <button onClick={onClose} className="text-xs text-ios-tertiary hover:text-ios-label">✕</button>
      </div>

      {loading ? (
        <p className="px-4 py-6 text-xs text-ios-tertiary text-center">{t.loading}</p>
      ) : items.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ios-tertiary text-center">{t.noMismatches}</p>
      ) : (
        <div className="divide-y divide-amber-100">
          {items.map(item => (
            <PairCard
              key={item.originalStockId}
              item={item}
              swapping={swapping}
              onSwap={handleSwap}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One original → substitute(s) pair + the order lines that need swapping.
// When there are multiple substitutes (same original was substituted twice or
// more), the owner picks which one to use per-card; the first substitute is
// pre-selected as a sensible default.
function PairCard({ item, swapping, onSwap }) {
  const [selectedSub, setSelectedSub] = useState(item.substitutes[0]?.stockId || '');
  const substitute = item.substitutes.find(s => s.stockId === selectedSub);

  return (
    <div className="px-4 py-3 space-y-2">
      {/* Original (left) → Substitute (right) */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ios-label truncate">{item.originalName}</p>
          <p className="text-[10px] text-ios-tertiary">
            {t.currentStock}:{' '}
            <span className={item.originalQty < 0 ? 'text-red-600 font-semibold' : ''}>
              {item.originalQty}
            </span>
          </p>
        </div>
        <span className="text-ios-tertiary text-xs">→</span>
        <div className="min-w-0 flex-1">
          {item.substitutes.length === 0 ? (
            <p className="text-[10px] text-red-500">{t.noSubstitutes}</p>
          ) : item.substitutes.length === 1 ? (
            <div>
              <p className="text-sm font-medium text-indigo-600 truncate">
                {item.substitutes[0].name}
              </p>
              <p className="text-[10px] text-indigo-500">
                {item.substitutes[0].availableQty} {t.stems} {t.available}
              </p>
            </div>
          ) : (
            <select
              value={selectedSub}
              onChange={e => setSelectedSub(e.target.value)}
              className="text-sm px-2 py-1 border rounded-lg w-full"
            >
              {item.substitutes.map(s => (
                <option key={s.stockId} value={s.stockId}>
                  {s.name} ({s.availableQty})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Affected order lines — one Swap button per line (FIFO by delivery date) */}
      <div className="space-y-1">
        {item.affectedLines.map(line => {
          const key = `${line.orderId}-${line.lineId}`;
          const isSwapping = swapping === key;
          // Disable swap if no substitute picked or not enough stock to cover this line's qty.
          const canSwap = !!substitute && substitute.availableQty >= line.quantity;
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-2 bg-amber-50/40 rounded-lg px-2 py-1.5"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-ios-label truncate">
                  #{line.appOrderId} · {line.customerName || '—'}
                </p>
                <p className="text-[10px] text-ios-tertiary">
                  {line.requiredBy || '—'} · {line.quantity} {t.stems}
                </p>
              </div>
              <button
                disabled={isSwapping || !canSwap}
                onClick={() => onSwap(item, line, selectedSub)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-brand-600 text-white disabled:opacity-40 active:bg-brand-700"
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
