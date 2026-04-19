// OrderDetailPanel — expanded view with full order details + inline editing.
// Like opening a work order folder: see everything, change anything.

import { useState, useEffect } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import Pills from './Pills.jsx';
import InlineEdit from './InlineEdit.jsx';
import useConfigLists from '../hooks/useConfigLists.js';
import { DissolvePremadesDialog, computePremadeShortfalls } from '@flower-studio/shared';

// Split "Rose Red (14.Mar.)" into { name: "Rose Red", batch: "14.Mar." }
function parseBatchName(displayName) {
  const m = (displayName || '').match(/^(.+?)\s*\((\d{1,2}\.\w{3,4}\.?)\)$/);
  return m ? { name: m[1], batch: m[2] } : { name: displayName, batch: null };
}

const STATUSES = [
  { value: 'New',              label: t.statusNew,       activeClass: 'bg-indigo-600 text-white shadow-sm' },
  { value: 'Ready',            label: t.statusReady,     activeClass: 'bg-amber-600 text-white shadow-sm' },
  { value: 'Out for Delivery', label: t.statusOutForDel, activeClass: 'bg-sky-600 text-white shadow-sm' },
  { value: 'Delivered',        label: t.statusDelivered, activeClass: 'bg-emerald-600 text-white shadow-sm' },
  { value: 'Picked Up',        label: t.statusPickedUp,  activeClass: 'bg-teal-600 text-white shadow-sm' },
  { value: 'Cancelled',        label: t.statusCancelled, activeClass: 'bg-rose-600 text-white shadow-sm' },
];

const PAYMENT_STATUSES = [
  { value: 'Unpaid',  label: t.unpaid,  activeClass: 'bg-ios-red text-white shadow-sm' },
  { value: 'Paid',    label: t.paid,    activeClass: 'bg-ios-green text-white shadow-sm' },
  { value: 'Partial', label: t.partial, activeClass: 'bg-ios-orange text-white shadow-sm' },
];

const DELIVERY_TYPES = [
  { value: 'Delivery', label: '🚗 ' + t.delivery },
  { value: 'Pickup',   label: '🏪 ' + t.pickup },
];

export default function OrderDetailPanel({ orderId, onUpdate }) {
  const { paymentMethods: pmList, orderSources: srcList, timeSlots, targetMarkup } = useConfigLists();
  const PAYMENT_METHODS = pmList.map(v => ({ value: v, label: v }));
  const SOURCES = srcList.map(v => ({ value: v, label: v }));
  const [driverNames, setDriverNames] = useState([]);
  const DRIVERS = driverNames.map(v => ({ value: v, label: v }));
  const [order, setOrder]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editingBouquet, setEditingBouquet] = useState(false);
  const [editLines, setEditLines] = useState([]);
  const [removedLines, setRemovedLines] = useState([]);
  const [showRemoveDialog, setShowRemoveDialog] = useState(null);
  const [stockAction, setStockAction] = useState(null);
  const [addingFlower, setAddingFlower] = useState(false);
  const [flowerSearch, setFlowerSearch] = useState('');
  const [stockItems, setStockItems] = useState([]);
  const [newFlowerForm, setNewFlowerForm] = useState(null); // { name, costPrice, sellPrice, lotSize, supplier }
  const [pendingPO, setPendingPO] = useState({});
  // Premade reservations + pending dissolve dialog. Fetched lazily when the
  // owner opens the bouquet editor; only rendered when a save would push
  // stock negative for a flower that's locked in a premade.
  const [premadeMap, setPremadeMap] = useState({});
  const [dissolveCandidates, setDissolveCandidates] = useState(null);
  const { showToast } = useToast();

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [orderRes, settingsRes] = await Promise.all([
          client.get(`/orders/${orderId}`),
          client.get('/settings').catch(() => ({ data: { drivers: [] } })),
        ]);
        setOrder(orderRes.data);
        setDriverNames(settingsRes.data.drivers || []);
      } catch {
        showToast(t.error, 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [orderId, showToast]);

  async function patchOrder(fields) {
    setSaving(true);
    try {
      await client.patch(`/orders/${orderId}`, fields);
      // Update local state optimistically
      setOrder(prev => ({ ...prev, ...fields }));
      showToast(t.orderUpdated);
      onUpdate();
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function doSaveDashboard(action, { skipShortfallCheck = false } = {}) {
    setSaving(true);
    try {
      const finalRemoved = [...removedLines];
      if (action) {
        for (const line of editLines) {
          if (line._originalQty > 0 && line.quantity < line._originalQty) {
            finalRemoved.push({
              lineId: null, stockItemId: line.stockItemId,
              quantity: line._originalQty - line.quantity,
              action, reason: action === 'writeoff' ? 'Bouquet edit' : undefined,
            });
          }
        }
        for (const rem of finalRemoved) { if (!rem.action) rem.action = action; }
      }

      // Gate: if this save would push a flower's stock below zero AND some of
      // those stems are locked in premade bouquets, pause and ask the owner
      // whether to dissolve them. The dialog re-enters via confirmDissolveAndSave.
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

      await client.put(`/orders/${orderId}/lines`, { lines: editLines, removedLines: finalRemoved });
      setEditingBouquet(false);
      setStockAction(null);
      const res = await client.get(`/orders/${orderId}`);
      setOrder(res.data);
      showToast(t.bouquetUpdated);
      onUpdate();
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Dissolve each selected premade (returns remaining stems to stock + deletes
  // the bouquet), refresh stockItems/premadeMap, then retry the save with the
  // shortfall check bypassed.
  async function confirmDissolveAndSave(bouquetIds) {
    const action = dissolveCandidates?.pendingAction ?? null;
    setDissolveCandidates(null);
    setSaving(true);
    for (const id of bouquetIds) {
      try {
        await client.post(`/premade-bouquets/${id}/dissolve`);
      } catch (err) {
        showToast(err.response?.data?.error || t.error, 'error');
      }
    }
    try {
      const [stockRes, premadeRes] = await Promise.all([
        client.get('/stock'),
        client.get('/stock/premade-committed').catch(() => ({ data: {} })),
      ]);
      setStockItems(stockRes.data);
      setPremadeMap(premadeRes.data || {});
    } catch {}
    await doSaveDashboard(action, { skipShortfallCheck: true });
  }

  async function patchDelivery(fields) {
    if (!order.delivery?.id) return;
    setSaving(true);
    try {
      await client.patch(`/deliveries/${order.delivery.id}`, fields);
      setOrder(prev => ({
        ...prev,
        delivery: { ...prev.delivery, ...fields },
      }));
      showToast(t.orderUpdated);
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(returnStock = false) {
    setSaving(true);
    try {
      if (returnStock) {
        const res = await client.post(`/orders/${orderId}/cancel-with-return`);
        const returned = res.data.returnedItems || [];
        if (returned.length > 0) {
          const summary = returned.map(r => `${r.flowerName}: +${r.quantityReturned}`).join(', ');
          showToast(`${t.orderCancelled || 'Order cancelled'}. ${t.stockReturned || 'Returned'}: ${summary}`, 'success');
        } else {
          showToast(t.orderCancelled || 'Order cancelled', 'success');
        }
      } else {
        await patchOrder({ Status: 'Cancelled' });
      }
      const res = await client.get(`/orders/${orderId}`);
      setOrder(res.data);
      if (onUpdate) onUpdate();
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    } finally {
      setSaving(false);
      setConfirmCancel(false);
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-6 flex justify-center">
        <div className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!order) return null;

  const o = order;
  const isTerminal = o.Status === 'Delivered' || o.Status === 'Picked Up' || o.Status === 'Cancelled';
  const showPaymentMethod = o['Payment Status'] === 'Paid';

  // Price Override replaces flower total only; delivery fee always added on top.
  // While editing the bouquet, compute the line total from the in-memory editLines
  // (using live stock sell prices) so the grand-total badge updates as quantities
  // change. Parity with florist OrderCard.
  const savedLineTotal = (o.orderLines || []).reduce((sum, l) =>
    sum + (l['Sell Price Per Unit'] || 0) * (l.Quantity || 0), 0);
  const editingLineTotal = editingBouquet
    ? editLines.reduce((sum, l) => {
        const si = l.stockItemId ? stockItems.find(s => s.id === l.stockItemId) : null;
        const price = Number(si?.['Current Sell Price'] ?? l.sellPricePerUnit ?? 0);
        return sum + price * Number(l.quantity || 0);
      }, 0)
    : null;
  const lineTotal = editingLineTotal != null ? editingLineTotal : savedLineTotal;
  const deliveryFee = Number(o['Delivery Fee'] || o.delivery?.['Delivery Fee'] || 0);
  const effectivePrice = (o['Price Override'] || lineTotal) + deliveryFee;

  // Partial payment state
  const isPartial = o['Payment Status'] === 'Partial';
  const p1Amount = Number(o['Payment 1 Amount'] || 0);
  const p1Method = o['Payment 1 Method'] || '';
  const p2Amount = Number(o['Payment 2 Amount'] || 0);
  const p2Method = o['Payment 2 Method'] || '';
  const hasP1 = p1Amount > 0 && p1Method;
  const remainingAfterP1 = effectivePrice - p1Amount;

  return (
    <div className="border-t border-gray-100 px-4 py-4 bg-gray-50/70 space-y-5">
      {/* Status */}
      <Section label={t.status}>
        <Pills
          options={STATUSES}
          value={o.Status}
          onChange={v => patchOrder({ Status: v })}
          disabled={saving}
        />
      </Section>

      {/* Source + Delivery type row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section label={t.source}>
          <Pills
            options={SOURCES}
            value={o.Source}
            onChange={v => patchOrder({ Source: v })}
            disabled={saving}
          />
        </Section>
        <Section label={t.deliveryType}>
          <Pills
            options={DELIVERY_TYPES}
            value={o['Delivery Type']}
            onChange={async v => {
              if (v === 'Delivery' && o['Delivery Type'] === 'Pickup' && !o.delivery) {
                // Switching from Pickup to Delivery — create delivery record on-the-fly
                setSaving(true);
                try {
                  const res = await client.post(`/orders/${orderId}/convert-to-delivery`, {});
                  setOrder(prev => ({ ...prev, 'Delivery Type': 'Delivery', delivery: res.data }));
                  showToast(t.orderUpdated);
                  onUpdate();
                } catch (err) {
                  showToast(err.response?.data?.error || t.error, 'error');
                } finally {
                  setSaving(false);
                }
              } else {
                patchOrder({ 'Delivery Type': v });
              }
            }}
            disabled={saving}
          />
        </Section>
      </div>

      {/* Payment row */}
      <div className="space-y-3">
        <Section label={t.paymentStatus}>
          <Pills
            options={PAYMENT_STATUSES}
            value={o['Payment Status'] || 'Unpaid'}
            onChange={v => {
              const updates = { 'Payment Status': v };
              if (v === 'Unpaid') {
                updates['Payment Method'] = null;
                updates['Payment 1 Amount'] = null;
                updates['Payment 1 Method'] = null;
                updates['Payment 2 Amount'] = null;
                updates['Payment 2 Method'] = null;
              }
              patchOrder(updates);
            }}
            disabled={saving}
          />
        </Section>

        {/* Paid directly — single method picker */}
        {showPaymentMethod && (
          <Section label={t.paymentMethod}>
            <Pills
              options={PAYMENT_METHODS}
              value={o['Payment Method'] || ''}
              onChange={v => patchOrder({ 'Payment Method': v })}
              disabled={saving}
            />
          </Section>
        )}

        {/* Partial payment flow — two-step split payment */}
        {isPartial && (
          <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 space-y-3">
            {effectivePrice > 0 && (
              <p className="text-xs text-ios-tertiary">
                {t.price}: <span className="font-semibold text-ios-label">{effectivePrice.toFixed(0)} {t.zl}</span>
              </p>
            )}

            {/* Payment 1 */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">{t.payment1}</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={p1Amount || ''}
                  onChange={e => {
                    const val = e.target.value === '' ? null : Number(e.target.value);
                    setOrder(prev => ({ ...prev, 'Payment 1 Amount': val }));
                  }}
                  placeholder="0"
                  className="w-24 text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none"
                  disabled={saving}
                />
                <span className="text-xs text-ios-tertiary">{t.zl}</span>
              </div>
              <Pills
                options={PAYMENT_METHODS}
                value={p1Method}
                onChange={v => {
                  const amt = Number(order['Payment 1 Amount'] || 0);
                  if (amt > 0) {
                    patchOrder({ 'Payment 1 Amount': amt, 'Payment 1 Method': v });
                  } else {
                    setOrder(prev => ({ ...prev, 'Payment 1 Method': v }));
                  }
                }}
                disabled={saving}
              />
              {!hasP1 && p1Amount > 0 && p1Method && (
                <button
                  onClick={() => patchOrder({ 'Payment 1 Amount': p1Amount, 'Payment 1 Method': p1Method })}
                  disabled={saving}
                  className="text-xs text-brand-600 font-medium"
                >{t.save}</button>
              )}
            </div>

            {/* Remaining after Payment 1 */}
            {hasP1 && (
              <div className="border-t border-gray-100 pt-2 space-y-1">
                <p className="text-xs text-ios-tertiary">
                  {t.paidAmount}: <span className="font-medium text-ios-green">{p1Amount.toFixed(0)} {t.zl}</span>
                  {' · '}
                  {t.remaining}: <span className="font-semibold text-ios-orange">{remainingAfterP1.toFixed(0)} {t.zl}</span>
                </p>
              </div>
            )}

            {/* Payment 2 — only when P1 is saved */}
            {hasP1 && remainingAfterP1 > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">{t.payment2}</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={p2Amount || remainingAfterP1 || ''}
                    onChange={e => {
                      const val = e.target.value === '' ? null : Number(e.target.value);
                      setOrder(prev => ({ ...prev, 'Payment 2 Amount': val }));
                    }}
                    placeholder={remainingAfterP1.toFixed(0)}
                    className="w-24 text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none"
                    disabled={saving}
                  />
                  <span className="text-xs text-ios-tertiary">{t.zl}</span>
                </div>
                <Pills
                  options={PAYMENT_METHODS}
                  value={p2Method}
                  onChange={v => {
                    const amt = Number(order['Payment 2 Amount'] || remainingAfterP1);
                    // When Payment 2 is entered, auto-complete to Paid
                    patchOrder({
                      'Payment 2 Amount': amt,
                      'Payment 2 Method': v,
                      'Payment Status': 'Paid',
                    });
                  }}
                  disabled={saving}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Price override */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Section label={t.priceOverride}>
          <InlineEdit
            value={o['Price Override'] ? String(o['Price Override']) : ''}
            type="number"
            placeholder="—"
            onSave={v => patchOrder({ 'Price Override': v ? Number(v) : null })}
            disabled={saving}
          />
        </Section>
        <Section label={t.price}>
          <span className="text-sm font-semibold text-ios-label">
            {effectivePrice.toFixed(0)} {t.zl}
          </span>
        </Section>
      </div>

      {/* Order date — read-only. Shown here (not in the list row) so the
          collapsed view's date column can be the due date (delivery/pickup),
          which is what the owner needs for triage. */}
      {o['Order Date'] && (
        <Section label={t.orderDate || 'Order date'}>
          <span className="text-sm text-ios-label">
            {new Date(o['Order Date'] + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
          </span>
        </Section>
      )}

      {/* Customer request */}
      <Section label={t.request}>
        <InlineEdit
          value={o['Customer Request'] || ''}
          multiline
          placeholder="—"
          onSave={v => patchOrder({ 'Customer Request': v })}
          disabled={saving}
        />
      </Section>

      {/* Order lines (bouquet composition) */}
      {o.orderLines?.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">
              {t.bouquetComposition}
            </p>
            {/* Dashboard is owner-only (PIN-gated at login), so bouquet
                editing stays available in every status, including Delivered,
                Picked Up, and Cancelled. The backend still enforces owner
                role for terminal-status edits in editBouquetLines(). */}
            {!editingBouquet && (
              <button
                onClick={() => {
                  setEditLines(o.orderLines.map(l => ({
                    id: l.id, stockItemId: l['Stock Item']?.[0] || null,
                    flowerName: l['Flower Name'], quantity: l.Quantity,
                    _originalQty: l.Quantity,
                    costPricePerUnit: l['Cost Price Per Unit'] || 0,
                    sellPricePerUnit: l['Sell Price Per Unit'] || 0,
                  })));
                  setRemovedLines([]);
                  setAddingFlower(false);
                  setFlowerSearch('');
                  setEditingBouquet(true);
                  if (stockItems.length === 0) {
                    client.get('/stock').then(r => setStockItems(r.data)).catch(() => {});
                  }
                  client.get('/stock/pending-po').then(r => setPendingPO(r.data)).catch(() => {});
                  client.get('/stock/premade-committed').then(r => setPremadeMap(r.data || {})).catch(() => setPremadeMap({}));
                }}
                className="text-xs text-brand-600 font-medium"
              >{t.editBouquet}</button>
            )}
          </div>

          {editingBouquet ? (() => {
            // Running totals — sell uses live stock price (fallback to snapshot)
            // so if a stock sell price is edited elsewhere mid-edit, the editor
            // reflects it immediately. Cost stays on the snapshot because cost
            // rarely changes post-PO and the snapshot is the "true paid" value.
            // Parity with florist OrderCard.
            const editCostTotal = editLines.reduce((s, l) => s + Number(l.costPricePerUnit || 0) * Number(l.quantity || 0), 0);
            const editSellTotal = editLines.reduce((sum, l) => {
              const si = l.stockItemId ? stockItems.find(x => x.id === l.stockItemId) : null;
              const price = Number(si?.['Current Sell Price'] ?? l.sellPricePerUnit ?? 0);
              return sum + price * Number(l.quantity || 0);
            }, 0);
            const editMargin = editSellTotal > 0 ? Math.round(((editSellTotal - editCostTotal) / editSellTotal) * 100) : 0;
            // Delta vs saved original so the owner sees how much the bouquet
            // total has shifted since last save. Red over, green under.
            const originalSellTotal = Number(o['Sell Total'] || 0);
            const sellDelta = originalSellTotal > 0 ? editSellTotal - originalSellTotal : 0;
            // Detect quantity reductions that need stock decision (only for lines that had stock before)
            const hasReductions = editLines.some(l => l._originalQty > 0 && l.quantity < l._originalQty);
            // removedLines that already have explicit actions from the remove dialog
            const hasExplicitRemovals = removedLines.some(r => r.lineId);
            // Only lines with quantity reductions (not full removals) need a global stock decision
            const needsStockDecision = hasReductions && !stockAction;
            return (
            <div className="space-y-2">
              {/* Edit lines with sell price × qty like the order wizard */}
              {editLines.map((line, idx) => {
                const lineSell = Number(line.sellPricePerUnit || 0) * Number(line.quantity || 0);
                const { name: parsedName, batch } = parseBatchName(line.flowerName);
                return (
                <div key={line.id || idx} className="bg-gray-50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-ios-label truncate block">
                        {parsedName}
                        {batch && <span className="ml-1 text-[10px] font-normal text-ios-tertiary bg-gray-100 rounded px-1 py-0.5">{batch}</span>}
                      </span>
                      <span className="text-xs text-ios-tertiary">
                        {Number(line.sellPricePerUnit || 0).toFixed(0)} {t.zl} × {line.quantity} = <strong className="text-brand-700">{lineSell.toFixed(0)} {t.zl}</strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => setEditLines(prev => prev.map((l, i) => i === idx ? { ...l, quantity: Math.max(1, (Number(l.quantity) || 1) - 1) } : l))}
                        className="w-7 h-7 rounded-full bg-white text-ios-secondary text-lg font-bold flex items-center justify-center">−</button>
                      <input type="number" min="1" value={line.quantity}
                        onChange={e => setEditLines(prev => prev.map((l, i) => i === idx ? { ...l, quantity: e.target.value === '' ? '' : (Number(e.target.value) || 0) } : l))}
                        onBlur={e => { if (!e.target.value || Number(e.target.value) < 1) setEditLines(prev => prev.map((l, i) => i === idx ? { ...l, quantity: 1 } : l)); }}
                        onFocus={e => e.target.select()}
                        className="w-10 text-center text-sm font-bold border border-gray-200 rounded-lg py-1" />
                      <button onClick={() => setEditLines(prev => prev.map((l, i) => i === idx ? { ...l, quantity: (Number(l.quantity) || 0) + 1 } : l))}
                        className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-lg font-bold flex items-center justify-center">+</button>
                    </div>
                    <button onClick={() => setShowRemoveDialog(idx)}
                      className="text-red-400 hover:text-red-600 text-sm px-1">✕</button>
                  </div>
                </div>
                );
              })}

              {/* Sell total + cost + margin — like order wizard. Sell total
                  shows a coloured delta vs. saved original (red over, green
                  under) so the owner sees at a glance how much an edit moved
                  the price. Parity with florist "Flowers" footer. */}
              {editLines.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-ios-label">{t.sellTotal}</span>
                    <div className="flex items-center gap-2">
                      {originalSellTotal > 0 && sellDelta !== 0 && (
                        <span className={`text-xs font-bold ${sellDelta > 0 ? 'text-red-500' : 'text-green-600'}`}>
                          ({sellDelta > 0 ? '+' : ''}{sellDelta.toFixed(0)})
                        </span>
                      )}
                      <span className="text-base font-bold text-brand-600">{editSellTotal.toFixed(0)} {t.zl}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1 pt-1 border-t border-gray-50">
                    <span className="text-xs text-ios-tertiary">{t.costTotal} · {t.markup}: {editMargin}%</span>
                    <span className="text-xs text-ios-tertiary font-medium">{editCostTotal.toFixed(0)} {t.zl}</span>
                  </div>
                </div>
              )}

              {/* Add flower picker — shows stock catalog immediately */}
              {!addingFlower ? (
                <button onClick={() => setAddingFlower(true)}
                  className="w-full py-2 text-sm text-brand-600 font-medium bg-brand-50 rounded-lg hover:bg-brand-100"
                >+ {t.addFlower}</button>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 p-2 space-y-1">
                  <input type="text" value={flowerSearch}
                    onChange={e => setFlowerSearch(e.target.value)}
                    placeholder={t.flowerSearch}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none"
                    autoFocus />
                  <div className="flex items-center text-[10px] text-ios-tertiary uppercase tracking-wide px-2 pt-1">
                    <span className="flex-1">{t.flowers}</span>
                    <span className="w-14 text-right">{t.costPrice}</span>
                    <span className="w-14 text-right">{t.sellPrice}</span>
                    <span className="w-12 text-right">{t.quantity} <span className="text-blue-500">{t.onOrderShort || '+PO'}</span></span>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-gray-50">
                    {stockItems
                      .filter(s => {
                        const name = (s['Display Name'] || '').toLowerCase();
                        const qty = Number(s['Current Quantity']) || 0;
                        if (qty <= 0 && /\(\d{1,2}\.\w{3,4}\.?\)$/.test(s['Display Name'] || '')) return false;
                        if (editLines.some(l => l.stockItemId === s.id)) return false;
                        if (flowerSearch) return name.includes(flowerSearch.toLowerCase());
                        return true;
                      })
                      .slice(0, 20)
                      .map(s => {
                        const qty = Number(s['Current Quantity']) || 0;
                        const cost = Number(s['Current Cost Price']) || 0;
                        const sell = Number(s['Current Sell Price']) || 0;
                        const poQty = pendingPO[s.id]?.ordered || 0;
                        const { name: fn, batch } = parseBatchName(s['Display Name']);
                        return (
                          <button key={s.id} type="button"
                            onClick={() => {
                              setEditLines(p => [...p, {
                                id: null, stockItemId: s.id, flowerName: s['Display Name'],
                                quantity: 1, _originalQty: 0,
                                costPricePerUnit: cost,
                                sellPricePerUnit: sell,
                              }]);
                              setFlowerSearch('');
                            }}
                            className={`w-full flex items-center px-2 py-1.5 text-sm hover:bg-gray-50 rounded ${qty <= 0 ? 'bg-amber-50/50' : ''}`}
                          >
                            <span className="flex-1 font-medium text-left truncate">
                              {fn}
                              {batch && <span className="ml-1 text-[10px] font-normal text-ios-tertiary bg-gray-100 rounded px-1 py-0.5">{batch}</span>}
                            </span>
                            <span className="w-14 text-right text-xs text-ios-tertiary">{cost > 0 ? cost.toFixed(0) : '—'}</span>
                            <span className="w-14 text-right text-xs text-ios-secondary">{sell > 0 ? `${sell.toFixed(0)}` : '—'}</span>
                            <span className={`w-12 text-right text-xs font-medium ${qty <= 0 ? 'text-amber-600' : 'text-ios-label'}`}>
                              {qty}
                              {poQty > 0 && <span className="text-blue-600"> +{poQty}</span>}
                            </span>
                          </button>
                        );
                      })}
                    {flowerSearch.length >= 2 && !stockItems.some(s =>
                      (s['Display Name'] || '').toLowerCase() === flowerSearch.toLowerCase()
                    ) && (
                      <button type="button"
                        onClick={() => {
                          setNewFlowerForm({ name: flowerSearch.trim(), costPrice: '', sellPrice: '', lotSize: '', supplier: '' });
                          setAddingFlower(false);
                        }}
                        className="w-full text-left px-2 py-1.5 text-sm text-brand-600 font-medium border-t border-gray-100"
                      >+ {t.addNewFlower} "{flowerSearch}"</button>
                    )}
                  </div>
                  <button onClick={() => { setAddingFlower(false); setFlowerSearch(''); }}
                    className="text-xs text-ios-tertiary">{t.cancel}</button>
                </div>
              )}

              {/* New flower form — cost, sell, lot size, supplier */}
              {newFlowerForm && (
                <div className="bg-indigo-50 rounded-xl px-4 py-3 space-y-2">
                  <p className="text-sm font-semibold text-indigo-800">{t.addNewFlower}: {newFlowerForm.name}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" step="0.01" value={newFlowerForm.costPrice}
                      onChange={e => {
                        const cost = e.target.value;
                        setNewFlowerForm(p => ({
                          ...p, costPrice: cost,
                          sellPrice: cost && targetMarkup ? String(Math.round(Number(cost) * targetMarkup)) : p.sellPrice,
                        }));
                      }}
                      placeholder={t.costPrice} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                    <input type="number" step="0.01" value={newFlowerForm.sellPrice}
                      onChange={e => setNewFlowerForm(p => ({ ...p, sellPrice: e.target.value }))}
                      placeholder={t.sellPrice} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" value={newFlowerForm.lotSize}
                      onChange={e => setNewFlowerForm(p => ({ ...p, lotSize: e.target.value }))}
                      placeholder={t.lotSize} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                    <input type="text" value={newFlowerForm.supplier}
                      onChange={e => setNewFlowerForm(p => ({ ...p, supplier: e.target.value }))}
                      placeholder={t.supplier} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                  </div>
                  <div className="flex gap-2">
                    <button type="button"
                      onClick={async () => {
                        try {
                          const res = await client.post('/stock', {
                            displayName: newFlowerForm.name,
                            costPrice: Number(newFlowerForm.costPrice) || 0,
                            sellPrice: Number(newFlowerForm.sellPrice) || 0,
                            lotSize: Number(newFlowerForm.lotSize) || 1,
                            supplier: newFlowerForm.supplier || '',
                            quantity: 0,
                          });
                          setEditLines(p => [...p, {
                            id: null, stockItemId: res.data.id, flowerName: res.data['Display Name'],
                            quantity: 1, _originalQty: 0,
                            costPricePerUnit: Number(newFlowerForm.costPrice) || 0,
                            sellPricePerUnit: Number(newFlowerForm.sellPrice) || 0,
                          }]);
                        } catch {
                          setEditLines(p => [...p, {
                            id: null, stockItemId: null, flowerName: newFlowerForm.name,
                            quantity: 1, _originalQty: 0,
                            costPricePerUnit: Number(newFlowerForm.costPrice) || 0,
                            sellPricePerUnit: Number(newFlowerForm.sellPrice) || 0,
                          }]);
                        }
                        setNewFlowerForm(null);
                        setFlowerSearch('');
                      }}
                      className="flex-1 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold"
                    >{t.addToCart}</button>
                    <button type="button" onClick={() => setNewFlowerForm(null)}
                      className="px-4 py-2 rounded-xl bg-gray-100 text-ios-secondary text-sm"
                    >{t.cancel}</button>
                  </div>
                </div>
              )}

              {/* Remove dialog — return to stock, write off, or adjust PO */}
              {showRemoveDialog != null && (() => {
                const line = editLines[showRemoveDialog];
                const si = stockItems.find(s => s.id === line?.stockItemId);
                const currentQty = Number(si?.['Current Quantity'] ?? 0);
                const isNegativeStock = currentQty < 0;
                return (
                  <div className={`${isNegativeStock ? 'bg-blue-50' : 'bg-amber-50'} rounded-xl px-4 py-3 space-y-2`}>
                    <p className={`text-sm font-medium ${isNegativeStock ? 'text-blue-800' : 'text-amber-800'}`}>
                      {line?.flowerName}: {isNegativeStock ? t.notReceivedYet : t.returnOrWriteOff}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setRemovedLines(prev => [...prev, { lineId: line.id, stockItemId: line.stockItemId, quantity: line._originalQty, action: 'return' }]);
                          setEditLines(prev => prev.filter((_, i) => i !== showRemoveDialog));
                          setShowRemoveDialog(null);
                        }}
                        className="flex-1 py-2 rounded-xl bg-green-600 text-white text-sm font-medium"
                      >{t.returnToStock}</button>
                      {isNegativeStock ? (
                        <button
                          onClick={() => {
                            setRemovedLines(prev => [...prev, { lineId: line.id, stockItemId: line.stockItemId, quantity: line._originalQty, action: 'return' }]);
                            setEditLines(prev => prev.filter((_, i) => i !== showRemoveDialog));
                            setShowRemoveDialog(null);
                            showToast(t.adjustPO, 'info');
                          }}
                          className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium"
                        >{t.adjustPO}</button>
                      ) : (
                        <button
                          onClick={() => {
                            setRemovedLines(prev => [...prev, { lineId: line.id, stockItemId: line.stockItemId, quantity: line._originalQty, action: 'writeoff', reason: 'Bouquet edit' }]);
                            setEditLines(prev => prev.filter((_, i) => i !== showRemoveDialog));
                            setShowRemoveDialog(null);
                          }}
                          className="flex-1 py-2 rounded-xl bg-amber-600 text-white text-sm font-medium"
                        >{t.writeOff}</button>
                      )}
                    </div>
                    <button onClick={() => setShowRemoveDialog(null)} className="text-xs text-ios-tertiary">
                      {t.cancel}
                    </button>
                  </div>
                );
              })()}

              {/* Stock action dialog — ONLY for quantity reductions (not full removals, those are handled above) */}
              {stockAction === 'pending' && (() => {
                const reduced = editLines.filter(l => l._originalQty > 0 && l.quantity < l._originalQty);
                const totalReduced = reduced.reduce((s, l) => s + (l._originalQty - l.quantity), 0);
                return totalReduced > 0 ? (
                  <div className="bg-amber-50 rounded-xl px-4 py-3 space-y-2">
                    <p className="text-sm font-medium text-amber-800">
                      {t.spareFlowersQuestion}
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => doSaveDashboard('return')}
                        className="flex-1 py-2 rounded-xl bg-green-600 text-white text-sm font-medium">
                        {t.returnToStock}</button>
                      <button onClick={() => doSaveDashboard('writeoff')}
                        className="flex-1 py-2 rounded-xl bg-amber-600 text-white text-sm font-medium">
                        {t.writeOff}</button>
                    </div>
                    <button onClick={() => setStockAction(null)} className="text-xs text-ios-tertiary">{t.cancel}</button>
                  </div>
                ) : null;
              })()}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    const hasQtyReductions = editLines.some(l => l._originalQty > 0 && l.quantity < l._originalQty);
                    if (hasQtyReductions && stockAction !== 'pending') {
                      setStockAction('pending');
                      return;
                    }
                    doSaveDashboard(null);
                  }}
                  disabled={saving}
                  className="flex-1 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold"
                >{saving ? '...' : t.saveBouquet}</button>
                <button
                  onClick={() => { setEditingBouquet(false); setShowRemoveDialog(null); setStockAction(null); }}
                  className="px-4 py-2 rounded-xl bg-gray-100 text-ios-secondary text-sm"
                >{t.cancel}</button>
              </div>
            </div>
            );
          })()
          : (
            <div className="bg-white rounded-xl overflow-hidden border border-gray-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-ios-tertiary border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium">{t.flowers}</th>
                    <th className="text-right px-3 py-2 font-medium">{t.quantity}</th>
                    <th className="text-right px-3 py-2 font-medium">{t.costPrice}</th>
                    <th className="text-right px-3 py-2 font-medium">{t.sellPrice}</th>
                    <th className="text-right px-3 py-2 font-medium">{t.orderTotal}</th>
                  </tr>
                </thead>
                <tbody>
                  {o.orderLines.map(line => (
                    <tr key={line.id} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-ios-label">{line['Flower Name'] || '—'}</td>
                      <td className="px-3 py-2 text-right">{line.Quantity}</td>
                      <td className="px-3 py-2 text-right text-ios-tertiary">
                        {(line['Cost Price Per Unit'] || 0).toFixed(0)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {(line['Sell Price Per Unit'] || 0).toFixed(0)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {((line['Sell Price Per Unit'] || 0) * (line.Quantity || 0)).toFixed(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Delivery method + driver (for delivery orders) */}
      {o['Delivery Type'] === 'Delivery' && o.delivery && (
        <div className="space-y-3">
          <Section label={t.deliveryMethod || 'Delivery method'}>
            <Pills
              options={[
                { value: 'Driver',  label: t.deliveryMethodDriver || 'Driver' },
                { value: 'Taxi',    label: t.deliveryMethodTaxi || 'Taxi' },
                { value: 'Florist', label: t.deliveryMethodFlorist || 'Florist' },
              ]}
              value={o.delivery?.['Delivery Method'] || 'Driver'}
              onChange={v => {
                const patch = { 'Delivery Method': v };
                if (v === 'Taxi') {
                  patch['Assigned Driver'] = '';
                  patch['Driver Payout'] = 0;
                } else if (v === 'Florist') {
                  patch['Assigned Driver'] = '';
                  patch['Driver Payout'] = 0;
                  patch['Taxi Cost'] = 0;
                } else {
                  patch['Taxi Cost'] = 0;
                }
                patchDelivery(patch);
              }}
              disabled={saving}
            />
          </Section>

          {/* Driver picker — only when method is Driver */}
          {(o.delivery?.['Delivery Method'] || 'Driver') === 'Driver' && (
            <Section label={t.driver}>
              <Pills
                options={DRIVERS}
                value={o.delivery?.['Assigned Driver'] || ''}
                onChange={v => patchDelivery({ 'Assigned Driver': v })}
                disabled={saving}
              />
            </Section>
          )}

          {/* Taxi cost — only when method is Taxi */}
          {o.delivery?.['Delivery Method'] === 'Taxi' && (
            <Section label={t.taxiCost || 'Taxi cost'}>
              <InlineEdit
                value={o.delivery['Taxi Cost'] ? String(o.delivery['Taxi Cost']) : ''}
                type="number"
                placeholder="0"
                onSave={v => patchDelivery({ 'Taxi Cost': v ? Number(v) : 0 })}
                disabled={saving}
              />
            </Section>
          )}
        </div>
      )}

      {/* Date & time — same for delivery and pickup, uses patchOrder (backend cascades to delivery).
          Section heading + date label follow the Delivery Type so a pickup
          order isn't labelled "Delivery". */}
      <div>
        <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
          {o['Delivery Type'] === 'Pickup' ? (t.pickup || 'Pickup') : t.deliveryDate}
        </p>
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 space-y-3">
          <EditableRow label={o['Delivery Type'] === 'Pickup' ? (t.pickupDate || t.requiredBy || t.pickup || 'Pickup date') : t.deliveryDate}
            value={o['Required By'] || ''}
            onSave={v => patchOrder({ 'Required By': v || null })} disabled={saving} type="date" />
          <div className="flex items-start gap-3">
            <span className="text-xs text-ios-tertiary w-20 shrink-0 pt-0.5">{t.deliveryTime}</span>
            <div className="flex-1">
              <Pills
                options={timeSlots.map(s => ({ value: s, label: s }))}
                value={o['Delivery Time'] || ''}
                onChange={v => patchOrder({ 'Delivery Time': v })}
                disabled={saving}
              />
            </div>
          </div>
          <EditableRow label={t.cardText} value={o['Greeting Card Text'] || ''}
            onSave={v => patchOrder({ 'Greeting Card Text': v })} disabled={saving} multiline />
        </div>
      </div>

      {/* Delivery-specific: recipient, address, fee */}
      {o.delivery && (
        <div>
          <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
            {t.delivery}
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-3 bg-white rounded-xl border border-gray-100 px-4 py-3">
            <EditableRow label={t.recipientName} value={o.delivery['Recipient Name']}
              onSave={v => patchDelivery({ 'Recipient Name': v })} disabled={saving} />
            <EditableRow label={t.phone} value={o.delivery['Recipient Phone']}
              onSave={v => patchDelivery({ 'Recipient Phone': v })} disabled={saving} />
            <EditableRow label={t.deliveryAddress} value={o.delivery['Delivery Address']}
              onSave={v => patchDelivery({ 'Delivery Address': v })} disabled={saving} multiline />
            <EditableRow label={t.deliveryFee} value={o.delivery['Delivery Fee'] ? String(o.delivery['Delivery Fee']) : ''}
              onSave={v => patchDelivery({ 'Delivery Fee': v ? Number(v) : null })} disabled={saving} type="number"
              suffix={t.zl} />
          </div>
        </div>
      )}

      {/* Notes */}
      <Section label={t.notes}>
        <InlineEdit
          value={o['Notes Original'] || ''}
          multiline
          placeholder="—"
          onSave={v => patchOrder({ 'Notes Original': v })}
          disabled={saving}
        />
      </Section>

      {/* Action buttons */}
      <div className="flex gap-2 pt-2">
        {o['Delivery Type'] === 'Pickup' && o.Status === 'Ready' && (
          <button
            onClick={() => patchOrder({ Status: 'Picked Up' })}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-ios-green text-white text-sm font-semibold"
          >
            {t.markPickedUp}
          </button>
        )}

        {o.Status !== 'Cancelled' && (
          <>
            {!confirmCancel ? (
              <button
                onClick={() => setConfirmCancel(true)}
                className="px-4 py-2 rounded-xl bg-ios-red/10 text-ios-red text-sm font-medium"
              >
                {t.cancelOrder}
              </button>
            ) : (
              <div className="space-y-2">
                <span className="text-xs text-ios-red block">{t.cancelConfirm}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCancel(true)}
                    disabled={saving}
                    className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold"
                  >
                    {t.cancelAndReturn || 'Cancel + return stock'}
                  </button>
                  <button
                    onClick={() => handleCancel(false)}
                    disabled={saving}
                    className="px-3 py-1.5 rounded-lg bg-ios-red text-white text-xs font-semibold"
                  >
                    {t.cancelNoReturn || 'Cancel only'}
                  </button>
                  <button
                    onClick={() => setConfirmCancel(false)}
                    className="px-3 py-1.5 rounded-lg bg-gray-100 text-xs"
                  >
                    {t.cancel}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <DissolvePremadesDialog
        candidates={dissolveCandidates}
        saving={saving}
        onConfirm={confirmDissolveAndSave}
        onCancel={() => setDissolveCandidates(null)}
        labels={{
          title: t.dissolvePremadeTitle || 'Dissolve premade bouquets?',
          intro: t.dissolvePremadeIntro || 'These flowers are locked in premade bouquets. Pick which to dissolve — the remaining stems will return to stock and the bouquet will disappear.',
          headerNeed: t.dissolvePremadeNeed || 'Need',
          headerAvail: t.dissolvePremadeAvail || 'Avail',
          headerShort: t.dissolvePremadeShort || 'Short',
          cancel: t.cancel || 'Cancel',
          confirm: t.dissolvePremadeConfirm || 'Dissolve',
        }}
      />
    </div>
  );
}

// Section wrapper with label
function Section({ label, children }) {
  return (
    <div>
      <p className="text-xs text-ios-tertiary mb-1.5">{label}</p>
      {children}
    </div>
  );
}

// Editable key-value row for delivery info
function EditableRow({ label, value, onSave, disabled, multiline, type, suffix }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-ios-tertiary w-20 shrink-0 pt-0.5">{label}</span>
      <div className="flex-1 flex items-center gap-1">
        <InlineEdit
          value={value || ''}
          onSave={onSave}
          disabled={disabled}
          multiline={multiline}
          type={type}
          placeholder="—"
        />
        {suffix && value && <span className="text-xs text-ios-tertiary">{suffix}</span>}
      </div>
    </div>
  );
}
