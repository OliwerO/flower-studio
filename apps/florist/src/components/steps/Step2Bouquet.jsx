// Step2Bouquet — catalog tap-to-add above, cart stepper below.
//
// Catalog rows are fully tappable (not just the + button).
// Selected items get a brand tint so you can see at a glance what's in the bouquet.
// Cart lines show only sell-price math. Cost + margin appear in the totals summary.

import { useState, useMemo, useEffect, useRef } from 'react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import t from '../../translations.js';
import useConfigLists from '../../hooks/useConfigLists.js';
import { renderStockName } from '@flower-studio/shared';

// Isolated cart row — holds local input state so typing multi-digit numbers
// doesn't re-render the parent and kill focus. Like a sub-assembly station
// that buffers its output before sending it down the line.
// Confidence border colors for AI-matched import lines
const CONFIDENCE_STYLES = {
  high: 'border-l-4 border-l-green-400',
  low:  'border-l-4 border-l-amber-400',
  none: 'border-l-4 border-l-red-300',
};

function CartLine({ line: l, stock, onChangeQty, onCommitQty, onRemove, isFutureOrder, onToggleDeferred, pendingPO }) {
  const stockItem = stock.find(s => s.id === l.stockItemId);
  const availableQty = Number(stockItem?.['Current Quantity']) || 0;
  const sellPrice = Number(stockItem?.['Current Sell Price'] ?? l.sellPricePerUnit);
  const lineSell  = sellPrice * Number(l.quantity);
  const confidence = l.confidence; // 'high' | 'low' | 'none' | undefined
  // Don't show over-stock warning for deferred lines (they don't pull from inventory)
  const overStock = l.stockItemId && !l.stockDeferred && l.quantity > availableQty;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');

  function handleFocus(e) {
    setEditing(true);
    setDraft(String(l.quantity));
    e.target.select();
  }

  function handleBlur() {
    setEditing(false);
    onCommitQty(l.stockItemId || l.flowerName, draft);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') e.target.blur();
  }

  return (
    <div className={`flex flex-col px-4 py-3 ${confidence ? CONFIDENCE_STYLES[confidence] || '' : ''}`}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-ios-label truncate">{l.flowerName}</span>
            {confidence === 'low' && <span className="text-amber-500 text-xs" title={t.intake?.confidenceLow}>?</span>}
            {confidence === 'none' && <span className="text-red-400 text-xs" title={t.intake?.confidenceNone}>✗</span>}
            {isFutureOrder && (
              <button
                type="button"
                onClick={() => onToggleDeferred(l.stockItemId || l.flowerName)}
                className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide transition-colors ${
                  l.stockDeferred
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-green-100 text-green-700'
                }`}
              >
                {l.stockDeferred ? (t.orderNew || 'New') : (t.useStock || 'Stock')}
              </button>
            )}
          </div>
          <div className="text-xs text-ios-tertiary">
            {sellPrice.toFixed(0)} zł × {l.quantity} = <strong className="text-brand-700">{lineSell.toFixed(0)} zł</strong>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onChangeQty(l.stockItemId || l.flowerName, -1)}
            className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 text-xl font-bold
                       flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 active-scale"
          >
            −
          </button>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={editing ? draft : l.quantity}
            onChange={e => setDraft(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="w-9 text-center text-sm font-bold border border-gray-200 rounded-xl py-1 bg-white outline-none"
          />
          <button
            onClick={() => onChangeQty(l.stockItemId || l.flowerName, +1)}
            className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xl font-bold
                       flex items-center justify-center active:bg-brand-200 active-scale"
          >
            +
          </button>
          <button onClick={() => onRemove(l.stockItemId || l.flowerName)}
                  className="text-ios-tertiary text-base ml-1 active:text-ios-red px-1">
            ✕
          </button>
        </div>
      </div>
      {overStock && (() => {
        const linePoQty = l.stockItemId ? (pendingPO?.[l.stockItemId]?.ordered || 0) : 0;
        return (
          <div className={`mt-1 text-xs rounded-lg px-2 py-1 ${linePoQty > 0 ? 'text-blue-700 bg-blue-50' : 'text-amber-600 bg-amber-50'}`}>
            {l.quantity - availableQty} {t.notInStock || 'not in stock'}
            {linePoQty > 0 && <span> · +{linePoQty} {t.onOrder || 'on order'}</span>}
          </div>
        );
      })()}
    </div>
  );
}

export default function Step2Bouquet({
  customerRequest, orderLines, priceOverride, stock, onStockRefresh,
  onChange, onLinesChange, requiredBy, isOwner,
}) {
  const { showToast } = useToast();
  // Determine if the order is for a future date (not today).
  // Future orders allow toggling between "use current stock" and "order new" per line.
  const isFutureOrder = (() => {
    if (!requiredBy) return false;
    const today = new Date().toISOString().split('T')[0];
    return requiredBy > today;
  })();
  const { suppliers: configSuppliers, targetMarkup } = useConfigLists();
  const [flowerQuery, setFlowerQuery] = useState('');
  const [showCost, setShowCost]       = useState(false);
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [showCustomFlower, setShowCustomFlower] = useState(false);
  const [customFlower, setCustomFlower] = useState({ name: '', supplier: '', costPrice: '', sellPrice: '', lotSize: '' });
  const [pendingPO, setPendingPO]     = useState({});

  // Fetch pending PO quantities so florists can see what's coming
  useEffect(() => {
    client.get('/stock/pending-po').then(r => setPendingPO(r.data)).catch(() => {});
  }, []);

  // Keep order line price snapshots in sync with current stock prices.
  // When stock data refreshes (e.g. after editing sell price), update the
  // snapshotted prices so the submitted order uses the latest values.
  const stockRef = useRef(stock);
  useEffect(() => {
    if (stock === stockRef.current) return;
    stockRef.current = stock;
    if (orderLines.length === 0 || stock.length === 0) return;
    let changed = false;
    const updated = orderLines.map(l => {
      if (!l.stockItemId) return l;
      const si = stock.find(x => x.id === l.stockItemId);
      if (!si) return l;
      const newCost = Number(si['Current Cost Price']) || 0;
      const newSell = Number(si['Current Sell Price']) || 0;
      if (newCost !== l.costPricePerUnit || newSell !== l.sellPricePerUnit) {
        changed = true;
        return { ...l, costPricePerUnit: newCost, sellPricePerUnit: newSell };
      }
      return l;
    });
    if (changed) onLinesChange(() => updated);
  }, [stock, orderLines, onLinesChange]);

  // Use current stock prices for display totals (snapshot happens at submit)
  const costTotal = useMemo(
    () => orderLines.reduce((s, l) => {
      const si = stock.find(x => x.id === l.stockItemId);
      return s + Number(si?.['Current Cost Price'] ?? l.costPricePerUnit) * Number(l.quantity);
    }, 0),
    [orderLines, stock]
  );
  const sellTotal = useMemo(
    () => orderLines.reduce((s, l) => {
      const si = stock.find(x => x.id === l.stockItemId);
      return s + Number(si?.['Current Sell Price'] ?? l.sellPricePerUnit) * Number(l.quantity);
    }, 0),
    [orderLines, stock]
  );
  const margin = sellTotal > 0 ? Math.round(((sellTotal - costTotal) / sellTotal) * 100) : 0;

  // Filter stock: hide depleted dated batches (e.g. "Rose Red (14.Mar.)" with qty 0).
  // Show dated batches only when they have stock — useful for choosing which batch to use.
  // Always show the base flower name even at qty 0 (for negative stock / future ordering).
  const visibleStock = useMemo(() => {
    const dateBatchPattern = /\(\d{1,2}\.\w{3,4}\.?\)$/;
    return stock.filter(s => {
      const qty = Number(s['Current Quantity']) || 0;
      const name = s['Display Name'] || '';
      if (qty <= 0 && dateBatchPattern.test(name)) return false;
      return true;
    });
  }, [stock]);

  const filteredStock = useMemo(() => {
    let result = visibleStock;
    // #39: Filter to show only in-stock items by default,
    // but always show items with pending PO quantities (they're coming)
    if (!showOutOfStock) {
      result = result.filter(s =>
        (Number(s['Current Quantity']) || 0) > 0 || (pendingPO[s.id]?.ordered || 0) > 0
      );
    }
    const q = flowerQuery.toLowerCase().trim();
    if (!q) return result;
    return result.filter(s =>
      (s['Display Name'] || '').toLowerCase().includes(q) ||
      (s['Category'] || '').toLowerCase().includes(q)
    );
  }, [visibleStock, flowerQuery, showOutOfStock, pendingPO]);

  function addOne(stockItem) {
    onLinesChange(lines => {
      const exists = lines.find(l => l.stockItemId === stockItem.id);
      if (exists) {
        return lines.map(l =>
          l.stockItemId === stockItem.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [...lines, {
        stockItemId:      stockItem.id,
        flowerName:       stockItem['Display Name'],
        quantity:         1,
        costPricePerUnit: Number(stockItem['Current Cost Price']) || 0,
        sellPricePerUnit: Number(stockItem['Current Sell Price']) || 0,
        stockDeferred:    isFutureOrder,
      }];
    });
  }

  // lineKey can be stockItemId or flowerName (for unmatched imports)
  function matchesKey(line, key) {
    return line.stockItemId === key || (!line.stockItemId && line.flowerName === key);
  }

  function lineKey(line) {
    return line.stockItemId || line.flowerName;
  }

  function changeQty(key, delta) {
    onLinesChange(lines =>
      lines
        .map(l => matchesKey(l, key)
          ? { ...l, quantity: l.quantity + delta }
          : l
        )
        .filter(l => l.quantity > 0)
    );
  }

  // Commit a typed quantity value — called on blur (not on every keystroke).
  // This lets the florist type multi-digit numbers without losing focus.
  function commitQty(key, value) {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 0) return;
    onLinesChange(lines =>
      n === 0
        ? lines.filter(l => !matchesKey(l, key))
        : lines.map(l => matchesKey(l, key) ? { ...l, quantity: n } : l)
    );
  }

  function removeLine(key) {
    onLinesChange(lines => lines.filter(l => !matchesKey(l, key)));
  }

  function toggleDeferred(key) {
    onLinesChange(lines =>
      lines.map(l => matchesKey(l, key) ? { ...l, stockDeferred: !l.stockDeferred } : l)
    );
  }

  return (
    <div className="flex flex-col gap-6">

      {/* Customer request */}
      <div>
        <p className="ios-label">{t.customerRequest}</p>
        <div className="ios-card px-4 py-3">
          <textarea
            value={customerRequest}
            onChange={e => onChange({ customerRequest: e.target.value })}
            placeholder={t.requestPlaceholder}
            rows={3}
            className="w-full text-base text-ios-label bg-transparent outline-none resize-none placeholder-ios-tertiary/50"
          />
        </div>
      </div>

      {/* ── Catalog — tap entire row to add ── */}
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
            <button onClick={onStockRefresh} className="text-xs text-brand-600 font-medium">
              ↻ {t.refreshStock}
            </button>
          </div>
        </div>

        <div className="ios-card flex items-center px-4 gap-3 mb-2">
          <span className="text-ios-tertiary text-sm">🔍</span>
          <input
            type="text"
            value={flowerQuery}
            onChange={e => setFlowerQuery(e.target.value)}
            placeholder={t.flowerSearch}
            className="flex-1 py-3.5 text-base bg-transparent outline-none placeholder-ios-tertiary/50"
          />
          {flowerQuery && (
            <button onClick={() => setFlowerQuery('')} className="text-ios-tertiary text-sm">✕</button>
          )}
        </div>

        <div className="ios-card overflow-hidden divide-y divide-gray-100 max-h-64 overflow-y-auto">
          {/* Add unlisted flower — for flowers not yet in the stock catalog.
              Check against filteredStock (not full stock) so out-of-stock flowers
              hidden by the "In stock only" filter still show the "Add new" option. */}
          {flowerQuery.length >= 2 && !filteredStock.some(s => (s['Display Name'] || '').toLowerCase() === flowerQuery.toLowerCase()) && (
            <button
              type="button"
              onClick={() => {
                // If an exact match exists in stock but is just out of stock, add it directly
                const existing = stock.find(s => (s['Display Name'] || '').toLowerCase() === flowerQuery.toLowerCase());
                if (existing) {
                  addOne(existing);
                  setFlowerQuery('');
                } else {
                  setShowCustomFlower(true);
                  setCustomFlower({ name: flowerQuery, supplier: '', costPrice: '', sellPrice: '', lotSize: '' });
                }
              }}
              className="w-full flex items-center px-4 py-3 gap-3 text-left bg-indigo-50/60 active:bg-indigo-100 transition-colors"
            >
              <span className="text-sm font-medium text-indigo-700">+ {t.addNewFlower || 'Add new'} "{flowerQuery}"</span>
            </button>
          )}
          {filteredStock.length === 0 && !showCustomFlower ? (
            <p className="text-ios-tertiary text-sm text-center py-8">{t.noStockFound}</p>
          ) : (
            filteredStock.map(s => {
              const qty    = Number(s['Current Quantity']) || 0;
              const inCart = orderLines.find(l => l.stockItemId === s.id);
              const low    = qty > 0 && qty <= (s['Reorder Threshold'] || 5);
              const out    = qty <= 0;
              const poQty  = pendingPO[s.id]?.ordered || 0;

              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => addOne(s)}
                  className={`w-full flex items-center px-4 py-3 gap-3 text-left transition-colors active-scale
                              ${out ? 'bg-amber-50/60' : inCart ? 'bg-brand-50/70' : 'active:bg-gray-50'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className={`text-base font-medium truncate ${inCart ? 'text-brand-700' : out ? 'text-amber-700' : 'text-ios-label'}`}>
                      {renderStockName(s['Display Name'], s['Last Restocked'])}
                    </div>
                    <div className="text-sm text-ios-tertiary">
                      <span className="font-bold text-brand-700">{Number(s['Current Sell Price']).toFixed(0)} zł</span>
                      {isOwner && <span> · {Number(s['Current Cost Price']).toFixed(0)} zł {t.costPrice}</span>}
                      <span> · {qty} pcs</span>
                      {low && !out && <span className="text-ios-orange"> · low</span>}
                      {out && !poQty && <span className="text-amber-600 font-medium"> · {t.outOfStock || 'out'}</span>}
                      {poQty > 0 && <span className="text-blue-600 font-medium"> · +{poQty} {t.onOrder || 'on order'}</span>}
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

      {/* ── Custom flower form — create new stock item + add to cart ── */}
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
                // #40: Auto-suggest sell price = cost × targetMarkup
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
                  // If new supplier entered, persist to settings for future use
                  if (customFlower.supplier === '__other__' && supplierValue && !configSuppliers.some(s => s.toLowerCase() === supplierValue.toLowerCase())) {
                    client.put('/settings/config', { suppliers: [...configSuppliers, supplierValue] }).catch(() => {});
                  }
                  const res = await client.post('/stock', {
                    displayName: customFlower.name.trim(),
                    supplier: supplierValue,
                    costPrice: Number(customFlower.costPrice) || 0,
                    sellPrice: Number(customFlower.sellPrice) || 0,
                    ...(Number(customFlower.lotSize) > 1 ? { lotSize: Number(customFlower.lotSize) } : {}),
                    quantity: 0,
                  });
                  const newItem = res.data;
                  addOne({
                    id: newItem.id,
                    'Display Name': newItem['Display Name'],
                    'Current Cost Price': newItem['Current Cost Price'] || 0,
                    'Current Sell Price': newItem['Current Sell Price'] || 0,
                  });
                  setShowCustomFlower(false);
                  setFlowerQuery('');
                  onStockRefresh();
                } catch (err) {
                  // Show error — do NOT fall back to text-only line.
                  // Every flower in an order must have a stock record for stock tracking to work.
                  const msg = err.response?.data?.error || t.error;
                  showToast(msg, 'error');
                }
              }}
              className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold active-scale"
            >
              {t.addToCart || 'Add to bouquet'}
            </button>
            <button
              type="button"
              onClick={() => setShowCustomFlower(false)}
              className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 text-sm"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {/* ── Cart ── */}
      {orderLines.length > 0 && (
        <div>
          <p className="ios-label">{t.bouquetContents}</p>
          <div className="ios-card overflow-hidden divide-y divide-gray-100">
            {orderLines.map(l => (
              <CartLine
                key={lineKey(l)}
                line={l}
                stock={stock}
                onChangeQty={(key, delta) => changeQty(key, delta)}
                onCommitQty={(key, val) => commitQty(key, val)}
                onRemove={(key) => removeLine(key)}
                isFutureOrder={isFutureOrder}
                onToggleDeferred={(key) => toggleDeferred(key)}
                pendingPO={pendingPO}
              />
            ))}
          </div>

          {/* Totals — tap to toggle cost/margin visibility (owner only) */}
          <button
            key={`totals-${costTotal}-${sellTotal}`}
            type="button"
            onClick={() => isOwner && setShowCost(v => !v)}
            className="w-full mt-2 ios-card px-4 py-3 text-left active-scale transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-ios-label font-semibold">{t.sellTotal}</span>
              <span className="text-base font-bold text-brand-600">{sellTotal.toFixed(0)} zł</span>
            </div>
            {isOwner && showCost && (
              <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-gray-100">
                <span className="text-xs text-ios-tertiary">{t.costTotal}: (Margin: {margin}%)</span>
                <span className="text-xs text-ios-tertiary font-medium">{costTotal.toFixed(0)} zł</span>
              </div>
            )}
          </button>
        </div>
      )}

      {/* Price override */}
      <div>
        <p className="ios-label">{t.priceOverride}</p>
        <div className="ios-card flex items-center px-4">
          <input
            type="number"
            value={priceOverride}
            onChange={e => onChange({ priceOverride: e.target.value })}
            placeholder={sellTotal > 0 ? String(Math.round(sellTotal)) : '0'}
            className="flex-1 py-3.5 text-base text-ios-label bg-transparent outline-none placeholder-ios-tertiary/50"
          />
          <span className="text-ios-tertiary text-sm shrink-0 pr-1">zł</span>
        </div>
      </div>
    </div>
  );
}
