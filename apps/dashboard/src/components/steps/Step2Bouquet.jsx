// Step2Bouquet — catalog tap-to-add above, cart stepper below.

import { useState, useMemo } from 'react';
import t from '../../translations.js';

export default function Step2Bouquet({
  customerRequest, orderLines, priceOverride, stock, onStockRefresh,
  onChange, onLinesChange, requiredBy,
}) {
  // Determine if the order is for a future date (not today).
  // Future orders allow toggling between "use current stock" and "order new" per line.
  const isFutureOrder = (() => {
    if (!requiredBy) return false;
    const today = new Date().toISOString().split('T')[0];
    return requiredBy > today;
  })();
  const [flowerQuery, setFlowerQuery] = useState('');
  const [showCost, setShowCost]       = useState(false);

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

  const filteredStock = useMemo(() => {
    const q = flowerQuery.toLowerCase().trim();
    if (!q) return stock;
    return stock.filter(s =>
      (s['Display Name'] || '').toLowerCase().includes(q) ||
      (s['Category'] || '').toLowerCase().includes(q)
    );
  }, [stock, flowerQuery]);

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

  function changeQty(stockItemId, delta) {
    onLinesChange(lines =>
      lines
        .map(l => l.stockItemId === stockItemId
          ? { ...l, quantity: l.quantity + delta }
          : l
        )
        .filter(l => l.quantity > 0)
    );
  }

  function setQtyDirect(stockItemId, value) {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 0) return;
    onLinesChange(lines =>
      n === 0
        ? lines.filter(l => l.stockItemId !== stockItemId)
        : lines.map(l => l.stockItemId === stockItemId ? { ...l, quantity: n } : l)
    );
  }

  function removeLine(stockItemId) {
    onLinesChange(lines => lines.filter(l => l.stockItemId !== stockItemId));
  }

  function toggleDeferred(stockItemId) {
    onLinesChange(lines =>
      lines.map(l => l.stockItemId === stockItemId ? { ...l, stockDeferred: !l.stockDeferred } : l)
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

      {/* Catalog */}
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
          {filteredStock.length === 0 ? (
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
                      {s['Display Name']}
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

      {/* Cart */}
      {orderLines.length > 0 && (
        <div>
          <p className="ios-label">{t.bouquetContents}</p>
          <div className="ios-card overflow-hidden divide-y divide-white/40">
            {orderLines.map(l => {
              const stockItem = stock.find(s => s.id === l.stockItemId);
              const availableQty = Number(stockItem?.['Current Quantity']) || 0;
              const overStock = l.stockItemId && !l.stockDeferred && l.quantity > availableQty;
              // Always use current stock price for display (snapshot happens at submit)
              const sellPrice = Number(stockItem?.['Current Sell Price'] ?? l.sellPricePerUnit);
              const lineSell  = sellPrice * Number(l.quantity);
              return (
              <div key={l.stockItemId} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-ios-label truncate">{l.flowerName}</span>
                      {isFutureOrder && (
                        <button
                          type="button"
                          onClick={() => toggleDeferred(l.stockItemId)}
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
                      onClick={() => changeQty(l.stockItemId, -1)}
                      className="w-8 h-8 rounded-full bg-white/60 text-ios-secondary text-xl font-bold
                                 flex items-center justify-center active:bg-white"
                    >−</button>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={l.quantity}
                      onChange={e => setQtyDirect(l.stockItemId, e.target.value)}
                      onFocus={e => e.target.select()}
                      className="w-9 text-center text-sm font-bold border border-white/50 rounded-xl py-1 bg-white/40 outline-none"
                    />
                    <button
                      onClick={() => changeQty(l.stockItemId, +1)}
                      className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xl font-bold
                                 flex items-center justify-center active:bg-brand-200"
                    >+</button>
                    <button onClick={() => removeLine(l.stockItemId)}
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
