// DeliveryCard — a compact card for each delivery in the list.
//
// Layout priorities (top to bottom):
//   1. Status / timing / payment    — is this urgent? already paid?
//   2. Who (labelled)               — recipient + customer so the driver
//                                     can't confuse them (gift orders are
//                                     common — the person at the door is
//                                     NOT the person who paid).
//   3. Owner's message to the driver — promoted above the address so it
//                                     can't be missed mid-scroll.
//   4. Where + how to navigate      — address then the three-map strip.
//   5. How to call                  — recipient + customer, labelled.
//   6. Details / status actions.
//
// Call and nav buttons use stopPropagation so tapping them never
// expands the card by accident — the "Details" row is the only expand
// surface besides the card body itself.

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
  const recipient        = d['Recipient Name'] || '—';
  const customerName     = d['Customer Name'] || '';
  const deliveredAt      = d['Delivered At'];
  const deliveryResult   = d['Delivery Result'] || '';
  // Owner-authored instructions (new) fall back to the legacy translated
  // customer note so existing data still renders.
  const driverInstr      = d['Driver Instructions'] || d['Special Instructions'] || '';
  const paymentStatus    = d['Payment Status'] || '';
  // Gift orders: customer ≠ recipient. Only surface the buyer's info
  // when it actually differs, otherwise it's redundant.
  const showBuyer        = customerName && customerName !== recipient;

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

  const divider = 'border-t border-gray-100 pt-3';

  return (
    <div
      onClick={onTap}
      className={`ios-card overflow-hidden active-scale cursor-pointer transition-opacity ${
        dimmed ? 'opacity-60' : ''
      }`}
    >
      <div className="px-4 py-3 space-y-3">
        {/* Unpaid warning — driver must collect payment before handing over */}
        {paymentStatus && paymentStatus !== 'Paid' && status !== 'Delivered' && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 flex items-center gap-2">
            <span className="text-red-500 text-sm">⚠</span>
            <span className="text-xs font-semibold text-red-700">{t.collectPayment || 'Collect payment before handing over'}</span>
          </div>
        )}

        {/* Top row: order ID + payment badge + time badge */}
        <div className="flex items-center justify-between gap-2">
          {d['App Order ID'] ? (
            <span className="text-[11px] font-mono text-ios-tertiary shrink-0">#{d['App Order ID']}</span>
          ) : <span />}
          <div className="flex items-center gap-1.5 shrink-0">
            {paymentBadge()}
            {time && (
              <span className="text-xs font-medium text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">
                🕐 {time}
              </span>
            )}
          </div>
        </div>

        {/* Who — labelled so "Svetlana" can't be read as "who paid".
            Recipient is the big text; customer appears only on gift orders. */}
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-ios-tertiary shrink-0">
              {t.recipient}
            </span>
            <h3 className="text-base font-semibold text-ios-label truncate">{recipient}</h3>
          </div>
          {showBuyer && (
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ios-tertiary shrink-0">
                {t.customer}
              </span>
              <span className="text-xs text-ios-tertiary truncate">{customerName}</span>
            </div>
          )}
        </div>

        {/* Owner's instructions — promoted above address because it's the
            single most important message on the card when present. */}
        {driverInstr && (
          <div className="bg-orange-50 border-l-4 border-orange-500 rounded-lg px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-orange-700 mb-0.5">
              ⚠ {t.driverInstructions}
            </p>
            <p className="text-sm text-ios-label leading-snug whitespace-pre-wrap">
              {driverInstr}
            </p>
          </div>
        )}

        {/* Where — address then three-way navigation */}
        {address && (
          <div className={`${divider} space-y-2`}>
            <p className="flex items-start gap-1.5 text-sm text-ios-label">
              <span className="shrink-0 mt-0.5">📍</span>
              <span className="line-clamp-2">{address}</span>
            </p>
            <NavButtons address={address} />
          </div>
        )}

        {/* Who to call — two labelled pills side by side so the driver
            picks the right contact fast. */}
        {(customerPhone || recipientPhone) && (
          <div className={`${divider}`}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-ios-tertiary mb-2">
              📞 {t.phone}
            </p>
            <div className="flex flex-wrap gap-2">
              {recipientPhone && (
                <CallButton
                  phone={recipientPhone}
                  label={t.recipient}
                  icon="📞"
                  className="flex-1 justify-center"
                />
              )}
              {customerPhone && customerPhone !== recipientPhone && (
                <CallButton
                  phone={customerPhone}
                  label={t.customer}
                  icon="📞"
                  className="flex-1 justify-center"
                  variant="subtle"
                />
              )}
            </div>
          </div>
        )}

        {/* Delivered timestamp */}
        {(isDone && (deliveredAt || deliveryResult)) && (
          <div className="flex items-center gap-3 text-xs">
            {deliveredAt && (
              <span className="text-emerald-600 font-medium">
                ✓ {new Date(deliveredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {deliveryResult && deliveryResult !== 'Success' && (
              <span className="text-orange-500 font-medium">{deliveryResult}</span>
            )}
          </div>
        )}

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
          <div>
            {isPending && (
              <button
                onClick={e => { e.stopPropagation(); handleStatusChange('Out for Delivery'); }}
                className="w-full h-11 rounded-xl bg-sky-600 text-white text-sm font-semibold
                           flex items-center justify-center gap-1.5 active:opacity-80 active-scale shadow-sm"
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
                  className="flex-1 h-11 rounded-xl bg-emerald-600 text-white text-sm font-semibold
                             flex items-center justify-center gap-1.5 active:opacity-80 active-scale shadow-sm"
                >
                  ✓ {t.markDelivered}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onProblem?.(); }}
                  className="h-11 px-4 rounded-xl bg-orange-500 text-white text-sm font-semibold
                             flex items-center justify-center active:opacity-80 active-scale shadow-sm"
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
