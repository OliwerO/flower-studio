// DeliveryCard — a compact card for each delivery in the list.
// Tap the card (or the explicit "Details" button) to open the detail
// sheet. Call and navigation buttons open their respective apps
// without triggering expand, so the driver can decide: expand, call,
// or navigate — without accidental taps.

import t from '../translations.js';
import { CallButton, NavButtons } from '@flower-studio/shared';

export default function DeliveryCard({ delivery, onTap, onStatusChange, onProblem, dimmed }) {
  const d = delivery;
  const status     = d['Status'] || 'Pending';
  const isPending  = status === 'Pending';
  const isOut      = status === 'Out for Delivery';
  const isDone     = status === 'Delivered';

  const address          = d['Delivery Address'] || '';
  const recipientPhone   = d['Recipient Phone'] || '';
  const customerPhone    = d['Customer Phone'] || '';
  const time             = d['Delivery Time'] || '';
  const recipient        = d['Recipient Name'] || 'Unknown';
  const deliveredAt      = d['Delivered At'];
  const deliveryResult   = d['Delivery Result'] || '';
  // Owner-authored instructions (new) fall back to the legacy translated
  // customer note so existing data still renders.
  const driverInstr      = d['Driver Instructions'] || d['Special Instructions'] || '';
  const paymentStatus    = d['Payment Status'] || '';

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

  return (
    <div
      onClick={onTap}
      className={`ios-card overflow-hidden active-scale cursor-pointer transition-opacity ${
        dimmed ? 'opacity-60' : ''
      }`}
    >
      <div className="px-4 py-3 space-y-2">
        {/* Unpaid warning — driver must collect payment before handing over */}
        {paymentStatus && paymentStatus !== 'Paid' && status !== 'Delivered' && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 flex items-center gap-2">
            <span className="text-red-500 text-sm">⚠</span>
            <span className="text-xs font-semibold text-red-700">{t.collectPayment || 'Collect payment before handing over'}</span>
          </div>
        )}

        {/* Top row: recipient + order ID + time badge + payment badge */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {d['App Order ID'] && (
              <span className="text-[11px] font-mono text-ios-tertiary shrink-0">#{d['App Order ID']}</span>
            )}
            <h3 className="text-sm font-semibold text-ios-label truncate">{recipient}</h3>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {paymentBadge()}
            {time && (
              <span className="text-xs font-medium text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">
                🕐 {time}
              </span>
            )}
          </div>
        </div>

        {/* Address — plain text; nav strip below offers three map apps */}
        {address && (
          <p className="flex items-start gap-1.5 text-xs text-ios-label">
            <span className="shrink-0 mt-0.5">📍</span>
            <span className="line-clamp-2">{address}</span>
          </p>
        )}

        {/* Three-way navigation: Google / Waze / Apple */}
        {address && <NavButtons address={address} />}

        {/* Call buttons — customer (who placed) and recipient (who receives) */}
        {(customerPhone || recipientPhone) && (
          <div className="flex flex-wrap gap-2">
            {customerPhone && (
              <CallButton
                phone={customerPhone}
                label={t.callCustomer}
                variant="subtle"
              />
            )}
            {recipientPhone && (
              <CallButton
                phone={recipientPhone}
                label={t.callRecipient}
                variant="subtle"
              />
            )}
          </div>
        )}

        {/* Owner's instructions to the driver */}
        {driverInstr && (
          <div className="bg-orange-50 border-l-4 border-orange-400 rounded-lg px-3 py-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-orange-700 mb-0.5">
              ⚠ {t.driverInstructions}
            </p>
            <p className="text-xs text-ios-label leading-snug whitespace-pre-wrap line-clamp-2">
              {driverInstr}
            </p>
          </div>
        )}

        {/* Delivered timestamp */}
        <div className="flex items-center gap-3 text-xs text-ios-tertiary">
          {isDone && deliveredAt && (
            <span className="text-emerald-600 font-medium">
              ✓ {new Date(deliveredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {isDone && deliveryResult && deliveryResult !== 'Success' && (
            <span className="text-orange-500 font-medium">{deliveryResult}</span>
          )}
        </div>

        {/* Explicit "Details" button — makes the expand action discoverable
            even when call/nav buttons occupy most of the card. */}
        <button
          onClick={e => { e.stopPropagation(); onTap?.(); }}
          className="w-full text-center text-xs font-medium text-ios-tertiary py-1.5 border-t border-gray-100 active-scale"
        >
          {t.details || 'Details'} ▾
        </button>

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
                  onClick={e => {
                    e.stopPropagation();
                    if (window.confirm(t.confirmDelivered)) handleStatusChange('Delivered');
                  }}
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
