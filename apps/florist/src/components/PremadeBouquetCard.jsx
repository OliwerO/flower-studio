// PremadeBouquetCard — a premade-bouquet row on the inventory view.
//
// Shows composition, price, age, and three primary actions:
//   • "Sold" — opens the order wizard with the premade pre-selected (Step 1
//     for the customer, then Step 3 for delivery/payment — Step 2 is skipped
//     because the composition is already locked in).
//   • "Return to stock" — restores all flowers to inventory and deletes the
//     premade record. Nothing to cancel, because no order was ever created.
//   • Tap header to expand — shows the full flower list and notes.

import { useState } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';

function timeAgo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function PremadeBouquetCard({ bouquet, isOwner, onRemoved, onMatchClicked }) {
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const sellTotal = Number(bouquet['Computed Sell Total'] || 0);
  const costTotal = Number(bouquet['Computed Cost Total'] || 0);
  const finalPrice = Number(bouquet['Price Override'] || sellTotal);
  const margin = sellTotal > 0 ? Math.round(((sellTotal - costTotal) / sellTotal) * 100) : 0;
  const summary = bouquet['Bouquet Summary']
    || (bouquet.lines || [])
      .map(l => `${Number(l.Quantity || 0)}× ${l['Flower Name'] || '?'}`)
      .join(', ');

  async function handleReturnToStock() {
    if (!window.confirm(t.confirmReturnToStock)) return;
    setBusy(true);
    try {
      await client.post(`/premade-bouquets/${bouquet.id}/return-to-stock`);
      showToast(t.premadeReturned, 'success');
      onRemoved?.(bouquet.id);
    } catch (err) {
      console.error('Failed to return premade to stock:', err);
      showToast(err.response?.data?.error || t.error, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ios-card overflow-hidden">
      {/* Header — tap to expand */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left active-scale"
      >
        <div className="w-10 h-10 rounded-full bg-pink-100 text-pink-600 text-lg flex items-center justify-center shrink-0">
          💐
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-ios-label truncate">
              {bouquet.Name || t.premadeBouquet}
            </span>
            <span className="text-[11px] text-ios-tertiary shrink-0">
              · {t.premadeBouquetAge} {timeAgo(bouquet['Created At'])}
            </span>
          </div>
          <div className="text-xs text-ios-tertiary truncate">{summary || '—'}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-bold text-brand-600">{Math.round(finalPrice)} zł</div>
          {isOwner && sellTotal > 0 && (
            <div className="text-[10px] text-ios-tertiary">{margin}%</div>
          )}
        </div>
        <span className="text-ios-tertiary text-sm ml-1">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100">
          {(bouquet.lines || []).length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] text-ios-tertiary uppercase tracking-wide mb-1">{t.labelBouquet}</div>
              <ul className="text-sm text-ios-label space-y-0.5">
                {(bouquet.lines || []).map(l => (
                  <li key={l.id} className="flex justify-between">
                    <span>{Number(l.Quantity || 0)}× {l['Flower Name'] || '?'}</span>
                    <span className="text-ios-tertiary">
                      {Number(l['Sell Price Per Unit'] || 0).toFixed(0)} × {Number(l.Quantity || 0)} = {(Number(l['Sell Price Per Unit'] || 0) * Number(l.Quantity || 0)).toFixed(0)} zł
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {bouquet.Notes && (
            <div className="mb-3 text-xs text-ios-secondary italic">{bouquet.Notes}</div>
          )}
          {bouquet['Price Override'] && (
            <div className="mb-3 text-xs text-ios-tertiary">
              {t.priceOverrideOptional}: <strong className="text-brand-600">{Math.round(bouquet['Price Override'])} zł</strong>
              {sellTotal !== bouquet['Price Override'] && (
                <span className="text-ios-tertiary"> ({t.sellTotal}: {Math.round(sellTotal)} zł)</span>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onMatchClicked?.(bouquet.id)}
              className="flex-1 h-11 rounded-xl bg-brand-600 text-white text-sm font-semibold disabled:opacity-30 active:bg-brand-700 active-scale"
            >
              {t.soldBouquet}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleReturnToStock}
              className="flex-1 h-11 rounded-xl bg-amber-100 text-amber-700 text-sm font-semibold disabled:opacity-30 active:bg-amber-200 active-scale"
            >
              {t.returnToStock}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
