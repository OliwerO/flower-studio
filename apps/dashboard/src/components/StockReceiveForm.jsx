// StockReceiveForm — record incoming flower delivery from a supplier.
// Like receiving goods at a warehouse dock: select item, count stems, log cost.
// Supports creating a new stock item inline. Auto-fills prices from existing
// stock data and calculates sell price via markup factor.

import { useState, useMemo } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import useConfigLists from '../hooks/useConfigLists.js';

const NEW_ITEM_VALUE = '__new__';
const NEW_SUPPLIER_VALUE = '__new_supplier__';

export default function StockReceiveForm({ stock, onDone }) {
  const { suppliers: SUPPLIERS, categories: CATEGORIES, targetMarkup } = useConfigLists();
  const [itemId, setItemId]       = useState('');
  const [newName, setNewName]     = useState('');
  const [newCategory, setNewCategory] = useState('Other');
  const [quantity, setQuantity]   = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [sellPriceManual, setSellPriceManual] = useState(false);
  const [supplier, setSupplier]   = useState('');
  const [newSupplier, setNewSupplier] = useState('');
  const [farmer, setFarmer]       = useState('');
  const [notes, setNotes]         = useState('');
  const [saving, setSaving]       = useState(false);
  const { showToast } = useToast();

  const isNew = itemId === NEW_ITEM_VALUE;
  const isNewSup = supplier === NEW_SUPPLIER_VALUE;
  const supplierValue = isNewSup ? newSupplier.trim() : supplier;
  const canSave = isNew ? (newName.trim() && quantity) : (itemId && quantity);

  // All known suppliers from stock + config
  const allSuppliers = useMemo(() => {
    const fromStock = stock.map(s => s.Supplier).filter(Boolean);
    return [...new Set([...SUPPLIERS, ...fromStock])];
  }, [stock, SUPPLIERS]);

  // Selected stock item (for auto-fill)
  const selectedItem = useMemo(
    () => !isNew && itemId ? stock.find(s => s.id === itemId) : null,
    [stock, itemId, isNew]
  );

  // Auto-fill prices when selecting an existing item
  function handleItemChange(id) {
    setItemId(id);
    if (id && id !== NEW_ITEM_VALUE) {
      const item = stock.find(s => s.id === id);
      if (item) {
        const cost = item['Current Cost Price'] || 0;
        const sell = item['Current Sell Price'] || 0;
        setCostPrice(cost > 0 ? String(cost) : '');
        setSellPrice(sell > 0 ? String(sell) : '');
        setSellPriceManual(sell > 0);
        setSupplier(item.Supplier || '');
        setFarmer(item.Farmer || '');
      }
    } else {
      setCostPrice('');
      setSellPrice('');
      setSellPriceManual(false);
      setSupplier('');
      setFarmer('');
    }
  }

  // Auto-calculate sell price from cost * markup when cost changes
  function handleCostChange(value) {
    setCostPrice(value);
    if (!sellPriceManual && value && targetMarkup) {
      setSellPrice(String(Math.round(Number(value) * targetMarkup)));
    }
  }

  // When user manually edits sell price, mark it as manual
  function handleSellPriceChange(value) {
    setSellPrice(value);
    setSellPriceManual(true);
  }

  // Computed totals
  const qty = Number(quantity) || 0;
  const cost = Number(costPrice) || 0;
  const sell = Number(sellPrice) || 0;
  const totalCost = qty * cost;
  const totalSell = qty * sell;
  const computedMarkup = cost > 0 && sell > 0 ? (sell / cost).toFixed(1) : null;

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
          costPrice: cost,
          sellPrice: sell,
          supplier: supplierValue,
          farmer: farmer.trim() || undefined,
        });
        finalItemId = res.data.id;
      }

      await client.post('/stock-purchases', {
        stockItemId: finalItemId,
        quantityPurchased: qty,
        pricePerUnit: cost,
        sellPricePerUnit: sell || undefined,
        supplierName: supplierValue,
        notes,
      });

      // If farmer changed on existing item, patch it
      if (!isNew && selectedItem && farmer.trim() !== (selectedItem.Farmer || '')) {
        await client.patch(`/stock/${finalItemId}`, { Farmer: farmer.trim() });
      }

      // Persist new supplier to settings
      if (isNewSup && supplierValue && !SUPPLIERS.some(s => s.toLowerCase() === supplierValue.toLowerCase())) {
        client.put('/settings/config', { suppliers: [...SUPPLIERS, supplierValue] }).catch(() => {});
      }

      showToast(t.stockReceived);
      onDone();
    } catch {
      showToast(t.error, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card px-5 py-5 space-y-4">
      <h3 className="text-sm font-semibold text-ios-label">{t.receiveStock}</h3>

      {/* Row 1: Item selection + new item fields */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="text-xs text-ios-tertiary mb-1 block">{t.stockName}</label>
          <select value={itemId} onChange={e => handleItemChange(e.target.value)}
            className="field-input block w-full">
            <option value="">— {t.search} —</option>
            {stock.map(s => (
              <option key={s.id} value={s.id}>{s['Display Name']}</option>
            ))}
            <option value={NEW_ITEM_VALUE}>+ {t.addItem}</option>
          </select>
        </div>

        {isNew ? (
          <>
            <div>
              <label className="text-xs text-ios-tertiary mb-1 block">{t.stockName}</label>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder={t.stockName}
                className="field-input block w-full" />
            </div>
            <div>
              <label className="text-xs text-ios-tertiary mb-1 block">{t.category}</label>
              <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                className="field-input block w-full">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="text-xs text-ios-tertiary mb-1 block">{t.category}</label>
              <input value={selectedItem?.Category || '—'} readOnly
                className="field-input block w-full bg-gray-50 text-ios-tertiary" />
            </div>
            <div>
              <label className="text-xs text-ios-tertiary mb-1 block">{t.quantity} ({t.inStock})</label>
              <input value={selectedItem ? (selectedItem['Current Quantity'] || 0) : '—'} readOnly
                className="field-input block w-full bg-gray-50 text-ios-tertiary" />
            </div>
          </>
        )}
      </div>

      {/* Row 2: Quantity + Cost + Sell + Markup indicator */}
      <div className="grid grid-cols-4 gap-4">
        <div>
          <label className="text-xs text-ios-tertiary mb-1 block">{t.quantityReceived}</label>
          <input type="number" min="1" value={quantity}
            onChange={e => setQuantity(e.target.value)}
            className="field-input block w-full" />
        </div>
        <div>
          <label className="text-xs text-ios-tertiary mb-1 block">{t.costPrice} / {t.unit}</label>
          <input type="number" step="0.01" value={costPrice}
            onChange={e => handleCostChange(e.target.value)}
            className="field-input block w-full" />
        </div>
        <div>
          <label className="text-xs text-ios-tertiary mb-1 block">
            {t.sellPrice} / {t.unit}
            {computedMarkup && (
              <span className={`ml-2 text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
                Number(computedMarkup) >= targetMarkup
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700'
              }`}>
                ×{computedMarkup}
              </span>
            )}
          </label>
          <input type="number" step="0.01" value={sellPrice}
            onChange={e => handleSellPriceChange(e.target.value)}
            placeholder={costPrice && targetMarkup ? String(Math.round(Number(costPrice) * targetMarkup)) : '—'}
            className="field-input block w-full" />
        </div>
        {/* Totals */}
        <div className="flex flex-col justify-end">
          {qty > 0 && cost > 0 && (
            <div className="space-y-1 text-right">
              <div className="text-xs text-ios-tertiary">
                {t.costTotal}: <span className="font-semibold text-ios-label">{totalCost.toFixed(0)} {t.zl}</span>
              </div>
              {sell > 0 && (
                <div className="text-xs text-ios-tertiary">
                  {t.sellTotal}: <span className="font-semibold text-ios-green">{totalSell.toFixed(0)} {t.zl}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Supplier + Farmer + Notes */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="text-xs text-ios-tertiary mb-1 block">{t.supplier}</label>
          <select value={supplier} onChange={e => { setSupplier(e.target.value); setNewSupplier(''); }}
            className="field-input block w-full">
            <option value="">— {t.search} —</option>
            {allSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
            <option value={NEW_SUPPLIER_VALUE}>+ {t.addItem}</option>
          </select>
          {isNewSup && (
            <input value={newSupplier} onChange={e => setNewSupplier(e.target.value)}
              placeholder={t.supplier}
              className="field-input block w-full mt-1" />
          )}
        </div>
        <div>
          <label className="text-xs text-ios-tertiary mb-1 block">{t.farmer}</label>
          <input value={farmer} onChange={e => setFarmer(e.target.value)}
            placeholder="—"
            className="field-input block w-full" />
        </div>
        <div>
          <label className="text-xs text-ios-tertiary mb-1 block">{t.notes}</label>
          <input value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="—"
            className="field-input block w-full" />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving || !canSave}
          className="px-5 py-2 rounded-xl bg-ios-green text-white text-sm font-semibold disabled:opacity-50">
          {saving ? t.saving : t.save}
        </button>
        <button type="button" onClick={onDone}
          className="px-5 py-2 rounded-xl bg-white/50 text-sm">
          {t.cancel}
        </button>
      </div>
    </form>
  );
}
