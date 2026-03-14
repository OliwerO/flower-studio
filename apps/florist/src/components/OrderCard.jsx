// OrderCard — expandable card that shows order summary, and when tapped
// expands inline to show full details + status/payment controls.
// No overlays, no fixed positioning — just normal DOM flow. Like flipping
// a kanban card over to see the full work order on the back.

import { useState, useEffect } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import DatePicker from './DatePicker.jsx';

const STATUS_STYLES = {
  'New':              { label: 'bg-indigo-50 text-indigo-600' },
  'In Progress':      { label: 'bg-orange-50 text-orange-600' },
  'Ready':            { label: 'bg-amber-50 text-amber-700' },
  'Out for Delivery': { label: 'bg-sky-50 text-sky-700' },
  'Delivered':        { label: 'bg-emerald-50 text-emerald-700' },
  'Picked Up':        { label: 'bg-teal-50 text-teal-700' },
  'Cancelled':        { label: 'bg-rose-50 text-rose-600' },
};

// Map Airtable status values → translation keys
const STATUS_LABELS = {
  'New':              () => t.statusNew,
  'In Progress':      () => t.statusInProgress,
  'Ready':            () => t.statusReady,
  'Out for Delivery': () => t.statusOutForDelivery,
  'Delivered':        () => t.statusDelivered,
  'Picked Up':        () => t.statusPickedUp,
  'Cancelled':        () => t.statusCancelled,
};

const FALLBACK_PAY_METHODS = ['Cash', 'Card', 'Transfer'];
const FALLBACK_TIME_SLOTS  = ['10:00-12:00', '12:00-14:00', '14:00-16:00', '16:00-18:00'];

// Florist doesn't trigger "Out for Delivery" — that's the driver's job.
const ALLOWED_TRANSITIONS = {
  'New':              ['Ready', 'Cancelled'],
  'In Progress':      ['Ready', 'Cancelled'],
  'Ready':            ['Delivered', 'Picked Up', 'Cancelled'],
  'Out for Delivery': ['Delivered', 'Cancelled'],
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
          onClick={(e) => { e.stopPropagation(); !disabled && onChange(o.value); }}
          disabled={disabled}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors active-scale disabled:opacity-40 ${
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

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-ios-tertiary shrink-0">{label}</span>
      <span className="text-xs text-ios-label text-right">{value}</span>
    </div>
  );
}

export default function OrderCard({ order, onOrderUpdated, isOwner, payMethods, timeSlots }) {
  const { showToast } = useToast();
  const [expanded, setExpanded]   = useState(false);
  const [detail, setDetail]       = useState(null);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [editingBouquet, setEditingBouquet] = useState(false);
  const [editLines, setEditLines] = useState([]);
  const [removedLines, setRemovedLines] = useState([]);
  const [removeIdx, setRemoveIdx] = useState(null);

  const status     = order['Status'] || 'New';
  const styles     = STATUS_STYLES[status] || STATUS_STYLES['New'];
  const isDelivery = order['Delivery Type'] === 'Delivery';
  const isTerminal = ['Delivered', 'Picked Up', 'Cancelled'].includes(status);
  const request    = order['Customer Request'] || '';
  const price      = order['Price Override'] || order['Sell Total'] || '';
  const isPaid     = order['Payment Status'] === 'Paid';
  const isWix      = order['Source'] === 'Wix';
  // Wix orders without a composed bouquet — florist needs to select actual flowers
  const needsComposition = isWix && !order['Bouquet Summary'] && status === 'New';

  function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    // Fetch full detail if we haven't yet
    if (!detail) {
      setLoading(true);
      client.get(`/orders/${order.id}`)
        .then(r => setDetail(r.data))
        .catch(() => showToast(t.loadError, 'error'))
        .finally(() => setLoading(false));
    }
  }

  async function patch(fields) {
    setSaving(true);
    try {
      const res = await client.patch(`/orders/${order.id}`, fields);
      setDetail(prev => prev ? { ...prev, ...res.data } : res.data);
      onOrderUpdated?.(order.id, res.data);
      showToast(t.updated, 'success');
    } catch (err) {
      const msg = err.response?.data?.error || t.updateError;
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function patchDelivery(fields) {
    const deliveryId = detail?.delivery?.id;
    if (!deliveryId) return;
    setSaving(true);
    try {
      await client.patch(`/deliveries/${deliveryId}`, fields);
      setDetail(prev => ({
        ...prev,
        delivery: { ...prev.delivery, ...fields },
      }));
      // Also update the order-level fields so the collapsed view refreshes
      onOrderUpdated?.(order.id, {
        'Delivery Date': fields['Delivery Date'] ?? detail.delivery['Delivery Date'],
        'Delivery Time': fields['Delivery Time'] ?? detail.delivery['Delivery Time'],
      });
      showToast(t.updated, 'success');
    } catch (err) {
      const msg = err.response?.data?.error || t.updateError;
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Use detail data if loaded, otherwise fall back to list data
  const d = detail || order;
  const currentStatus = d['Status'] || 'New';
  const currentPaid   = d['Payment Status'] === 'Paid';
  const currentPrice  = d['Price Override'] || d['Sell Total'] || price;

  function statusLabel(s) {
    return STATUS_LABELS[s]?.() || s;
  }

  return (
    <div
      onClick={toggle}
      className={`bg-white rounded-2xl shadow-sm px-4 py-4 transition-colors cursor-pointer ${
        expanded ? 'ring-2 ring-brand-200' : 'active:bg-ios-fill'
      }`}
    >
      {/* Unpaid warning — prominent banner for pickup orders */}
      {!currentPaid && !isDelivery && currentStatus !== 'Cancelled' && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 flex items-center gap-2">
          <span className="text-red-500 text-sm">⚠</span>
          <span className="text-xs font-semibold text-red-700">{t.collectPayment || 'Collect payment before handing over'}</span>
        </div>
      )}

      {/* ── Summary (always visible) ── */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {order['Order ID'] && (
            <span className="text-[11px] font-mono text-ios-tertiary">#{order['Order ID']}</span>
          )}
          <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${styles.label}`}>
            {statusLabel(currentStatus)}
          </span>
          <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
            isDelivery ? 'bg-purple-50 text-purple-600' : 'bg-teal-50 text-teal-700'
          }`}>
            {isDelivery ? t.delivery : t.pickup}
          </span>
          <span className={`text-xs px-2.5 py-0.5 rounded-full ${
            currentPaid ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-500'
          }`}>
            {currentPaid ? t.paid : t.unpaid}
          </span>
          {needsComposition && (
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-700">
              {t.intake?.needsComposition || '🌸 Compose'}
            </span>
          )}
        </div>
        {currentPrice > 0 && (
          <span className={`text-sm font-bold shrink-0 px-3 py-1 rounded-full ${
            currentPaid
              ? 'bg-green-100 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-600 border border-red-200'
          }`}>{currentPrice} zł</span>
        )}
      </div>

      <p className="font-semibold text-ios-label">{d['Customer Name'] || order['Customer Name'] || '—'}</p>
      {request && (
        <p className={`text-sm text-ios-tertiary mt-0.5 ${expanded ? '' : 'line-clamp-1'}`}>{request}</p>
      )}
      {order['Bouquet Summary'] && (
        <p className="text-xs text-brand-600/70 mt-1 line-clamp-1">🌸 {order['Bouquet Summary']}</p>
      )}
      {/* Show delivery/pickup date in overview — more actionable than order date */}
      {(order['Delivery Date'] || order['Required By']) && (
        <p className="text-xs text-ios-tertiary mt-1">
          {order['Delivery Date'] || order['Required By']}
          {order['Delivery Time'] ? ` · ${order['Delivery Time']}` : ''}
        </p>
      )}
      {/* Card text hint — truncated in collapsed view, full text in expanded */}
      {!expanded && order['Greeting Card Text'] && (
        <div className="relative mt-2 bg-amber-50 rounded-lg px-3 py-1.5 overflow-hidden" style={{ maxHeight: '2.2em' }}>
          <p className="text-sm text-ios-label leading-snug whitespace-pre-wrap">
            ✉ {order['Greeting Card Text']}
          </p>
          <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-amber-50 to-transparent" />
        </div>
      )}

      {/* ── Expanded details (inline, no overlays) ── */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-100 flex flex-col gap-4" onClick={e => e.stopPropagation()}>

          {loading ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
            </div>
          ) : !detail ? (
            <p className="text-xs text-ios-tertiary text-center py-4">{t.errorLoadDetails}</p>
          ) : (
            <>
              {/* Order lines — with inline edit capability */}
              {detail.orderLines?.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">{t.labelBouquet}</p>
                    {!isTerminal && !editingBouquet && (
                      <button onClick={() => {
                        setEditLines(detail.orderLines.map(l => ({
                          id: l.id, stockItemId: l['Stock Item']?.[0] || null,
                          flowerName: l['Flower Name'], quantity: l.Quantity,
                          _originalQty: l.Quantity,
                        })));
                        setRemovedLines([]);
                        setEditingBouquet(true);
                      }} className="text-xs text-brand-600 font-medium">{t.edit || 'Edit'}</button>
                    )}
                  </div>

                  {editingBouquet ? (
                    <div className="bg-gray-50 rounded-xl px-3 py-3 space-y-2">
                      {editLines.map((line, idx) => (
                        <div key={line.id || idx} className="flex items-center gap-2">
                          <span className="flex-1 text-sm text-ios-label truncate">{line.flowerName}</span>
                          <input type="number" min="1" value={line.quantity}
                            onChange={e => setEditLines(p => p.map((l, i) => i === idx ? { ...l, quantity: Number(e.target.value) || 1 } : l))}
                            className="w-14 text-center text-sm border border-gray-200 rounded-lg py-1.5" />
                          <button onClick={() => setRemoveIdx(idx)} className="text-red-400 text-sm px-1">✕</button>
                        </div>
                      ))}

                      {removeIdx != null && (
                        <div className="bg-amber-50 rounded-xl px-3 py-2 space-y-2">
                          <p className="text-sm text-amber-800">{editLines[removeIdx]?.flowerName}</p>
                          <div className="flex gap-2">
                            <button onClick={() => {
                              const l = editLines[removeIdx];
                              setRemovedLines(p => [...p, { lineId: l.id, stockItemId: l.stockItemId, quantity: l._originalQty, action: 'return' }]);
                              setEditLines(p => p.filter((_, i) => i !== removeIdx));
                              setRemoveIdx(null);
                            }} className="flex-1 py-2 rounded-xl bg-green-600 text-white text-xs font-medium">
                              {t.returnToStock || 'Return'}
                            </button>
                            <button onClick={() => {
                              const l = editLines[removeIdx];
                              setRemovedLines(p => [...p, { lineId: l.id, stockItemId: l.stockItemId, quantity: l._originalQty, action: 'writeoff', reason: 'Bouquet edit' }]);
                              setEditLines(p => p.filter((_, i) => i !== removeIdx));
                              setRemoveIdx(null);
                            }} className="flex-1 py-2 rounded-xl bg-amber-600 text-white text-xs font-medium">
                              {t.writeOff || 'Write off'}
                            </button>
                          </div>
                          <button onClick={() => setRemoveIdx(null)} className="text-xs text-ios-tertiary">{t.cancel}</button>
                        </div>
                      )}

                      <div className="flex gap-2 pt-1">
                        <button onClick={async () => {
                          setSaving(true);
                          try {
                            await client.put(`/orders/${order.id}/lines`, { lines: editLines, removedLines });
                            setEditingBouquet(false);
                            const res = await client.get(`/orders/${order.id}`);
                            setDetail(res.data);
                            showToast(t.bouquetUpdated || 'Bouquet updated');
                          } catch (err) {
                            showToast(err.response?.data?.error || t.updateError, 'error');
                          } finally { setSaving(false); }
                        }} disabled={saving}
                          className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold"
                        >{saving ? '...' : (t.save || 'Save')}</button>
                        <button onClick={() => { setEditingBouquet(false); setRemoveIdx(null); }}
                          className="px-4 py-2.5 rounded-xl bg-gray-100 text-ios-secondary text-sm"
                        >{t.cancel}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-gray-50 rounded-xl overflow-hidden divide-y divide-gray-100">
                      {detail.orderLines.map((line, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2">
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
                    </div>
                  )}
                </div>
              )}

              {/* Order date (shown in expanded view, not overview) */}
              {d['Order Date'] && (
                <div className="bg-gray-50 rounded-xl px-3 py-1">
                  <Row label={t.labelOrderDate} value={d['Order Date']} />
                </div>
              )}

              {/* Delivery details — date + time editable */}
              {isDelivery && detail.delivery && (
                <div>
                  <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.labelDelivery}</p>
                  <div className="bg-gray-50 rounded-xl px-3 py-2 space-y-2">
                    {/* Editable date */}
                    <div className="flex items-center justify-between gap-2 py-1">
                      <span className="text-xs text-ios-tertiary shrink-0">{t.labelDate}</span>
                      <div className="relative z-10">
                        <DatePicker
                          value={detail.delivery['Delivery Date'] || ''}
                          onChange={val => patchDelivery({ 'Delivery Date': val })}
                          placeholder={t.optional || '—'}
                        />
                      </div>
                    </div>
                    {/* Editable time slot */}
                    <div className="py-1">
                      <span className="text-xs text-ios-tertiary block mb-1.5">{t.labelTime}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {(timeSlots || FALLBACK_TIME_SLOTS).map(slot => (
                          <button
                            key={slot}
                            onClick={() => patchDelivery({
                              'Delivery Time': detail.delivery['Delivery Time'] === slot ? '' : slot,
                            })}
                            disabled={saving}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors active-scale disabled:opacity-40 ${
                              detail.delivery['Delivery Time'] === slot
                                ? 'bg-brand-600 text-white shadow-sm'
                                : 'bg-white text-ios-secondary border border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            {slot}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Row label={t.labelAddress}   value={detail.delivery['Delivery Address']} />
                    <Row label={t.labelRecipient} value={detail.delivery['Recipient Name']} />
                    <Row label={t.labelPhone}     value={detail.delivery['Recipient Phone']} />
                    <Row label={t.labelFee}       value={detail.delivery['Delivery Fee'] ? `${detail.delivery['Delivery Fee']} zł` : null} />
                  </div>
                </div>
              )}

              {/* Greeting card text — large, readable for writing onto physical card */}
              {detail['Greeting Card Text'] && (
                <div>
                  <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.labelCardMsg}</p>
                  <p className="text-lg text-ios-label bg-amber-50 rounded-xl px-4 py-3 leading-relaxed whitespace-pre-wrap">
                    {detail['Greeting Card Text']}
                  </p>
                </div>
              )}

              {/* Owner: Cost/Margin — computed from order lines */}
              {isOwner && (() => {
                // Compute cost from line items (detail endpoint doesn't pre-calculate this)
                const costTotal = (detail.orderLines || []).reduce(
                  (sum, l) => sum + Number(l['Cost Price Per Unit'] || 0) * Number(l['Quantity'] || 0), 0
                );
                const sellTotal = Number(detail['Price Override'] || 0)
                  || (detail.orderLines || []).reduce(
                    (sum, l) => sum + Number(l['Sell Price Per Unit'] || 0) * Number(l['Quantity'] || 0), 0
                  );
                const effectivePrice = sellTotal + Number(detail['Delivery Fee'] || 0);
                if (!costTotal && !effectivePrice) return null;
                const marginAmt = effectivePrice - costTotal;
                const marginPct = effectivePrice > 0 ? Math.round((marginAmt / effectivePrice) * 100) : 0;
                return (
                  <div>
                    <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.owner.finances}</p>
                    <div className="bg-gray-50 rounded-xl px-3 py-1">
                      <Row label={t.owner.cost} value={`${Math.round(costTotal)} zł`} />
                      <Row label={t.owner.margin} value={`${Math.round(marginAmt)} zł (${marginPct}%)`} />
                    </div>
                  </div>
                );
              })()}

              {/* Status controls */}
              <div>
                <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.labelStatus}</p>
                {(() => {
                  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
                  const visible = [currentStatus, ...allowed];
                  return (
                    <Pills
                      value={currentStatus}
                      onChange={val => patch({ 'Status': val })}
                      disabled={saving}
                      options={visible.map(s => ({ value: s, label: statusLabel(s) }))}
                    />
                  );
                })()}
              </div>

              {/* Payment controls */}
              <div>
                <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.labelPayment}</p>
                <div className="flex flex-col gap-2">
                  <Pills
                    value={d['Payment Status'] || 'Unpaid'}
                    onChange={val => patch({
                      'Payment Status': val,
                      ...(val === 'Unpaid' ? { 'Payment Method': '' } : {}),
                    })}
                    disabled={saving}
                    options={[
                      { value: 'Unpaid', label: t.unpaid },
                      { value: 'Paid',   label: t.paid },
                    ]}
                  />
                  {currentPaid && (
                    <Pills
                      value={d['Payment Method'] || ''}
                      onChange={val => patch({ 'Payment Method': val })}
                      disabled={saving}
                      options={(payMethods || FALLBACK_PAY_METHODS).map(m => ({ value: m, label: m }))}
                    />
                  )}
                </div>
              </div>

              {/* Notes */}
              {detail['Notes Original'] && (
                <div>
                  <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.labelNotes}</p>
                  <p className="text-sm text-ios-label bg-gray-50 rounded-xl px-3 py-2">{detail['Notes Original']}</p>
                </div>
              )}
            </>
          )}

          {/* Collapse button */}
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
            className="text-xs text-ios-tertiary text-center py-1 active-scale"
          >
            ▲ {t.collapse}
          </button>
        </div>
      )}
    </div>
  );
}
