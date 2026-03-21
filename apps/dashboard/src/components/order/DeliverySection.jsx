import t from '../../translations.js';
import Pills from '../Pills.jsx';
import InlineEdit from '../InlineEdit.jsx';

function EditableRow({ label, value, onSave, disabled, multiline, type, suffix }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-ios-tertiary w-20 shrink-0 pt-0.5">{label}</span>
      <div className="flex-1 flex items-center gap-1">
        <InlineEdit value={value || ''} onSave={onSave} disabled={disabled} multiline={multiline} type={type} placeholder="—" />
        {suffix && value && <span className="text-xs text-ios-tertiary">{suffix}</span>}
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div>
      <p className="text-xs text-ios-tertiary mb-1.5">{label}</p>
      {children}
    </div>
  );
}

export default function DeliverySection({ order, driverNames, timeSlots, saving, patchDelivery }) {
  const o = order;
  const DRIVERS = driverNames.map(v => ({ value: v, label: v }));

  if (o['Delivery Type'] !== 'Delivery' || !o.delivery) return null;

  return (
    <>
      <div className="space-y-3">
        <Section label={t.deliveryMethod}>
          <Pills
            options={[
              { value: 'Driver',  label: t.deliveryMethodDriver },
              { value: 'Taxi',    label: t.deliveryMethodTaxi },
              { value: 'Florist', label: t.deliveryMethodFlorist },
            ]}
            value={o.delivery?.['Delivery Method'] || 'Driver'}
            onChange={v => {
              const patch = { 'Delivery Method': v };
              if (v === 'Taxi') { patch['Assigned Driver'] = ''; patch['Driver Payout'] = 0; }
              else if (v === 'Florist') { patch['Assigned Driver'] = ''; patch['Driver Payout'] = 0; patch['Taxi Cost'] = 0; }
              else { patch['Taxi Cost'] = 0; }
              patchDelivery(patch);
            }}
            disabled={saving}
          />
        </Section>

        {(o.delivery?.['Delivery Method'] || 'Driver') === 'Driver' && (
          <Section label={t.driver}>
            <Pills options={DRIVERS} value={o.delivery?.['Assigned Driver'] || ''} onChange={v => patchDelivery({ 'Assigned Driver': v })} disabled={saving} />
          </Section>
        )}

        {o.delivery?.['Delivery Method'] === 'Taxi' && (
          <Section label={t.taxiCost}>
            <InlineEdit value={o.delivery['Taxi Cost'] ? String(o.delivery['Taxi Cost']) : ''} type="number" placeholder="0"
              onSave={v => patchDelivery({ 'Taxi Cost': v ? Number(v) : 0 })} disabled={saving} />
          </Section>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">{t.delivery}</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-3 bg-white rounded-xl border border-gray-100 px-4 py-3">
          <EditableRow label={t.recipientName} value={o.delivery['Recipient Name']} onSave={v => patchDelivery({ 'Recipient Name': v })} disabled={saving} />
          <EditableRow label={t.phone} value={o.delivery['Recipient Phone']} onSave={v => patchDelivery({ 'Recipient Phone': v })} disabled={saving} />
          <EditableRow label={t.deliveryAddress} value={o.delivery['Delivery Address']} onSave={v => patchDelivery({ 'Delivery Address': v })} disabled={saving} multiline />
          <EditableRow label={t.deliveryDate} value={o.delivery['Delivery Date'] || ''} onSave={v => patchDelivery({ 'Delivery Date': v || null })} disabled={saving} type="date" />
          <div className="flex items-start gap-3">
            <span className="text-xs text-ios-tertiary w-20 shrink-0 pt-0.5">{t.deliveryTime}</span>
            <div className="flex-1">
              <Pills options={timeSlots.map(s => ({ value: s, label: s }))} value={o.delivery['Delivery Time'] || ''} onChange={v => patchDelivery({ 'Delivery Time': v })} disabled={saving} />
            </div>
          </div>
          <EditableRow label={t.cardText} value={o.delivery['Greeting Card Text']} onSave={v => patchDelivery({ 'Greeting Card Text': v })} disabled={saving} multiline />
          <EditableRow label={t.deliveryFee} value={o.delivery['Delivery Fee'] ? String(o.delivery['Delivery Fee']) : ''} onSave={v => patchDelivery({ 'Delivery Fee': v ? Number(v) : null })} disabled={saving} type="number" suffix={t.zl} />
        </div>
      </div>
    </>
  );
}
