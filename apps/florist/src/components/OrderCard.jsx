// OrderCard — expandable card that shows order summary, and when tapped
// expands inline to show full details + status/payment controls.
// No overlays, no fixed positioning — just normal DOM flow. Like flipping
// a kanban card over to see the full work order on the back.

import { useState, useEffect, memo } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import fmtDate from '../utils/formatDate.js';
import DatePicker from './DatePicker.jsx';
import useConfigLists from '../hooks/useConfigLists.js';
import { DissolvePremadesDialog, computePremadeShortfalls } from '@flower-studio/shared';

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

// Stock data (`editorStockItems`, `editorPremadeMap`) is hoisted to
// OrderListPage so a single shared fetch covers every card on screen.
// `onStockRefresh` lets the card ask the parent for fresh data after a
// mutation (e.g. after dissolving a premade bouquet mid-save).
function OrderCard({
  order,
  onOrderUpdated,
  onOrderDeleted,
  isOwner,
  editorStockItems: stockItems = [],
  editorPremadeMap: premadeMap = {},
  onStockRefresh,
}) {
  const { paymentMethods: payMethods, timeSlots, drivers } = useConfigLists();
  const { showToast } = useToast();
  const [expanded, setExpanded]   = useState(false);
  const [detail, setDetail]       = useState(null);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingBouquet, setEditingBouquet] = useState(false);
  const [editLines, setEditLines] = useState([]);
  const [removedLines, setRemovedLines] = useState([]);
  const [removeIdx, setRemoveIdx] = useState(null);
  const [stockAction, setStockAction] = useState(null); // null | 'pending' — shown before save when qty reduced
  const [addingFlower, setAddingFlower] = useState(false);
  const [flowerSearch, setFlowerSearch] = useState('');
  const [dissolveCandidates, setDissolveCandidates] = useState(null);

  const status     = order['Status'] || 'New';
  const styles     = STATUS_STYLES[status] || STATUS_STYLES['New'];
  const isDelivery = order['Delivery Type'] === 'Delivery' || detail?.['Delivery Type'] === 'Delivery';
  const isTerminal = ['Delivered', 'Picked Up', 'Cancelled'].includes(status);
  const request    = order['Customer Request'] || '';
  // Price Override replaces flower total only; delivery fee always added on top
  const _delFee    = isDelivery ? Number(order['Delivery Fee'] || 0) : 0;
  const _sellTotal = Number(order['Sell Total'] || 0);
  const price      = order['Final Price'] || ((order['Price Override'] || _sellTotal) + _delFee) || '';
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

  async function handleDelete() {
    setSaving(true);
    try {
      const res = await client.delete(`/orders/${order.id}`);
      const returned = res.data.returnedItems || [];
      const summary = returned.length > 0
        ? returned.map(r => `${r.flowerName}: +${r.quantityReturned}`).join(', ')
        : '';
      showToast(`${t.orderDeleted || 'Order deleted'}${summary ? '. ' + summary : ''}`, 'success');
      onOrderDeleted?.(order.id);
    } catch (err) {
      showToast(err.response?.data?.error || t.updateError, 'error');
      setConfirmDelete(false);
      setSaving(false);
    }
    // Note: on success the parent unmounts this card, so we don't
    // clear saving — the component is about to disappear anyway.
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
  async function doSave(action, { skipShortfallCheck = false } = {}) {
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

      // Gate: if the save would push any flower's stock negative AND premade
      // bouquets hold stems of that flower, pause and ask the owner. Dialog
      // re-enters here via confirmDissolveAndSave with skipShortfallCheck = true.
      if (!skipShortfallCheck) {
        const shortfalls = computePremadeShortfalls({
          editLines, finalRemoved, stockItems, premadeMap,
        });
        if (shortfalls.length > 0) {
          setDissolveCandidates({ shortfalls, pendingAction: action });
          setSaving(false);
          return;
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

  // Dissolve selected premades (returns remaining stems to stock + deletes the
  // bouquet record) and retry the save with the shortfall check bypassed.
  async function confirmDissolveAndSave(bouquetIds) {
    const action = dissolveCandidates?.pendingAction ?? null;
    setDissolveCandidates(null);
    setSaving(true);
    for (const id of bouquetIds) {
      try {
        await client.post(`/premade-bouquets/${id}/dissolve`);
      } catch (err) {
        showToast(err.response?.data?.error || t.updateError, 'error');
      }
    }
    // Ask the parent to re-fetch so stock + premade counts reflect the
    // dissolve before the retry runs its shortfall check.
    if (onStockRefresh) {
      try { await onStockRefresh(); } catch {}
    }
    await doSave(action, { skipShortfallCheck: true });
  }

  // Use detail data if loaded, otherwise fall back to list data
  const d = detail || order;
  const currentStatus = d['Status'] || 'New';
  const currentPaid   = d['Payment Status'] === 'Paid';
  // Price Override replaces flower total only; delivery fee always added on top.
  // While editing the bouquet, compute the line total from the in-memory editLines
  // (using live stock sell prices) so Flowers / Total update as quantities change.
  const savedLineTotal = (detail?.orderLines || []).reduce((sum, l) =>
    sum + (l['Sell Price Per Unit'] || 0) * (l.Quantity || 0), 0);
  const editingLineTotal = editingBouquet
    ? editLines.reduce((sum, l) => {
        const si = l.stockItemId ? stockItems.find(s => s.id === l.stockItemId) : null;
        const price = Number(si?.['Current Sell Price'] ?? l.sellPricePerUnit ?? 0);
        return sum + price * Number(l.quantity || 0);
      }, 0)
    : null;
  const detailLineTotal = editingLineTotal != null ? editingLineTotal : savedLineTotal;
  const detailDeliveryFee = Number(detail?.delivery?.['Delivery Fee'] || d['Delivery Fee'] || 0);
  const flowerTotal = detailLineTotal > 0 ? detailLineTotal : (Number(d['Sell Total']) || 0);
  const currentPrice = (d['Price Override'] || flowerTotal) + detailDeliveryFee;

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
                    {(!isTerminal || isOwner) && !editingBouquet && (
                      <button onClick={async () => {
                        setEditLines(detail.orderLines.map(l => ({
                          id: l.id, stockItemId: l['Stock Item']?.[0] || null,
                          flowerName: l['Flower Name'], quantity: l.Quantity,
                          _originalQty: l.Quantity,
                          costPricePerUnit: Number(l['Cost Price Per Unit']) || 0,
                          sellPricePerUnit: Number(l['Sell Price Per Unit']) || 0,
                        })));
                        setRemovedLines([]);
                        setAddingFlower(false);
                        setFlowerSearch('');
                        setEditingBouquet(true);
                        // Stock + premade map come in as props (hoisted to
                        // OrderListPage). If the parent's list looks empty —
                        // e.g. its initial fetch is still in flight — ask it
                        // to refresh so the picker has data to show.
                        if (stockItems.length === 0 && onStockRefresh) {
                          onStockRefresh();
                        }
                      }} className="text-xs text-brand-600 font-medium">{t.edit || 'Edit'}</button>
                    )}
                  </div>

                  {editingBouquet ? (
                    <div className="bg-gray-50 rounded-xl px-3 py-3 space-y-2">
                      {editLines.map((line, idx) => {
                        const si = line.stockItemId ? stockItems.find(s => s.id === line.stockItemId) : null;
                        const liveSell = Number(si?.['Current Sell Price'] ?? line.sellPricePerUnit ?? 0);
                        const qtyNum = Number(line.quantity || 0);
                        const lineTotal = liveSell * qtyNum;
                        return (
                          <div key={line.id || idx} className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="flex-1 text-sm text-ios-label truncate">{line.flowerName}</span>
                              <input type="number" min="1" value={line.quantity}
                                onChange={e => setEditLines(p => p.map((l, i) => i === idx ? { ...l, quantity: e.target.value === '' ? '' : (Number(e.target.value) || 0) } : l))}
                                onBlur={e => { if (!e.target.value || Number(e.target.value) < 1) setEditLines(p => p.map((l, i) => i === idx ? { ...l, quantity: 1 } : l)); }}
                                onFocus={e => e.target.select()}
                                className="w-14 text-center text-sm border border-gray-200 rounded-lg py-1.5" />
                              <button onClick={() => setRemoveIdx(idx)} className="text-red-400 text-sm px-1">✕</button>
                            </div>
                            <div className="flex justify-between items-baseline pr-12">
                              <span className="text-xs text-ios-tertiary">
                                {liveSell > 0 ? `${liveSell.toFixed(0)} zł × ${qtyNum}` : '—'}
                              </span>
                              {liveSell > 0 && (
                                <span className="text-xs font-semibold text-brand-700">{lineTotal.toFixed(0)} zł</span>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Live flower total — updates as quantities change */}
                      {editLines.length > 0 && (() => {
                        const liveSellTotal = editLines.reduce((sum, l) => {
                          const si = l.stockItemId ? stockItems.find(s => s.id === l.stockItemId) : null;
                          const price = Number(si?.['Current Sell Price'] ?? l.sellPricePerUnit ?? 0);
                          return sum + price * Number(l.quantity || 0);
                        }, 0);
                        const originalTotal = Number(detail?.['Sell Total'] || 0);
                        const delta = originalTotal > 0 ? liveSellTotal - originalTotal : 0;
                        return (
                          <div className="flex justify-between items-baseline pt-1 border-t border-gray-200">
                            <span className="text-xs font-semibold text-ios-secondary uppercase tracking-wide">
                              {t.flowerTotal || 'Flowers'}
                            </span>
                            <div className="flex items-center gap-2">
                              {originalTotal > 0 && delta !== 0 && (
                                <span className={`text-xs font-bold ${delta > 0 ? 'text-red-500' : 'text-green-600'}`}>
                                  ({delta > 0 ? '+' : ''}{delta.toFixed(0)})
                                </span>
                              )}
                              <span className="text-sm font-bold text-brand-600">{liveSellTotal.toFixed(0)} zł</span>
                            </div>
                          </div>
                        );
                      })()}

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
                            {/* Stock results — positive OR negative qty; hide empties */}
                            {flowerSearch.length >= 1 && stockItems
                              .filter(s => {
                                const name = (s['Display Name'] || '').toLowerCase();
                                const q = flowerSearch.toLowerCase();
                                const qty = Number(s['Current Quantity']) || 0;
                                // Hide depleted dated batches (e.g. "Rose (14.Mar.)")
                                if (qty <= 0 && /\(\d{1,2}\.\w{3,4}\.?\)$/.test(s['Display Name'] || '')) return false;
                                // Hide exactly-zero base rows — they're clutter
                                // (duplicate records from earlier manual entries, etc.).
                                // Negative stock stays: it's implicit demand for the next PO.
                                if (qty === 0) return false;
                                return name.includes(q) && !editLines.some(l => l.stockItemId === s.id);
                              })
                              .slice(0, 6)
                              .map(s => {
                                const stockQty = Number(s['Current Quantity']) || 0;
                                const stockSell = Number(s['Current Sell Price']) || 0;
                                return (
                                  <div key={s.id}
                                    onPointerDown={e => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setEditLines(p => [...p, {
                                        id: null, stockItemId: s.id,
                                        flowerName: s['Display Name'],
                                        quantity: 1, _originalQty: 0,
                                        costPricePerUnit: Number(s['Current Cost Price']) || 0,
                                        sellPricePerUnit: stockSell,
                                      }]);
                                      setFlowerSearch('');
                                      setAddingFlower(false);
                                    }}
                                    className="w-full text-left px-2 py-2.5 text-sm active:bg-gray-100 dark:active:bg-gray-700 rounded cursor-pointer flex items-center justify-between gap-2"
                                  >
                                    <span className="font-medium truncate">{s['Display Name']}</span>
                                    <span className="text-xs text-ios-tertiary shrink-0">
                                      {stockSell > 0 && <span className="font-bold text-brand-700">{stockSell.toFixed(0)} zł</span>}
                                      {' · '}{stockQty} pcs
                                    </span>
                                  </div>
                                );
                              })}
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

                      {/* Stock action dialog — shown when Save is tapped and quantities
                          were reduced inline (e.g. 10→7). Fully-removed lines already
                          carry their own action from the per-line ✕ dialog. */}
                      {stockAction === 'pending' && (() => {
                        const reduced = editLines.filter(l => l._originalQty > 0 && l.quantity < l._originalQty);
                        const totalReduced = reduced.reduce((s, l) => s + (l._originalQty - l.quantity), 0);
                        return totalReduced > 0 ? (
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
                          // Only ask about spare flowers for INLINE quantity reductions.
                          // Lines removed via ✕ already chose return/writeoff per-line,
                          // so a second confirmation would be redundant.
                          const hasReductions = editLines.some(l => l._originalQty > 0 && l.quantity < l._originalQty);
                          if (hasReductions && stockAction !== 'pending') {
                            setStockAction('pending');
                            return;
                          }
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

              {/* ── Price Summary ── */}
              {(() => {
                const fTotal = flowerTotal;
                const overrideVal = d['Price Override'] ? Number(d['Price Override']) : null;
                const dFee = isDelivery ? detailDeliveryFee : 0;
                const grandTotal = (overrideVal || fTotal) + dFee;
                return (
                  <div className="bg-white border border-gray-200 rounded-xl px-3 py-2">
                    <div className="flex justify-between py-1.5">
                      <span className="text-xs text-ios-tertiary">{t.flowerTotal || 'Flowers'}</span>
                      <span className={`text-sm text-ios-label ${overrideVal ? 'line-through text-ios-tertiary' : 'font-medium'}`}>
                        {Math.round(fTotal)} zł
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1.5 border-t border-gray-100">
                      <span className="text-xs text-ios-tertiary">{t.priceOverride}</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          defaultValue={d['Price Override'] || ''}
                          onBlur={e => {
                            const val = e.target.value === '' ? null : Number(e.target.value);
                            if (val !== (d['Price Override'] || null)) patch({ 'Price Override': val });
                          }}
                          placeholder="—"
                          disabled={saving}
                          className="w-20 text-sm text-right text-ios-label bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 outline-none disabled:opacity-40"
                        />
                        <span className="text-xs text-ios-tertiary">zł</span>
                      </div>
                    </div>
                    {isDelivery && (
                      <div className="flex justify-between items-center py-1.5 border-t border-gray-100">
                        <span className="text-xs text-ios-tertiary">{t.labelFee}</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            defaultValue={detail?.delivery?.['Delivery Fee'] || ''}
                            onBlur={e => {
                              const val = e.target.value === '' ? 0 : Number(e.target.value);
                              if (val !== Number(detail?.delivery?.['Delivery Fee'] || 0)) patchDelivery({ 'Delivery Fee': val });
                            }}
                            placeholder="0"
                            disabled={saving}
                            className="w-20 text-sm text-right text-ios-label bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 outline-none disabled:opacity-40"
                          />
                          <span className="text-xs text-ios-tertiary">zł</span>
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between py-1.5 border-t border-gray-200">
                      <span className="text-xs font-semibold text-ios-label uppercase">{t.grandTotal || 'Total'}</span>
                      <span className="text-base font-bold text-brand-600">{Math.round(grandTotal)} zł</span>
                    </div>
                    {isOwner && (() => {
                      const costTotal = (detail.orderLines || []).reduce(
                        (sum, l) => sum + Number(l['Cost Price Per Unit'] || 0) * Number(l['Quantity'] || 0), 0
                      );
                      if (!costTotal) return null;
                      const marginAmt = grandTotal - costTotal;
                      const marginPct = grandTotal > 0 ? Math.round((marginAmt / grandTotal) * 100) : 0;
                      return (
                        <div className="flex justify-between py-1.5 border-t border-gray-100 text-xs text-ios-tertiary">
                          <span>{t.owner.cost}: {Math.round(costTotal)} zł</span>
                          <span>{t.owner.margin}: {Math.round(marginAmt)} zł ({marginPct}%)</span>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              {/* ── Greeting card (editable at any status) ── */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-1">
                  ✉ {t.labelCardMsg}
                </p>
                <textarea
                  defaultValue={detail['Greeting Card Text'] || ''}
                  onBlur={e => { if (e.target.value !== (detail['Greeting Card Text'] || '')) patch({ 'Greeting Card Text': e.target.value }); }}
                  placeholder={t.cardTextPlaceholder || t.cardText}
                  disabled={saving}
                  rows={2}
                  className="w-full text-base text-ios-label bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-xl px-3 py-2 outline-none disabled:opacity-40 whitespace-pre-wrap leading-relaxed"
                />
              </div>

              {/* ── Status controls ── */}
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
                {currentStatus !== 'Cancelled' && isTerminal && (
                  <button
                    onClick={async () => {
                      if (!confirm(t.cancelAndReturnConfirm || 'Cancel this order and return flowers to stock?')) return;
                      setSaving(true);
                      try {
                        const res = await client.post(`/orders/${order.id}/cancel-with-return`);
                        const returned = res.data.returnedItems || [];
                        const summary = returned.length > 0
                          ? returned.map(r => `${r.flowerName}: +${r.quantityReturned}`).join(', ')
                          : '';
                        showToast(`${t.orderCancelled || 'Cancelled'}${summary ? '. ' + summary : ''}`, 'success');
                        onOrderUpdated?.(order.id, { Status: 'Cancelled' });
                        setDetail(prev => prev ? { ...prev, Status: 'Cancelled' } : prev);
                      } catch (err) {
                        showToast(err.response?.data?.error || t.updateError, 'error');
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving}
                    className="mt-2 w-full py-2 rounded-xl bg-ios-red/10 text-ios-red text-sm font-medium active-scale disabled:opacity-40"
                  >
                    {t.cancelAndReturn || 'Cancel + return stock'}
                  </button>
                )}
              </div>

              {/* ── Payment controls ── */}
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
                  {currentPaid && (
                    <Pills
                      value={d['Payment Method'] || ''}
                      onChange={val => patch({ 'Payment Method': val })}
                      disabled={saving}
                      options={payMethods.map(m => ({ value: m, label: m }))}
                    />
                  )}
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
                            {t.grandTotal || 'Total'}: <span className="font-semibold text-ios-label">{effPrice} zł</span>
                          </p>
                        )}
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

              {/* ── Fulfillment type ── */}
              {!isTerminal && (
                <div>
                  <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.deliveryType || 'Fulfillment'}</p>
                  <Pills
                    value={d['Delivery Type'] || 'Pickup'}
                    onChange={async val => {
                      if (val === 'Delivery' && d['Delivery Type'] === 'Pickup' && !detail?.delivery) {
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

              {/* ── Date & time ── */}
              <div>
                <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">{t.labelDate || 'Date'}</p>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2 space-y-2">
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

              {/* ── Delivery details (address, recipient, phone) ── */}
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
                  </div>
                </div>
              )}

              {/* ── Driver assignment ── */}
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

              {/* ── Order date ── */}
              {d['Order Date'] && (
                <div className="bg-gray-50 rounded-xl px-3 py-1 space-y-0">
                  <Row label={t.labelOrderDate} value={fmtDate(d['Order Date'])} />
                  {detail['Notes Original'] && <Row label={t.customerNote} value={detail['Notes Original']} />}
                </div>
              )}

              {/* ── Owner-authored notes (editable at any stage) ── */}
              <div className="space-y-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-green-700 dark:text-green-300 mb-1">
                    🌸 {t.floristNote}
                  </p>
                  <textarea
                    defaultValue={detail['Florist Note'] || ''}
                    onBlur={e => { if (e.target.value !== (detail['Florist Note'] || '')) patch({ 'Florist Note': e.target.value }); }}
                    placeholder={t.floristNotePlaceholder}
                    disabled={saving}
                    rows={2}
                    className="w-full text-sm text-ios-label bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg px-2.5 py-1.5 outline-none disabled:opacity-40 whitespace-pre-wrap"
                  />
                </div>
                {isDelivery && detail.delivery && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-orange-700 dark:text-orange-300 mb-1">
                      🚗 {t.driverInstructions}
                    </p>
                    <textarea
                      defaultValue={detail.delivery['Driver Instructions'] || ''}
                      onBlur={e => { if (e.target.value !== (detail.delivery['Driver Instructions'] || '')) patchDelivery({ 'Driver Instructions': e.target.value }); }}
                      placeholder={t.driverInstructionsPlaceholder}
                      disabled={saving}
                      rows={2}
                      className="w-full text-sm text-ios-label bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-700 rounded-lg px-2.5 py-1.5 outline-none disabled:opacity-40 whitespace-pre-wrap"
                    />
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Danger zone — hard-delete the order (owner only). Distinct
              from Cancel: Cancel keeps the record for audit, Delete makes
              it disappear. Intended for test / duplicate / webhook-noise
              orders. Two-tap confirm so a fat-fingered swipe can't wipe
              a real order. */}
          {isOwner && !editingBouquet && (
            <div className="pt-3 border-t border-dashed border-gray-200 dark:border-gray-700">
              {!confirmDelete ? (
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                  disabled={saving}
                  className="w-full py-2 rounded-xl border border-ios-red/40 text-ios-red text-sm font-medium active-scale disabled:opacity-40"
                >
                  🗑 {t.deleteOrder || 'Delete order'}
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-ios-red font-semibold text-center">
                    {t.deleteOrderConfirm || 'Delete this order permanently? This cannot be undone.'}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                      disabled={saving}
                      className="flex-1 py-2 rounded-xl bg-ios-red text-white text-sm font-semibold active-scale disabled:opacity-50"
                    >
                      🗑 {t.deleteOrderConfirmYes || 'Delete permanently'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                      disabled={saving}
                      className="flex-1 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 text-ios-label text-sm font-medium active-scale"
                    >
                      {t.cancel}
                    </button>
                  </div>
                </div>
              )}
            </div>
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
      <DissolvePremadesDialog
        candidates={dissolveCandidates}
        saving={saving}
        onConfirm={confirmDissolveAndSave}
        onCancel={() => setDissolveCandidates(null)}
        labels={{
          title: t.dissolvePremadeTitle || 'Dissolve premade bouquets?',
          intro: t.dissolvePremadeIntro || 'These flowers are locked in premade bouquets. Pick which to dissolve — the remaining stems return to stock and the bouquet is deleted.',
          headerNeed: t.dissolvePremadeNeed || 'Need',
          headerAvail: t.dissolvePremadeAvail || 'Have',
          headerShort: t.dissolvePremadeShort || 'Short',
          cancel: t.cancel || 'Cancel',
          confirm: t.dissolvePremadeConfirm || 'Dissolve',
        }}
      />
    </div>
  );
}

// Fields on the `order` prop that drive visible card state. Restricted to
// what's actually shown in the collapsed + summary view — anything needed
// only inside the expanded detail lives in the fetched `detail` object,
// which isn't a prop.
const ORDER_COMPARE_FIELDS = [
  'Status',
  'Payment Status',
  'Delivery Date',
  'Required By',
  'Delivery Time',
  'Customer Name',
  'Customer Request',
  'Sell Total',
  'Delivery Fee',
  'Final Price',
  'Price Override',
  'Delivery Type',
  'Bouquet Summary',
  'App Order ID',
  'Source',
];

function arePropsEqual(prev, next) {
  if (prev.order.id !== next.order.id) return false;
  if (prev.isOwner !== next.isOwner) return false;
  if (prev.editorStockItems !== next.editorStockItems) return false;
  if (prev.editorPremadeMap !== next.editorPremadeMap) return false;
  if (prev.onStockRefresh !== next.onStockRefresh) return false;
  if (prev.onOrderUpdated !== next.onOrderUpdated) return false;
  if (prev.onOrderDeleted !== next.onOrderDeleted) return false;
  // stockShortfalls is keyed by stockId; the parent rebuilds it on every
  // shortfall poll. Compare by reference — if the parent is smart enough to
  // keep the same reference when content is unchanged, we skip re-render;
  // otherwise we re-render, which is the no-memo baseline anyway.
  if (prev.stockShortfalls !== next.stockShortfalls) return false;
  for (const k of ORDER_COMPARE_FIELDS) {
    if (prev.order[k] !== next.order[k]) return false;
  }
  return true;
}

export default memo(OrderCard, arePropsEqual);
