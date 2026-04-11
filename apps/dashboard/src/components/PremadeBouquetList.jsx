// PremadeBouquetList — dashboard inventory of premade bouquets.
//
// Mirrors the florist app's premade view but renders as table rows so it fits
// the dashboard density. Each row shows name, composition, age, total, and two
// actions: "Match to client" (jumps to the New Order tab with the premade
// pre-selected) and "Return to stock".
//
// Owner can also edit the bouquet's name/price override via the inline fields.

import { useState, useEffect, useCallback } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import PremadeBouquetCreateModal from './PremadeBouquetCreateModal.jsx';

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

export default function PremadeBouquetList({ onMatchClicked }) {
  const { showToast } = useToast();
  const [bouquets, setBouquets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpanded] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchBouquets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('/premade-bouquets');
      setBouquets(res.data || []);
    } catch (err) {
      console.error('Failed to fetch premade bouquets:', err);
      showToast(err.response?.data?.error || t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchBouquets();
    const interval = setInterval(() => {
      if (!document.hidden) fetchBouquets();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchBouquets]);

  async function handleReturn(id) {
    if (!window.confirm(t.confirmReturnToStock)) return;
    try {
      await client.post(`/premade-bouquets/${id}/return-to-stock`);
      showToast(t.premadeReturned, 'success');
      setBouquets(prev => prev.filter(b => b.id !== id));
    } catch (err) {
      console.error('Failed to return premade:', err);
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-ios-tertiary">{t.loading || 'Loading...'}</div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header with create button */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-ios-tertiary">
          {bouquets.length} {t.premadeBouquets.toLowerCase()}
        </span>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-3 py-1.5 rounded-full bg-pink-600 text-white text-xs font-semibold active:bg-pink-700"
        >
          + {t.createPremadeBouquet}
        </button>
      </div>

      {bouquets.length === 0 && (
        <div className="text-center py-12 text-ios-tertiary">{t.premadeBouquetEmpty}</div>
      )}

      {bouquets.map(b => {
        const isExpanded = expandedId === b.id;
        const sellTotal = Number(b['Computed Sell Total'] || 0);
        const finalPrice = Number(b['Price Override'] || sellTotal);
        const summary = b['Bouquet Summary']
          || (b.lines || []).map(l => `${Number(l.Quantity || 0)}× ${l['Flower Name'] || '?'}`).join(', ');

        return (
          <div key={b.id} className="glass-card overflow-hidden">
            <div
              onClick={() => setExpanded(isExpanded ? null : b.id)}
              className="px-4 py-3 flex items-center gap-4 cursor-pointer hover:bg-gray-50 transition-colors"
            >
              <div className="w-9 h-9 rounded-full bg-pink-100 text-pink-600 text-base flex items-center justify-center shrink-0">
                💐
              </div>
              <span className="text-xs text-ios-tertiary w-20 shrink-0">
                {t.premadeBouquetAge} {timeAgo(b['Created At'])}
              </span>
              <span className="text-sm font-medium text-ios-label w-40 truncate">
                {b.Name || t.premadeBouquet}
              </span>
              <span className="text-xs text-ios-secondary flex-1 truncate">{summary || '—'}</span>
              <span className="text-sm font-semibold text-brand-600 shrink-0">
                {Math.round(finalPrice)} zł
              </span>
              <span className="text-ios-tertiary text-sm">{isExpanded ? '▲' : '▼'}</span>
            </div>

            {isExpanded && (
              <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
                {(b.lines || []).length > 0 && (
                  <ul className="text-sm text-ios-label space-y-0.5">
                    {b.lines.map(l => (
                      <li key={l.id} className="flex justify-between">
                        <span>{Number(l.Quantity || 0)}× {l['Flower Name'] || '?'}</span>
                        <span className="text-ios-tertiary">
                          {Number(l['Sell Price Per Unit'] || 0).toFixed(0)} × {Number(l.Quantity || 0)} = {(Number(l['Sell Price Per Unit'] || 0) * Number(l.Quantity || 0)).toFixed(0)} zł
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {b.Notes && (
                  <div className="text-xs text-ios-secondary italic">{b.Notes}</div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onMatchClicked?.(b.id)}
                    disabled={!onMatchClicked}
                    title={!onMatchClicked ? 'Switch to the New Order tab and pick this bouquet from Step 2.' : ''}
                    className="flex-1 h-10 rounded-xl bg-brand-600 text-white text-sm font-semibold active:bg-brand-700 disabled:opacity-40"
                  >
                    {t.soldBouquet}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReturn(b.id)}
                    className="flex-1 h-10 rounded-xl bg-amber-100 text-amber-700 text-sm font-semibold active:bg-amber-200"
                  >
                    {t.returnToStock}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {showCreateModal && (
        <PremadeBouquetCreateModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(created) => {
            // Prepend locally so the new bouquet is visible immediately without a refetch round-trip.
            setBouquets(prev => [created, ...prev.filter(b => b.id !== created.id)]);
          }}
        />
      )}
    </div>
  );
}
