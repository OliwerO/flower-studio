// StockReceiveForm — record incoming flower delivery from a supplier.
// Like receiving goods at a warehouse dock: select item, count stems, log cost.
// Now supports creating a new stock item inline (aligned with florist app).

import { useState } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import useConfigLists from '../hooks/useConfigLists.js';
const NEW_ITEM_VALUE = '__new__';

export default function StockReceiveForm({ stock, onDone }) {
  const { suppliers: SUPPLIERS, categories: CATEGORIES } = useConfigLists();
  const [itemId, setItemId]       = useState('');
  const [newName, setNewName]     = useState('');
  const [newCategory, setNewCategory] = useState('Other');
  const [quantity, setQuantity]   = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [supplier, setSupplier]   = useState('');
  const [notes, setNotes]         = useState('');
  const [saving, setSaving]       = useState(false);
  const { showToast } = useToast();

  const isNew = itemId === NEW_ITEM_VALUE;
  const canSave = isNew ? (newName.trim() && quantity) : (itemId && quantity);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSave) return;

    setSaving(true);
    try {
      let finalItemId = itemId;

      // Create new stock item first if needed
      if (isNew) {
        const res = await client.post('/stock', {
          displayName: newName.trim(),
          category: newCategory,
          quantity: 0,
          costPrice: Number(costPrice) || 0,
          sellPrice: Number(sellPrice) || 0,
          supplier,
        });
        finalItemId = res.data.id;
      }

      await client.post('/stock-purchases', {
        stockItemId: finalItemId,
        quantityPurchased: Number(quantity),
        pricePerUnit: Number(costPrice) || 0,
        sellPricePerUnit: Number(sellPrice) || undefined,
        supplierName: supplier,
        notes,
      });
      showToast(t.stockReceived);
      onDone();
    } catch {
      showToast(t.error, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card px-4 py-4 space-y-3">
      <h3 className="text-sm font-semibold text-ios-label">{t.receiveStock}</h3>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Stock item select — includes "Create new" option */}
        <div>
          <label className="text-xs text-ios-tertiary">Item</label>
          <select value={itemId} onChange={e => setItemId(e.target.value)} className="field-input block w-full">
            <option value="">— Select —</option>
            {stock.map(s => (
              <option key={s.id} value={s.id}>{s['Display Name']}</option>
            ))}
            <option value={NEW_ITEM_VALUE}>+ Create new item</option>
          </select>
        </div>

        {/* New item fields — only when "Create new" is selected */}
        {isNew && (
          <>
            <div>
              <label className="text-xs text-ios-tertiary">{t.stockName}</label>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="e.g. White tulips"
                className="field-input block w-full" />
            </div>
            <div>
              <label className="text-xs text-ios-tertiary">{t.category}</label>
              <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                className="field-input block w-full">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </>
        )}

        {/* Quantity */}
        <div>
          <label className="text-xs text-ios-tertiary">{t.quantityReceived}</label>
          <input type="number" min="1" value={quantity}
            onChange={e => setQuantity(e.target.value)}
            className="field-input block w-full" />
        </div>

        {/* Cost price */}
        <div>
          <label className="text-xs text-ios-tertiary">{t.costPrice} / unit</label>
          <input type="number" step="0.01" value={costPrice}
            onChange={e => setCostPrice(e.target.value)}
            className="field-input block w-full" />
        </div>

        {/* Sell price */}
        <div>
          <label className="text-xs text-ios-tertiary">{t.sellPrice} / unit</label>
          <input type="number" step="0.01" value={sellPrice}
            onChange={e => setSellPrice(e.target.value)}
            placeholder="—"
            className="field-input block w-full" />
        </div>

        {/* Supplier */}
        <div>
          <label className="text-xs text-ios-tertiary">{t.supplier}</label>
          <select value={supplier} onChange={e => setSupplier(e.target.value)} className="field-input block w-full">
            <option value="">— Select —</option>
            {SUPPLIERS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs text-ios-tertiary">{t.notes}</label>
          <input value={notes} onChange={e => setNotes(e.target.value)}
            className="field-input block w-full" />
        </div>
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={saving || !canSave}
          className="px-4 py-2 rounded-xl bg-ios-green text-white text-sm font-semibold disabled:opacity-50">
          {saving ? t.saving : t.save}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-2 rounded-xl bg-white/50 text-sm">
          {t.cancel}
        </button>
      </div>
    </form>
  );
}
