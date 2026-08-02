import { useState } from 'react';
import t from '../../translations.js';
import { ConfigRow, Section } from './SettingsPrimitives.jsx';

export default function DistanceBandsSection({ config: cfg, onUpdate }) {
  const bands = cfg.distanceBands || [];
  const [editingBand, setEditingBand] = useState(null);
  const [draft, setDraft] = useState({ upToKm: '', price: 0 });

  function startEdit(i) {
    if (i === 'new') {
      setDraft({ upToKm: '', price: 0 });
    } else {
      const b = bands[i];
      setDraft({ upToKm: b.upToKm == null ? '' : String(b.upToKm), price: b.price });
    }
    setEditingBand(i);
  }

  function saveBand() {
    const entry = {
      id: editingBand === 'new' ? (bands.length > 0 ? Math.max(...bands.map(b => b.id)) + 1 : 1) : bands[editingBand].id,
      upToKm: draft.upToKm === '' ? null : Number(draft.upToKm),
      price: Number(draft.price) || 0,
    };
    const updated = [...bands];
    if (editingBand === 'new') updated.push(entry);
    else updated[editingBand] = entry;
    onUpdate({ distanceBands: updated });
    setEditingBand(null);
  }

  function removeBand(i) {
    onUpdate({ distanceBands: bands.filter((_, idx) => idx !== i) });
  }

  return (
    <Section title={t.dbTitle}>
      <div className="space-y-1.5 mb-3">
        {bands.map((b, i) => (
          <div key={b.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-xl text-sm border border-gray-100">
            <span className="flex-1 font-medium text-gray-700">
              {b.upToKm == null ? t.dbUnbounded : `${t.dbUpToKm}: ${b.upToKm}`}
            </span>
            <span className="text-xs text-gray-500">{b.price} zł</span>
            <button onClick={() => startEdit(i)} className="text-xs text-brand-600">{t.edit}</button>
            <button onClick={() => removeBand(i)} className="text-xs text-red-400 hover:text-red-600">✕</button>
          </div>
        ))}
      </div>

      <button
        onClick={() => startEdit('new')}
        className="text-xs text-brand-600 font-medium hover:bg-brand-50 px-2 py-1 rounded-lg mb-3"
      >+ {t.dbAddBand}</button>

      {editingBand !== null && (
        <div className="p-3 bg-white border border-gray-200 rounded-xl space-y-2 mb-3">
          <div className="flex gap-2">
            <input
              type="number"
              value={draft.upToKm}
              onChange={e => setDraft({ ...draft, upToKm: e.target.value })}
              placeholder={t.dbUnbounded}
              className="flex-1 text-sm px-2 py-1 border rounded-lg"
              min="0"
            />
            <input
              type="number"
              value={draft.price}
              onChange={e => setDraft({ ...draft, price: e.target.value })}
              placeholder={t.dbPrice}
              className="w-20 text-sm px-2 py-1 border rounded-lg"
              min="0"
            />
          </div>
          <div className="flex gap-2 items-center justify-end">
            <button onClick={saveBand} className="text-xs text-white bg-brand-600 px-3 py-1 rounded-lg">{t.save}</button>
            <button onClick={() => setEditingBand(null)} className="text-xs text-gray-400">✕</button>
          </div>
        </div>
      )}

      <ConfigRow
        label={t.dbStudioAddress}
        value={cfg.studioAddress || ''}
        hint={t.dbStudioAddressHint}
        onSave={v => onUpdate({ studioAddress: v })}
      />
    </Section>
  );
}
