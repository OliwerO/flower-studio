// Step3Details — consistent pill-button selectors throughout, matching Order Source style.

import { useEffect } from 'react';
import t from '../../translations.js';
import DatePicker from '../DatePicker.jsx';
import useConfigLists from '../../hooks/useConfigLists.js';
import { getAvailableSlots, DeliveryPricingFields } from '@flower-studio/shared';

function getSourceLabels() {
  return { 'In-store': t.sourceWalk, Instagram: t.sourceInstagram, WhatsApp: t.sourceWhatsApp, Telegram: t.sourceTelegram, Wix: t.sourceWebsite, Flowwow: t.sourceFlowwow, Other: t.sourceOther };
}

// Reusable pill-button group — same style everywhere
function Pills({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors active-scale ${
            value === o.value
              ? 'bg-brand-600 text-white shadow-sm'
              : 'bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SectionCard({ label, children }) {
  return (
    <div>
      <p className="ios-label">{label}</p>
      <div className="ios-card p-4">{children}</div>
    </div>
  );
}

function FormCard({ label, children }) {
  return (
    <div>
      <p className="ios-label">{label}</p>
      <div className="ios-card overflow-hidden divide-y divide-gray-100">{children}</div>
    </div>
  );
}

function Row({ label, children, last }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${!last ? 'border-b border-gray-100' : ''}`}>
      <span className="text-sm text-ios-tertiary w-28 shrink-0">{label}</span>
      <div className="flex-1 text-right">{children}</div>
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder || '—'}
      className="w-full text-base text-ios-label bg-transparent outline-none placeholder-ios-tertiary/50 text-right"
    />
  );
}

export default function Step3Details({ form, onChange, apiClient }) {
  const SOURCE_LABELS = getSourceLabels();
  const { orderSources: SOURCES, paymentMethods: payMethods, timeSlots, slotLeadTimeMinutes } = useConfigLists();
  const smartSlots = getAvailableSlots(timeSlots, form.deliveryDate, slotLeadTimeMinutes);

  // Review fix (#189/#517): if Step 1 picked a key person (e.g. "Maria") and
  // the recipient name/phone is then hand-edited away from that person's own
  // value (e.g. to "Anna"), the stale keyPersonId must not survive — it would
  // silently win over the freshly typed text when the order is submitted.
  // Clearing it here in the same update makes the typed value (not the old
  // link) the source of truth. Only fires on a genuine divergence, so the
  // CR-30 C3 pre-fill below (which copies keyPersonName/-Phone in verbatim)
  // never trips it.
  const setRecipientField = (field, keyPersonField) => val => {
    const patch = { [field]: val };
    if (form.keyPersonId && val !== form[keyPersonField]) patch.keyPersonId = null;
    onChange(patch);
  };

  // CR-30 C3: when a recipient (key person) is chosen and fulfilment is Delivery,
  // pre-fill the editable recipient fields from the chosen person — empty-only so we
  // never overwrite a manual edit. Derives from local form state (pitfall #1).
  useEffect(() => {
    if (form.deliveryType !== 'Delivery' || !form.keyPersonId) return;
    const patch = {};
    if (!form.recipientName   && form.keyPersonName)    patch.recipientName   = form.keyPersonName;
    if (!form.recipientPhone  && form.keyPersonPhone)   patch.recipientPhone  = form.keyPersonPhone;
    if (!form.deliveryAddress && form.keyPersonAddress) patch.deliveryAddress = form.keyPersonAddress;
    if (Object.keys(patch).length) onChange(patch);
  }, [form.deliveryType, form.keyPersonId]);

  // When date changes, clear time slot if it's no longer available
  function handleDateChange(val) {
    const slots = getAvailableSlots(timeSlots, val, slotLeadTimeMinutes);
    const currentStillAvailable = slots.find(s => s.slot === form.deliveryTime)?.available;
    onChange({ deliveryDate: val, ...(form.deliveryTime && !currentStillAvailable ? { deliveryTime: '' } : {}) });
  }

  return (
    <div className="flex flex-col gap-6">

      {/* Order Source — where the order came from */}
      <SectionCard label={t.source}>
        <Pills
          value={form.source}
          onChange={val => onChange({ source: val })}
          options={SOURCES.map(s => ({ value: s, label: SOURCE_LABELS[s] || s }))}
        />
      </SectionCard>

      {/* Communication Method — only shown if customer doesn't already have one saved */}
      {!form.customerCommMethod && (
        <SectionCard label={t.communicationMethod}>
          <Pills
            value={form.communicationMethod || ''}
            onChange={val => onChange({ communicationMethod: val })}
            options={SOURCES.map(s => ({ value: s, label: SOURCE_LABELS[s] || s }))}
          />
        </SectionCard>
      )}

      {/* Fulfillment */}
      <SectionCard label={t.deliveryType}>
        <Pills
          value={form.deliveryType}
          onChange={val => onChange({ deliveryType: val })}
          options={[
            { value: 'Pickup',   label: t.deliveryPickup },
            { value: 'Delivery', label: t.deliveryDelivery },
          ]}
        />
      </SectionCard>

      {/* Timing — date required, time slot optional */}
      <div className="relative z-20">
        <p className="ios-label">{form.deliveryType === 'Delivery' ? t.labelDeliveryTiming : t.requiredBy} <span className="text-ios-red">*</span></p>
        <div className={`ios-card overflow-visible divide-y divide-gray-100 ${!form.deliveryDate ? 'ring-1 ring-ios-red/30' : ''}`}>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="text-sm text-ios-tertiary w-28 shrink-0">{t.deliveryDate} <span className="text-ios-red">*</span></span>
            <div className="flex-1">
              <DatePicker
                value={form.deliveryDate}
                onChange={handleDateChange}
                placeholder={t.selectDate || 'Select date'}
              />
            </div>
          </div>
          <div className="px-4 py-3.5">
            <span className="text-sm text-ios-tertiary mb-2 block">{t.deliveryTime}</span>
            <div className="flex flex-wrap gap-2">
              {smartSlots.map(({ slot, available }) => (
                <button
                  key={slot}
                  onClick={() => available && onChange({ deliveryTime: form.deliveryTime === slot ? '' : slot })}
                  disabled={!available}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors active-scale ${
                    !available
                      ? 'opacity-40 cursor-not-allowed bg-gray-100 dark:bg-gray-700 text-gray-400 border border-gray-200 dark:border-gray-600'
                      : form.deliveryTime === slot
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {slot}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Delivery-specific */}
      {form.deliveryType === 'Delivery' && (
        <>
          <FormCard label={t.labelRecipient}>
            <Row label={t.recipientName}>
              <TextInput value={form.recipientName} onChange={setRecipientField('recipientName', 'keyPersonName')} placeholder="Name" />
            </Row>
            <Row label={t.recipientPhone}>
              <TextInput type="tel" value={form.recipientPhone} onChange={setRecipientField('recipientPhone', 'keyPersonPhone')} placeholder="+48..." />
            </Row>
            <Row label={null} last>
              <DeliveryPricingFields
                address={form.deliveryAddress}
                deliveryMethod="Driver"
                value={{ fee: form.deliveryFee, cost: form.deliveryCost }}
                onChange={patch => {
                  // DeliveryPricingFields' patch keys (fee/cost/band) are its own
                  // internal vocabulary — map them onto this wizard's form field
                  // names (deliveryFee/deliveryCost/distanceBand) so the submit
                  // payload assembly in NewOrderPage.jsx reads the values it expects.
                  const mapped = {};
                  if ('fee' in patch) mapped.deliveryFee = patch.fee;
                  if ('cost' in patch) mapped.deliveryCost = patch.cost;
                  if ('distanceKm' in patch) mapped.distanceKm = patch.distanceKm;
                  if ('band' in patch) mapped.distanceBand = patch.band;
                  onChange(mapped);
                }}
                apiClient={apiClient}
                t={t}
              />
            </Row>
          </FormCard>

          <div>
            <p className="ios-label">{t.deliveryAddress}</p>
            <div className="ios-card px-4 py-3">
              <textarea
                value={form.deliveryAddress}
                onChange={e => onChange({ deliveryAddress: e.target.value })}
                placeholder="ul. Kwiatowa 1, Kraków"
                rows={2}
                className="w-full text-base text-ios-label bg-transparent outline-none resize-none placeholder-ios-tertiary/50"
              />
            </div>
          </div>

        </>
      )}

      {/* Card text — available for both delivery and pickup */}
      <div>
        <p className="ios-label">{t.cardText}</p>
        <div className="ios-card px-4 py-3">
          <textarea
            value={form.cardText}
            onChange={e => onChange({ cardText: e.target.value })}
            placeholder="Happy birthday! 🎂"
            rows={4}
            className="w-full text-lg text-ios-label bg-transparent outline-none resize-none placeholder-ios-tertiary/50 leading-relaxed"
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <p className="ios-label">{t.orderNotes}</p>
        <div className="ios-card px-4 py-3">
          <textarea
            value={form.notes}
            onChange={e => onChange({ notes: e.target.value })}
            placeholder="Any additional notes..."
            rows={3}
            className="w-full text-base text-ios-label bg-transparent outline-none resize-none placeholder-ios-tertiary/50"
          />
        </div>
      </div>

      {/* Florist note — internal, staff-only. Captured here at creation instead
          of only via post-creation edit (#189). Green tint matches the same
          field's treatment in OrderCard / OrderDetailPage so it reads as one
          concept across the app. */}
      <div>
        <p className="ios-label">🌸 {t.floristNote}</p>
        <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-3">
          <textarea
            value={form.floristNote}
            onChange={e => onChange({ floristNote: e.target.value })}
            placeholder={t.floristNotePlaceholder}
            rows={3}
            className="w-full text-base text-ios-label bg-transparent outline-none resize-none placeholder-ios-tertiary/50"
          />
        </div>
      </div>

      {/* Payment status */}
      <SectionCard label={t.paymentStatus}>
        <Pills
          value={form.paymentStatus}
          onChange={val => onChange({ paymentStatus: val, ...(val === 'Unpaid' ? { paymentMethod: '' } : {}) })}
          options={[
            { value: 'Unpaid',  label: t.paymentUnpaid },
            { value: 'Paid',    label: t.paymentPaid },
            { value: 'Partial', label: t.paymentPartial || 'Partial' },
          ]}
        />
      </SectionCard>

      {/* Payment method — shown when paid or partial */}
      {(form.paymentStatus === 'Paid' || form.paymentStatus === 'Partial') && (
        <SectionCard label={t.paymentMethod}>
          <Pills
            value={form.paymentMethod}
            onChange={val => onChange({ paymentMethod: val })}
            options={payMethods.map(m => ({ value: m, label: m }))}
          />
        </SectionCard>
      )}

      {/* Partial payment amount — shown only for Partial status */}
      {form.paymentStatus === 'Partial' && (
        <SectionCard label={t.partialAmountPaid || 'Amount paid'}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.payment1Amount || ''}
              onChange={e => onChange({ payment1Amount: e.target.value })}
              placeholder="0"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 text-base"
            />
            <span className="text-sm text-ios-tertiary">{t.zl || 'zł'}</span>
          </div>
        </SectionCard>
      )}

    </div>
  );
}
