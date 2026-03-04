// OrderDetailSheet — slide-up bottom sheet showing full order details.
// Florist can update status and mark order as paid without leaving the list.

import { useState, useEffect } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

const STATUSES     = ['New', 'In Progress', 'Ready', 'Delivered', 'Picked Up', 'Cancelled'];
const PAY_METHODS  = ['Cash', 'Card', 'Transfer'];

// Must match backend ALLOWED_TRANSITIONS
const ALLOWED_TRANSITIONS = {
  'New':         ['In Progress', 'Cancelled'],
  'In Progress': ['Ready', 'Cancelled'],
  'Ready':       ['Delivered', 'Picked Up', 'In Progress', 'Cancelled'],
  'Delivered':   [],
  'Picked Up':   [],
  'Cancelled':   ['New'],
};

const STATUS_COLORS = {
  'New':         'bg-blue-50 text-blue-600 border-blue-200',
  'In Progress': 'bg-orange-50 text-orange-600 border-orange-200',
  'Ready':       'bg-green-50 text-green-700 border-green-200',
  'Delivered':   'bg-gray-100 text-gray-500 border-gray-200',
  'Cancelled':   'bg-red-50 text-red-500 border-red-200',
};

function Pills({ options, value, onChange, disabled }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => !disabled && onChange(o.value)}
          disabled={disabled}
          className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors active-scale disabled:opacity-40 ${
            value === o.value
              ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
              : 'bg-white/60 text-ios-secondary border-white/60 active:bg-white/80'
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
    <div className="flex justify-between gap-4 py-2 border-b border-white/30 last:border-0">
      <span className="text-sm text-ios-tertiary shrink-0">{label}</span>
      <span className="text-sm text-ios-label text-right">{value}</span>
    </div>
  );
}

export default function OrderDetailSheet({ orderId, onClose, onOrderUpdated }) {
  const { showToast }   = useToast();
  const [order, setOrder]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    if (!orderId) return;
    setLoading(true);
    client.get(`/orders/${orderId}`)
      .then(r => setOrder(r.data))
      .catch(() => showToast('Failed to load order.', 'error'))
      .finally(() => setLoading(false));
  }, [orderId]);

  async function patch(fields) {
    setSaving(true);
    try {
      const res = await client.patch(`/orders/${orderId}`, fields);
      setOrder(prev => ({ ...prev, ...res.data }));
      onOrderUpdated?.(orderId, res.data);
      showToast('Updated!', 'success');
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to update order.';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  const price    = order?.['Price Override'] || order?.['Sell Total'];
  const isPaid   = order?.['Payment Status'] === 'Paid';
  const isDelivery = order?.['Delivery Type'] === 'Delivery';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 flex flex-col max-h-[90vh]
                      bg-[#f8f0f3] rounded-t-3xl shadow-2xl overflow-hidden
                      animate-slide-up">

        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 bg-ios-separator rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0">
          <div>
            <p className="text-base font-semibold text-ios-label">
              {order?.['Customer Name'] || '—'}
            </p>
            <p className="text-xs text-ios-tertiary mt-0.5">
              {order?.['Order Date']} · {isDelivery ? 'Delivery' : 'Pickup'}
              {price > 0 && ` · ${price} zł`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-ios-fill2 flex items-center justify-center text-ios-secondary text-sm active-scale"
          >
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto px-5 pb-10 flex flex-col gap-5">

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
            </div>
          ) : !order ? null : (
            <>
              {/* Request */}
              {order['Customer Request'] && (
                <div className="ios-card px-4 py-3">
                  <p className="text-xs text-ios-tertiary mb-1">Customer request</p>
                  <p className="text-sm text-ios-label">{order['Customer Request']}</p>
                </div>
              )}

              {/* Order lines */}
              {order.orderLines?.length > 0 && (
                <div>
                  <p className="ios-label">Bouquet</p>
                  <div className="ios-card overflow-hidden divide-y divide-white/40">
                    {order.orderLines.map((line, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-ios-label">{line['Flower Name']}</p>
                          <p className="text-xs text-ios-tertiary">
                            {line['Sell Price Per Unit']} zł × {line['Quantity']}
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-brand-600">
                          {(Number(line['Sell Price Per Unit']) * Number(line['Quantity'])).toFixed(0)} zł
                        </p>
                      </div>
                    ))}
                    <div className="flex justify-between px-4 py-3 bg-brand-50/50">
                      <span className="text-sm text-ios-tertiary">Total</span>
                      <span className="text-sm font-bold text-brand-600">
                        {price > 0 ? `${price} zł` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Delivery details */}
              {isDelivery && (
                <div>
                  <p className="ios-label">Delivery</p>
                  <div className="ios-card px-4 py-2">
                    <Row label="Date"      value={order.delivery?.['Delivery Date']} />
                    <Row label="Time"      value={order.delivery?.['Delivery Time']} />
                    <Row label="Address"   value={order.delivery?.['Delivery Address']} />
                    <Row label="Recipient" value={order.delivery?.['Recipient Name']} />
                    <Row label="Phone"     value={order.delivery?.['Recipient Phone']} />
                    <Row label="Card msg"  value={order['Greeting Card Text']} />
                    <Row label="Fee"       value={order.delivery?.['Delivery Fee'] ? `${order.delivery['Delivery Fee']} zł` : null} />
                  </div>
                </div>
              )}

              {/* Status */}
              <div>
                <p className="ios-label">Status</p>
                <div className="ios-card p-4">
                  {(() => {
                    const current = order['Status'] || 'New';
                    const allowed = ALLOWED_TRANSITIONS[current] || [];
                    // Show current status + allowed next statuses
                    const visible = [current, ...allowed];
                    return (
                      <Pills
                        value={current}
                        onChange={val => patch({ 'Status': val })}
                        disabled={saving}
                        options={visible.map(s => ({ value: s, label: s }))}
                      />
                    );
                  })()}
                </div>
              </div>

              {/* Payment */}
              <div>
                <p className="ios-label">Payment</p>
                <div className="ios-card p-4 flex flex-col gap-3">
                  <Pills
                    value={order['Payment Status'] || 'Unpaid'}
                    onChange={val => patch({
                      'Payment Status': val,
                      ...(val === 'Unpaid' ? { 'Payment Method': '' } : {}),
                    })}
                    disabled={saving}
                    options={[
                      { value: 'Unpaid', label: 'Unpaid' },
                      { value: 'Paid',   label: 'Paid' },
                    ]}
                  />
                  {isPaid && (
                    <Pills
                      value={order['Payment Method'] || ''}
                      onChange={val => patch({ 'Payment Method': val })}
                      disabled={saving}
                      options={PAY_METHODS.map(m => ({ value: m, label: m }))}
                    />
                  )}
                </div>
              </div>

              {/* Source + notes */}
              {(order['Source'] || order['Notes Original']) && (
                <div>
                  <p className="ios-label">Info</p>
                  <div className="ios-card px-4 py-2">
                    <Row label="Source" value={order['Source']} />
                    <Row label="Notes"  value={order['Notes Original']} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
