// PremadeBouquetCard — a premade-bouquet row on the inventory view.
//
// Shows composition, price, age, and primary actions:
//   • "Sold" — opens the order wizard with the premade pre-selected
//   • "Return to stock" — restores all flowers to inventory
//   • "Edit" — inline editing of name, notes, price override, and flower lines

import { useState, useEffect, useMemo } from 'react';
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

export default function PremadeBouquetCard({ bouquet, isOwner, onRemoved, onUpdated, onMatchClicked }) {
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  // Editable field state
  const [editName, setEditName] = useState(bouquet.Name || '');
  const [editNotes, setEditNotes] = useState(bouquet.Notes || '');
  const [editPriceOverride, setEditPriceOverride] = useState(bouquet['Price Override'] || '');

  // Line editing state
  const [editLines, setEditLines] = useState([]);
  const [removedLines, setRemovedLines] = useState([]);

  // Stock catalog for adding flowers
  const [stock, setStock] = useState([]);
  const [flowerSearch, setFlowerSearch] = useState('');
  const [showAddFlower, setShowAddFlower] = useState(false);

  const sellTotal = Number(bouquet['Computed Sell Total'] || 0);
  const costTotal = Number(bouquet['Computed Cost Total'] || 0);
  const finalPrice = Number(bouquet['Price Override'] || sellTotal);
  const margin = sellTotal > 0 ? Math.round(((sellTotal - costTotal) / sellTotal) * 100) : 0;
  const summary = bouquet['Bouquet Summary']
    || (bouquet.lines || [])
      .map(l => `${Number(l.Quantity || 0)}× ${l['Flower Name'] || '?'}`)
      .join(', ');

  // Computed totals for edit mode
  const editSellTotal = useMemo(() =>
    editLines.reduce((s, l) => s + Number(l.sellPricePerUnit || 0) * Number(l.quantity || 0), 0),
    [editLines],
  );
  const editCostTotal = useMemo(() =>
    editLines.reduce((s, l) => s + Number(l.costPricePerUnit || 0) * Number(l.quantity || 0), 0),
    [editLines],
  );

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
      const newQty = Math.max(1, l.quantity + delta);
      return { ...l, quantity: newQty };
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

  // Fetch stock when opening add-flower
  useEffect(() => {
    if (!showAddFlower || stock.length > 0) return;
    client.get('/stock').then(r => setStock(r.data)).catch(() => {});
  }, [showAddFlower]);

  const filteredStock = useMemo(() => {
    if (!flowerSearch.trim()) return stock.slice(0, 20);
    const q = flowerSearch.toLowerCase().trim();
    return stock.filter(s =>
      (s['Display Name'] || '').toLowerCase().includes(q),
    ).slice(0, 20);
  }, [stock, flowerSearch]);

  async function handleSave() {
    setBusy(true);
    try {
      // 1. Patch top-level fields if changed
      const patch = {};
      if (editName.trim() !== (bouquet.Name || '')) patch.name = editName.trim();
      if ((editNotes || '') !== (bouquet.Notes || '')) patch.notes = editNotes;
      const overrideNum = editPriceOverride ? Number(editPriceOverride) : null;
      if (overrideNum !== (bouquet['Price Override'] || null)) patch.priceOverride = overrideNum;

      if (Object.keys(patch).length > 0) {
        await client.patch(`/premade-bouquets/${bouquet.id}`, patch);
      }

      // 2. Save line changes if any
      const hasLineChanges = removedLines.length > 0
        || editLines.some(l => !l.id)
        || editLines.some(l => l.id && l.quantity !== l._originalQty);

      if (hasLineChanges) {
        await client.put(`/premade-bouquets/${bouquet.id}/lines`, {
          lines: editLines,
          removedLines,
        });
      }

      // 3. Refresh the bouquet data
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
        onClick={() => { if (!editing) setExpanded(v => !v); }}
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
      {expanded && !editing && (
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
              onClick={startEditing}
              className="h-11 px-4 rounded-xl bg-gray-100 text-ios-label text-sm font-semibold disabled:opacity-30 active:bg-gray-200 active-scale"
            >
              {t.editBouquet}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleReturnToStock}
              className="h-11 px-4 rounded-xl bg-amber-100 text-amber-700 text-sm font-semibold disabled:opacity-30 active:bg-amber-200 active-scale"
            >
              {t.returnToStock}
            </button>
          </div>
        </div>
      )}

      {/* Editing mode */}
      {expanded && editing && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100">
          {/* Name */}
          <div className="mb-3">
            <label className="text-[11px] text-ios-tertiary uppercase tracking-wide">{t.premadeBouquetName}</label>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="w-full mt-1 px-3 py-2.5 rounded-xl bg-ios-fill text-base text-ios-label outline-none"
            />
          </div>

          {/* Lines editor */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-ios-tertiary uppercase tracking-wide">{t.labelBouquet}</span>
              <button
                type="button"
                onClick={() => setShowAddFlower(v => !v)}
                className="text-xs font-semibold text-brand-600 active-scale"
              >
                + {t.addFlower}
              </button>
            </div>

            {/* Add flower search */}
            {showAddFlower && (
              <div className="mb-2 bg-gray-50 rounded-xl p-3">
                <input
                  type="text"
                  value={flowerSearch}
                  onChange={e => setFlowerSearch(e.target.value)}
                  placeholder={t.flowerSearch}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-ios-separator text-sm outline-none mb-2"
                  autoFocus
                />
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {filteredStock.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addFlowerFromStock(item)}
                      className="w-full text-left px-3 py-2 rounded-lg bg-white text-sm active:bg-gray-100 flex justify-between items-center"
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

            {/* Current lines */}
            <div className="space-y-1">
              {editLines.map((line, idx) => (
                <div key={line.id || `new-${idx}`} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                  <span className="flex-1 text-sm text-ios-label truncate">{line.flowerName}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateQty(idx, -1)}
                      className="w-7 h-7 rounded-full bg-white border border-ios-separator text-sm text-ios-label flex items-center justify-center active-scale"
                    >−</button>
                    <span className="w-6 text-center text-sm font-semibold text-ios-label">{line.quantity}</span>
                    <button
                      type="button"
                      onClick={() => updateQty(idx, 1)}
                      className="w-7 h-7 rounded-full bg-white border border-ios-separator text-sm text-ios-label flex items-center justify-center active-scale"
                    >+</button>
                  </div>
                  <span className="text-xs text-ios-tertiary w-12 text-right">{Math.round(line.sellPricePerUnit * line.quantity)} zł</span>
                  <button
                    type="button"
                    onClick={() => removeLine(idx)}
                    className="text-red-400 text-sm active-scale ml-1"
                  >✕</button>
                </div>
              ))}
            </div>

            {/* Edit totals */}
            {editLines.length > 0 && (
              <div className="flex justify-between mt-2 px-1 text-xs">
                <span className="text-ios-tertiary">{t.sellTotal}: <strong className="text-ios-label">{Math.round(editSellTotal)} zł</strong></span>
                {isOwner && (
                  <span className="text-ios-tertiary">{t.costTotal}: <strong className="text-ios-label">{Math.round(editCostTotal)} zł</strong></span>
                )}
              </div>
            )}
          </div>

          {/* Price override */}
          <div className="mb-3">
            <label className="text-[11px] text-ios-tertiary uppercase tracking-wide">{t.priceOverrideOptional}</label>
            <input
              type="number"
              value={editPriceOverride}
              onChange={e => setEditPriceOverride(e.target.value)}
              placeholder={`${Math.round(editSellTotal)} zł`}
              className="w-full mt-1 px-3 py-2.5 rounded-xl bg-ios-fill text-base text-ios-label outline-none"
            />
          </div>

          {/* Notes */}
          <div className="mb-4">
            <label className="text-[11px] text-ios-tertiary uppercase tracking-wide">{t.premadeBouquetNotes}</label>
            <textarea
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
              placeholder={t.premadeBouquetNotesHint}
              rows={2}
              className="w-full mt-1 px-3 py-2.5 rounded-xl bg-ios-fill text-sm text-ios-label outline-none resize-none"
            />
          </div>

          {/* Save / Cancel */}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !editName.trim() || editLines.length === 0}
              onClick={handleSave}
              className="flex-1 h-11 rounded-xl bg-brand-600 text-white text-sm font-semibold disabled:opacity-30 active:bg-brand-700 active-scale"
            >
              {t.saveBouquet}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={cancelEditing}
              className="h-11 px-6 rounded-xl bg-gray-100 text-ios-secondary text-sm font-semibold active:bg-gray-200 active-scale"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
