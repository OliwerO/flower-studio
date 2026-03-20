// OrderDetailPanel — expanded view with full order details + inline editing.
// Like opening a work order folder: see everything, change anything.

import { useState, useEffect } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import Pills from './Pills.jsx';
import InlineEdit from './InlineEdit.jsx';
import useConfigLists from '../hooks/useConfigLists.js';
import { useOrderEditing, parseBatchName } from '@flower-studio/shared';

const STATUSES = [
  { value: 'New',              label: t.statusNew,       activeClass: 'bg-indigo-600 text-white shadow-sm' },
  { value: 'Accepted',         label: t.statusAccepted || 'Accepted', activeClass: 'bg-violet-600 text-white shadow-sm' },
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
  const { showToast } = useToast();
  const editing = useOrderEditing({ orderId, apiClient: client, showToast, t });

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

  async function doSaveDashboard(action) {
    const refreshed = await editing.doSave(action);
    if (refreshed) {
      setOrder(refreshed);
      onUpdate();
    }
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

  async function handleCancel() {
    await patchOrder({ Status: 'Cancelled' });
    setConfirmCancel(false);
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

  // Effective price: Price Override || (line sell total + delivery fee)
  // This is the "invoice total" — what the customer owes.
  const lineTotal = (o.orderLines || []).reduce((sum, l) =>
    sum + (l['Sell Price Per Unit'] || 0) * (l.Quantity || 0), 0);
  const deliveryFee = Number(o['Delivery Fee'] || o.delivery?.['Delivery Fee'] || 0);
  const effectivePrice = o['Price Override'] || (lineTotal + deliveryFee) || 0;

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
            {!isTerminal && !editing.editingBouquet && (
              <button
                onClick={() => editing.startEditing(o.orderLines)}
                className="text-xs text-brand-600 font-medium"
              >{t.editBouquet}</button>
            )}
          </div>

          {editing.editingBouquet ? (() => {
            const { editLines, editCostTotal, editSellTotal, editMargin,
                    addingFlower, flowerSearch, stockItems, newFlowerForm,
                    removeDialogIdx, removeDialogLine, removeDialogIsNegativeStock,
                    stockAction } = editing;
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
                      <button onClick={() => editing.decrementQty(idx)}
                        className="w-7 h-7 rounded-full bg-white text-ios-secondary text-lg font-bold flex items-center justify-center">−</button>
                      <input type="number" min="1" value={line.quantity}
                        onChange={e => editing.updateLineQty(idx, e.target.value)}
                        onBlur={() => editing.commitLineQty(idx)}
                        onFocus={e => e.target.select()}
                        className="w-10 text-center text-sm font-bold border border-gray-200 rounded-lg py-1" />
                      <button onClick={() => editing.incrementQty(idx)}
                        className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-lg font-bold flex items-center justify-center">+</button>
                    </div>
                    <button onClick={() => editing.setRemoveDialogIdx(idx)}
                      className="text-red-400 hover:text-red-600 text-sm px-1">✕</button>
                  </div>
                </div>
                );
              })}

              {/* Sell total + cost + margin — like order wizard */}
              {editLines.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-ios-label">{t.sellTotal}</span>
                    <span className="text-base font-bold text-brand-600">{editSellTotal.toFixed(0)} {t.zl}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1 pt-1 border-t border-gray-50">
                    <span className="text-xs text-ios-tertiary">{t.costTotal} · {t.markup}: {editMargin}%</span>
                    <span className="text-xs text-ios-tertiary font-medium">{editCostTotal.toFixed(0)} {t.zl}</span>
                  </div>
                </div>
              )}

              {/* Add flower picker — shows stock catalog immediately */}
              {!addingFlower ? (
                <button onClick={() => editing.setAddingFlower(true)}
                  className="w-full py-2 text-sm text-brand-600 font-medium bg-brand-50 rounded-lg hover:bg-brand-100"
                >+ {t.addFlower}</button>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 p-2 space-y-1">
                  <input type="text" value={flowerSearch}
                    onChange={e => editing.setFlowerSearch(e.target.value)}
                    placeholder={t.flowerSearch}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none"
                    autoFocus />
                  <div className="flex items-center text-[10px] text-ios-tertiary uppercase tracking-wide px-2 pt-1">
                    <span className="flex-1">{t.flowers}</span>
                    <span className="w-14 text-right">{t.costPrice}</span>
                    <span className="w-14 text-right">{t.sellPrice}</span>
                    <span className="w-12 text-right">{t.quantity}</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-gray-50">
                    {editing.getFilteredStock(flowerSearch)
                      .slice(0, 20)
                      .map(s => {
                        const qty = Number(s['Current Quantity']) || 0;
                        const cost = Number(s['Current Cost Price']) || 0;
                        const sell = Number(s['Current Sell Price']) || 0;
                        const { name: fn, batch } = parseBatchName(s['Display Name']);
                        return (
                          <button key={s.id} type="button"
                            onClick={() => editing.addFlowerFromStock(s)}
                            className={`w-full flex items-center px-2 py-1.5 text-sm hover:bg-gray-50 rounded ${qty <= 0 ? 'bg-amber-50/50' : ''}`}
                          >
                            <span className="flex-1 font-medium text-left truncate">
                              {fn}
                              {batch && <span className="ml-1 text-[10px] font-normal text-ios-tertiary bg-gray-100 rounded px-1 py-0.5">{batch}</span>}
                            </span>
                            <span className="w-14 text-right text-xs text-ios-tertiary">{cost > 0 ? cost.toFixed(0) : '—'}</span>
                            <span className="w-14 text-right text-xs text-ios-secondary">{sell > 0 ? `${sell.toFixed(0)}` : '—'}</span>
                            <span className={`w-12 text-right text-xs font-medium ${qty <= 0 ? 'text-amber-600' : 'text-ios-label'}`}>{qty}</span>
                          </button>
                        );
                      })}
                    {flowerSearch.length >= 2 && !stockItems.some(s =>
                      (s['Display Name'] || '').toLowerCase() === flowerSearch.toLowerCase()
                    ) && (
                      <button type="button"
                        onClick={() => editing.openNewFlowerForm(flowerSearch.trim())}
                        className="w-full text-left px-2 py-1.5 text-sm text-brand-600 font-medium border-t border-gray-100"
                      >+ {t.addNewFlower} "{flowerSearch}"</button>
                    )}
                  </div>
                  <button onClick={() => { editing.setAddingFlower(false); editing.setFlowerSearch(''); }}
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
                        editing.setNewFlowerForm(p => ({
                          ...p, costPrice: cost,
                          sellPrice: cost && targetMarkup ? String(Math.round(Number(cost) * targetMarkup)) : p.sellPrice,
                        }));
                      }}
                      placeholder={t.costPrice} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                    <input type="number" step="0.01" value={newFlowerForm.sellPrice}
                      onChange={e => editing.setNewFlowerForm(p => ({ ...p, sellPrice: e.target.value }))}
                      placeholder={t.sellPrice} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" value={newFlowerForm.lotSize}
                      onChange={e => editing.setNewFlowerForm(p => ({ ...p, lotSize: e.target.value }))}
                      placeholder={t.lotSize} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                    <input type="text" value={newFlowerForm.supplier}
                      onChange={e => editing.setNewFlowerForm(p => ({ ...p, supplier: e.target.value }))}
                      placeholder={t.supplier} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                  </div>
                  <div className="flex gap-2">
                    <button type="button"
                      onClick={() => editing.addNewFlower()}
                      className="flex-1 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold"
                    >{t.addToCart}</button>
                    <button type="button" onClick={() => editing.setNewFlowerForm(null)}
                      className="px-4 py-2 rounded-xl bg-gray-100 text-ios-secondary text-sm"
                    >{t.cancel}</button>
                  </div>
                </div>
              )}

              {/* Remove dialog — return to stock, write off, or adjust PO */}
              {removeDialogIdx != null && (() => {
                return (
                  <div className={`${removeDialogIsNegativeStock ? 'bg-blue-50' : 'bg-amber-50'} rounded-xl px-4 py-3 space-y-2`}>
                    <p className={`text-sm font-medium ${removeDialogIsNegativeStock ? 'text-blue-800' : 'text-amber-800'}`}>
                      {removeDialogLine?.flowerName}: {removeDialogIsNegativeStock ? t.notReceivedYet : t.returnOrWriteOff}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => editing.confirmRemoveLine('return')}
                        className="flex-1 py-2 rounded-xl bg-green-600 text-white text-sm font-medium"
                      >{t.returnToStock}</button>
                      {removeDialogIsNegativeStock ? (
                        <button
                          onClick={() => { editing.confirmRemoveLine('return'); showToast(t.adjustPO, 'info'); }}
                          className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium"
                        >{t.adjustPO}</button>
                      ) : (
                        <button
                          onClick={() => editing.confirmRemoveLine('writeoff')}
                          className="flex-1 py-2 rounded-xl bg-amber-600 text-white text-sm font-medium"
                        >{t.writeOff}</button>
                      )}
                    </div>
                    <button onClick={() => editing.setRemoveDialogIdx(null)} className="text-xs text-ios-tertiary">
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
                    <button onClick={() => editing.setStockAction(null)} className="text-xs text-ios-tertiary">{t.cancel}</button>
                  </div>
                ) : null;
              })()}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    if (editing.hasReductions && stockAction !== 'pending') {
                      editing.setStockAction('pending');
                      return;
                    }
                    doSaveDashboard(null);
                  }}
                  disabled={saving || editing.saving}
                  className="flex-1 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold"
                >{saving || editing.saving ? '...' : t.saveBouquet}</button>
                <button
                  onClick={() => editing.cancelEditing()}
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
          <Section label={t.deliveryMethod}>
            <Pills
              options={[
                { value: 'Driver',  label: t.deliveryMethodDriver },
                { value: 'Taxi',    label: t.deliveryMethodTaxi },
                { value: 'Florist', label: t.deliveryMethodFlorist },
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
            <Section label={t.taxiCost}>
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

      {/* Delivery info — all editable */}
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
            <EditableRow label={t.deliveryDate} value={o.delivery['Delivery Date'] || ''}
              onSave={v => patchDelivery({ 'Delivery Date': v || null })} disabled={saving} type="date" />
            <div className="flex items-start gap-3">
              <span className="text-xs text-ios-tertiary w-20 shrink-0 pt-0.5">{t.deliveryTime}</span>
              <div className="flex-1">
                <Pills
                  options={timeSlots.map(s => ({ value: s, label: s }))}
                  value={o.delivery['Delivery Time'] || ''}
                  onChange={v => patchDelivery({ 'Delivery Time': v })}
                  disabled={saving}
                />
              </div>
            </div>
            <EditableRow label={t.cardText} value={o.delivery['Greeting Card Text']}
              onSave={v => patchDelivery({ 'Greeting Card Text': v })} disabled={saving} multiline />
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

        {!isTerminal && (
          <>
            {!confirmCancel ? (
              <button
                onClick={() => setConfirmCancel(true)}
                className="px-4 py-2 rounded-xl bg-ios-red/10 text-ios-red text-sm font-medium"
              >
                {t.cancelOrder}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-ios-red">{t.cancelConfirm}</span>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg bg-ios-red text-white text-xs font-semibold"
                >
                  {t.confirm}
                </button>
                <button
                  onClick={() => setConfirmCancel(false)}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 text-xs"
                >
                  {t.cancel}
                </button>
              </div>
            )}
          </>
        )}
      </div>
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
