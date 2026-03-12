// Step3Details — consistent pill-button selectors throughout, matching Order Source style.

import { useState, useEffect } from 'react';
import client from '../../api/client.js';
import t from '../../translations.js';
import DatePicker from '../DatePicker.jsx';

const SOURCES     = ['In-store', 'Instagram', 'WhatsApp', 'Telegram', 'Wix', 'Flowwow', 'Other'];
const FALLBACK_PAY_METHODS = ['Cash', 'Card', 'Transfer'];
const FALLBACK_TIME_SLOTS  = ['10:00-12:00', '12:00-14:00', '14:00-16:00', '16:00-18:00'];

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
              : 'bg-gray-100 text-ios-secondary border border-gray-200 hover:bg-gray-200'
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

export default function Step3Details({ form, onChange }) {
  const SOURCE_LABELS = getSourceLabels();
  const set = key => val => onChange({ [key]: val });

  // Fetch config lists from backend (time slots, payment methods)
  const [timeSlots, setTimeSlots] = useState(FALLBACK_TIME_SLOTS);
  const [payMethods, setPayMethods] = useState(FALLBACK_PAY_METHODS);

  useEffect(() => {
    client.get('/settings/lists')
      .then(r => {
        if (r.data.paymentMethods?.length) setPayMethods(r.data.paymentMethods);
      })
      .catch(() => {});
    client.get('/settings')
      .then(r => {
        if (r.data.config?.deliveryTimeSlots?.length) setTimeSlots(r.data.config.deliveryTimeSlots);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-6">

      {/* Source */}
      <SectionCard label={t.source}>
        <Pills
          value={form.source}
          onChange={val => onChange({ source: val })}
          options={SOURCES.map(s => ({ value: s, label: SOURCE_LABELS[s] }))}
        />
      </SectionCard>

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

      {/* Timing — date + time slot (both optional — may be provided later) */}
      <div className="relative z-20">
        <p className="ios-label">{form.deliveryType === 'Delivery' ? t.labelDeliveryTiming : t.requiredBy}</p>
        <div className="ios-card overflow-visible divide-y divide-gray-100">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="text-sm text-ios-tertiary w-28 shrink-0">{t.deliveryDate}</span>
            <div className="flex-1">
              <DatePicker
                value={form.deliveryDate}
                onChange={val => onChange({ deliveryDate: val })}
                placeholder={t.optional}
              />
            </div>
          </div>
          <div className="px-4 py-3.5">
            <span className="text-sm text-ios-tertiary mb-2 block">{t.deliveryTime}</span>
            <div className="flex flex-wrap gap-2">
              {timeSlots.map(slot => (
                <button
                  key={slot}
                  onClick={() => onChange({ deliveryTime: form.deliveryTime === slot ? '' : slot })}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors active-scale ${
                    form.deliveryTime === slot
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'bg-gray-100 text-ios-secondary border border-gray-200 hover:bg-gray-200'
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
                <span className="text-ios-tertiary text-sm shrink-0">zł</span>
              </div>
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

      {/* Payment status */}
      <SectionCard label={t.paymentStatus}>
        <Pills
          value={form.paymentStatus}
          onChange={val => onChange({ paymentStatus: val, ...(val === 'Unpaid' ? { paymentMethod: '' } : {}) })}
          options={[
            { value: 'Unpaid', label: t.paymentUnpaid },
            { value: 'Paid',   label: t.paymentPaid },
          ]}
        />
      </SectionCard>

      {/* Payment method — only shown when paid */}
      {form.paymentStatus === 'Paid' && (
        <SectionCard label={t.paymentMethod}>
          <Pills
            value={form.paymentMethod}
            onChange={val => onChange({ paymentMethod: val })}
            options={payMethods.map(m => ({ value: m, label: m }))}
          />
        </SectionCard>
      )}

    </div>
  );
}
