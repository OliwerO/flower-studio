import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import t from '../translations.js';
import { stockBaseName, renderDateTag, LOSS_REASONS, reasonLabel, getEffectiveStock, hasStockShortfall } from '@flower-studio/shared';
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
export default function StockItem({ item, editMode, onAdjust, onWriteOff, onPatch, committedData, premadeData }) {
  const navigate = useNavigate();
  const qty       = item['Current Quantity'] || 0;
  const dead      = item['Dead/Unsold Stems'] || 0;
  const threshold = item['Reorder Threshold'] || 5;
  const committed = committedData?.committed || 0;
  // Use the shared helper — inline `qty - committed` was double-counting when
  // qty is already negative (the negative already reflects the same orders).
  // See packages/shared/utils/stockMath.js + root CLAUDE.md pitfall #7.
  const effective = getEffectiveStock(qty, committed);
  const hasShortfall = hasStockShortfall(qty, committed);
  const isLow     = qty > 0 && qty <= threshold;
  const isOut     = qty <= 0;
  // Premade reservations — stems physically locked into a premade bouquet.
  // Already deducted from Current Quantity; shown as a chip so the florist
  // knows they exist and which bouquets hold them.
  const premadeQty = premadeData?.qty || 0;
  const premadeBouquets = premadeData?.bouquets || [];
  const [showPremade, setShowPremade] = useState(false);

  const [expanded, setExpanded]            = useState(false);
  const [showWriteOff, setShowWriteOff]    = useState(false);
  const [writeOffQty, setWriteOffQty]      = useState(1);
  const [reason, setReason]                = useState('');
  const [editingDate, setEditingDate]      = useState(false);
  const [dateDraft, setDateDraft]          = useState('');
  const [showTrace, setShowTrace]          = useState(false);
  const [traceTrail, setTraceTrail]        = useState(null);
  const [traceLoading, setTraceLoading]    = useState(false);

  function toggleTrace(e) {
    e.stopPropagation();
    if (showTrace) { setShowTrace(false); return; }
    setShowTrace(true);
    if (traceTrail) return;
    setTraceLoading(true);
    client.get(`/stock/${item.id}/usage`)
      .then(r => setTraceTrail(r.data.trail || []))
      .catch(() => setTraceTrail([]))
      .finally(() => setTraceLoading(false));
  }

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
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13px] font-medium text-ios-label break-words">{stockBaseName(item['Display Name'])}</span>
            {editMode && editingDate ? (
              <input
                type="date"
                value={dateDraft}
                onChange={e => setDateDraft(e.target.value)}
                onBlur={() => {
                  setEditingDate(false);
                  const oldVal = item['Last Restocked'] ? item['Last Restocked'].split('T')[0] : null;
                  if ((dateDraft || null) !== oldVal) onPatch({ 'Last Restocked': dateDraft || null });
                }}
                autoFocus
                className="text-xs border border-gray-200 rounded-lg px-1.5 py-0.5 bg-white outline-none"
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span onClick={e => {
                if (!editMode) return;
                e.stopPropagation();
                setDateDraft(item['Last Restocked'] ? item['Last Restocked'].split('T')[0] : '');
                setEditingDate(true);
              }}>
                {renderDateTag(item['Display Name'], item['Last Restocked'])}
              </span>
            )}
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
              {/* Qty number + thin committed bar + premade chip */}
              <div className="flex flex-col items-center w-12">
                <span className={`font-bold text-[13px] leading-none ${qtyColor}`}>{qty}</span>
                {committed > 0 && (
                  <div className="w-full h-[3px] rounded-full bg-gray-200 mt-1 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor}`}
                      style={{ width: `${committedPct}%` }}
                    />
                  </div>
                )}
                {premadeQty > 0 && (
                  <button
                    onClick={e => { e.stopPropagation(); setShowPremade(v => !v); }}
                    className="text-[9px] leading-tight text-indigo-600 font-medium mt-0.5 hover:text-indigo-800 whitespace-nowrap"
                  >
                    +{premadeQty} {t.inPremadesShort || 'premade'}
                  </button>
                )}
              </div>
              {qty > 0 && (
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

      {/* Premade bouquets that hold stems of this flower — chip-triggered */}
      {showPremade && premadeBouquets.length > 0 && (
        <div className="px-3 pb-2 ml-4" onClick={e => e.stopPropagation()}>
          <div className="mb-1 flex items-center justify-between text-[10px] text-indigo-600 font-semibold uppercase tracking-wide">
            <span>{t.lockedInPremades || 'Locked in premades'}</span>
            <span>{premadeQty} {t.stems}</span>
          </div>
          <div className="bg-indigo-50 rounded-lg border border-indigo-100 divide-y divide-indigo-100 overflow-hidden">
            {premadeBouquets.map((b, i) => (
              <div key={i} className="flex items-center justify-between px-2.5 py-1.5 text-[11px] text-indigo-900">
                <span className="truncate">{b.name}</span>
                <span className="tabular-nums font-semibold">{b.qty}</span>
              </div>
            ))}
          </div>
          {/* Reconcile action lives only in the dashboard (Stock tab → 🔧
              toggle) so it can't be tapped accidentally from the florist's
              daily flow. The owner uses dashboard for that admin task. */}
        </div>
      )}

      {/* Expanded: no commitments message */}
      {expanded && !editMode && committed === 0 && (
        <div className="px-3 pb-2 ml-4">
          <p className="text-[10px] text-ios-tertiary">{t.noCommitments}</p>
        </div>
      )}

      {/* Trace button + usage trail */}
      {expanded && !editMode && (
        <div className="px-3 pb-2 ml-4" onClick={e => e.stopPropagation()}>
          <button onClick={toggleTrace}
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full active-scale ${
              showTrace ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600'
            }`}>
            {t.trace || 'Trace'}
          </button>
          {showTrace && (
            <div className="mt-1.5">
              {traceLoading ? (
                <p className="text-[10px] text-ios-tertiary">{t.loading}...</p>
              ) : !traceTrail || traceTrail.length === 0 ? (
                <p className="text-[10px] text-ios-tertiary">{t.noUsageData || 'No history found.'}</p>
              ) : (
                <div className="bg-white rounded-lg border border-gray-100 divide-y divide-gray-50 overflow-hidden max-h-48 overflow-y-auto">
                  {traceTrail.map((entry, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between px-2.5 py-1.5 ${
                        entry.type === 'order' && entry.orderRecordId ? 'cursor-pointer active:bg-gray-50' : ''
                      }`}
                      onClick={() => {
                        if (entry.type === 'order' && entry.orderRecordId) navigate(`/orders/${entry.orderRecordId}`);
                      }}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`text-[9px] font-medium px-1 py-0.5 rounded ${
                          entry.type === 'order' ? 'bg-brand-100 text-brand-700' :
                          entry.type === 'writeoff' ? 'bg-red-100 text-red-700' :
                          entry.type === 'premade' ? 'bg-indigo-100 text-indigo-700' :
                          'bg-green-100 text-green-700'
                        }`}>
                          {entry.type === 'order' ? (t.usageOrder || 'Order') :
                           entry.type === 'writeoff' ? (t.writeOff || 'W/O') :
                           entry.type === 'premade' ? (t.usagePremade || 'Premade') :
                           (t.usagePurchase || 'Purchase')}
                        </span>
                        <span className={`text-[10px] truncate ${entry.type === 'order' && entry.orderRecordId ? 'text-brand-600' : 'text-ios-label'}`}>
                          {entry.type === 'order' ? `${entry.orderId} ${entry.customer}` :
                           entry.type === 'writeoff' ? entry.reason :
                           entry.type === 'premade' ? entry.bouquetName :
                           entry.supplier}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {entry.date ? (
                          <span className="text-[9px] text-ios-tertiary">
                            {entry.date}{entry.type === 'order' && entry.requiredBy ? ` → ${entry.requiredBy}` : ''}
                          </span>
                        ) : entry.type === 'premade' ? (
                          <span className="text-[9px] text-indigo-500 font-medium">{t.ongoing || 'ongoing'}</span>
                        ) : null}
                        <span className={`text-[11px] font-semibold tabular-nums ${entry.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {entry.quantity > 0 ? '+' : ''}{entry.quantity}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
                max={qty}
                onFocus={e => e.target.select()}
                onChange={e => {
                  const raw = e.target.value;
                  if (raw === '') { setWriteOffQty(''); return; }
                  const n = parseInt(raw, 10);
                  if (!isNaN(n) && n >= 0) setWriteOffQty(Math.min(n, qty));
                }}
                onBlur={() => {
                  const n = Number(writeOffQty);
                  if (!n || n < 1) setWriteOffQty(1);
                  else if (n > qty) setWriteOffQty(qty);
                }}
                className="w-9 text-center text-xs font-bold border border-red-200 rounded-lg py-0.5 bg-white outline-none"
              />
              <button
                onClick={() => setWriteOffQty(q => Math.min(q + 1, qty))}
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
            {LOSS_REASONS.map(r => (
              <option key={r} value={r}>{reasonLabel(t, r)}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
