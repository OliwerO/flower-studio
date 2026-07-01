import { useEffect, useState } from 'react';
import { formatDateDMY } from '../utils/formatDate.js';

/**
 * OrderQuickViewModal — read-only order preview shown OVER the stock Variety
 * trace (owner feedback, round-2): tapping an order in the trace used to
 * navigate away to the order page, so she lost her place. Now it opens this
 * lightweight popup — glance at who/what/when, then close back to the trace.
 *
 * Self-fetching deep module: give it an order record id + an apiClient and it
 * loads GET /orders/:id itself, so both the florist app and the dashboard wire
 * it the same way (each just decides what "open full order" does via onOpenFull).
 *
 * Props:
 *   orderId    — order record id (uuid) to preview. Falsy → renders nothing.
 *   apiClient  — axios-like client with .get() (the shared API client).
 *   t          — translation strings (close, loading, customer, delivery,
 *                pickup, orderTotal, paid, unpaid, orderItems, orderOpenFull,
 *                currency, status* keys, deliveryType)
 *   onClose    — () => void — dismiss, returning to the trace.
 *   onOpenFull — optional (orderId) => void — "open the full order" escape hatch
 *                (florist navigates to /orders/:id, dashboard switches tab).
 */
export default function OrderQuickViewModal({ orderId, apiClient, t = {}, onClose, onOpenFull }) {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!orderId) return;
    let alive = true;
    setLoading(true);
    setError(false);
    setOrder(null);
    apiClient.get(`/orders/${orderId}`)
      .then((res) => { if (alive) { setOrder(res.data); setLoading(false); } })
      .catch((err) => {
        // Surface nothing sensitive; the trace stays open behind the modal.
        console.error('OrderQuickView load failed', err?.response?.data?.error || err?.message);
        if (alive) { setError(true); setLoading(false); }
      });
    return () => { alive = false; };
  }, [orderId, apiClient]);

  if (!orderId) return null;

  const displayId = order
    ? (order['App Order ID'] || order['Wix Order ID'] || `#${String(order.id || orderId).slice(0, 8)}`)
    : '';

  const status = order?.['Status'] ?? '';
  const statusText = t[`status${String(status).replace(/\s+/g, '')}`] ?? status;

  const customer = order?.['Customer Name'] || order?.['Customer'] || '';
  const phone = order?.['Customer Phone'] || '';
  const isDelivery = /deliver/i.test(order?.['Delivery Type'] || '');
  const reqBy = order?.['Required By'];
  const delTime = order?.['Delivery Time'];
  const address = order?.delivery?.['Delivery Address'];
  const lines = order?.orderLines || order?.['Order Lines'] || [];
  const total = order?.['Final Price'] ?? order?.['Order Total'] ?? order?.['Total'];
  const paid = order?.['Payment Status'] === 'Paid';
  const currency = t.currency ?? 'zł';

  return (
    <div
      data-testid="order-quickview-backdrop"
      className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        data-testid="order-quickview-content"
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — order id + status + close */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-gray-900 tabular-nums truncate">{displayId}</span>
            {status && (
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${statusPill(status)}`}>
                {statusText}
              </span>
            )}
          </div>
          <button
            type="button"
            data-testid="order-quickview-close"
            onClick={onClose}
            aria-label={t.close ?? 'Close'}
            className="shrink-0 ml-2 text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 overflow-y-auto text-sm">
          {loading && <p className="text-xs text-gray-400 py-4 text-center">{t.loading ?? 'Loading...'}</p>}
          {error && <p className="text-xs text-red-500 py-4 text-center">{t.error ?? 'Could not load the order.'}</p>}

          {order && !loading && (
            <div className="space-y-3">
              {/* Customer */}
              {(customer || phone) && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">{t.customer ?? 'Customer'}</div>
                  <div className="text-gray-800 font-medium">{customer || '—'}</div>
                  {phone && <div className="text-xs text-gray-500 tabular-nums">{phone}</div>}
                </div>
              )}

              {/* Fulfilment */}
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-400">
                  {isDelivery ? (t.delivery ?? 'Delivery') : (t.pickup ?? 'Pickup')}
                </div>
                <div className="text-gray-800 flex items-center gap-1.5">
                  <span>{isDelivery ? '🚗' : '🏪'}</span>
                  {reqBy && <span className="tabular-nums">{formatDateDMY(reqBy)}</span>}
                  {delTime && <span className="text-gray-500 tabular-nums">{delTime}</span>}
                </div>
                {isDelivery && address && (
                  <div className="text-xs text-gray-500 mt-0.5">{address}</div>
                )}
              </div>

              {/* Items */}
              {lines.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">{t.orderItems ?? 'Items'}</div>
                  <ul className="space-y-0.5">
                    {lines.map((l, i) => (
                      <li key={l.id ?? i} className="flex items-center justify-between gap-2">
                        <span className="text-gray-700 truncate">{l['Flower Name'] || l.flowerName || '—'}</span>
                        <span className="text-gray-500 tabular-nums shrink-0">× {l['Quantity'] ?? l.quantity ?? 0}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — total + payment + actions */}
        {order && !loading && (
          <div className="px-4 py-3 border-t border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${paid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {paid ? (t.paid ?? 'Paid') : (t.unpaid ?? 'Unpaid')}
              </span>
              {total != null && (
                <span className="text-base font-bold text-gray-900 tabular-nums">
                  {Number(total).toFixed(2)} {currency}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {onOpenFull && (
                <button
                  type="button"
                  data-testid="order-quickview-openfull"
                  onClick={() => onOpenFull(orderId)}
                  className="flex-1 py-2 text-sm font-medium text-brand-600 hover:text-brand-800 rounded-lg bg-brand-50 hover:bg-brand-100"
                >
                  {t.orderOpenFull ?? 'Open full order ›'}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className={`${onOpenFull ? '' : 'flex-1'} py-2 px-4 text-sm text-gray-500 hover:text-gray-700`}
              >
                {t.close ?? 'Close'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Colour a status pill to match the app conventions (indigo=New, amber=Ready,
// sky=Out for Delivery, emerald=Delivered/Picked Up, gray=Cancelled).
function statusPill(status) {
  switch (status) {
    case 'New':             return 'bg-indigo-100 text-indigo-700';
    case 'In Progress':     return 'bg-violet-100 text-violet-700';
    case 'Ready':           return 'bg-amber-100 text-amber-700';
    case 'Out for Delivery':return 'bg-sky-100 text-sky-700';
    case 'Delivered':
    case 'Picked Up':       return 'bg-emerald-100 text-emerald-700';
    case 'Cancelled':       return 'bg-gray-200 text-gray-500';
    default:                return 'bg-gray-100 text-gray-600';
  }
}
