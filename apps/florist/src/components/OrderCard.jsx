// OrderCard — expandable card that shows order summary, and when tapped
// expands inline to show full details + status/payment controls.
// No overlays, no fixed positioning — just normal DOM flow. Like flipping
// a kanban card over to see the full work order on the back.

import { useState, useEffect } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import fmtDate from '../utils/formatDate.js';
import DatePicker from './DatePicker.jsx';
import useConfigLists from '../hooks/useConfigLists.js';

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
              : 'bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
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

export default function OrderCard({ order, onOrderUpdated, isOwner }) {
  const { paymentMethods: payMethods, timeSlots, drivers } = useConfigLists();
  const { showToast } = useToast();
  const [expanded, setExpanded]   = useState(false);
  const [detail, setDetail]       = useState(null);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [editingBouquet, setEditingBouquet] = useState(false);
  const [editLines, setEditLines] = useState([]);
  const [removedLines, setRemovedLines] = useState([]);
  const [removeIdx, setRemoveIdx] = useState(null);
  const [stockAction, setStockAction] = useState(null); // null | 'pending' — shown before save when qty reduced
  const [addingFlower, setAddingFlower] = useState(false);
  const [flowerSearch, setFlowerSearch] = useState('');
  const [stockItems, setStockItems] = useState([]);

  const status     = order['Status'] || 'New';
  const styles     = STATUS_STYLES[status] || STATUS_STYLES['New'];
  const isDelivery = order['Delivery Type'] === 'Delivery' || detail?.['Delivery Type'] === 'Delivery';
  const isTerminal = ['Delivered', 'Picked Up', 'Cancelled'].includes(status);
  const request    = order['Customer Request'] || '';
  // Total includes delivery fee — use backend's Final Price if present, else compute
  const _delFee    = isDelivery ? Number(order['Delivery Fee'] || 0) : 0;
  const _sellTotal = Number(order['Sell Total'] || 0);
  const price      = order['Final Price'] || order['Price Override'] || (_sellTotal + _delFee) || '';
  const isPaid     = order['Payment Status'] === 'Paid';
  const isPartialPayment = order['Payment Status'] === 'Partial';
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

  // Save bouquet edits — action is 'return', 'writeoff', or null (no stock changes needed)
  async function doSave(action) {
    setSaving(true);
    try {
      // For qty-reduced lines, add stock adjustment entries to removedLines
      const finalRemoved = [...removedLines];
      if (action) {
        for (const line of editLines) {
          if (line._originalQty > 0 && line.quantity < line._originalQty) {
            const delta = line._originalQty - line.quantity;
            finalRemoved.push({
              lineId: null, // not removing the line, just reducing qty
              stockItemId: line.stockItemId,
              quantity: delta,
              action,
              reason: action === 'writeoff' ? 'Bouquet edit' : undefined,
            });
          }
        }
        // Ensure fully removed lines also have the chosen action
        for (const rem of finalRemoved) {
          if (!rem.action) rem.action = action;
        }
      }
      await client.put(`/orders/${order.id}/lines`, { lines: editLines, removedLines: finalRemoved });
      setEditingBouquet(false);
      setStockAction(null);
      const res = await client.get(`/orders/${order.id}`);
      setDetail(res.data);
      showToast(t.bouquetUpdated || 'Bouquet updated');
    } catch (err) {
      showToast(err.response?.data?.error || t.updateError, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Use detail data if loaded, otherwise fall back to list data
  const d = detail || order;
  const currentStatus = d['Status'] || 'New';
  const currentPaid   = d['Payment Status'] === 'Paid';
  // Effective price: Price Override || (sell total + delivery fee)
  const detailLineTotal = (detail?.orderLines || []).reduce((sum, l) =>
    sum + (l['Sell Price Per Unit'] || 0) * (l.Quantity || 0), 0);
  const detailDeliveryFee = Number(detail?.delivery?.['Delivery Fee'] || d['Delivery Fee'] || 0);
  const currentPrice = d['Price Override'] || (detailLineTotal > 0 ? detailLineTotal + detailDeliveryFee : (d['Sell Total'] || price) ) || 0;

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
      {!currentPaid && currentStatus !== 'Cancelled' && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 flex items-center gap-2">
          <span className="text-red-500 text-sm">⚠</span>
          <span className="text-xs font-semibold text-red-700">{t.collectPayment || 'Collect payment before handing over'}</span>
        </div>
      )}

      {/* ── Summary (always visible) ── */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {order['App Order ID'] && (
            <span className="text-[11px] font-mono text-ios-tertiary">#{order['App Order ID']}</span>
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
            currentPaid ? 'bg-green-50 text-green-700'
              : (d['Payment Status'] === 'Partial' ? 'bg-orange-50 text-orange-600' : 'bg-red-50 text-red-500')
          }`}>
            {currentPaid ? t.paid : (d['Payment Status'] === 'Partial' ? (t.partial || 'Partial') : t.unpaid)}
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

      <p className="text-base font-semibold text-ios-label">{d['Customer Name'] || order['Customer Name'] || '—'}</p>
      {request && (
        <p className={`text-sm text-ios-tertiary mt-0.5 ${expanded ? '' : 'line-clamp-1'}`}>{request}</p>
      )}
      {order['Bouquet Summary'] && (
        <p className="text-xs text-brand-600/70 mt-1 line-clamp-1">🌸 {order['Bouquet Summary']}</p>
      )}
      {/* Show delivery/pickup date in overview — more actionable than order date */}
      {(order['Delivery Date'] || order['Required By']) && (
        <p className="text-sm text-ios-label font-semibold mt-1">
          {fmtDate(order['Delivery Date'] || order['Required By'])}
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

      {/* #44 — Status transition button on collapsed card */}
      {!expanded && !isTerminal && (() => {
        const nextStatuses = ALLOWED_TRANSITIONS[currentStatus] || [];
        // Pick the primary next action (first non-cancel transition)
        const primary = nextStatuses.find(s => s !== 'Cancelled');
        if (!primary) return null;
        const labelMap = {
          'Ready': t.markReady,
          'Delivered': t.markDelivered,
          'Picked Up': t.markPickedUp,
        };
        return (
          <div className="mt-2 pt-2 border-t border-gray-100">
            <button
              onClick={e => { e.stopPropagation(); patch({ 'Status': primary }); }}
              disabled={saving}
              className="w-full py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold active-scale disabled:opacity-40"
            >
              {labelMap[primary] || primary}
            </button>
          </div>
        );
      })()}

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
                      <button onClick={async () => {
                        setEditLines(detail.orderLines.map(l => ({
                          id: l.id, stockItemId: l['Stock Item']?.[0] || null,
                          flowerName: l['Flower Name'], quantity: l.Quantity,
                          _originalQty: l.Quantity,
                        })));
                        setRemovedLines([]);
                        setAddingFlower(false);
                        setFlowerSearch('');
                        setEditingBouquet(true);
                        // Lazy-load stock for the flower picker
                        if (stockItems.length === 0) {
                          client.get('/stock').then(r => setStockItems(r.data)).catch(() => {
                            showToast(t.loadError || 'Failed to load stock', 'error');
                          });
                        }
                      }} className="text-xs text-brand-600 font-medium">{t.edit || 'Edit'}</button>
                    )}
                  </div>

                  {editingBouquet ? (
                    <div className="bg-gray-50 rounded-xl px-3 py-3 space-y-2">
                      {editLines.map((line, idx) => (
                        <div key={line.id || idx} className="flex items-center gap-2">
                          <span className="flex-1 text-sm text-ios-label truncate">{line.flowerName}</span>
                          <input type="number" min="1" value={line.quantity}
                            onChange={e => setEditLines(p => p.map((l, i) => i === idx ? { ...l, quantity: e.target.value === '' ? '' : (Number(e.target.value) || 0) } : l))}
                            onBlur={e => { if (!e.target.value || Number(e.target.value) < 1) setEditLines(p => p.map((l, i) => i === idx ? { ...l, quantity: 1 } : l)); }}
                            onFocus={e => e.target.select()}
                            className="w-14 text-center text-sm border border-gray-200 rounded-lg py-1.5" />
                          <button onClick={() => setRemoveIdx(idx)} className="text-red-400 text-sm px-1">✕</button>
                        </div>
                      ))}

                      {/* Add flower picker */}
                      {!addingFlower ? (
                        <button onClick={() => setAddingFlower(true)}
                          className="w-full py-2 text-sm text-brand-600 font-medium bg-brand-50 rounded-lg active:bg-brand-100"
                        >+ {t.addFlower || 'Add flower'}</button>
                      ) : (
                        <div className="bg-white rounded-xl border border-gray-200 p-2 space-y-1">
                          <input type="text" value={flowerSearch}
                            onChange={e => setFlowerSearch(e.target.value)}
                            placeholder={t.flowerSearch || 'Search...'}
                            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none"
                            autoFocus />
                          <div className="max-h-36 overflow-y-auto divide-y divide-gray-50">
                            {/* Stock results — only items with qty > 0 */}
                            {flowerSearch.length >= 1 && stockItems
                              .filter(s => {
                                const name = (s['Display Name'] || '').toLowerCase();
                                const q = flowerSearch.toLowerCase();
                                const qty = Number(s['Current Quantity']) || 0;
                                // Hide depleted dated batches
                                if (qty <= 0 && /\(\d{1,2}\.\w{3,4}\.?\)$/.test(s['Display Name'] || '')) return false;
                                return name.includes(q) && !editLines.some(l => l.stockItemId === s.id);
                              })
                              .slice(0, 6)
                              .map(s => (
                                <div key={s.id}
                                  onPointerDown={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setEditLines(p => [...p, {
                                      id: null, stockItemId: s.id,
                                      flowerName: s['Display Name'],
                                      quantity: 1, _originalQty: 0,
                                      costPricePerUnit: Number(s['Current Cost Price']) || 0,
                                      sellPricePerUnit: Number(s['Current Sell Price']) || 0,
                                    }]);
                                    setFlowerSearch('');
                                    setAddingFlower(false);
                                  }}
                                  className="w-full text-left px-2 py-2.5 text-sm active:bg-gray-100 dark:active:bg-gray-700 rounded cursor-pointer"
                                >
                                  <span className="font-medium">{s['Display Name']}</span>
                                  <span className="text-xs text-ios-tertiary ml-1">
                                    ({Number(s['Current Quantity']) || 0} pcs)
                                  </span>
                                </div>
                              ))}
                            {/* Add unlisted flower */}
                            {flowerSearch.length >= 2 && !stockItems.some(s =>
                              (s['Display Name'] || '').toLowerCase() === flowerSearch.toLowerCase()
                            ) && (
                              <div
                                onPointerDown={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  try {
                                    const res = await client.post('/stock', {
                                      displayName: flowerSearch.trim(), quantity: 0,
                                    });
                                    setEditLines(p => [...p, {
                                      id: null, stockItemId: res.data.id,
                                      flowerName: res.data['Display Name'],
                                      quantity: 1, _originalQty: 0,
                                      costPricePerUnit: 0, sellPricePerUnit: 0,
                                    }]);
                                  } catch {
                                    setEditLines(p => [...p, {
                                      id: null, stockItemId: null,
                                      flowerName: flowerSearch.trim(),
                                      quantity: 1, _originalQty: 0,
                                      costPricePerUnit: 0, sellPricePerUnit: 0,
                                    }]);
                                  }
                                  setFlowerSearch('');
                                  setAddingFlower(false);
                                }}
                                className="w-full text-left px-2 py-2.5 text-sm text-brand-600 font-medium border-t border-gray-100 cursor-pointer active:bg-brand-50 rounded"
                              >+ {t.addNewFlower || 'Add new'} "{flowerSearch}"</div>
                            )}
                          </div>
                          <button onClick={() => { setAddingFlower(false); setFlowerSearch(''); }}
                            className="text-xs text-ios-tertiary">{t.cancel}</button>
                        </div>
                      )}

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

                      {/* Stock action dialog — shown when Save is tapped and quantities decreased */}
                      {stockAction === 'pending' && (() => {
                        const reduced = editLines.filter(l => l._originalQty > 0 && l.quantity < l._originalQty);
                        const totalReduced = reduced.reduce((s, l) => s + (l._originalQty - l.quantity), 0);
                        return totalReduced > 0 || removedLines.length > 0 ? (
                          <div className="bg-amber-50 rounded-xl px-3 py-3 space-y-2">
                            <p className="text-sm font-medium text-amber-800">
                              {t.spareFlowersQuestion || 'What would you like to do with the spare flowers?'}
                            </p>
                            <div className="flex gap-2">
                              <button onClick={() => doSave('return')}
                                className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium active-scale">
                                {t.returnToStock || 'Return to stock'}
                              </button>
                              <button onClick={() => doSave('writeoff')}
                                className="flex-1 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-medium active-scale">
                                {t.writeOff || 'Write off'}
                              </button>
                            </div>
                            <button onClick={() => setStockAction(null)} className="text-xs text-ios-tertiary">{t.cancel}</button>
                          </div>
                        ) : null;
                      })()}

                      <div className="flex gap-2 pt-1">
                        <button onClick={() => {
                          // Check if any quantities decreased or lines removed
                          const hasReductions = editLines.some(l => l._originalQty > 0 && l.quantity < l._originalQty);
                          const hasRemovals = removedLines.length > 0;
                          if ((hasReductions || hasRemovals) && stockAction !== 'pending') {
                            setStockAction('pending');
                            return;
                          }
                          // No reductions — save directly (additions or no changes)
                          doSave(null);
                        }} disabled={saving}
                          className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold"
                        >{saving ? '...' : (t.save || 'Save')}</button>
                        <button onClick={() => { setEditingBouquet(false); setRemoveIdx(null); setStockAction(null); }}
                          className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 text-sm"
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
                  <Row label={t.labelOrderDate} value={fmtDate(d['Order Date'])} />
                </div>
              )}

              {/* Date & time — same for delivery and pickup, uses patch (backend cascades to delivery) */}
              <div>
                <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.labelDate || 'Date'}</p>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2 space-y-2">
                  {/* Editable date */}
                  <div className="flex items-center justify-between gap-2 py-1">
                    <span className="text-xs text-ios-tertiary shrink-0">{t.labelDate}</span>
                    <div className="relative z-10">
                      <DatePicker
                        value={d['Required By'] || ''}
                        onChange={val => patch({ 'Required By': val || null })}
                        placeholder={t.selectDate || '—'}
                      />
                    </div>
                  </div>
                  {/* Editable time slot */}
                  <div className="py-1">
                    <span className="text-xs text-ios-tertiary block mb-1.5">{t.labelTime}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {timeSlots.map(slot => (
                        <button
                          key={slot}
                          onClick={() => patch({
                            'Delivery Time': d['Delivery Time'] === slot ? '' : slot,
                          })}
                          disabled={saving}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors active-scale disabled:opacity-40 ${
                            d['Delivery Time'] === slot
                              ? 'bg-brand-600 text-white shadow-sm'
                              : 'bg-white dark:bg-gray-800 text-ios-secondary dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                        >
                          {slot}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Delivery-specific: address, recipient, fee */}
              {isDelivery && detail.delivery && (
                <div>
                  <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.labelDelivery}</p>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2 space-y-2">
                    <div className="py-1">
                      <span className="text-xs text-ios-tertiary block mb-1">{t.labelAddress}</span>
                      <input
                        type="text"
                        defaultValue={detail.delivery['Delivery Address'] || ''}
                        onBlur={e => { if (e.target.value !== (detail.delivery['Delivery Address'] || '')) patchDelivery({ 'Delivery Address': e.target.value }); }}
                        placeholder="—"
                        disabled={saving}
                        className="w-full text-sm text-ios-label bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 outline-none disabled:opacity-40"
                      />
                    </div>
                    <div className="py-1">
                      <span className="text-xs text-ios-tertiary block mb-1">{t.labelRecipient}</span>
                      <input
                        type="text"
                        defaultValue={detail.delivery['Recipient Name'] || ''}
                        onBlur={e => { if (e.target.value !== (detail.delivery['Recipient Name'] || '')) patchDelivery({ 'Recipient Name': e.target.value }); }}
                        placeholder="—"
                        disabled={saving}
                        className="w-full text-sm text-ios-label bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 outline-none disabled:opacity-40"
                      />
                    </div>
                    <div className="py-1">
                      <span className="text-xs text-ios-tertiary block mb-1">{t.labelPhone}</span>
                      <input
                        type="tel"
                        defaultValue={detail.delivery['Recipient Phone'] || ''}
                        onBlur={e => { if (e.target.value !== (detail.delivery['Recipient Phone'] || '')) patchDelivery({ 'Recipient Phone': e.target.value }); }}
                        placeholder="—"
                        disabled={saving}
                        className="w-full text-sm text-ios-label bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 outline-none disabled:opacity-40"
                      />
                    </div>
                    <div className="py-1">
                      <span className="text-xs text-ios-tertiary block mb-1">{t.labelFee}</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          defaultValue={detail.delivery['Delivery Fee'] || ''}
                          onBlur={e => {
                            const val = e.target.value === '' ? 0 : Number(e.target.value);
                            if (val !== Number(detail.delivery['Delivery Fee'] || 0)) patchDelivery({ 'Delivery Fee': val });
                          }}
                          placeholder="0"
                          disabled={saving}
                          className="w-20 text-sm text-ios-label bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 outline-none disabled:opacity-40"
                        />
                        <span className="text-xs text-ios-tertiary">zł</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* #37 — Driver assignment for delivery orders */}
              {isDelivery && detail?.delivery && drivers.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.assignedDriver}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {drivers.map(driver => (
                      <button
                        key={driver}
                        onClick={() => patchDelivery({ 'Assigned Driver': detail.delivery['Assigned Driver'] === driver ? '' : driver })}
                        disabled={saving}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors active-scale disabled:opacity-40 ${
                          detail.delivery['Assigned Driver'] === driver
                            ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                            : 'bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {driver}
                      </button>
                    ))}
                  </div>
                  {!detail.delivery['Assigned Driver'] && (
                    <p className="text-xs text-ios-tertiary mt-1">{t.noDriver}</p>
                  )}
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
                const effectivePrice = sellTotal + Number(detail?.delivery?.['Delivery Fee'] || detail['Delivery Fee'] || 0);
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

              {/* Delivery type switch — allows changing Pickup↔Delivery after creation */}
              {!isTerminal && (
                <div>
                  <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.deliveryType || 'Delivery type'}</p>
                  <Pills
                    value={d['Delivery Type'] || 'Pickup'}
                    onChange={async val => {
                      if (val === 'Delivery' && d['Delivery Type'] === 'Pickup' && !detail?.delivery) {
                        // Switching Pickup → Delivery: create delivery record on-the-fly
                        setSaving(true);
                        try {
                          const res = await client.post(`/orders/${order.id}/convert-to-delivery`, {});
                          setDetail(prev => ({ ...prev, 'Delivery Type': 'Delivery', delivery: res.data }));
                          onOrderUpdated?.(order.id, { 'Delivery Type': 'Delivery' });
                          showToast(t.updated, 'success');
                        } catch (err) {
                          showToast(err.response?.data?.error || t.updateError, 'error');
                        } finally {
                          setSaving(false);
                        }
                      } else {
                        patch({ 'Delivery Type': val });
                      }
                    }}
                    disabled={saving}
                    options={[
                      { value: 'Pickup',   label: t.pickup || 'Pickup' },
                      { value: 'Delivery', label: t.delivery || 'Delivery' },
                    ]}
                  />
                </div>
              )}

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
                    onChange={val => {
                      const updates = { 'Payment Status': val };
                      if (val === 'Unpaid') {
                        updates['Payment Method'] = '';
                        updates['Payment 1 Amount'] = null;
                        updates['Payment 1 Method'] = null;
                        updates['Payment 2 Amount'] = null;
                        updates['Payment 2 Method'] = null;
                      }
                      patch(updates);
                    }}
                    disabled={saving}
                    options={[
                      { value: 'Unpaid',  label: t.unpaid },
                      { value: 'Paid',    label: t.paid },
                      { value: 'Partial', label: t.partial || 'Partial' },
                    ]}
                  />
                  {/* Paid directly — single method */}
                  {currentPaid && (
                    <Pills
                      value={d['Payment Method'] || ''}
                      onChange={val => patch({ 'Payment Method': val })}
                      disabled={saving}
                      options={payMethods.map(m => ({ value: m, label: m }))}
                    />
                  )}
                  {/* Partial payment flow */}
                  {d['Payment Status'] === 'Partial' && (() => {
                    const effPrice = currentPrice || 0;
                    const p1Amt = Number(d['Payment 1 Amount'] || 0);
                    const p1Mtd = d['Payment 1 Method'] || '';
                    const hasP1 = p1Amt > 0 && p1Mtd;
                    const rem = effPrice - p1Amt;
                    return (
                      <div className="bg-gray-50 rounded-xl px-3 py-3 space-y-3">
                        {effPrice > 0 && (
                          <p className="text-xs text-ios-tertiary">
                            {t.price || 'Total'}: <span className="font-semibold text-ios-label">{effPrice} zł</span>
                          </p>
                        )}
                        {/* Payment 1 */}
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-ios-tertiary uppercase">{t.payment1}</p>
                          <input
                            type="number"
                            value={d['Payment 1 Amount'] || ''}
                            onChange={e => {
                              const val = e.target.value === '' ? null : Number(e.target.value);
                              setDetail(prev => prev ? { ...prev, 'Payment 1 Amount': val } : prev);
                            }}
                            placeholder="0"
                            className="w-24 text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none"
                            disabled={saving}
                          />
                          <Pills
                            value={p1Mtd}
                            onChange={v => {
                              const amt = Number(detail?.['Payment 1 Amount'] || d['Payment 1 Amount'] || 0);
                              if (amt > 0) {
                                patch({ 'Payment 1 Amount': amt, 'Payment 1 Method': v });
                              } else {
                                setDetail(prev => prev ? { ...prev, 'Payment 1 Method': v } : prev);
                              }
                            }}
                            disabled={saving}
                            options={payMethods.map(m => ({ value: m, label: m }))}
                          />
                        </div>
                        {/* Remaining + Payment 2 */}
                        {hasP1 && (
                          <div className="border-t border-gray-200 pt-2 space-y-1.5">
                            <p className="text-xs text-ios-tertiary">
                              {t.paidAmount}: <span className="text-green-600 font-medium">{p1Amt} zł</span>
                              {' · '}
                              {t.remaining}: <span className="text-orange-600 font-semibold">{rem > 0 ? rem : 0} zł</span>
                            </p>
                            {rem > 0 && (
                              <div className="space-y-1.5">
                                <p className="text-xs font-semibold text-ios-tertiary uppercase">{t.payment2}</p>
                                <input
                                  type="number"
                                  value={d['Payment 2 Amount'] || rem || ''}
                                  onChange={e => {
                                    const val = e.target.value === '' ? null : Number(e.target.value);
                                    setDetail(prev => prev ? { ...prev, 'Payment 2 Amount': val } : prev);
                                  }}
                                  placeholder={String(rem)}
                                  className="w-24 text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none"
                                  disabled={saving}
                                />
                                <Pills
                                  value={d['Payment 2 Method'] || ''}
                                  onChange={v => {
                                    const amt = Number(detail?.['Payment 2 Amount'] || d['Payment 2 Amount'] || rem);
                                    patch({
                                      'Payment 2 Amount': amt,
                                      'Payment 2 Method': v,
                                      'Payment Status': 'Paid',
                                    });
                                  }}
                                  disabled={saving}
                                  options={payMethods.map(m => ({ value: m, label: m }))}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
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
