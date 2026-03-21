import { useState, useEffect } from 'react';
import t from '../../translations.js';

export function RateTypesEditor({ types, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(types);

  useEffect(() => { setDraft(types); }, [types]);

  function save() {
    onSave(draft.filter(t => t.trim()));
    setEditing(false);
  }

  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-sm font-medium text-gray-700">{t.rateTypes}</span>
          <p className="text-xs text-gray-400 mt-0.5">{t.rateTypesHint}</p>
        </div>
        {!editing ? (
          <button onClick={() => setEditing(true)} className="text-xs text-brand-600 font-medium hover:bg-brand-50 px-2 py-1 rounded-lg">{t.edit}</button>
        ) : (
          <div className="flex gap-1">
            <button onClick={save} className="text-xs text-white bg-brand-600 px-2 py-1 rounded-lg">{t.save}</button>
            <button onClick={() => { setEditing(false); setDraft(types); }} className="text-xs text-gray-400">✕</button>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        {draft.map((rt, idx) => (
          <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-xl text-sm border border-gray-100">
            {editing ? (
              <>
                <input
                  value={rt}
                  onChange={e => setDraft(d => d.map((v, i) => i === idx ? e.target.value : v))}
                  className="flex-1 text-sm px-2 py-1 border rounded-lg"
                />
                {draft.length > 1 && (
                  <button onClick={() => setDraft(d => d.filter((_, i) => i !== idx))} className="text-red-400 text-sm">✕</button>
                )}
              </>
            ) : (
              <span className="flex-1 font-medium text-gray-700">{rt}</span>
            )}
          </div>
        ))}
        {editing && (
          <button
            onClick={() => setDraft(d => [...d, ''])}
            className="w-full py-2 text-xs text-brand-600 font-medium bg-brand-50 rounded-xl hover:bg-brand-100"
          >+ {t.addRateType}</button>
        )}
      </div>
    </div>
  );
}

export function FloristRatesEditor({ names, rateTypes, rates, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rates);

  useEffect(() => { setDraft(rates); }, [rates]);

  function updateRate(name, type, value) {
    setDraft(d => ({
      ...d,
      [name]: { ...(d[name] || {}), [type]: Number(value) || 0 },
    }));
  }

  function save() {
    onSave(draft);
    setEditing(false);
  }

  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-sm font-medium text-gray-700">{t.floristRates}</span>
          <p className="text-xs text-gray-400 mt-0.5">{t.floristRatesHint}</p>
        </div>
        {!editing ? (
          <button onClick={() => setEditing(true)} className="text-xs text-brand-600 font-medium hover:bg-brand-50 px-2 py-1 rounded-lg">{t.edit}</button>
        ) : (
          <div className="flex gap-1">
            <button onClick={save} className="text-xs text-white bg-brand-600 px-2 py-1 rounded-lg">{t.save}</button>
            <button onClick={() => { setEditing(false); setDraft(rates); }} className="text-xs text-gray-400">✕</button>
          </div>
        )}
      </div>
      <div className="space-y-3">
        {names.map(name => {
          const floristRates = typeof rates[name] === 'object' ? rates[name] : {};
          const floristDraft = typeof draft[name] === 'object' ? draft[name] : {};
          return (
            <div key={name} className="px-3 py-2 bg-gray-50 rounded-xl border border-gray-100">
              <span className="text-sm font-medium text-gray-700 block mb-1.5">{name}</span>
              <div className="grid grid-cols-3 gap-2">
                {rateTypes.map(type => (
                  <div key={type} className="text-center">
                    <span className="text-[10px] text-gray-400 uppercase block mb-0.5">{type}</span>
                    {editing ? (
                      <input
                        type="number" min="0" step="1"
                        value={floristDraft[type] || ''}
                        onChange={e => updateRate(name, type, e.target.value)}
                        placeholder="0"
                        className="w-full text-sm px-2 py-1 border rounded-lg text-center"
                      />
                    ) : (
                      <span className="text-sm text-gray-500">{floristRates[type] ? `${floristRates[type]} zł/h` : '—'}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
