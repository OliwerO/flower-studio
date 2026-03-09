// OrderCard — expandable card that shows order summary, and when tapped
// expands inline to show full details + status/payment controls.
// No overlays, no fixed positioning — just normal DOM flow. Like flipping
// a kanban card over to see the full work order on the back.

import { useState } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';

const STATUS_STYLES = {
  'New':              { label: 'bg-indigo-50 text-indigo-600' },
  'In Progress':      { label: 'bg-orange-50 text-orange-600' },
  'Ready':            { label: 'bg-amber-50 text-amber-700' },
  'Out for Delivery': { label: 'bg-sky-50 text-sky-700' },
  'Delivered':        { label: 'bg-emerald-50 text-emerald-700' },
  'Picked Up':        { label: 'bg-teal-50 text-teal-700' },
  'Cancelled':        { label: 'bg-rose-50 text-rose-600' },
};

const PAY_METHODS = ['Cash', 'Card', 'Transfer'];

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

export default function OrderCard({ order, onOrderUpdated }) {
  const { showToast } = useToast();
  const [expanded, setExpanded]   = useState(false);
  const [detail, setDetail]       = useState(null);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);

  const status     = order['Status'] || 'New';
  const styles     = STATUS_STYLES[status] || STATUS_STYLES['New'];
  const isDelivery = order['Delivery Type'] === 'Delivery';
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
        .catch(() => showToast('Failed to load details.', 'error'))
        .finally(() => setLoading(false));
    }
  }

  async function patch(fields) {
    setSaving(true);
    try {
      const res = await client.patch(`/orders/${order.id}`, fields);
      setDetail(prev => prev ? { ...prev, ...res.data } : res.data);
      onOrderUpdated?.(order.id, res.data);
      showToast('Updated!', 'success');
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to update.';
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

  return (
    <div
      onClick={toggle}
      className={`bg-white rounded-2xl shadow-sm px-4 py-4 transition-colors cursor-pointer ${
        expanded ? 'ring-2 ring-brand-200' : 'active:bg-ios-fill'
      }`}
    >
      {/* ── Summary (always visible) ── */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${styles.label}`}>
            {currentStatus}
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
      {order['Order Date'] && (
        <p className="text-xs text-ios-tertiary mt-1">{order['Order Date']}</p>
      )}

      {/* ── Expanded details (inline, no overlays) ── */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-100 flex flex-col gap-4" onClick={e => e.stopPropagation()}>

          {loading ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
            </div>
          ) : !detail ? (
            <p className="text-xs text-ios-tertiary text-center py-4">Could not load details.</p>
          ) : (
            <>
              {/* Order lines */}
              {detail.orderLines?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">Bouquet</p>
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
                </div>
              )}

              {/* Delivery details */}
              {isDelivery && detail.delivery && (
                <div>
                  <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">Delivery</p>
                  <div className="bg-gray-50 rounded-xl px-3 py-1">
                    <Row label="Date"      value={detail.delivery['Delivery Date']} />
                    <Row label="Time"      value={detail.delivery['Delivery Time']} />
                    <Row label="Address"   value={detail.delivery['Delivery Address']} />
                    <Row label="Recipient" value={detail.delivery['Recipient Name']} />
                    <Row label="Phone"     value={detail.delivery['Recipient Phone']} />
                    <Row label="Card msg"  value={detail['Greeting Card Text']} />
                    <Row label="Fee"       value={detail.delivery['Delivery Fee'] ? `${detail.delivery['Delivery Fee']} zł` : null} />
                  </div>
                </div>
              )}

              {/* Status controls */}
              <div>
                <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">Status</p>
                {(() => {
                  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
                  const visible = [currentStatus, ...allowed];
                  return (
                    <Pills
                      value={currentStatus}
                      onChange={val => patch({ 'Status': val })}
                      disabled={saving}
                      options={visible.map(s => ({ value: s, label: s }))}
                    />
                  );
                })()}
              </div>

              {/* Payment controls */}
              <div>
                <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">Payment</p>
                <div className="flex flex-col gap-2">
                  <Pills
                    value={d['Payment Status'] || 'Unpaid'}
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
                  {currentPaid && (
                    <Pills
                      value={d['Payment Method'] || ''}
                      onChange={val => patch({ 'Payment Method': val })}
                      disabled={saving}
                      options={PAY_METHODS.map(m => ({ value: m, label: m }))}
                    />
                  )}
                </div>
              </div>

              {/* Notes */}
              {detail['Notes Original'] && (
                <div>
                  <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1">Notes</p>
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
            ▲ Collapse
          </button>
        </div>
      )}
    </div>
  );
}
