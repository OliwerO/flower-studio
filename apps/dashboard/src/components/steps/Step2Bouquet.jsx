// Step2Bouquet — catalog tap-to-add above, cart stepper below.

import { useState, useMemo } from 'react';
import client from '../../api/client.js';
import t from '../../translations.js';
import { useToast } from '../../context/ToastContext.jsx';
import useConfigLists from '../../hooks/useConfigLists.js';
import { renderStockName } from '@flower-studio/shared';

export default function Step2Bouquet({
  customerRequest, orderLines, priceOverride, stock, onStockRefresh,
  onChange, onLinesChange, requiredBy,
  // Premade-bouquet match mode — mirrors the florist app.
  premadeBouquets = null,
  matchPremadeId = null,
  onSelectPremade = null,
  onUnlinkPremade = null,
}) {
  const premadeLocked = !!matchPremadeId;
  const lockedBouquet = premadeLocked && Array.isArray(premadeBouquets)
    ? premadeBouquets.find(b => b.id === matchPremadeId)
    : null;
  // Determine if the order is for a future date (not today).
  const isFutureOrder = (() => {
    if (!requiredBy) return false;
    const today = new Date().toISOString().split('T')[0];
    return requiredBy > today;
  })();
  const { targetMarkup } = useConfigLists();
  const { showToast } = useToast();
  const [flowerQuery, setFlowerQuery] = useState('');
  const [showCost, setShowCost]       = useState(false);
  const [showCustomFlower, setShowCustomFlower] = useState(false);
  const [customFlower, setCustomFlower] = useState({ name: '', supplier: '', costPrice: '', sellPrice: '', lotSize: '' });

  // Stable key for lines: stockItemId or flowerName (for unlisted flowers)
  function lineKey(l) { return l.stockItemId || l.flowerName; }
  function matchesKey(l, key) {
    return l.stockItemId === key || (!l.stockItemId && l.flowerName === key);
  }

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

  // Hide depleted dated batches (e.g. "Rose Red (14.Mar.)" at qty 0)
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
    const q = flowerQuery.toLowerCase().trim();
    if (!q) return visibleStock;
    return visibleStock.filter(s =>
      (s['Display Name'] || '').toLowerCase().includes(q) ||
      (s['Category'] || '').toLowerCase().includes(q)
    );
  }, [visibleStock, flowerQuery]);

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

  function changeQty(key, delta) {
    onLinesChange(lines =>
      lines
        .map(l => matchesKey(l, key) ? { ...l, quantity: l.quantity + delta } : l)
        .filter(l => l.quantity > 0)
    );
  }

  function setQtyDirect(key, value) {
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

      {/* Premade bouquets section — for matching an existing composition to this customer */}
      {Array.isArray(premadeBouquets) && premadeBouquets.length > 0 && !premadeLocked && (
        <div>
          <p className="ios-label">{t.premadeBouquets}</p>
          <div className="ios-card overflow-hidden divide-y divide-white/40">
            {premadeBouquets.map(b => {
              const price = Math.round(Number(b['Price Override'] || b['Computed Sell Total'] || 0));
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onSelectPremade?.(b)}
                  className="w-full flex items-center px-4 py-3 gap-3 text-left active:bg-pink-50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-pink-100 text-pink-600 text-base flex items-center justify-center shrink-0">
                    💐
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-ios-label truncate">{b.Name || t.premadeBouquet}</div>
                    <div className="text-xs text-ios-tertiary truncate">{b['Bouquet Summary'] || '—'}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-brand-600">{price} zł</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Locked-to-premade banner */}
      {premadeLocked && (
        <div className="ios-card bg-pink-50 border border-pink-200 px-4 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-pink-100 text-pink-600 text-lg flex items-center justify-center shrink-0">
            💐
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-pink-700 font-semibold uppercase tracking-wide">{t.premadeLocked}</div>
            <div className="text-sm font-semibold text-ios-label truncate">
              {lockedBouquet?.Name || t.premadeBouquet}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onUnlinkPremade?.()}
            className="text-pink-700 text-xs font-semibold underline active-scale shrink-0"
          >
            {t.unlinkPremade}
          </button>
        </div>
      )}

      {/* Catalog */}
      {!premadeLocked && (
      <div>
        <div className="flex items-center justify-between mb-1.5 px-1">
          <p className="ios-label !px-0 !mb-0">{t.searchFlowers}</p>
          <button onClick={onStockRefresh} className="text-xs text-brand-600 font-medium">
            &#8635; {t.refreshStock}
          </button>
        </div>

        <div className="ios-card flex items-center px-4 gap-3 mb-2">
          <span className="text-ios-tertiary text-sm">&#128269;</span>
          <input
            type="text"
            value={flowerQuery}
            onChange={e => setFlowerQuery(e.target.value)}
            placeholder={t.flowerSearch}
            className="flex-1 py-3.5 text-base bg-transparent outline-none placeholder-ios-tertiary/50"
          />
          {flowerQuery && (
            <button onClick={() => setFlowerQuery('')} className="text-ios-tertiary text-sm">&#10005;</button>
          )}
        </div>

        <div className="ios-card overflow-hidden divide-y divide-white/40 max-h-64 overflow-y-auto">
          {/* Add unlisted flower option */}
          {flowerQuery.length >= 2 && !stock.some(s => (s['Display Name'] || '').toLowerCase() === flowerQuery.toLowerCase()) && (
            <button
              type="button"
              onClick={() => {
                setShowCustomFlower(true);
                setCustomFlower({ name: flowerQuery, supplier: '', costPrice: '', sellPrice: '', lotSize: '' });
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

              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => addOne(s)}
                  className={`w-full flex items-center px-4 py-3 gap-3 text-left transition-colors
                              ${out ? 'bg-amber-50/60' : inCart ? 'bg-brand-50/70' : 'active:bg-white/40'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${inCart ? 'text-brand-700' : out ? 'text-amber-700' : 'text-ios-label'}`}>
                      {renderStockName(s['Display Name'], s['Last Restocked'])}
                    </div>
                    <div className="text-xs text-ios-tertiary">
                      {Number(s['Current Sell Price']).toFixed(0)} zł sell · {Number(s['Current Cost Price']).toFixed(0)} zł cost · {qty} pcs
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
      )}

      {/* Custom flower form */}
      {!premadeLocked && showCustomFlower && (
        <div className="ios-card px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-ios-label">{t.addNewFlower || 'Add new flower'}</p>
          <input
            value={customFlower.name}
            onChange={e => setCustomFlower(p => ({ ...p, name: e.target.value }))}
            placeholder={t.flowerName || 'Flower name'}
            className="field-input w-full text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <input value={customFlower.supplier} onChange={e => setCustomFlower(p => ({ ...p, supplier: e.target.value }))}
              placeholder={t.supplier || 'Supplier'} className="field-input text-sm" />
            <input type="number" value={customFlower.lotSize} onChange={e => setCustomFlower(p => ({ ...p, lotSize: e.target.value }))}
              placeholder={t.lotSize || 'Lot size'} className="field-input text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={customFlower.costPrice} onChange={e => {
                const cost = e.target.value;
                setCustomFlower(p => ({
                  ...p, costPrice: cost,
                  sellPrice: cost && targetMarkup ? String(Math.round(Number(cost) * targetMarkup)) : p.sellPrice,
                }));
              }}
              placeholder={`${t.costPrice} (zł)`} className="field-input text-sm" />
            <input type="number" value={customFlower.sellPrice} onChange={e => setCustomFlower(p => ({ ...p, sellPrice: e.target.value }))}
              placeholder={`${t.sellPrice} (zł)`} className="field-input text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={async () => {
                if (!customFlower.name.trim()) return;
                try {
                  const res = await client.post('/stock', {
                    displayName: customFlower.name.trim(),
                    supplier: customFlower.supplier || '',
                    costPrice: Number(customFlower.costPrice) || 0,
                    sellPrice: Number(customFlower.sellPrice) || 0,
                    lotSize: Number(customFlower.lotSize) || 1,
                    quantity: 0,
                  });
                  const newItem = res.data;
                  addOne({ id: newItem.id, 'Display Name': newItem['Display Name'],
                    'Current Cost Price': newItem['Current Cost Price'] || 0,
                    'Current Sell Price': newItem['Current Sell Price'] || 0 });
                  setShowCustomFlower(false);
                  setFlowerQuery('');
                  onStockRefresh();
                } catch (err) {
                  // Show error — do NOT fall back to a stockItemId-less line.
                  // Every flower in an order must have a stock record so demand,
                  // PO generation, and stock deduction stay consistent.
                  const msg = err.response?.data?.error || t.error;
                  showToast(msg, 'error');
                }
              }}
              className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold active-scale"
            >{t.addToCart || 'Add to bouquet'}</button>
            <button type="button" onClick={() => setShowCustomFlower(false)}
              className="px-4 py-2.5 rounded-xl bg-gray-100 text-ios-secondary text-sm"
            >{t.cancel}</button>
          </div>
        </div>
      )}

      {/* Cart */}
      {orderLines.length > 0 && (
        <div>
          <p className="ios-label">{t.bouquetContents}</p>
          <div className="ios-card overflow-hidden divide-y divide-white/40">
            {premadeLocked && orderLines.map(l => (
              <div key={lineKey(l)} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium text-ios-label truncate">
                  {Number(l.quantity)}× {l.flowerName}
                </span>
                <span className="text-xs text-ios-tertiary shrink-0">
                  {Number(l.sellPricePerUnit).toFixed(0)} × {Number(l.quantity)} = {(Number(l.sellPricePerUnit) * Number(l.quantity)).toFixed(0)} zł
                </span>
              </div>
            ))}
            {!premadeLocked && orderLines.map(l => {
              const key = lineKey(l);
              const stockItem = stock.find(s => s.id === l.stockItemId);
              const availableQty = Number(stockItem?.['Current Quantity']) || 0;
              const overStock = l.stockItemId && !l.stockDeferred && l.quantity > availableQty;
              const sellPrice = Number(stockItem?.['Current Sell Price'] ?? l.sellPricePerUnit);
              const lineSell  = sellPrice * Number(l.quantity);
              return (
              <div key={key} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-ios-label truncate">{l.flowerName}</span>
                      {!l.stockItemId && (
                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-indigo-100 text-indigo-600">NEW</span>
                      )}
                      {isFutureOrder && (
                        <button type="button" onClick={() => toggleDeferred(key)}
                          className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide transition-colors ${
                            l.stockDeferred ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                          }`}
                        >{l.stockDeferred ? (t.orderNew || 'New') : (t.useStock || 'Stock')}</button>
                      )}
                    </div>
                    <div className="text-xs text-ios-tertiary">
                      {sellPrice.toFixed(0)} zł × {l.quantity} = <strong className="text-brand-700">{lineSell.toFixed(0)} zł</strong>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => changeQty(key, -1)}
                      className="w-8 h-8 rounded-full bg-white/60 text-ios-secondary text-xl font-bold flex items-center justify-center active:bg-white"
                    >−</button>
                    <input type="text" inputMode="numeric" pattern="[0-9]*"
                      value={l.quantity} onChange={e => setQtyDirect(key, e.target.value)}
                      onFocus={e => e.target.select()}
                      className="w-9 text-center text-sm font-bold border border-white/50 rounded-xl py-1 bg-white/40 outline-none"
                    />
                    <button onClick={() => changeQty(key, +1)}
                      className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xl font-bold flex items-center justify-center active:bg-brand-200"
                    >+</button>
                    <button onClick={() => removeLine(key)}
                            className="text-ios-tertiary text-base ml-1 active:text-ios-red px-1">
                      &#10005;
                    </button>
                  </div>
                </div>
                {overStock && (
                  <div className="mt-1 text-xs text-amber-600 bg-amber-50 rounded-lg px-2 py-1">
                    {l.quantity - availableQty} {t.notInStock || 'not in stock'}
                  </div>
                )}
              </div>
              );
            })}
          </div>

          {/* Totals */}
          <button
            key={`totals-${costTotal}-${sellTotal}`}
            type="button"
            onClick={() => setShowCost(v => !v)}
            className="w-full mt-2 ios-card px-4 py-3 text-left transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-ios-label font-semibold">{t.sellTotal}</span>
              <span className="text-base font-bold text-brand-600">{sellTotal.toFixed(0)} zł</span>
            </div>
            {showCost && (
              <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-white/40">
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
