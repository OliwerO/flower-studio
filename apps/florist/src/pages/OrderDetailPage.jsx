// OrderDetailPage — full-page order detail view.
// Replaces the bottom sheet approach which had CSS stacking context issues.
// A separate page is the most resilient pattern — no overlays, no z-index.

import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import useConfigLists from '../hooks/useConfigLists.js';
import { parseBatchName, renderStockName } from '@flower-studio/shared';

// Florist flow: New → Ready → Delivered/Picked Up.
// "Out for Delivery" is set automatically by drivers — florists don't need that button.
const ALLOWED_TRANSITIONS = {
  'New':              ['Ready', 'Cancelled'],
  'In Progress':      ['Ready', 'Cancelled'],
  'Ready':            ['Delivered', 'Picked Up', 'Cancelled'],
  'Out for Delivery': ['Delivered', 'Cancelled'],   // can still advance if driver started it
  'Delivered':        [],
  'Picked Up':        [],
  'Cancelled':        ['New'],
};

function Pills({ options, value, onChange, disabled }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => !disabled && onChange(o.value)}
          disabled={disabled}
          className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors active-scale disabled:opacity-40 ${
            value === o.value
              ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
              : 'bg-gray-100 text-ios-secondary border-gray-200 hover:bg-gray-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Edit bouquet section — mirrors Step2Bouquet's catalog + cart pattern.
// Shows available flowers with effective quantities, in-stock toggle, add-new-flower form.
function EditBouquetSection({
  editLines, setEditLines, editBudget, setEditBudget,
  removedLines, setRemovedLines, removeDialog, setRemoveDialog,
  flowerSearch, setFlowerSearch, stockItems, setStockItems,
  showOutOfStock, setShowOutOfStock,
  showCustomFlower, setShowCustomFlower, customFlower, setCustomFlower,
  configSuppliers, targetMarkup,
  saving, setSaving, orderId, showToast,
  setEditingBouquet, setAddingFlower, setOrder,
}) {
  const editSellTotal = editLines.reduce((s, l) => s + Number(l.sellPricePerUnit || 0) * Number(l.quantity || 0), 0);
  const budgetNum = Number(editBudget) || 0;
  const delta = budgetNum ? editSellTotal - budgetNum : 0;
  const overBudget = delta > 0;
  const underBudget = delta < 0;

  // Filter stock: hide depleted dated batches, apply search + in-stock toggle
  const dateBatchPattern = /\(\d{1,2}\.\w{3,4}\.?\)$/;
  const visibleStock = useMemo(() =>
    stockItems.filter(s => {
      const qty = Number(s['Current Quantity']) || 0;
      if (qty <= 0 && dateBatchPattern.test(s['Display Name'] || '')) return false;
      return true;
    }),
    [stockItems]
  );

  const catalogItems = useMemo(() => {
    let result = visibleStock;
    if (!showOutOfStock) {
      result = result.filter(s => (Number(s['Current Quantity']) || 0) > 0);
    }
    const q = flowerSearch.toLowerCase().trim();
    if (!q) return result;
    return result.filter(s =>
      (s['Display Name'] || '').toLowerCase().includes(q) ||
      (s['Category'] || '').toLowerCase().includes(q)
    );
  }, [visibleStock, flowerSearch, showOutOfStock]);

  function addFromCatalog(s) {
    const existing = editLines.findIndex(l => l.stockItemId === s.id);
    if (existing >= 0) {
      setEditLines(p => p.map((l, i) => i === existing ? { ...l, quantity: (Number(l.quantity) || 0) + 1 } : l));
    } else {
      setEditLines(p => [...p, {
        id: null, stockItemId: s.id, flowerName: s['Display Name'],
        quantity: 1, _originalQty: 0,
        costPricePerUnit: Number(s['Current Cost Price']) || 0,
        sellPricePerUnit: Number(s['Current Sell Price']) || 0,
      }]);
    }
  }

  function refreshStock() {
    client.get('/stock?includeEmpty=true').then(r => setStockItems(r.data)).catch(() => {});
  }

  return (
  <div className="space-y-3">

    {/* Budget + running sell total */}
    <div className="ios-card px-4 py-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ios-label">{t.sellTotal}</span>
        <span className="text-base font-bold text-brand-600">{editSellTotal.toFixed(0)} zł</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-ios-tertiary shrink-0">{t.budget}:</span>
        <input
          type="number"
          inputMode="numeric"
          value={editBudget}
          onChange={e => setEditBudget(e.target.value)}
          placeholder={editSellTotal > 0 ? String(Math.round(editSellTotal)) : '0'}
          className="flex-1 text-sm font-medium border border-gray-200 rounded-lg px-2 py-1 bg-white outline-none"
        />
        <span className="text-xs text-ios-tertiary shrink-0">zł</span>
        {budgetNum > 0 && (
          <span className={`text-xs font-bold shrink-0 ${overBudget ? 'text-red-500' : underBudget ? 'text-green-600' : 'text-ios-tertiary'}`}>
            {overBudget ? '+' : ''}{delta.toFixed(0)} zł
          </span>
        )}
      </div>
    </div>

    {/* Stock catalog — matches Step2Bouquet layout */}
    <div>
      <div className="flex items-center justify-between mb-1.5 px-1">
        <p className="ios-label !px-0 !mb-0">{t.searchFlowers}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowOutOfStock(v => !v)}
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${showOutOfStock ? 'bg-gray-200 text-ios-label' : 'bg-brand-50 text-brand-600'}`}
          >
            {showOutOfStock ? t.showAll : t.inStockOnly}
          </button>
          <button onClick={refreshStock} className="text-xs text-brand-600 font-medium">
            ↻ {t.refreshStock}
          </button>
        </div>
      </div>

      <div className="ios-card flex items-center px-4 gap-3 mb-2">
        <span className="text-ios-tertiary text-sm">🔍</span>
        <input
          type="text"
          value={flowerSearch}
          onChange={e => setFlowerSearch(e.target.value)}
          placeholder={t.flowerSearch}
          className="flex-1 py-3.5 text-base bg-transparent outline-none placeholder-ios-tertiary/50"
        />
        {flowerSearch && (
          <button onClick={() => setFlowerSearch('')} className="text-ios-tertiary text-sm">✕</button>
        )}
      </div>

      <div className="ios-card overflow-hidden divide-y divide-gray-100 max-h-64 overflow-y-auto">
        {/* Add unlisted flower option */}
        {flowerSearch.length >= 2 && !catalogItems.some(s => (s['Display Name'] || '').toLowerCase() === flowerSearch.toLowerCase()) && (
          <button
            type="button"
            onClick={() => {
              const existing = stockItems.find(s => (s['Display Name'] || '').toLowerCase() === flowerSearch.toLowerCase());
              if (existing) {
                addFromCatalog(existing);
                setFlowerSearch('');
              } else {
                setShowCustomFlower(true);
                setCustomFlower({ name: flowerSearch, supplier: '', costPrice: '', sellPrice: '', lotSize: '' });
              }
            }}
            className="w-full flex items-center px-4 py-3 gap-3 text-left bg-indigo-50/60 active:bg-indigo-100 transition-colors"
          >
            <span className="text-sm font-medium text-indigo-700">+ {t.addNewFlower || 'Add new'} "{flowerSearch}"</span>
          </button>
        )}
        {catalogItems.length === 0 && !showCustomFlower ? (
          <p className="text-ios-tertiary text-sm text-center py-8">{t.noStockFound || 'No items found'}</p>
        ) : (
          catalogItems.map(s => {
            const qty = Number(s['Current Quantity']) || 0;
            const sell = Number(s['Current Sell Price']) || 0;
            const inCart = editLines.find(l => l.stockItemId === s.id);
            const low = qty > 0 && qty <= (s['Reorder Threshold'] || 5);
            const out = qty <= 0;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => addFromCatalog(s)}
                className={`w-full flex items-center px-4 py-3 gap-3 text-left transition-colors active-scale
                            ${out ? 'bg-amber-50/60' : inCart ? 'bg-brand-50/70' : 'active:bg-gray-50'}`}
              >
                <div className="flex-1 min-w-0">
                  <div className={`text-base font-medium truncate ${inCart ? 'text-brand-700' : out ? 'text-amber-700' : 'text-ios-label'}`}>
                    {renderStockName(s['Display Name'], s['Last Restocked'])}
                  </div>
                  <div className="text-sm text-ios-tertiary">
                    <span className="font-bold text-brand-700">{sell.toFixed(0)} zł</span>
                    <span> · {qty} pcs</span>
                    {low && !out && <span className="text-ios-orange"> · low</span>}
                    {out && <span className="text-amber-600 font-medium"> · {t.outOfStock || 'out'}</span>}
                  </div>
                </div>
                {inCart && (
                  <span className="min-w-[24px] h-[24px] px-1.5 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">
                    {inCart.quantity}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>

    {/* Custom flower form — create new stock item + add to cart */}
    {showCustomFlower && (
      <div className="ios-card px-4 py-3 space-y-2">
        <p className="text-sm font-semibold text-ios-label">{t.addNewFlower || 'Add new flower'}</p>
        <input
          value={customFlower.name}
          onChange={e => setCustomFlower(p => ({ ...p, name: e.target.value }))}
          placeholder={t.flowerName || 'Flower name'}
          className="field-input w-full text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={customFlower.supplier}
            onChange={e => setCustomFlower(p => ({ ...p, supplier: e.target.value }))}
            className="field-input text-sm"
          >
            <option value="">{t.supplier || 'Supplier'}...</option>
            {configSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
            <option value="__other__">{t.otherSupplier || 'Other'}...</option>
          </select>
          {customFlower.supplier === '__other__' && (
            <input
              value={customFlower.customSupplier || ''}
              onChange={e => setCustomFlower(p => ({ ...p, customSupplier: e.target.value }))}
              placeholder={t.supplier || 'Supplier name'}
              className="field-input text-sm col-span-2"
            />
          )}
          <input
            type="number"
            value={customFlower.lotSize}
            onChange={e => setCustomFlower(p => ({ ...p, lotSize: e.target.value }))}
            placeholder={t.lotSize || 'Lot size'}
            className="field-input text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            value={customFlower.costPrice}
            onChange={e => {
              const cost = e.target.value;
              const updates = { costPrice: cost };
              if (cost && targetMarkup && !customFlower.sellPrice) {
                updates.sellPrice = String(Math.round(Number(cost) * targetMarkup));
              }
              setCustomFlower(p => ({ ...p, ...updates }));
            }}
            placeholder={`${t.costPrice || 'Cost price'} (zł)`}
            className="field-input text-sm"
          />
          <div className="flex flex-col">
            <input
              type="number"
              value={customFlower.sellPrice}
              onChange={e => setCustomFlower(p => ({ ...p, sellPrice: e.target.value }))}
              placeholder={`${t.sellPrice || 'Sell price'} (zł)`}
              className="field-input text-sm"
            />
            {customFlower.costPrice && targetMarkup && !customFlower.sellPrice && (
              <span className="text-[10px] text-ios-tertiary mt-0.5">
                {t.suggestedSellPrice}: {Math.round(Number(customFlower.costPrice) * targetMarkup)} zł
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={async () => {
              if (!customFlower.name.trim()) return;
              const supplierValue = customFlower.supplier === '__other__'
                ? (customFlower.customSupplier || '').trim()
                : customFlower.supplier || '';
              try {
                if (customFlower.supplier === '__other__' && supplierValue && !configSuppliers.some(s => s.toLowerCase() === supplierValue.toLowerCase())) {
                  client.put('/settings/config', { suppliers: [...configSuppliers, supplierValue] }).catch(() => {});
                }
                const res = await client.post('/stock', {
                  displayName: customFlower.name.trim(),
                  supplier: supplierValue,
                  costPrice: Number(customFlower.costPrice) || 0,
                  sellPrice: Number(customFlower.sellPrice) || 0,
                  lotSize: Number(customFlower.lotSize) || 1,
                  quantity: 0,
                });
                const newItem = res.data;
                addFromCatalog({
                  id: newItem.id,
                  'Display Name': newItem['Display Name'],
                  'Current Cost Price': newItem['Current Cost Price'] || 0,
                  'Current Sell Price': newItem['Current Sell Price'] || 0,
                });
                setShowCustomFlower(false);
                setFlowerSearch('');
                refreshStock();
              } catch {
                setEditLines(p => [...p, {
                  id: null, stockItemId: null,
                  flowerName: customFlower.name.trim(),
                  quantity: 1, _originalQty: 0,
                  costPricePerUnit: Number(customFlower.costPrice) || 0,
                  sellPricePerUnit: Number(customFlower.sellPrice) || 0,
                }]);
                setShowCustomFlower(false);
                setFlowerSearch('');
              }
            }}
            className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold active-scale"
          >
            {t.addToCart || 'Add to bouquet'}
          </button>
          <button
            type="button"
            onClick={() => setShowCustomFlower(false)}
            className="px-4 py-2.5 rounded-xl bg-gray-100 text-ios-secondary text-sm"
          >
            {t.cancel}
          </button>
        </div>
      </div>
    )}

    {/* Cart — current bouquet lines with steppers */}
    {editLines.length > 0 && (
      <div>
        <p className="ios-label">{t.bouquetContents || 'Bouquet'}</p>
        <div className="ios-card overflow-hidden divide-y divide-gray-100">
          {editLines.map((line, idx) => {
            const si = stockItems.find(s => s.id === line.stockItemId);
            const availableQty = Number(si?.['Current Quantity']) || 0;
            const lineSell = Number(line.sellPricePerUnit || 0) * Number(line.quantity || 0);
            const overStock = line.stockItemId && line.quantity > availableQty;
            const { name: parsedName, batch } = parseBatchName(line.flowerName);
            return (
            <div key={line.id || idx} className="flex flex-col px-4 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-ios-label truncate block">
                    {parsedName}
                    {batch && <span className="ml-1 text-[10px] font-normal text-ios-tertiary bg-gray-100 rounded px-1 py-0.5">{batch}</span>}
                  </span>
                  <span className="text-xs text-ios-tertiary">
                    {Number(line.sellPricePerUnit || 0).toFixed(0)} zł × {line.quantity} = <strong className="text-brand-700">{lineSell.toFixed(0)} zł</strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setEditLines(prev => prev.map((l, i) => i === idx ? { ...l, quantity: Math.max(1, (Number(l.quantity) || 1) - 1) } : l))}
                    className="w-7 h-7 rounded-full bg-gray-100 text-ios-secondary text-lg font-bold flex items-center justify-center active-scale"
                  >−</button>
                  <input type="number" min="1" value={line.quantity}
                    onChange={e => setEditLines(prev => prev.map((l, i) => i === idx ? { ...l, quantity: e.target.value === '' ? '' : (Number(e.target.value) || 0) } : l))}
                    onBlur={e => { if (!e.target.value || Number(e.target.value) < 1) setEditLines(prev => prev.map((l, i) => i === idx ? { ...l, quantity: 1 } : l)); }}
                    onFocus={e => e.target.select()}
                    className="w-9 text-center text-sm font-bold border border-gray-200 rounded-xl py-1 bg-white outline-none"
                  />
                  <button
                    onClick={() => setEditLines(prev => prev.map((l, i) => i === idx ? { ...l, quantity: (Number(l.quantity) || 0) + 1 } : l))}
                    className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-lg font-bold flex items-center justify-center active-scale"
                  >+</button>
                </div>
                <button onClick={() => setRemoveDialog(idx)} className="text-red-400 active:text-red-600 text-sm px-1">✕</button>
              </div>
              {overStock && (
                <div className="mt-1 text-xs text-amber-600 bg-amber-50 rounded-lg px-2 py-1">
                  {line.quantity - availableQty} {t.notInStock || 'not in stock'}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>
    )}

    {removeDialog != null && (() => {
      const line = editLines[removeDialog];
      const si = stockItems.find(s => s.id === line?.stockItemId);
      const currentQty = Number(si?.['Current Quantity'] ?? 0);
      const isNegativeStock = currentQty < 0;
      return (
      <div className={`${isNegativeStock ? 'bg-blue-50' : 'bg-amber-50'} rounded-xl px-3 py-2 space-y-2`}>
        <p className={`text-sm font-medium ${isNegativeStock ? 'text-blue-800' : 'text-amber-800'}`}>
          {line?.flowerName}: {isNegativeStock ? (t.notReceivedYet || 'Not received yet') : (t.returnOrWriteOff || 'Return or write off?')}
        </p>
        <div className="flex gap-2">
          <button onClick={() => {
            setRemovedLines(p => [...p, { lineId: line.id, stockItemId: line.stockItemId, quantity: line._originalQty, action: 'return' }]);
            setEditLines(p => p.filter((_, i) => i !== removeDialog));
            setRemoveDialog(null);
          }} className="flex-1 py-2 rounded-xl bg-green-600 text-white text-xs font-medium active-scale">
            {t.returnToStock || 'Return'}
          </button>
          {isNegativeStock ? (
            <button onClick={() => {
              setRemovedLines(p => [...p, { lineId: line.id, stockItemId: line.stockItemId, quantity: line._originalQty, action: 'return' }]);
              setEditLines(p => p.filter((_, i) => i !== removeDialog));
              setRemoveDialog(null);
              showToast(t.adjustPO || 'Adjust PO for this flower', 'info');
            }} className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-xs font-medium active-scale">
              {t.adjustPO || 'Adjust PO'}
            </button>
          ) : (
            <button onClick={() => {
              setRemovedLines(p => [...p, { lineId: line.id, stockItemId: line.stockItemId, quantity: line._originalQty, action: 'writeoff', reason: 'Bouquet edit' }]);
              setEditLines(p => p.filter((_, i) => i !== removeDialog));
              setRemoveDialog(null);
            }} className="flex-1 py-2 rounded-xl bg-amber-600 text-white text-xs font-medium active-scale">
              {t.writeOff || 'Write off'}
            </button>
          )}
        </div>
        <button onClick={() => setRemoveDialog(null)} className="text-xs text-ios-tertiary">{t.cancel}</button>
      </div>
      );
    })()}

    <div className="flex gap-2 pt-1">
      <button
        onClick={async () => {
          setSaving(true);
          try {
            await client.put(`/orders/${orderId}/lines`, { lines: editLines, removedLines });
            const budgetVal = Number(editBudget) || 0;
            if (budgetVal > 0) {
              await client.patch(`/orders/${orderId}`, { 'Price Override': budgetVal });
            }
            setEditingBouquet(false);
            setAddingFlower(false);
            setFlowerSearch('');
            setRemoveDialog(null);
            setShowCustomFlower(false);
            const res = await client.get(`/orders/${orderId}`);
            setOrder(res.data);
            showToast(t.bouquetUpdated);
          } catch (err) {
            showToast(err.response?.data?.error || t.error, 'error');
          } finally { setSaving(false); }
        }}
        disabled={saving}
        className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold active-scale"
      >{saving ? '...' : t.saveBouquet}</button>
      <button onClick={() => { setEditingBouquet(false); setRemoveDialog(null); setAddingFlower(false); setFlowerSearch(''); setShowCustomFlower(false); }}
        className="px-4 py-2.5 rounded-xl bg-gray-100 text-ios-secondary text-sm active-scale"
      >{t.cancel}</button>
    </div>
  </div>);
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-ios-tertiary shrink-0">{label}</span>
      <span className="text-sm text-ios-label text-right">{value}</span>
    </div>
  );
}

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { paymentMethods, suppliers: configSuppliers, targetMarkup } = useConfigLists();

  const [order, setOrder]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [editingBouquet, setEditingBouquet] = useState(false);
  const [editLines, setEditLines] = useState([]);
  const [removedLines, setRemovedLines] = useState([]);
  const [removeDialog, setRemoveDialog] = useState(null);
  const [addingFlower, setAddingFlower] = useState(false);
  const [flowerSearch, setFlowerSearch] = useState('');
  const [stockItems, setStockItems] = useState([]);
  const [editBudget, setEditBudget] = useState('');
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [showCustomFlower, setShowCustomFlower] = useState(false);
  const [customFlower, setCustomFlower] = useState({ name: '', supplier: '', costPrice: '', sellPrice: '', lotSize: '' });

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(false);
    client.get(`/orders/${id}`)
      .then(r => setOrder(r.data))
      .catch(() => {
        setError(true);
        showToast('Failed to load order.', 'error');
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function patch(fields) {
    setSaving(true);
    try {
      const res = await client.patch(`/orders/${id}`, fields);
      setOrder(prev => ({ ...prev, ...res.data }));
      showToast('Updated!', 'success');
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to update order.';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  const price      = order?.['Price Override'] || order?.['Sell Total'];
  const isPaid     = order?.['Payment Status'] === 'Paid';
  const isDelivery = order?.['Delivery Type'] === 'Delivery';
  const isTerminal = ['Delivered', 'Picked Up', 'Cancelled'].includes(order?.Status);

  return (
    <div className="min-h-screen">
      {/* Header with back button */}
      <header className="glass-nav px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center gap-3 max-w-2xl mx-auto">
          <button
            onClick={() => navigate('/orders')}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-ios-secondary text-sm active-scale hover:bg-gray-200"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-ios-label truncate">
              {order?.['Customer Name'] || '—'}
            </p>
            <p className="text-xs text-ios-tertiary">
              {order?.['Order Date']} · {isDelivery ? 'Delivery' : 'Pickup'}
              {price > 0 && ` · ${price} zł`}
            </p>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="px-4 py-4 max-w-2xl mx-auto flex flex-col gap-5 pb-24">

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : error || !order ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <p className="text-4xl">😕</p>
            <p className="text-ios-tertiary text-sm">Could not load order details.</p>
            <button
              onClick={() => navigate('/orders')}
              className="px-5 py-2 rounded-full bg-brand-600 text-white text-sm font-medium active-scale"
            >
              Back to orders
            </button>
          </div>
        ) : (
          <>
            {/* Customer info — who placed the order */}
            <div>
              <p className="ios-label">Customer</p>
              <div className="ios-card px-4 py-2">
                <Row label="Name" value={order['Customer Name']} />
                {order['Customer Nickname'] && order['Customer Nickname'] !== order['Customer Name'] && (
                  <Row label="Nickname" value={order['Customer Nickname']} />
                )}
                {order['Customer Phone'] && (
                  <div className="flex justify-between gap-4 py-2 border-b border-gray-100 last:border-0">
                    <span className="text-sm text-ios-tertiary shrink-0">Phone</span>
                    <a href={`tel:${order['Customer Phone']}`} className="text-sm text-brand-600 font-medium">
                      {order['Customer Phone']}
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Customer request */}
            {order['Customer Request'] && (
              <div className="ios-card px-4 py-3">
                <p className="text-xs text-ios-tertiary mb-1">Customer request</p>
                <p className="text-sm text-ios-label">{order['Customer Request']}</p>
              </div>
            )}

            {/* Order lines */}
            {order.orderLines?.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="ios-label !mb-0">{t.bouquetContents || 'Bouquet'}</p>
                  {!isTerminal && !editingBouquet && (
                    <button
                      onClick={() => {
                        setEditLines(order.orderLines.map(l => ({
                          id: l.id, stockItemId: l['Stock Item']?.[0] || null,
                          flowerName: l['Flower Name'], quantity: l.Quantity,
                          _originalQty: l.Quantity,
                          costPricePerUnit: l['Cost Price Per Unit'] || 0,
                          sellPricePerUnit: l['Sell Price Per Unit'] || 0,
                        })));
                        setRemovedLines([]);
                        setAddingFlower(false);
                        setFlowerSearch('');
                        setEditBudget(order['Price Override'] ? String(order['Price Override']) : '');
                        setEditingBouquet(true);
                        if (stockItems.length === 0) {
                          client.get('/stock?includeEmpty=true').then(r => setStockItems(r.data)).catch(() => {});
                        }
                      }}
                      className="text-xs text-brand-600 font-medium px-1"
                    >{t.editBouquet}</button>
                  )}
                </div>

                {editingBouquet ? (<EditBouquetSection
                  editLines={editLines} setEditLines={setEditLines}
                  editBudget={editBudget} setEditBudget={setEditBudget}
                  removedLines={removedLines} setRemovedLines={setRemovedLines}
                  removeDialog={removeDialog} setRemoveDialog={setRemoveDialog}
                  flowerSearch={flowerSearch} setFlowerSearch={setFlowerSearch}
                  stockItems={stockItems} setStockItems={setStockItems}
                  showOutOfStock={showOutOfStock} setShowOutOfStock={setShowOutOfStock}
                  showCustomFlower={showCustomFlower} setShowCustomFlower={setShowCustomFlower}
                  customFlower={customFlower} setCustomFlower={setCustomFlower}
                  configSuppliers={configSuppliers} targetMarkup={targetMarkup}
                  saving={saving} setSaving={setSaving}
                  orderId={id} showToast={showToast}
                  setEditingBouquet={setEditingBouquet}
                  setAddingFlower={setAddingFlower}
                  setOrder={setOrder}
                />) : (
                  <div className="ios-card overflow-hidden divide-y divide-gray-100">
                    {order.orderLines.map((line, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-ios-label">{line['Flower Name']}</p>
                          <p className="text-xs text-ios-tertiary">
                            {line['Sell Price Per Unit']} zł × {line['Quantity']}
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-brand-600">
                          {(Number(line['Sell Price Per Unit'] || 0) * Number(line['Quantity'] || 0)).toFixed(0)} zł
                        </p>
                      </div>
                    ))}
                    <div className="flex justify-between px-4 py-3 bg-brand-50/50">
                      <span className="text-sm text-ios-tertiary">Total</span>
                      <span className="text-sm font-bold text-brand-600">
                        {price > 0 ? `${price} zł` : '—'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Delivery details */}
            {isDelivery && (
              <div>
                <p className="ios-label">Delivery</p>
                <div className="ios-card px-4 py-2">
                  <Row label="Date"      value={order.delivery?.['Delivery Date']} />
                  <Row label="Time"      value={order.delivery?.['Delivery Time']} />
                  <Row label="Address"   value={order.delivery?.['Delivery Address']} />
                  <Row label="Recipient" value={order.delivery?.['Recipient Name']} />
                  {order.delivery?.['Recipient Phone'] && (
                    <div className="flex justify-between gap-4 py-2 border-b border-gray-100 last:border-0">
                      <span className="text-sm text-ios-tertiary shrink-0">Phone</span>
                      <a href={`tel:${order.delivery['Recipient Phone']}`} className="text-sm text-brand-600 font-medium">
                        {order.delivery['Recipient Phone']}
                      </a>
                    </div>
                  )}
                  <Row label="Card msg"  value={order['Greeting Card Text']} />
                  <Row label="Fee"       value={order.delivery?.['Delivery Fee'] ? `${order.delivery['Delivery Fee']} zł` : null} />
                </div>
              </div>
            )}

            {/* Pickup details */}
            {!isDelivery && order['Required By'] && (
              <div>
                <p className="ios-label">Pickup</p>
                <div className="ios-card px-4 py-2">
                  <Row label="Pickup time" value={order['Required By']} />
                </div>
              </div>
            )}

            {/* Status */}
            <div>
              <p className="ios-label">Status</p>
              <div className="ios-card p-4">
                {(() => {
                  const current = order['Status'] || 'New';
                  const allowed = ALLOWED_TRANSITIONS[current] || [];
                  const visible = [current, ...allowed];
                  return (
                    <Pills
                      value={current}
                      onChange={val => patch({ 'Status': val })}
                      disabled={saving}
                      options={visible.map(s => ({ value: s, label: s }))}
                    />
                  );
                })()}
              </div>
            </div>

            {/* Payment */}
            <div>
              <p className="ios-label">Payment</p>
              <div className="ios-card p-4 flex flex-col gap-3">
                <Pills
                  value={order['Payment Status'] || 'Unpaid'}
                  onChange={val => patch({
                    'Payment Status': val,
                    ...(val === 'Unpaid' ? { 'Payment Method': '' } : {}),
                  })}
                  disabled={saving}
                  options={[
                    { value: 'Unpaid', label: 'Unpaid' },
                    { value: 'Paid',   label: 'Paid' },
                    { value: 'Partial', label: t.paymentPartial || 'Partial' },
                  ]}
                />
                {(isPaid || order['Payment Status'] === 'Partial') && (
                  <Pills
                    value={order['Payment Method'] || ''}
                    onChange={val => patch({ 'Payment Method': val })}
                    disabled={saving}
                    options={paymentMethods.map(m => ({ value: m, label: m }))}
                  />
                )}
              </div>
            </div>

            {/* Source + notes */}
            {(order['Source'] || order['Notes Original']) && (
              <div>
                <p className="ios-label">Info</p>
                <div className="ios-card px-4 py-2">
                  <Row label="Source" value={order['Source']} />
                  <Row label="Notes"  value={order['Notes Original']} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
