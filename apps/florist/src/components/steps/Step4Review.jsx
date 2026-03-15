// Step4Review — clean summary in iOS grouped-list style.

import t from '../../translations.js';
import fmtDate from '../../utils/formatDate.js';

function Section({ title, stepIndex, onEdit, children }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 px-1">
        <p className="ios-label !px-0 !mb-0">{title}</p>
        <button onClick={() => onEdit(stepIndex)} className="text-brand-600 text-sm font-medium">
          {t.edit}
        </button>
      </div>
      <div className="ios-card overflow-hidden divide-y divide-ios-separator/40">
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="text-sm text-ios-tertiary shrink-0">{label}</span>
      <span className="text-sm text-ios-label text-right max-w-[60%] font-medium">{value}</span>
    </div>
  );
}

export default function Step4Review({ form, orderTotal, deliveryFee, isOwner, onEdit, onSubmit, submitting }) {

  return (
    <div className="flex flex-col gap-5 pb-36">

      <h2 className="text-2xl font-bold text-ios-label">{t.reviewTitle}</h2>

      {/* Customer */}
      <Section title={t.customer} stepIndex={0} onEdit={onEdit}>
        <Row label={t.customerName} value={form.customerName} />
      </Section>

      {/* Bouquet */}
      <Section title={t.bouquet} stepIndex={1} onEdit={onEdit}>
        {form.orderLines.map(l => (
          <Row
            key={l.stockItemId}
            label={l.flowerName}
            value={`${l.quantity} × ${l.sellPricePerUnit} zł = ${(l.quantity * l.sellPricePerUnit).toFixed(0)} zł`}
          />
        ))}
        {form.customerRequest && <Row label={t.customerRequest} value={form.customerRequest} />}
        {form.priceOverride && <Row label={t.priceOverride} value={`${form.priceOverride} zł`} />}
      </Section>

      {/* Details */}
      <Section title={t.details} stepIndex={2} onEdit={onEdit}>
        <Row label={t.source}       value={form.source} />
        <Row label={t.deliveryType} value={form.deliveryType === 'Delivery' ? t.deliveryDelivery : t.deliveryPickup} />
        {form.deliveryType === 'Delivery' && (
          <>
            <Row label={t.recipientName}   value={form.recipientName} />
            <Row label={t.recipientPhone}  value={form.recipientPhone} />
            <Row label={t.deliveryAddress} value={form.deliveryAddress} />
            <Row label={t.deliveryDate}    value={fmtDate(form.deliveryDate)} />
            <Row label={t.deliveryTime}    value={form.deliveryTime} />
            <Row label={t.cardText}        value={form.cardText} />
            <Row label={t.deliveryFee}     value={`${form.deliveryFee} zł`} />
          </>
        )}
        <Row label={t.paymentStatus} value={form.paymentStatus === 'Paid' ? t.paymentPaid : t.paymentUnpaid} />
        <Row label={t.paymentMethod} value={form.paymentMethod} />
        {form.notes && <Row label={t.orderNotes} value={form.notes} />}
      </Section>

      {/* Total */}
      <div className="ios-card px-5 py-4">
        {deliveryFee > 0 && (
          <div className="flex justify-between text-sm text-ios-tertiary mb-2">
            <span>{t.deliveryFee}</span>
            <span>+ {deliveryFee} zł</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold text-ios-label">{t.orderTotal}</span>
          <span className="text-3xl font-bold text-brand-600">{orderTotal.toFixed(0)} zł</span>
        </div>
      </div>

      {/* Submit */}
      <div className="fixed bottom-0 left-0 right-0 glass-bar px-4 py-4 pb-6">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="w-full h-14 rounded-2xl bg-brand-600 text-white text-base font-semibold
                       disabled:opacity-30 active:bg-brand-700 shadow-lg active-scale"
          >
            {submitting ? t.submitting : t.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
