// PremadeBouquetList — dashboard inventory of premade bouquets.
//
// Mirrors the florist app's premade view but renders as table rows so it fits
// the dashboard density. Each row shows name, composition, age, total, and two
// actions: "Match to client" (jumps to the New Order tab with the premade
// pre-selected) and "Return to stock".
//
// Owner can also edit the bouquet's name/price override via the inline fields.

import { useState, useEffect, useCallback, useMemo } from 'react';
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
              <PremadeExpanded
                bouquet={b}
                onMatchClicked={onMatchClicked}
                onReturn={() => handleReturn(b.id)}
                onUpdated={(updated) => setBouquets(prev => prev.map(x => x.id === updated.id ? updated : x))}
              />
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

// Expanded row — read-only by default, switches to inline edit when the owner
// clicks "Edit bouquet". Mirrors the florist PremadeBouquetCard edit UI but
// stays compact for the dashboard's denser rows. On save, patches name/price/
// notes and PUTs line changes, then surfaces the refreshed bouquet upward.
function PremadeExpanded({ bouquet, onMatchClicked, onReturn, onUpdated }) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [editName, setEditName] = useState(bouquet.Name || '');
  const [editNotes, setEditNotes] = useState(bouquet.Notes || '');
  const [editPriceOverride, setEditPriceOverride] = useState(bouquet['Price Override'] || '');
  const [editLines, setEditLines] = useState([]);
  const [removedLines, setRemovedLines] = useState([]);
  const [stock, setStock] = useState([]);
  const [flowerSearch, setFlowerSearch] = useState('');
  const [showAddFlower, setShowAddFlower] = useState(false);

  const sellTotal = Number(bouquet['Computed Sell Total'] || 0);

  // Live totals while editing — sell uses live stock Current Sell Price with
  // fallback to the line's snapshot, matching the florist premade card and
  // the order bouquet editor. Cost stays on the snapshot (true-paid value).
  const editSellTotal = useMemo(() =>
    editLines.reduce((sum, l) => {
      const si = l.stockItemId ? stock.find(s => s.id === l.stockItemId) : null;
      const price = Number(si?.['Current Sell Price'] ?? l.sellPricePerUnit ?? 0);
      return sum + price * Number(l.quantity || 0);
    }, 0),
    [editLines, stock],
  );
  const editCostTotal = useMemo(() =>
    editLines.reduce((s, l) => s + Number(l.costPricePerUnit || 0) * Number(l.quantity || 0), 0),
    [editLines],
  );
  const editMargin = editSellTotal > 0 ? Math.round(((editSellTotal - editCostTotal) / editSellTotal) * 100) : 0;
  // Delta vs saved sell total — red if composition got pricier, green if cheaper.
  const sellDelta = sellTotal > 0 ? editSellTotal - sellTotal : 0;

  function startEditing() {
    setEditing(true);
    setEditName(bouquet.Name || '');
    setEditNotes(bouquet.Notes || '');
    setEditPriceOverride(bouquet['Price Override'] || '');
    setEditLines((bouquet.lines || []).map(l => ({
      id: l.id,
      stockItemId: l['Stock Item']?.[0] || null,
      flowerName: l['Flower Name'] || '',
      quantity: Number(l.Quantity || 0),
      _originalQty: Number(l.Quantity || 0),
      costPricePerUnit: Number(l['Cost Price Per Unit'] || 0),
      sellPricePerUnit: Number(l['Sell Price Per Unit'] || 0),
    })));
    setRemovedLines([]);
    setShowAddFlower(false);
    setFlowerSearch('');
  }

  function cancelEditing() {
    setEditing(false);
    setRemovedLines([]);
    setShowAddFlower(false);
  }

  function removeLine(idx) {
    const line = editLines[idx];
    if (line.id) {
      setRemovedLines(prev => [...prev, {
        lineId: line.id,
        stockItemId: line.stockItemId,
        quantity: line._originalQty,
      }]);
    }
    setEditLines(prev => prev.filter((_, i) => i !== idx));
  }

  function updateQty(idx, delta) {
    setEditLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      return { ...l, quantity: Math.max(1, l.quantity + delta) };
    }));
  }

  function addFlowerFromStock(item) {
    const existing = editLines.findIndex(l => l.stockItemId === item.id);
    if (existing >= 0) {
      setEditLines(prev => prev.map((l, i) =>
        i === existing ? { ...l, quantity: l.quantity + 1 } : l,
      ));
    } else {
      setEditLines(prev => [...prev, {
        id: null,
        stockItemId: item.id,
        flowerName: item['Display Name'] || '',
        quantity: 1,
        _originalQty: 0,
        costPricePerUnit: Number(item['Current Cost Price'] || 0),
        sellPricePerUnit: Number(item['Current Sell Price'] || 0),
      }]);
    }
    setShowAddFlower(false);
    setFlowerSearch('');
  }

  useEffect(() => {
    if (!showAddFlower || stock.length > 0) return;
    client.get('/stock').then(r => setStock(r.data)).catch(() => {});
  }, [showAddFlower, stock.length]);

  const filteredStock = useMemo(() => {
    if (!flowerSearch.trim()) return stock.slice(0, 20);
    const q = flowerSearch.toLowerCase().trim();
    return stock.filter(s => (s['Display Name'] || '').toLowerCase().includes(q)).slice(0, 20);
  }, [stock, flowerSearch]);

  async function handleSave() {
    setBusy(true);
    try {
      const patch = {};
      if (editName.trim() !== (bouquet.Name || '')) patch.name = editName.trim();
      if ((editNotes || '') !== (bouquet.Notes || '')) patch.notes = editNotes;
      const overrideNum = editPriceOverride ? Number(editPriceOverride) : null;
      if (overrideNum !== (bouquet['Price Override'] || null)) patch.priceOverride = overrideNum;

      if (Object.keys(patch).length > 0) {
        await client.patch(`/premade-bouquets/${bouquet.id}`, patch);
      }

      const hasLineChanges = removedLines.length > 0
        || editLines.some(l => !l.id)
        || editLines.some(l => l.id && l.quantity !== l._originalQty);

      if (hasLineChanges) {
        await client.put(`/premade-bouquets/${bouquet.id}/lines`, {
          lines: editLines,
          removedLines,
        });
      }

      const res = await client.get(`/premade-bouquets/${bouquet.id}`);
      onUpdated?.(res.data);
      setEditing(false);
      showToast(t.bouquetUpdated, 'success');
    } catch (err) {
      console.error('Failed to save premade bouquet:', err);
      showToast(err.response?.data?.error || t.error, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
        {(bouquet.lines || []).length > 0 && (
          <ul className="text-sm text-ios-label space-y-0.5">
            {bouquet.lines.map(l => (
              <li key={l.id} className="flex justify-between">
                <span>{Number(l.Quantity || 0)}× {l['Flower Name'] || '?'}</span>
                <span className="text-ios-tertiary">
                  {Number(l['Sell Price Per Unit'] || 0).toFixed(0)} × {Number(l.Quantity || 0)} = {(Number(l['Sell Price Per Unit'] || 0) * Number(l.Quantity || 0)).toFixed(0)} zł
                </span>
              </li>
            ))}
          </ul>
        )}
        {bouquet.Notes && (
          <div className="text-xs text-ios-secondary italic">{bouquet.Notes}</div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onMatchClicked?.(bouquet.id)}
            disabled={!onMatchClicked}
            title={!onMatchClicked ? 'Switch to the New Order tab and pick this bouquet from Step 2.' : ''}
            className="flex-1 h-10 rounded-xl bg-brand-600 text-white text-sm font-semibold active:bg-brand-700 disabled:opacity-40"
          >
            {t.soldBouquet}
          </button>
          <button
            type="button"
            onClick={startEditing}
            className="h-10 px-4 rounded-xl bg-gray-100 text-ios-label text-sm font-semibold active:bg-gray-200"
          >
            {t.editBouquet}
          </button>
          <button
            type="button"
            onClick={onReturn}
            className="flex-1 h-10 rounded-xl bg-amber-100 text-amber-700 text-sm font-semibold active:bg-amber-200"
          >
            {t.returnToStock}
          </button>
        </div>
      </div>
    );
  }

  // Edit mode
  return (
    <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
      <div>
        <label className="text-[11px] text-ios-tertiary uppercase tracking-wide">{t.premadeBouquetName}</label>
        <input
          type="text"
          value={editName}
          onChange={e => setEditName(e.target.value)}
          className="field-input w-full mt-1 text-sm"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11px] text-ios-tertiary uppercase tracking-wide">{t.labelBouquet || 'Bouquet'}</label>
          <button
            type="button"
            onClick={() => setShowAddFlower(v => !v)}
            className="text-xs font-semibold text-brand-600 active-scale"
          >
            + {t.addFlower}
          </button>
        </div>

        {showAddFlower && (
          <div className="mb-2 bg-gray-50 rounded-xl p-3">
            <input
              type="text"
              value={flowerSearch}
              onChange={e => setFlowerSearch(e.target.value)}
              placeholder={t.flowerSearch || 'Search stock...'}
              className="field-input w-full text-sm mb-2"
              autoFocus
            />
            <div className="max-h-40 overflow-y-auto space-y-1">
              {filteredStock.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addFlowerFromStock(item)}
                  className="w-full text-left px-3 py-2 rounded-lg bg-white text-sm hover:bg-gray-100 flex justify-between items-center"
                >
                  <span className="text-ios-label">{item['Display Name'] || '?'}</span>
                  <span className="text-ios-tertiary text-xs">
                    {Number(item['Current Quantity'] || 0)} · {Number(item['Current Sell Price'] || 0)} zł
                  </span>
                </button>
              ))}
              {filteredStock.length === 0 && (
                <p className="text-xs text-ios-tertiary text-center py-2">{t.noStockFound || 'No items found'}</p>
              )}
            </div>
          </div>
        )}

        <div className="space-y-1">
          {editLines.map((line, idx) => {
            // Use live stock sell price when available so the per-line total
            // matches the footer total computed from the same source.
            const si = line.stockItemId ? stock.find(s => s.id === line.stockItemId) : null;
            const liveSell = Number(si?.['Current Sell Price'] ?? line.sellPricePerUnit ?? 0);
            const lineTotal = liveSell * Number(line.quantity || 0);
            return (
              <div key={line.id || `new-${idx}`} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-ios-label truncate block">{line.flowerName}</span>
                  <span className="text-[10px] text-ios-tertiary">
                    {liveSell.toFixed(0)} zł × {line.quantity} = <strong className="text-brand-700">{lineTotal.toFixed(0)} zł</strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => updateQty(idx, -1)}
                    className="w-7 h-7 rounded-full bg-white border border-gray-200 text-sm flex items-center justify-center"
                  >−</button>
                  <span className="w-6 text-center text-sm font-semibold">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => updateQty(idx, 1)}
                    className="w-7 h-7 rounded-full bg-white border border-gray-200 text-sm flex items-center justify-center"
                  >+</button>
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(idx)}
                  className="text-red-400 text-sm ml-1"
                >✕</button>
              </div>
            );
          })}
        </div>

        {/* Live totals footer — sell total with coloured delta vs saved,
            plus cost total + margin so the owner can sanity-check pricing
            while composing. Parity with the order bouquet editor. */}
        {editLines.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 px-3 py-2 mt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ios-label">{t.sellTotal}</span>
              <div className="flex items-center gap-2">
                {sellTotal > 0 && sellDelta !== 0 && (
                  <span className={`text-xs font-bold ${sellDelta > 0 ? 'text-red-500' : 'text-green-600'}`}>
                    ({sellDelta > 0 ? '+' : ''}{sellDelta.toFixed(0)})
                  </span>
                )}
                <span className="text-base font-bold text-brand-600">{Math.round(editSellTotal)} zł</span>
              </div>
            </div>
            <div className="flex items-center justify-between mt-1 pt-1 border-t border-gray-50">
              <span className="text-xs text-ios-tertiary">{t.costTotal} · {t.markup || 'Markup'}: {editMargin}%</span>
              <span className="text-xs text-ios-tertiary font-medium">{Math.round(editCostTotal)} zł</span>
            </div>
          </div>
        )}
      </div>

      <div>
        <label className="text-[11px] text-ios-tertiary uppercase tracking-wide">{t.priceOverrideOptional || 'Price override'}</label>
        <input
          type="number"
          value={editPriceOverride}
          onChange={e => setEditPriceOverride(e.target.value)}
          placeholder={`${Math.round(sellTotal)} zł`}
          className="field-input w-full mt-1 text-sm"
        />
      </div>

      <div>
        <label className="text-[11px] text-ios-tertiary uppercase tracking-wide">{t.premadeBouquetNotes || 'Notes'}</label>
        <textarea
          value={editNotes}
          onChange={e => setEditNotes(e.target.value)}
          placeholder={t.premadeBouquetNotesHint || ''}
          rows={2}
          className="field-input w-full mt-1 text-sm resize-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !editName.trim() || editLines.length === 0}
          onClick={handleSave}
          className="flex-1 h-10 rounded-xl bg-brand-600 text-white text-sm font-semibold disabled:opacity-40 active:bg-brand-700"
        >
          {t.saveBouquet || t.save || 'Save'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={cancelEditing}
          className="h-10 px-6 rounded-xl bg-gray-100 text-ios-secondary text-sm font-semibold active:bg-gray-200"
        >
          {t.cancel}
        </button>
      </div>
    </div>
  );
}
