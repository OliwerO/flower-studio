// ReceiveStockForm — records incoming supplier deliveries.
// Florists can select an existing item OR quick-add a new one on the spot.

import { useState } from 'react';
import client from '../api/client.js';
import { renderStockName, NewVarietyFields, VarietyResolveNotice } from '@flower-studio/shared';
import t from '../translations.js';
import useConfigLists from '../hooks/useConfigLists.js';
import { useToast } from '../context/ToastContext.jsx';

const NEW_ITEM_VALUE = '__new__';
const NEW_SUPPLIER_VALUE = '__new_supplier__';

function Row({ label, children }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 last:border-0">
      <span className="text-sm text-ios-tertiary w-28 shrink-0">{label}</span>
      <div className="flex-1 text-right">{children}</div>
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder || '—'}
      className="w-full text-base text-ios-label bg-transparent outline-none placeholder-ios-tertiary/50 text-right"
    />
  );
}

export default function ReceiveStockForm({ stock, onSave, onCancel }) {
  const { categories: CATEGORIES, suppliers: configSuppliers } = useConfigLists();
  const [stockItemId, setStockItemId] = useState('');
  const [newCategory, setNewCategory] = useState('Other');
  const [newAttrs, setNewAttrs]       = useState({ typeName: '', colour: '', sizeCm: '', cultivar: '' });
  // Resolution of the 4-tuple against loaded stock (#604) — the flower's NAME
  // comes from here, never from a free-typed box.
  const [resolution, setResolution]   = useState({ state: 'none', match: null, resolvedName: '' });
  const [varietyConfirmed, setVarietyConfirmed] = useState(false);
  const [search, setSearch]           = useState('');
  const [qty, setQty]                 = useState('');
  const [price, setPrice]             = useState('');
  const [sellPrice, setSellPrice]     = useState('');
  const [supplierId, setSupplierId]   = useState('');
  const [newSupplier, setNewSupplier] = useState('');
  const [saving, setSaving]           = useState(false);
  const { showToast } = useToast();

  // Unique supplier names from existing stock items + config list
  const knownSuppliers = [...new Set([
    ...stock.map(s => s['Supplier']).filter(Boolean),
    ...configSuppliers,
  ])];

  const isNewSupplier = supplierId === NEW_SUPPLIER_VALUE;
  const supplierValue = isNewSupplier ? newSupplier.trim() : supplierId;

  const isNew = stockItemId === NEW_ITEM_VALUE;
  // Type is required and no longer falls back to the typed name — that fallback
  // is what produced cards whose Type is `Pink Peonies` (#562).
  const canSave = isNew
    ? Boolean(qty) && resolution.state !== 'none' && (resolution.state !== 'new' || varietyConfirmed)
    : Boolean(stockItemId && qty);

  // The list is every flower she owns; without a filter, finding one on a phone
  // means scrolling past all of them, which is why creating felt faster.
  const q = search.trim().toLowerCase();
  const visibleStock = q
    ? stock.filter(s => (s['Display Name'] || '').toLowerCase().includes(q))
    : stock;

  async function handleSubmit() {
    if (!canSave) return;
    setSaving(true);
    try {
      let itemId = stockItemId;

      if (isNew) {
        // Create the stock item first, then log receipt
        const sizeRaw = newAttrs.sizeCm;
        const res = await client.post('/stock', {
          // Derived from the classification — a name and a 4-tuple that
          // disagree is the #558 divergence class.
          displayName: resolution.resolvedName,
          category:    newCategory,
          typeName:    (newAttrs.typeName ?? '').trim(),
          colour:      (newAttrs.colour ?? '').trim() || null,
          sizeCm:      sizeRaw !== '' && sizeRaw != null ? Number(sizeRaw) : null,
          cultivar:    (newAttrs.cultivar ?? '').trim() || null,
          quantity:    0,
          costPrice:   Number(price) || 0,
          sellPrice:   Number(sellPrice) || 0,
          supplier:    supplierValue || undefined,
          // Only a confirmed create bypasses the server's duplicate guard (#603).
          ...(resolution.state === 'new' && varietyConfirmed ? { newVariety: true } : {}),
        });
        itemId = res.data.id;
      }

      await onSave({
        stockItemId:       itemId,
        supplierName:      supplierValue,
        quantityPurchased: Number(qty),
        pricePerUnit:      Number(price) || 0,
        sellPricePerUnit:  Number(sellPrice) || 0,
        notes:             '',
      });

      // If genuinely new supplier, persist to settings so it's available everywhere
      if (isNewSupplier && supplierValue && !configSuppliers.some(s => s.toLowerCase() === supplierValue.toLowerCase())) {
        client.put('/settings/config', { suppliers: [...configSuppliers, supplierValue] })
          .catch(err => console.error('Failed to persist new supplier:', err));
      }
    } catch (err) {
      console.error('ReceiveStockForm error:', err);
      showToast(err.response?.data?.error || t.receiveError, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Flower selection */}
      <div>
        <p className="ios-label">{t.searchFlowers}</p>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t.searchFlowers}
          className="w-full mb-2 text-base border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none"
          data-testid="receive-search"
        />
        <div className="ios-card overflow-hidden divide-y divide-gray-100">
          {visibleStock.map(s => (
            <button
              key={s.id}
              onClick={() => setStockItemId(s.id)}
              className={`w-full text-left px-4 py-3.5 flex items-center justify-between transition-colors ${
                stockItemId === s.id ? 'bg-brand-50' : 'active:bg-ios-fill'
              }`}
            >
              <span className="text-base text-ios-label">{renderStockName(s['Display Name'], s['Last Restocked'])}</span>
              {stockItemId === s.id && <span className="text-brand-600 text-lg">✓</span>}
            </button>
          ))}
          <button
            onClick={() => setStockItemId(NEW_ITEM_VALUE)}
            className={`w-full text-left px-4 py-3.5 flex items-center justify-between transition-colors ${
              isNew ? 'bg-brand-50' : 'active:bg-ios-fill'
            }`}
          >
            <span className={`text-base font-medium ${isNew ? 'text-brand-600' : 'text-ios-secondary'}`}>
              {t.newStockItem}
            </span>
            {isNew && <span className="text-brand-600 text-lg">✓</span>}
          </button>
        </div>
      </div>

      {/* New item name + category */}
      {isNew && (
        <div>
          <p className="ios-label">{t.newItemName}</p>
          <div className="ios-card overflow-hidden divide-y divide-gray-100">
            <Row label={t.newItemCategory}>
              <select
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                className="text-base text-ios-label bg-transparent outline-none"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Row>
          </div>
          <div className="mt-2 space-y-2">
            <NewVarietyFields
              form={newAttrs}
              onChange={setNewAttrs}
              t={t}
              stockItems={stock}
            />
            <VarietyResolveNotice
              form={newAttrs}
              stockItems={stock}
              confirmed={varietyConfirmed}
              onConfirmedChange={setVarietyConfirmed}
              onResolve={setResolution}
              t={t}
            />
          </div>
        </div>
      )}

      {/* Receipt details — only show once item is selected */}
      {stockItemId && (
        <div>
          <p className="ios-label">Receipt details</p>
          <div className="ios-card overflow-hidden divide-y divide-gray-100">
            <Row label={t.quantityReceived}>
              <TextInput type="number" value={qty} onChange={setQty} placeholder="0" />
            </Row>
            <Row label={`Cost price (zł)`}>
              <TextInput type="number" value={price} onChange={setPrice} placeholder="0.00" />
            </Row>
            <Row label={`Sell price (zł)`}>
              <TextInput type="number" value={sellPrice} onChange={setSellPrice} placeholder="0.00" />
            </Row>
          </div>
        </div>
      )}

      {/* Supplier selection */}
      {stockItemId && (
        <div>
          <p className="ios-label">{t.supplier}</p>
          <div className="ios-card p-4 flex flex-wrap gap-2">
            {knownSuppliers.map(s => (
              <button
                key={s}
                onClick={() => setSupplierId(s)}
                className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors active-scale ${
                  supplierId === s
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {s}
              </button>
            ))}
            <button
              onClick={() => setSupplierId(NEW_SUPPLIER_VALUE)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors active-scale ${
                isNewSupplier
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              + New
            </button>
          </div>
          {isNewSupplier && (() => {
            // Fuzzy-match: find existing suppliers similar to what user is typing
            const trimmed = newSupplier.trim().toLowerCase();
            const suggestion = trimmed.length >= 2
              ? configSuppliers.find(s => {
                  const sl = s.toLowerCase();
                  return sl !== trimmed && (sl.startsWith(trimmed) || trimmed.startsWith(sl));
                })
              : null;
            return (
              <div className="ios-card mt-2 px-4 py-3 space-y-2">
                <TextInput value={newSupplier} onChange={setNewSupplier} placeholder="Supplier name" />
                {suggestion && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-amber-600">{t.didYouMean}: "{suggestion}"?</span>
                    <button
                      type="button"
                      onClick={() => { setSupplierId(suggestion); setNewSupplier(''); }}
                      className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full"
                    >{t.useThis}</button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 h-12 rounded-2xl bg-ios-fill2 text-ios-secondary font-medium active-scale"
        >
          {t.cancel}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSave || saving}
          className="flex-1 h-12 rounded-2xl bg-brand-600 text-white font-semibold
                     disabled:opacity-30 active:bg-brand-700 shadow-sm active-scale"
        >
          {saving ? t.saving : t.save}
        </button>
      </div>
    </div>
  );
}
