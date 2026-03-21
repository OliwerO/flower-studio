import { useState } from 'react';
import t from '../../translations.js';
import { ConfigRow, ListEditor, Section } from './SettingsPrimitives.jsx';

export default function DeliveryZonesSection({ config: cfg, onUpdate }) {
  const zones = cfg.deliveryZones || [];
  const [editingZone, setEditingZone] = useState(null);
  const [draft, setDraft] = useState({ name: '', fee: 0, postcodes: '' });

  function startEdit(i) {
    if (i === 'new') {
      setDraft({ name: '', fee: 0, postcodes: '' });
    } else {
      const z = zones[i];
      setDraft({ name: z.name, fee: z.fee, postcodes: (z.postcodes || []).join(', ') });
    }
    setEditingZone(i);
  }

  function saveZone() {
    if (!draft.name) return;
    const entry = {
      id: editingZone === 'new' ? (zones.length > 0 ? Math.max(...zones.map(z => z.id)) + 1 : 1) : zones[editingZone].id,
      name: draft.name,
      fee: Number(draft.fee) || 0,
      postcodes: draft.postcodes.split(',').map(s => s.trim()).filter(Boolean),
    };
    const updated = [...zones];
    if (editingZone === 'new') updated.push(entry);
    else updated[editingZone] = entry;
    onUpdate({ deliveryZones: updated });
    setEditingZone(null);
  }

  function removeZone(i) {
    onUpdate({ deliveryZones: zones.filter((_, idx) => idx !== i) });
  }

  return (
    <Section title={t.dzTitle}>
      <div className="space-y-1.5 mb-3">
        {zones.map((z, i) => (
          <div key={z.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-xl text-sm border border-gray-100">
            <span className="flex-1 font-medium text-gray-700">{z.name}</span>
            <span className="text-xs text-gray-500">{z.fee} zl</span>
            <span className="text-xs text-gray-400">{(z.postcodes || []).join(', ') || t.dzAnyPostcode}</span>
            <button onClick={() => startEdit(i)} className="text-xs text-brand-600">{t.edit}</button>
            <button onClick={() => removeZone(i)} className="text-xs text-red-400 hover:text-red-600">✕</button>
          </div>
        ))}
      </div>

      <button
        onClick={() => startEdit('new')}
        className="text-xs text-brand-600 font-medium hover:bg-brand-50 px-2 py-1 rounded-lg mb-3"
      >+ {t.dzAddZone}</button>

      {editingZone !== null && (
        <div className="p-3 bg-white border border-gray-200 rounded-xl space-y-2 mb-3">
          <div className="flex gap-2">
            <input
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              placeholder={t.dzZoneName}
              className="flex-1 text-sm px-2 py-1 border rounded-lg"
            />
            <input
              type="number"
              value={draft.fee}
              onChange={e => setDraft({ ...draft, fee: e.target.value })}
              placeholder={t.dzFee}
              className="w-20 text-sm px-2 py-1 border rounded-lg"
              min="0"
            />
          </div>
          <div className="flex gap-2 items-center">
            <input
              value={draft.postcodes}
              onChange={e => setDraft({ ...draft, postcodes: e.target.value })}
              placeholder={t.dzPostcodes}
              className="flex-1 text-sm px-2 py-1 border rounded-lg"
            />
            <button onClick={saveZone} className="text-xs text-white bg-brand-600 px-3 py-1 rounded-lg">{t.save}</button>
            <button onClick={() => setEditingZone(null)} className="text-xs text-gray-400">✕</button>
          </div>
        </div>
      )}

      <ConfigRow
        label={t.dzFreeThreshold}
        value={cfg.freeDeliveryThreshold || 0}
        type="number"
        hint={t.dzFreeThresholdHint}
        onSave={v => onUpdate({ freeDeliveryThreshold: v })}
      />
      <ConfigRow
        label={t.dzExpressSurcharge}
        value={cfg.expressSurcharge || 0}
        type="number"
        hint={t.dzExpressSurchargeHint}
        onSave={v => onUpdate({ expressSurcharge: v })}
      />

      <ListEditor
        label={t.dzTimeSlots}
        items={cfg.deliveryTimeSlots || []}
        hint={t.dzTimeSlotsHint}
        onSave={v => onUpdate({ deliveryTimeSlots: [...v].sort() })}
      />
    </Section>
  );
}
