// Step2Bouquet — catalog tap-to-add above, cart stepper below.
//
// Catalog rows are fully tappable (not just the + button).
// Selected items get a brand tint so you can see at a glance what's in the bouquet.
// Cart lines show only sell-price math. Cost + margin appear in the totals summary.

import { useState, useMemo } from 'react';
import t from '../../translations.js';

// Isolated cart row — holds local input state so typing multi-digit numbers
// doesn't re-render the parent and kill focus. Like a sub-assembly station
// that buffers its output before sending it down the line.
// Confidence border colors for AI-matched import lines
const CONFIDENCE_STYLES = {
  high: 'border-l-4 border-l-green-400',
  low:  'border-l-4 border-l-amber-400',
  none: 'border-l-4 border-l-red-300',
};

function CartLine({ line: l, stock, onChangeQty, onCommitQty, onRemove }) {
  const stockItem = stock.find(s => s.id === l.stockItemId);
  const maxQty    = Number(stockItem?.['Current Quantity']) || Infinity;
  const sellPrice = Number(stockItem?.['Current Sell Price'] ?? l.sellPricePerUnit);
  const lineSell  = sellPrice * Number(l.quantity);
  const confidence = l.confidence; // 'high' | 'low' | 'none' | undefined

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
    <div className={`flex items-center gap-3 px-4 py-3 ${confidence ? CONFIDENCE_STYLES[confidence] || '' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-ios-label truncate">{l.flowerName}</span>
          {confidence === 'low' && <span className="text-amber-500 text-xs" title={t.intake?.confidenceLow}>?</span>}
          {confidence === 'none' && <span className="text-red-400 text-xs" title={t.intake?.confidenceNone}>✗</span>}
        </div>
        <div className="text-xs text-ios-tertiary">
          {sellPrice.toFixed(0)} zł × {l.quantity} = <strong className="text-brand-700">{lineSell.toFixed(0)} zł</strong>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => onChangeQty(l.stockItemId || l.flowerName, -1)}
          className="w-8 h-8 rounded-full bg-gray-100 text-ios-secondary text-xl font-bold
                     flex items-center justify-center hover:bg-gray-200 active-scale"
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
          disabled={l.quantity >= maxQty}
          className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xl font-bold
                     flex items-center justify-center active:bg-brand-200 active-scale disabled:opacity-30"
        >
          +
        </button>
        <button onClick={() => onRemove(l.stockItemId || l.flowerName)}
                className="text-ios-tertiary text-base ml-1 active:text-ios-red px-1">
          ✕
        </button>
      </div>
    </div>
  );
}

export default function Step2Bouquet({
  customerRequest, orderLines, priceOverride, stock, onStockRefresh,
  onChange, onLinesChange,
}) {
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
    const maxQty = Number(stockItem['Current Quantity']) || 0;
    onLinesChange(lines => {
      const exists = lines.find(l => l.stockItemId === stockItem.id);
      if (exists) {
        if (exists.quantity >= maxQty) return lines;
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

  // lineKey can be stockItemId or flowerName (for unmatched imports)
  function matchesKey(line, key) {
    return line.stockItemId === key || (!line.stockItemId && line.flowerName === key);
  }

  function lineKey(line) {
    return line.stockItemId || line.flowerName;
  }

  function changeQty(key, delta) {
    const maxQty = Number(stock.find(s => s.id === key)?.['Current Quantity']) || Infinity;
    onLinesChange(lines =>
      lines
        .map(l => matchesKey(l, key)
          ? { ...l, quantity: Math.min(l.quantity + delta, maxQty) }
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
    const maxQty = Number(stock.find(s => s.id === key)?.['Current Quantity']) || Infinity;
    const capped = Math.min(n, maxQty);
    onLinesChange(lines =>
      capped === 0
        ? lines.filter(l => !matchesKey(l, key))
        : lines.map(l => matchesKey(l, key) ? { ...l, quantity: capped } : l)
    );
  }

  function removeLine(key) {
    onLinesChange(lines => lines.filter(l => !matchesKey(l, key)));
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

        <div className="ios-card overflow-hidden divide-y divide-gray-100 max-h-64 overflow-y-auto">
          {filteredStock.length === 0 ? (
            <p className="text-ios-tertiary text-sm text-center py-8">{t.noStockFound}</p>
          ) : (
            filteredStock.map(s => {
              const qty    = Number(s['Current Quantity']) || 0;
              const inCart = orderLines.find(l => l.stockItemId === s.id);
              const low    = qty > 0 && qty <= (s['Reorder Threshold'] || 5);
              const out    = qty <= 0;
              const maxed  = inCart && inCart.quantity >= qty;
              const disabled = out || maxed;

              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => !disabled && addOne(s)}
                  disabled={disabled}
                  className={`w-full flex items-center px-4 py-3 gap-3 text-left transition-colors
                              disabled:opacity-40 active-scale
                              ${inCart ? 'bg-brand-50/70' : 'active:bg-gray-50'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${inCart ? 'text-brand-700' : 'text-ios-label'}`}>
                      {s['Display Name']}
                    </div>
                    <div className="text-xs text-ios-tertiary">
                      {Number(s['Current Sell Price']).toFixed(0)} zł sell · {Number(s['Current Cost Price']).toFixed(0)} zł cost · {qty} pcs
                      {low && !out && <span className="text-ios-orange"> · low</span>}
                      {out && <span className="text-ios-red"> · out</span>}
                      {s['Last Restocked'] && <span className="text-ios-tertiary/70"> · {s['Last Restocked'].slice(5)}</span>}
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
              />
            ))}
          </div>

          {/* Totals — tap to toggle cost/margin visibility */}
          <button
            key={`totals-${costTotal}-${sellTotal}`}
            type="button"
            onClick={() => setShowCost(v => !v)}
            className="w-full mt-2 ios-card px-4 py-3 text-left active-scale transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-ios-label font-semibold">{t.sellTotal}</span>
              <span className="text-base font-bold text-brand-600">{sellTotal.toFixed(0)} zł</span>
            </div>
            {showCost && (
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
