// DeliverySheet — bottom sheet showing full delivery details + actions.
// Like opening a work order: all info at a glance, with action buttons at the bottom.

import { useState, useEffect } from 'react';
import t from '../translations.js';

export default function DeliverySheet({ delivery, onClose, onStatusChange, onSaveNote }) {
  const d = delivery;
  const status     = d['Status'] || 'Pending';
  const isPending  = status === 'Pending';
  const isOut      = status === 'Out for Delivery';
  const isDone     = status === 'Delivered';

  const [note, setNote] = useState(d['Driver Notes'] || '');
  const [saving, setSaving] = useState(false);

  // Sync note when delivery changes
  useEffect(() => { setNote(d['Driver Notes'] || ''); }, [d]);

  const address        = d['Delivery Address'] || '';
  const phone          = d['Recipient Phone'] || '';
  const time           = d['Delivery Time'] || '';
  const recipient      = d['Recipient Name'] || 'Unknown';
  const fee            = d['Delivery Fee'];
  const payment        = d['Driver Payment Status'] || t.unpaid;
  const cardText       = d['Greeting Card Text'] || '';
  const deliveredAt    = d['Delivered At'];
  const customerName   = d['Customer Name'] || '';
  const customerPhone  = d['Customer Phone'] || '';
  const orderContents  = d['Order Contents'] || '';
  const specialInstr   = d['Special Instructions'] || '';
  const paymentStatus  = d['Payment Status'] || '';
  // Only show customer info when it differs from recipient (gift orders)
  const showCustomer = customerPhone && customerPhone !== phone;

  const mapsUrl = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : null;
  const telUrl = phone ? `tel:${phone.replace(/\s/g, '')}` : null;

  async function handleSaveNote() {
    setSaving(true);
    await onSaveNote(note);
    setSaving(false);
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white
                      rounded-t-3xl shadow-2xl max-h-[85vh] overflow-y-auto animate-slide-up">

        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-ios-separator" />
        </div>

        <div className="px-5 pb-8 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-ios-label">{recipient}</h2>
            <button onClick={onClose} className="text-ios-tertiary text-sm font-medium">{t.close}</button>
          </div>

          {/* Info rows */}
          <div className="ios-card divide-y divide-gray-100 overflow-hidden">
            {/* Time */}
            {time && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-ios-tertiary">{t.time}</span>
                <span className="text-sm font-medium text-ios-label">🕐 {time}</span>
              </div>
            )}

            {/* Address */}
            {address && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-ios-tertiary">{t.address}</span>
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-ios-blue text-right max-w-[60%] active:underline"
                >
                  📍 {address}
                </a>
              </div>
            )}

            {/* Phone */}
            {phone && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-ios-tertiary">{t.phone}</span>
                <a href={telUrl} className="text-sm font-medium text-ios-blue active:underline">
                  📱 {phone}
                </a>
              </div>
            )}

            {/* Customer who ordered (shown only for gift orders where customer ≠ recipient) */}
            {showCustomer && (
              <div className="flex items-center justify-between px-4 py-3 bg-brand-50/30">
                <span className="text-sm text-ios-tertiary">{t.orderedBy}</span>
                <div className="text-right">
                  {customerName && (
                    <p className="text-sm font-medium text-ios-label">{customerName}</p>
                  )}
                  <a href={`tel:${customerPhone.replace(/\s/g, '')}`} className="text-sm text-ios-blue active:underline">
                    📱 {customerPhone}
                  </a>
                </div>
              </div>
            )}

            {/* Fee + Payment */}
            {fee != null && fee !== '' && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-ios-tertiary">{t.fee}</span>
                <span className="text-sm font-medium text-ios-label">
                  {Number(fee).toFixed(0)} zł · {payment}
                </span>
              </div>
            )}

            {/* Delivered at */}
            {isDone && deliveredAt && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-ios-tertiary">{t.deliveredAt}</span>
                <span className="text-sm font-medium text-ios-green">
                  ✓ {new Date(deliveredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}
          </div>

          {/* Payment status badge */}
          {paymentStatus && (
            <div className="flex items-center gap-2">
              {paymentStatus === 'Paid' && (
                <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-100 text-emerald-700">{t.paidBadge}</span>
              )}
              {paymentStatus === 'Unpaid' && (
                <span className="text-xs font-semibold px-3 py-1 rounded-full bg-red-100 text-red-700">{t.unpaidBadge}</span>
              )}
              {paymentStatus === 'Partial' && (
                <span className="text-xs font-semibold px-3 py-1 rounded-full bg-amber-100 text-amber-700">{t.partialBadge}</span>
              )}
            </div>
          )}

          {/* Order contents */}
          {orderContents && (
            <div>
              <p className="ios-label">{t.orderContents}</p>
              <div className="ios-card px-4 py-3">
                <p className="text-sm text-ios-label">🌸 {orderContents}</p>
              </div>
            </div>
          )}

          {/* Special instructions */}
          {specialInstr && (
            <div>
              <p className="ios-label">{t.specialInstructions}</p>
              <div className="ios-card px-4 py-3 border border-amber-200 bg-amber-50/50">
                <p className="text-sm text-ios-label">⚠ {specialInstr}</p>
              </div>
            </div>
          )}

          {/* Greeting card */}
          {cardText && (
            <div>
              <p className="ios-label">{t.greetingCard}</p>
              <div className="ios-card px-4 py-3">
                <p className="text-sm text-ios-label italic">&ldquo;{cardText}&rdquo;</p>
              </div>
            </div>
          )}

          {/* Driver notes */}
          <div>
            <p className="ios-label">{t.driverNotes}</p>
            <div className="ios-card px-4 py-3">
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t.notesPlaceholder}
                rows={2}
                className="w-full text-sm text-ios-label bg-transparent outline-none resize-none placeholder-ios-tertiary/50"
              />
            </div>
            {note !== (d['Driver Notes'] || '') && (
              <button
                onClick={handleSaveNote}
                disabled={saving}
                className="mt-2 px-4 py-2 rounded-xl bg-brand-100 text-brand-700 text-xs font-semibold
                           active:bg-brand-200 active-scale"
              >
                {saving ? '...' : t.saveNote}
              </button>
            )}
          </div>

          {/* Action buttons */}
          {(isPending || isOut) && (
            <div className="pt-2 space-y-2">
              {isPending && (
                <button
                  onClick={() => onStatusChange('Out for Delivery')}
                  className="w-full h-12 rounded-2xl bg-ios-blue text-white text-base font-semibold
                             flex items-center justify-center gap-2 active:opacity-80 active-scale shadow-md"
                >
                  🚗 {t.startDelivery}
                </button>
              )}
              {isOut && (
                <button
                  onClick={() => {
                    if (window.confirm(t.confirmDelivery)) onStatusChange('Delivered');
                  }}
                  className="w-full h-12 rounded-2xl bg-ios-green text-white text-base font-semibold
                             flex items-center justify-center gap-2 active:opacity-80 active-scale shadow-md"
                >
                  ✓ {t.markDelivered}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
