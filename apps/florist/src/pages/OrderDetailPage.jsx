// OrderDetailPage — full-page order detail view.
// Replaces the bottom sheet approach which had CSS stacking context issues.
// A separate page is the most resilient pattern — no overlays, no z-index.

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

const PAY_METHODS = ['Cash', 'Card', 'Transfer'];

// Simplified flow: New → Ready → Delivered/Picked Up.
const ALLOWED_TRANSITIONS = {
  'New':         ['Ready', 'Cancelled'],
  'In Progress': ['Ready', 'Cancelled'],
  'Ready':       ['Delivered', 'Picked Up', 'Cancelled'],
  'Delivered':   [],
  'Picked Up':   [],
  'Cancelled':   ['New'],
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
    <div className="flex justify-between gap-4 py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-ios-tertiary shrink-0">{label}</span>
      <span className="text-sm text-ios-label text-right">{value}</span>
    </div>
  );
}

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [order, setOrder]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(false);
    client.get(`/orders/${id}`)
      .then(r => setOrder(r.data))
      .catch(() => {
        setError(true);
        showToast('Failed to load order.', 'error');
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function patch(fields) {
    setSaving(true);
    try {
      const res = await client.patch(`/orders/${id}`, fields);
      setOrder(prev => ({ ...prev, ...res.data }));
      showToast('Updated!', 'success');
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to update order.';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  const price      = order?.['Price Override'] || order?.['Sell Total'];
  const isPaid     = order?.['Payment Status'] === 'Paid';
  const isDelivery = order?.['Delivery Type'] === 'Delivery';

  return (
    <div className="min-h-screen">
      {/* Header with back button */}
      <header className="glass-nav px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center gap-3 max-w-2xl mx-auto">
          <button
            onClick={() => navigate('/orders')}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-ios-secondary text-sm active-scale hover:bg-gray-200"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-ios-label truncate">
              {order?.['Customer Name'] || '—'}
            </p>
            <p className="text-xs text-ios-tertiary">
              {order?.['Order Date']} · {isDelivery ? 'Delivery' : 'Pickup'}
              {price > 0 && ` · ${price} zł`}
            </p>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="px-4 py-4 max-w-2xl mx-auto flex flex-col gap-5 pb-20">

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : error || !order ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <p className="text-4xl">😕</p>
            <p className="text-ios-tertiary text-sm">Could not load order details.</p>
            <button
              onClick={() => navigate('/orders')}
              className="px-5 py-2 rounded-full bg-brand-600 text-white text-sm font-medium active-scale"
            >
              Back to orders
            </button>
          </div>
        ) : (
          <>
            {/* Customer request */}
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
                <div className="ios-card overflow-hidden divide-y divide-gray-100">
                  {order.orderLines.map((line, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3">
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
  );
}
