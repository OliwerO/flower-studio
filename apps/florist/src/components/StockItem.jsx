import { useState } from 'react';
import t from '../translations.js';
import { renderStockName } from '@flower-studio/shared';
import fmtDate from '../utils/formatDate.js';

/**
 * StockItem — a single compact row in the stock panel.
 *
 * Two modes controlled by the `editMode` prop:
 *   false (default) → write-off only (florist day-to-day: report dead stems)
 *   true            → +/− adjust buttons (owner manual corrections)
 *
 * Tapping the row expands it to show which orders consume this flower.
 */
export default function StockItem({ item, editMode, onAdjust, onWriteOff, committedData }) {
  const qty       = item['Current Quantity'] || 0;
  const dead      = item['Dead/Unsold Stems'] || 0;
  const threshold = item['Reorder Threshold'] || 5;
  const committed = committedData?.committed || 0;
  const effective = qty - committed;
  const hasShortfall = committed > 0 && effective < 0;
  const isLow     = qty > 0 && qty <= threshold;
  const isOut     = qty <= 0;

  const [expanded, setExpanded]            = useState(false);
  const [showWriteOff, setShowWriteOff]    = useState(false);
  const [writeOffQty, setWriteOffQty]      = useState(1);
  const [reason, setReason]                = useState('');

  const dotColor = isOut ? 'bg-ios-red' : isLow ? 'bg-ios-orange' : 'bg-ios-green';
  const qtyColor = isOut ? 'text-ios-red' : isLow ? 'text-ios-orange' : 'text-ios-label';

  function handleWriteOff() {
    const n = Number(writeOffQty);
    if (n > 0) {
      onWriteOff(n, reason.trim());
      setShowWriteOff(false);
      setWriteOffQty(1);
      setReason('');
    }
  }

  const isNeg = qty < 0;
  const rowBg = isNeg ? 'bg-red-50' : hasShortfall ? 'bg-orange-50' : isOut ? 'bg-ios-red/5' : isLow ? 'bg-ios-orange/5' : '';

  // Progress bar: shows committed vs free proportion
  const barTotal = Math.max(qty, committed, 1); // avoid division by zero
  const committedPct = committed > 0 ? Math.min((committed / barTotal) * 100, 100) : 0;
  const barColor = hasShortfall ? 'bg-red-400' : 'bg-orange-300';

  return (
    <div className={rowBg}>
      {/* Collapsed row — tappable to expand */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        onClick={() => !editMode && setExpanded(v => !v)}
      >
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className="text-[13px] font-medium text-ios-label break-words">{renderStockName(item['Display Name'], item['Last Restocked'])}</span>
          </div>
          <span className="text-[11px] text-ios-tertiary">
            <span className="font-semibold text-brand-700">{Number(item['Current Sell Price'] || 0).toFixed(0)}zł</span>
            {item.Supplier && <span> · {item.Supplier}</span>}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {editMode ? (
            <>
              <button
                onPointerDown={() => onAdjust(-1)}
                className="w-7 h-7 rounded-full bg-ios-fill2 text-ios-secondary text-lg font-bold
                           flex items-center justify-center active:bg-ios-separator active-scale"
              >−</button>
              <span className={`w-7 text-center font-bold text-[13px] ${qtyColor}`}>{qty}</span>
              <button
                onPointerDown={() => onAdjust(+1)}
                className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-lg font-bold
                           flex items-center justify-center active:bg-brand-200 active-scale"
              >+</button>
            </>
          ) : (
            <>
              {/* Qty number + thin committed bar underneath */}
              <div className="flex flex-col items-center w-9">
                <span className={`font-bold text-[13px] leading-none ${qtyColor}`}>{qty}</span>
                {committed > 0 && (
                  <div className="w-full h-[3px] rounded-full bg-gray-200 mt-1 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor}`}
                      style={{ width: `${committedPct}%` }}
                    />
                  </div>
                )}
              </div>
              {(qty > 0 || hasShortfall) && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowWriteOff(!showWriteOff); }}
                  className={`w-7 h-7 rounded-full text-xs flex items-center justify-center active-scale transition-colors ${
                    showWriteOff ? 'bg-red-100 text-red-600' : 'bg-ios-fill2 text-ios-tertiary'
                  }`}
                  title={t.writeOff}
                >🗑</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Expanded: committed order details */}
      {expanded && !editMode && committed > 0 && (
        <div className="px-3 pb-2 ml-4 space-y-1" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between text-[10px] text-ios-tertiary mb-1">
            <span>{t.committed}: {committed} {t.stems}</span>
            <span className={hasShortfall ? 'text-red-600 font-semibold' : 'text-green-600'}>
              {t.effectiveStock}: {effective}
            </span>
          </div>
          {(item.Supplier || item['Current Sell Price']) && (
            <div className="flex items-center gap-2 text-[10px] text-ios-tertiary mb-1">
              {item['Current Sell Price'] > 0 && <span className="font-semibold text-brand-700">{Number(item['Current Sell Price']).toFixed(0)}zł</span>}
              {item.Supplier && <span>{item.Supplier}</span>}
            </div>
          )}
          <div className="bg-white rounded-lg border border-gray-100 divide-y divide-gray-50 overflow-hidden">
            {(committedData?.orders || []).map((o, i) => (
              <div key={i} className="flex items-center justify-between px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  {o.appOrderId && (
                    <span className="text-[10px] font-mono text-ios-tertiary shrink-0">#{o.appOrderId}</span>
                  )}
                  <span className="text-[11px] text-ios-label truncate">{o.customerName || '—'}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {o.requiredBy && (
                    <span className="text-[10px] text-ios-tertiary">{fmtDate(o.requiredBy)}</span>
                  )}
                  <span className="text-[11px] font-semibold text-brand-600">{o.qty}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expanded: no commitments message */}
      {expanded && !editMode && committed === 0 && (
        <div className="px-3 pb-2 ml-4 space-y-1">
          {(item.Supplier || item['Current Sell Price']) && (
            <div className="flex items-center gap-2 text-[10px] text-ios-tertiary">
              {item['Current Sell Price'] > 0 && <span className="font-semibold text-brand-700">{Number(item['Current Sell Price']).toFixed(0)}zł</span>}
              {item.Supplier && <span>{item.Supplier}</span>}
            </div>
          )}
          <p className="text-[10px] text-ios-tertiary">{t.noCommitments}</p>
        </div>
      )}

      {/* Write-off inline form */}
      {showWriteOff && !editMode && (
        <div className="px-3 pb-2 pt-0 ml-4 space-y-1.5" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-ios-red font-medium shrink-0">{t.writeOff}:</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setWriteOffQty(q => Math.max(1, q - 1))}
                className="w-6 h-6 rounded-full bg-red-50 text-red-600 text-base font-bold flex items-center justify-center active-scale"
              >−</button>
              <input
                type="number"
                inputMode="numeric"
                value={writeOffQty}
                min={1}
                onFocus={e => e.target.select()}
                onChange={e => {
                  const raw = e.target.value;
                  if (raw === '') { setWriteOffQty(''); return; }
                  const n = parseInt(raw, 10);
                  if (!isNaN(n) && n >= 0) setWriteOffQty(n);
                }}
                onBlur={() => {
                  const n = Number(writeOffQty);
                  if (!n || n < 1) setWriteOffQty(1);
                }}
                className="w-9 text-center text-xs font-bold border border-red-200 rounded-lg py-0.5 bg-white outline-none"
              />
              <button
                onClick={() => setWriteOffQty(q => q + 1)}
                className="w-6 h-6 rounded-full bg-red-50 text-red-600 text-base font-bold flex items-center justify-center active-scale"
              >+</button>
            </div>
            <button
              onClick={handleWriteOff}
              className="px-2.5 py-1 rounded-full bg-red-500 text-white text-[11px] font-semibold active:bg-red-600 active-scale"
            >{t.confirm}</button>
            <button
              onClick={() => { setShowWriteOff(false); setWriteOffQty(1); setReason(''); }}
              className="text-[11px] text-ios-tertiary"
            >{t.cancel}</button>
          </div>
          <select
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="w-full text-xs border border-red-100 rounded-lg px-2 py-1 bg-white outline-none text-ios-label"
          >
            <option value="">{t.writeOffReason}</option>
            <option value="Wilted">{t.reasonWilted || 'Wilted'}</option>
            <option value="Damaged">{t.reasonDamaged || 'Broken at delivery'}</option>
          </select>
        </div>
      )}
    </div>
  );
}
