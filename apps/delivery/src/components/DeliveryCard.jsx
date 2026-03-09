// DeliveryCard — a compact card for each delivery in the list.
// Tap the card to open the detail sheet. Quick-action buttons for Maps and phone.
// Think of it as a dispatch slip: recipient, address, time, and one-tap actions.

import t from '../translations.js';

export default function DeliveryCard({ delivery, onTap, onStatusChange, onProblem, dimmed }) {
  const d = delivery;
  const status     = d['Status'] || 'Pending';
  const isPending  = status === 'Pending';
  const isOut      = status === 'Out for Delivery';
  const isDone     = status === 'Delivered';

  const address       = d['Delivery Address'] || '';
  const phone         = d['Recipient Phone'] || '';
  const time          = d['Delivery Time'] || '';
  const recipient     = d['Recipient Name'] || 'Unknown';
  const fee           = d['Delivery Fee'];
  const deliveredAt     = d['Delivered At'];
  const deliveryResult  = d['Delivery Result'] || '';
  const orderContents   = d['Order Contents'] || '';
  const specialInstr  = d['Special Instructions'] || '';
  const paymentStatus = d['Payment Status'] || '';

  // Payment status badge styling
  function paymentBadge() {
    if (!paymentStatus) return null;
    if (paymentStatus === 'Paid') {
      return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{t.paidBadge}</span>;
    }
    if (paymentStatus === 'Partial') {
      return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{t.partialBadge}</span>;
    }
    return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{t.unpaidBadge}</span>;
  }

  // Status changes flow up to parent — result picker is handled at page level
  function handleStatusChange(newStatus) {
    onStatusChange(newStatus);
  }

  // Build Google Maps URL for the address
  const mapsUrl = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : null;

  // Build tel: link
  const telUrl = phone ? `tel:${phone.replace(/\s/g, '')}` : null;

  return (
    <div
      onClick={onTap}
      className={`ios-card overflow-hidden active-scale cursor-pointer transition-opacity ${
        dimmed ? 'opacity-60' : ''
      }`}
    >
      <div className="px-4 py-3 space-y-2">
        {/* Top row: recipient + time badge + payment badge */}
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ios-label truncate flex-1">{recipient}</h3>
          <div className="flex items-center gap-1.5 shrink-0">
            {paymentBadge()}
            {time && (
              <span className="text-xs font-medium text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">
                🕐 {time}
              </span>
            )}
          </div>
        </div>

        {/* Address — tappable to open Maps */}
        {address && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex items-start gap-1.5 text-xs text-ios-blue active:underline"
          >
            <span className="shrink-0 mt-0.5">📍</span>
            <span className="line-clamp-2">{address}</span>
          </a>
        )}

        {/* Phone — tappable to call */}
        {phone && (
          <a
            href={telUrl}
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1.5 text-xs text-ios-blue active:underline"
          >
            <span className="shrink-0">📱</span>
            <span>{phone}</span>
          </a>
        )}

        {/* Order contents */}
        {orderContents && (
          <p className="text-xs text-ios-secondary line-clamp-2">🌸 {orderContents}</p>
        )}

        {/* Special instructions */}
        {specialInstr && (
          <p className="text-xs text-ios-orange line-clamp-2">⚠ {specialInstr}</p>
        )}

        {/* Fee + delivered timestamp */}
        <div className="flex items-center gap-3 text-xs text-ios-tertiary">
          {fee != null && fee !== '' && (
            <span>{t.fee}: {Number(fee).toFixed(0)} zł</span>
          )}
          {isDone && deliveredAt && (
            <span className="text-emerald-600 font-medium">
              ✓ {new Date(deliveredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {isDone && deliveryResult && deliveryResult !== 'Success' && (
            <span className="text-orange-500 font-medium">{deliveryResult}</span>
          )}
        </div>

        {/* Action button */}
        {!dimmed && (isPending || isOut) && (
          <div className="pt-1">
            {isPending && (
              <button
                onClick={e => { e.stopPropagation(); handleStatusChange('Out for Delivery'); }}
                className="w-full h-10 rounded-xl bg-sky-600 text-white text-sm font-semibold
                           flex items-center justify-center gap-1.5 active:opacity-80 active-scale"
              >
                🚗 {t.startDelivery}
              </button>
            )}
            {isOut && (
              <div className="flex gap-2">
                <button
                  onClick={e => { e.stopPropagation(); handleStatusChange('Delivered'); }}
                  className="flex-1 h-10 rounded-xl bg-emerald-600 text-white text-sm font-semibold
                             flex items-center justify-center gap-1.5 active:opacity-80 active-scale"
                >
                  ✓ {t.markDelivered}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onProblem?.(); }}
                  className="h-10 px-3 rounded-xl bg-orange-500 text-white text-sm font-semibold
                             flex items-center justify-center active:opacity-80 active-scale"
                >
                  ⚠
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
