// Step2Bouquet — catalog tap-to-add above, cart stepper below.

import { useState, useMemo } from 'react';
import t from '../../translations.js';

export default function Step2Bouquet({
  customerRequest, orderLines, priceOverride, stock, onStockRefresh,
  onChange, onLinesChange, costTotal, sellTotal,
}) {
  const [flowerQuery, setFlowerQuery] = useState('');

  const filteredStock = useMemo(() => {
    const q = flowerQuery.toLowerCase().trim();
    if (!q) return stock;
    return stock.filter(s =>
      (s['Display Name'] || '').toLowerCase().includes(q) ||
      (s['Category'] || '').toLowerCase().includes(q)
    );
  }, [stock, flowerQuery]);

  function addOne(stockItem) {
    const maxQty = Number(stockItem['Current Quantity']) || 0;
    onLinesChange(lines => {
      const exists = lines.find(l => l.stockItemId === stockItem.id);
      if (exists) {
        if (exists.quantity >= maxQty) return lines; // cap at available stock
        return lines.map(l =>
          l.stockItemId === stockItem.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      if (maxQty <= 0) return lines;
      return [...lines, {
        stockItemId:      stockItem.id,
        flowerName:       stockItem['Display Name'],
        quantity:         1,
        costPricePerUnit: Number(stockItem['Current Cost Price']) || 0,
        sellPricePerUnit: Number(stockItem['Current Sell Price']) || 0,
      }];
    });
  }

  function changeQty(stockItemId, delta) {
    const maxQty = Number(stock.find(s => s.id === stockItemId)?.['Current Quantity']) || Infinity;
    onLinesChange(lines =>
      lines
        .map(l => l.stockItemId === stockItemId
          ? { ...l, quantity: Math.min(l.quantity + delta, maxQty) }
          : l
        )
        .filter(l => l.quantity > 0)
    );
  }

  function setQtyDirect(stockItemId, value) {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 0) return;
    const maxQty = Number(stock.find(s => s.id === stockItemId)?.['Current Quantity']) || Infinity;
    const capped = Math.min(n, maxQty);
    onLinesChange(lines =>
      capped === 0
        ? lines.filter(l => l.stockItemId !== stockItemId)
        : lines.map(l => l.stockItemId === stockItemId ? { ...l, quantity: capped } : l)
    );
  }

  function removeLine(stockItemId) {
    onLinesChange(lines => lines.filter(l => l.stockItemId !== stockItemId));
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

      {/* ── Catalog ── */}
      <div>
        <div className="flex items-center justify-between mb-1.5 px-1">
          <p className="ios-label !px-0 !mb-0">{t.searchFlowers}</p>
          <button onClick={onStockRefresh} className="text-xs text-brand-600 font-medium">
            ↻ {t.refreshStock}
          </button>
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

        <div className="ios-card overflow-hidden divide-y divide-white/40 max-h-64 overflow-y-auto">
          {filteredStock.length === 0 ? (
            <p className="text-ios-tertiary text-sm text-center py-8">{t.noStockFound}</p>
          ) : (
            filteredStock.map(s => {
              const qty    = Number(s['Current Quantity']) || 0;
              const inCart = orderLines.find(l => l.stockItemId === s.id);
              const low    = qty > 0 && qty <= (s['Low Stock Threshold'] || 5);
              const out    = qty <= 0;
              const maxed  = inCart && inCart.quantity >= qty;

              return (
                <div key={s.id} className="flex items-center px-4 py-3 gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ios-label truncate">{s['Display Name']}</div>
                    <div className="text-xs text-ios-tertiary">
                      {Number(s['Current Sell Price']).toFixed(0)} zł · {qty} pcs
                      {low && !out && <span className="text-ios-orange"> · low</span>}
                      {out && <span className="text-ios-red"> · out</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {inCart && (
                      <span className="min-w-[22px] h-[22px] px-1 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">
                        {inCart.quantity}
                      </span>
                    )}
                    <button
                      onClick={() => addOne(s)}
                      disabled={out || maxed}
                      className={`w-9 h-9 rounded-full text-xl font-bold flex items-center justify-center
                                  active-scale disabled:opacity-30 transition-colors
                                  ${inCart ? 'bg-brand-100 text-brand-700' : 'bg-brand-600 text-white'}`}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Cart ── */}
      {orderLines.length > 0 && (
        <div>
          <p className="ios-label">{t.bouquetContents}</p>
          <div className="ios-card overflow-hidden divide-y divide-white/40">
            {orderLines.map(l => {
              const stockItem = stock.find(s => s.id === l.stockItemId);
              const maxQty    = Number(stockItem?.['Current Quantity']) || Infinity;
              return (
              <div key={l.stockItemId} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ios-label truncate">{l.flowerName}</div>
                  <div className="text-xs text-ios-tertiary">
                    {l.sellPricePerUnit} zł × {l.quantity} = <strong className="text-ios-label">{(l.sellPricePerUnit * l.quantity).toFixed(0)} zł</strong>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => changeQty(l.stockItemId, -1)}
                    className="w-8 h-8 rounded-full bg-white/60 text-ios-secondary text-xl font-bold
                               flex items-center justify-center active:bg-white active-scale"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={l.quantity}
                    min={1}
                    max={isFinite(maxQty) ? maxQty : undefined}
                    onChange={e => setQtyDirect(l.stockItemId, e.target.value)}
                    onFocus={e => e.target.select()}
                    className="w-9 text-center text-sm font-bold border border-white/50 rounded-xl py-1 bg-white/40 outline-none"
                  />
                  <button
                    onClick={() => changeQty(l.stockItemId, +1)}
                    disabled={l.quantity >= maxQty}
                    className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xl font-bold
                               flex items-center justify-center active:bg-brand-200 active-scale disabled:opacity-30"
                  >
                    +
                  </button>
                  <button onClick={() => removeLine(l.stockItemId)}
                          className="text-ios-tertiary text-base ml-1 active:text-ios-red px-1">
                    ✕
                  </button>
                </div>
              </div>
              );
            })}
          </div>

          {/* Totals — passed from parent (authoritative state) */}
          <div className="mt-2 ios-card px-4 py-3 flex justify-between text-sm">
            <span className="text-ios-tertiary">{t.costTotal}: <strong className="text-ios-label">{costTotal.toFixed(0)} zł</strong></span>
            <span className="text-brand-600 font-semibold">{t.sellTotal}: <strong>{sellTotal.toFixed(0)} zł</strong></span>
          </div>
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
