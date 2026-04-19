// Step3Details — adapted for dashboard with full payment method list.
// Uses server-configured delivery time slots (pill buttons) matching the florist app.

import t from '../../translations.js';
import DatePicker from '../DatePicker.jsx';
import useConfigLists from '../../hooks/useConfigLists.js';
import { getAvailableSlots } from '@flower-studio/shared';

function getSourceLabels() {
  return { 'In-store': t.sourceWalk, Instagram: t.sourceInstagram, WhatsApp: t.sourceWhatsApp, Telegram: t.sourceTelegram, Wix: t.sourceWebsite, Flowwow: t.sourceFlowwow, Other: t.sourceOther };
}
function getMethodLabels() {
  return {
    Cash: t.methodCash, Card: t.methodCard, Mbank: 'Mbank', Monobank: 'Monobank',
    Revolut: 'Revolut', PayPal: 'PayPal', 'Wix Online': 'Wix Online', Other: t.sourceOther,
  };
}

function Pills({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
            value === o.value
              ? 'bg-brand-600 text-white shadow-sm'
              : 'bg-white/50 text-ios-secondary border border-white/60 active:bg-white/70'
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
      <div className="ios-card overflow-hidden divide-y divide-white/40">{children}</div>
    </div>
  );
}

function Row({ label, children, last }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${!last ? 'border-b border-white/40' : ''}`}>
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

export default function Step3Details({ form, onChange }) {
  const SOURCE_LABELS = getSourceLabels();
  const METHOD_LABELS = getMethodLabels();
  const { orderSources: SOURCES, paymentMethods: payMethods, timeSlots, slotLeadTimeMinutes } = useConfigLists();
  const smartSlots = getAvailableSlots(timeSlots, form.deliveryDate, slotLeadTimeMinutes);
  const set = key => val => onChange({ [key]: val });

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

      {/* Timing — date picker + time slot pills (fetched from server config) */}
      <div className="relative z-20">
        <p className="ios-label">{form.deliveryType === 'Delivery' ? t.labelDeliveryTiming : t.requiredBy} <span className="text-ios-red">*</span></p>
        <div className={`ios-card overflow-visible divide-y divide-white/40 ${!form.deliveryDate ? 'ring-1 ring-ios-red/30' : ''}`}>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="text-sm text-ios-tertiary w-28 shrink-0">{t.deliveryDate} <span className="text-ios-red">*</span></span>
            <div className="flex-1">
              <DatePicker
                value={form.deliveryDate}
                onChange={handleDateChange}
                placeholder={t.selectDate || t.optional}
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
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    !available
                      ? 'opacity-40 cursor-not-allowed bg-gray-100 text-gray-400 border border-gray-200'
                      : form.deliveryTime === slot
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'bg-white/50 text-ios-secondary border border-white/60 active:bg-white/70'
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
              <TextInput value={form.recipientName} onChange={set('recipientName')} placeholder="Name" />
            </Row>
            <Row label={t.recipientPhone}>
              <TextInput type="tel" value={form.recipientPhone} onChange={set('recipientPhone')} placeholder="+48..." />
            </Row>
            <Row label={t.deliveryFee} last>
              <div className="flex items-center justify-end gap-1">
                <TextInput type="number" value={form.deliveryFee} onChange={v => onChange({ deliveryFee: Number(v) })} placeholder="35" />
                <span className="text-ios-tertiary text-sm shrink-0">zl</span>
              </div>
            </Row>
          </FormCard>

          <div>
            <p className="ios-label">{t.deliveryAddress}</p>
            <div className="ios-card px-4 py-3">
              <textarea
                value={form.deliveryAddress}
                onChange={e => onChange({ deliveryAddress: e.target.value })}
                placeholder="ul. Kwiatowa 1, Krakow"
                rows={2}
                className="w-full text-base text-ios-label bg-transparent outline-none resize-none placeholder-ios-tertiary/50"
              />
            </div>
          </div>
        </>
      )}

      {/* Card text — available for both Delivery and Pickup */}
      <div>
        <p className="ios-label">{t.cardText}</p>
        <div className="ios-card px-4 py-3">
          <textarea
            value={form.cardText}
            onChange={e => onChange({ cardText: e.target.value })}
            placeholder="Happy birthday!"
            rows={2}
            className="w-full text-base text-ios-label bg-transparent outline-none resize-none placeholder-ios-tertiary/50"
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

      {/* Payment method — only shown when paid */}
      {form.paymentStatus === 'Paid' && (
        <SectionCard label={t.paymentMethod}>
          <Pills
            value={form.paymentMethod}
            onChange={val => onChange({ paymentMethod: val })}
            options={payMethods.map(m => ({ value: m, label: METHOD_LABELS[m] || m }))}
          />
        </SectionCard>
      )}
    </div>
  );
}
