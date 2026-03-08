// OrderDetailPanel — expanded view with full order details + inline editing.
// Like opening a work order folder: see everything, change anything.

import { useState, useEffect } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import Pills from './Pills.jsx';
import InlineEdit from './InlineEdit.jsx';

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

const PAYMENT_METHODS = [
  { value: 'Cash',       label: t.methodCash },
  { value: 'Card',       label: t.methodCard },
  { value: 'Mbank',      label: t.methodMbank },
  { value: 'Monobank',   label: t.methodMonobank },
  { value: 'Revolut',    label: t.methodRevolut },
  { value: 'PayPal',     label: t.methodPayPal },
  { value: 'Wix Online', label: t.methodWixOnline },
  { value: 'Other',      label: t.sourceOther },
];

const SOURCES = [
  { value: 'In-store',  label: t.sourceWalk },
  { value: 'Instagram', label: t.sourceInstagram },
  { value: 'WhatsApp',  label: t.sourceWhatsApp },
  { value: 'Telegram',  label: t.sourceTelegram },
  { value: 'Wix',       label: t.sourceWebsite },
  { value: 'Flowwow',   label: t.sourceFlowwow },
  { value: 'Other',     label: t.sourceOther },
];

const DELIVERY_TYPES = [
  { value: 'Delivery', label: '🚗 ' + t.delivery },
  { value: 'Pickup',   label: '🏪 ' + t.pickup },
];

const DRIVERS = [
  { value: 'Timur',         label: 'Timur' },
  { value: 'Nikita',        label: 'Nikita' },
  { value: 'Dmitri',        label: 'Dmitri' },
  { value: 'Backup Driver', label: 'Backup' },
];

export default function OrderDetailPanel({ orderId, onUpdate }) {
  const [order, setOrder]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await client.get(`/orders/${orderId}`);
        setOrder(res.data);
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
  const showPaymentMethod = o['Payment Status'] === 'Paid' || o['Payment Status'] === 'Partial';

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
            onChange={v => patchOrder({ 'Delivery Type': v })}
            disabled={saving}
          />
        </Section>
      </div>

      {/* Payment row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section label={t.paymentStatus}>
          <Pills
            options={PAYMENT_STATUSES}
            value={o['Payment Status'] || 'Unpaid'}
            onChange={v => patchOrder({ 'Payment Status': v, ...(v === 'Unpaid' ? { 'Payment Method': null } : {}) })}
            disabled={saving}
          />
        </Section>
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
          {(() => {
            // Compute display price: same formula as analytics Effective Price
            const lineTotal = (o.orderLines || []).reduce((sum, l) =>
              sum + (l['Sell Price Per Unit'] || 0) * (l.Quantity || 0), 0);
            const deliveryFee = o.delivery?.['Delivery Fee'] || 0;
            const displayPrice = o['Final Price'] || o['Price Override'] || (lineTotal + deliveryFee) || 0;
            return (
              <span className="text-sm font-semibold text-ios-label">
                {displayPrice.toFixed(0)} {t.zl}
              </span>
            );
          })()}
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
          <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
            {t.bouquetComposition}
          </p>
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
        </div>
      )}

      {/* Driver (for delivery orders) */}
      {o['Delivery Type'] === 'Delivery' && (
        <Section label={t.driver}>
          <Pills
            options={DRIVERS}
            value={o.delivery?.['Assigned Driver'] || ''}
            onChange={v => patchDelivery({ 'Assigned Driver': v })}
            disabled={saving}
          />
        </Section>
      )}

      {/* Delivery info — all editable */}
      {o.delivery && (
        <div>
          <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
            {t.delivery}
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-3 bg-white rounded-xl border border-gray-100 px-4 py-3">
            <EditableRow label="Recipient" value={o.delivery['Recipient Name']}
              onSave={v => patchDelivery({ 'Recipient Name': v })} disabled={saving} />
            <EditableRow label="Phone" value={o.delivery['Recipient Phone']}
              onSave={v => patchDelivery({ 'Recipient Phone': v })} disabled={saving} />
            <EditableRow label="Address" value={o.delivery['Delivery Address']}
              onSave={v => patchDelivery({ 'Delivery Address': v })} disabled={saving} multiline />
            <EditableRow label="Time" value={o.delivery['Delivery Time']}
              onSave={v => patchDelivery({ 'Delivery Time': v })} disabled={saving} />
            <EditableRow label="Card" value={o.delivery['Greeting Card Text']}
              onSave={v => patchDelivery({ 'Greeting Card Text': v })} disabled={saving} multiline />
            <EditableRow label="Fee" value={o.delivery['Delivery Fee'] ? String(o.delivery['Delivery Fee']) : ''}
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
