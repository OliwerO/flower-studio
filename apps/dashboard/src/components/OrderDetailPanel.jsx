import { useState, useEffect } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import Pills from './Pills.jsx';
import InlineEdit from './InlineEdit.jsx';
import useConfigLists from '../hooks/useConfigLists.js';
import { useOrderEditing } from '@flower-studio/shared';
import BouquetSection from './order/BouquetSection.jsx';
import DeliverySection from './order/DeliverySection.jsx';

const BASE_STATUSES = [
  { value: 'New',              label: t.statusNew,            activeClass: 'bg-indigo-600 text-white shadow-sm' },
  { value: 'Ready',            label: t.statusReady,          activeClass: 'bg-amber-600 text-white shadow-sm' },
  { value: 'Out for Delivery', label: t.statusOutForDel,      activeClass: 'bg-sky-600 text-white shadow-sm' },
  { value: 'Delivered',        label: t.statusDelivered,      activeClass: 'bg-emerald-600 text-white shadow-sm' },
  { value: 'Picked Up',        label: t.statusPickedUp,       activeClass: 'bg-teal-600 text-white shadow-sm' },
  { value: 'Cancelled',        label: t.statusCancelled,      activeClass: 'bg-rose-600 text-white shadow-sm' },
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

function Section({ label, children }) {
  return (
    <div>
      <p className="text-xs text-ios-tertiary mb-1.5">{label}</p>
      {children}
    </div>
  );
}

export default function OrderDetailPanel({ orderId, onUpdate }) {
  const { paymentMethods: pmList, orderSources: srcList, timeSlots, targetMarkup } = useConfigLists();
  const PAYMENT_METHODS = pmList.map(v => ({ value: v, label: v }));
  const SOURCES = srcList.map(v => ({ value: v, label: v }));
  const [driverNames, setDriverNames] = useState([]);
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
      setOrder(prev => ({ ...prev, ...fields }));
      showToast(t.orderUpdated);
      onUpdate();
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function doSave(action) {
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
  const isWix = o.Source === 'Wix';
  const STATUSES = BASE_STATUSES.filter(s => !s.wixOnly || isWix || s.value === o.Status);
  const showPaymentMethod = o['Payment Status'] === 'Paid';
  const lineTotal = (o.orderLines || []).reduce((sum, l) =>
    sum + (l['Sell Price Per Unit'] || 0) * (l.Quantity || 0), 0);
  const deliveryFee = Number(o['Delivery Fee'] || o.delivery?.['Delivery Fee'] || 0);
  const effectivePrice = o['Price Override'] || (lineTotal + deliveryFee) || 0;

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
        <Pills options={STATUSES} value={o.Status} onChange={v => patchOrder({ Status: v })} disabled={saving} />
      </Section>

      {/* Source + Delivery type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section label={t.source}>
          <Pills options={SOURCES} value={o.Source} onChange={v => patchOrder({ Source: v })} disabled={saving} />
        </Section>
        <Section label={t.deliveryType}>
          <Pills
            options={DELIVERY_TYPES}
            value={o['Delivery Type']}
            onChange={async v => {
              if (v === 'Delivery' && o['Delivery Type'] === 'Pickup' && !o.delivery) {
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

      {/* Payment */}
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

        {showPaymentMethod && (
          <Section label={t.paymentMethod}>
            <Pills options={PAYMENT_METHODS} value={o['Payment Method'] || ''} onChange={v => patchOrder({ 'Payment Method': v })} disabled={saving} />
          </Section>
        )}

        {isPartial && (
          <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 space-y-3">
            {effectivePrice > 0 && (
              <p className="text-xs text-ios-tertiary">
                {t.price}: <span className="font-semibold text-ios-label">{effectivePrice.toFixed(0)} {t.zl}</span>
              </p>
            )}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">{t.payment1}</p>
              <div className="flex items-center gap-2">
                <input type="number" value={p1Amount || ''} onChange={e => {
                  const val = e.target.value === '' ? null : Number(e.target.value);
                  setOrder(prev => ({ ...prev, 'Payment 1 Amount': val }));
                }} placeholder="0" className="w-24 text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none" disabled={saving} />
                <span className="text-xs text-ios-tertiary">{t.zl}</span>
              </div>
              <Pills options={PAYMENT_METHODS} value={p1Method} onChange={v => {
                const amt = Number(order['Payment 1 Amount'] || 0);
                if (amt > 0) { patchOrder({ 'Payment 1 Amount': amt, 'Payment 1 Method': v }); }
                else { setOrder(prev => ({ ...prev, 'Payment 1 Method': v })); }
              }} disabled={saving} />
            </div>
            {hasP1 && (
              <div className="border-t border-gray-100 pt-2 space-y-1">
                <p className="text-xs text-ios-tertiary">
                  {t.paidAmount}: <span className="font-medium text-ios-green">{p1Amount.toFixed(0)} {t.zl}</span>
                  {' · '}
                  {t.remaining}: <span className="font-semibold text-ios-orange">{remainingAfterP1.toFixed(0)} {t.zl}</span>
                </p>
              </div>
            )}
            {hasP1 && remainingAfterP1 > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">{t.payment2}</p>
                <div className="flex items-center gap-2">
                  <input type="number" value={p2Amount || remainingAfterP1 || ''} onChange={e => {
                    const val = e.target.value === '' ? null : Number(e.target.value);
                    setOrder(prev => ({ ...prev, 'Payment 2 Amount': val }));
                  }} placeholder={remainingAfterP1.toFixed(0)} className="w-24 text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none" disabled={saving} />
                  <span className="text-xs text-ios-tertiary">{t.zl}</span>
                </div>
                <Pills options={PAYMENT_METHODS} value={p2Method} onChange={v => {
                  const amt = Number(order['Payment 2 Amount'] || remainingAfterP1);
                  patchOrder({ 'Payment 2 Amount': amt, 'Payment 2 Method': v, 'Payment Status': 'Paid' });
                }} disabled={saving} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Price override */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Section label={t.priceOverride}>
          <InlineEdit value={o['Price Override'] ? String(o['Price Override']) : ''} type="number" placeholder="—"
            onSave={v => patchOrder({ 'Price Override': v ? Number(v) : null })} disabled={saving} />
        </Section>
        <Section label={t.price}>
          <span className="text-sm font-semibold text-ios-label">{effectivePrice.toFixed(0)} {t.zl}</span>
        </Section>
      </div>

      {/* Customer request */}
      <Section label={t.request}>
        <InlineEdit value={o['Customer Request'] || ''} multiline placeholder="—"
          onSave={v => patchOrder({ 'Customer Request': v })} disabled={saving} />
      </Section>

      {/* Bouquet */}
      <BouquetSection order={o} editing={editing} isTerminal={isTerminal} saving={saving} targetMarkup={targetMarkup} doSave={doSave} />

      {/* Delivery */}
      <DeliverySection order={o} driverNames={driverNames} timeSlots={timeSlots} saving={saving} patchDelivery={patchDelivery} />

      {/* Notes */}
      <Section label={t.notes}>
        <InlineEdit value={o['Notes Original'] || ''} multiline placeholder="—"
          onSave={v => patchOrder({ 'Notes Original': v })} disabled={saving} />
      </Section>

      {/* Action buttons */}
      <div className="flex gap-2 pt-2">
        {o['Delivery Type'] === 'Pickup' && o.Status === 'Ready' && (
          <button onClick={() => patchOrder({ Status: 'Picked Up' })} disabled={saving}
            className="px-4 py-2 rounded-xl bg-ios-green text-white text-sm font-semibold">{t.markPickedUp}</button>
        )}
        {!isTerminal && (
          <>
            {!confirmCancel ? (
              <button onClick={() => setConfirmCancel(true)}
                className="px-4 py-2 rounded-xl bg-ios-red/10 text-ios-red text-sm font-medium">{t.cancelOrder}</button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-ios-red">{t.cancelConfirm}</span>
                <button onClick={handleCancel} disabled={saving}
                  className="px-3 py-1.5 rounded-lg bg-ios-red text-white text-xs font-semibold">{t.confirm}</button>
                <button onClick={() => setConfirmCancel(false)}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 text-xs">{t.cancel}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
