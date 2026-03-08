import { useState } from 'react';
import t from '../translations.js';

/**
 * StockItem — a single row in the stock panel.
 *
 * Two modes controlled by the `editMode` prop:
 *   false (default) → write-off only (florist day-to-day: report dead stems)
 *   true            → +/− adjust buttons (owner manual corrections)
 *
 * Think of it like a warehouse floor:
 *   - Workers report scrap (write-off)
 *   - Only the manager can manually override inventory counts (edit mode)
 */
export default function StockItem({ item, editMode, onAdjust, onWriteOff }) {
  const qty       = item['Current Quantity'] || 0;
  const dead      = item['Dead/Unsold Stems'] || 0;
  const threshold = item['Low Stock Threshold'] || 5;
  const isLow     = qty > 0 && qty <= threshold;
  const isOut     = qty <= 0;

  const [showWriteOff, setShowWriteOff] = useState(false);
  const [writeOffQty, setWriteOffQty]   = useState(1);
  const [reason, setReason]             = useState('');

  const dotColor = isOut ? 'bg-ios-red' : isLow ? 'bg-ios-orange' : 'bg-ios-green';
  const qtyColor = isOut ? 'text-ios-red' : isLow ? 'text-ios-orange' : 'text-ios-label';

  function handleWriteOff() {
    if (writeOffQty > 0 && writeOffQty <= qty) {
      onWriteOff(writeOffQty, reason.trim());
      setShowWriteOff(false);
      setWriteOffQty(1);
      setReason('');
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ios-label truncate">{item['Display Name']}</p>
          <p className="text-xs text-ios-tertiary">
            {item['Current Cost Price'] || 0} zł cost · {item['Current Sell Price'] || 0} zł sell
            {dead > 0 && <span className="text-ios-red"> · {dead} {t.deadStems}</span>}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {editMode ? (
            /* ── Owner edit mode: +/− adjust buttons ── */
            <>
              <button
                onPointerDown={() => onAdjust(-1)}
                className="w-8 h-8 rounded-full bg-ios-fill2 text-ios-secondary text-xl font-bold
                           flex items-center justify-center active:bg-ios-separator active-scale"
              >
                −
              </button>
              <span className={`w-8 text-center font-bold text-sm ${qtyColor}`}>{qty}</span>
              <button
                onPointerDown={() => onAdjust(+1)}
                className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xl font-bold
                           flex items-center justify-center active:bg-brand-200 active-scale"
              >
                +
              </button>
            </>
          ) : (
            /* ── Default mode: quantity display + write-off toggle ── */
            <>
              <span className={`w-8 text-center font-bold text-sm ${qtyColor}`}>{qty}</span>
              {qty > 0 && (
                <button
                  onClick={() => setShowWriteOff(!showWriteOff)}
                  className={`w-8 h-8 rounded-full text-sm flex items-center justify-center active-scale transition-colors ${
                    showWriteOff ? 'bg-red-100 text-red-600' : 'bg-ios-fill2 text-ios-tertiary'
                  }`}
                  title={t.writeOff}
                >
                  🗑
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Write-off inline form — only in default (non-edit) mode */}
      {showWriteOff && !editMode && (
        <div className="px-4 pb-3 pt-0 ml-5 space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-ios-red font-medium shrink-0">{t.writeOff}:</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setWriteOffQty(q => Math.max(1, q - 1))}
                className="w-7 h-7 rounded-full bg-red-50 text-red-600 text-lg font-bold flex items-center justify-center active-scale"
              >−</button>
              <input
                type="number"
                value={writeOffQty}
                min={1}
                max={qty}
                onChange={e => {
                  const n = parseInt(e.target.value, 10);
                  if (!isNaN(n) && n >= 1 && n <= qty) setWriteOffQty(n);
                }}
                className="w-10 text-center text-sm font-bold border border-red-200 rounded-lg py-1 bg-white outline-none"
              />
              <button
                onClick={() => setWriteOffQty(q => Math.min(qty, q + 1))}
                className="w-7 h-7 rounded-full bg-red-50 text-red-600 text-lg font-bold flex items-center justify-center active-scale"
              >+</button>
            </div>
            <button
              onClick={handleWriteOff}
              className="px-3 py-1.5 rounded-full bg-red-500 text-white text-xs font-semibold active:bg-red-600 active-scale"
            >
              {t.confirm}
            </button>
            <button
              onClick={() => { setShowWriteOff(false); setWriteOffQty(1); setReason(''); }}
              className="text-xs text-ios-tertiary"
            >
              {t.cancel}
            </button>
          </div>
          {/* Optional reason input */}
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={t.writeOffReason}
            className="w-full text-sm border border-red-100 rounded-lg px-3 py-1.5 bg-white outline-none placeholder-ios-tertiary/50"
          />
        </div>
      )}
    </div>
  );
}
