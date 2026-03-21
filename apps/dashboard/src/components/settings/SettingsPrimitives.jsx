import { useState, useEffect } from 'react';
import t from '../../translations.js';

export function ConfigRow({ label, value, type = 'text', onSave, hint }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  function save() {
    onSave(type === 'number' ? Number(draft) : draft);
    setEditing(false);
  }

  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <div>
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            type={type}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="w-24 px-2 py-1 text-sm border rounded-lg text-right"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && save()}
          />
          <button onClick={save} className="text-xs text-white bg-brand-600 px-2 py-1 rounded-lg">OK</button>
          <button onClick={() => { setEditing(false); setDraft(value); }} className="text-xs text-gray-400">✕</button>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-sm text-brand-600 font-medium hover:bg-brand-50 px-3 py-1 rounded-lg transition-colors"
        >
          {type === 'number' ? value : value}
        </button>
      )}
    </div>
  );
}

export function ListEditor({ label, items, onSave, hint }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(items);
  const [newItem, setNewItem] = useState('');
  const [warning, setWarning] = useState(null);

  useEffect(() => { setDraft(items); }, [items]);

  function findDuplicate(val) {
    const trimmed = val.trim().toLowerCase();
    if (!trimmed) return null;
    for (const existing of draft) {
      const ex = existing.toLowerCase();
      if (ex === trimmed) return { type: 'exact', match: existing };
      if (ex.startsWith(trimmed) || trimmed.startsWith(ex)) {
        return { type: 'similar', match: existing };
      }
    }
    return null;
  }

  function addItem(force = false) {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    if (!force) {
      const dup = findDuplicate(trimmed);
      if (dup) {
        if (dup.type === 'exact') { setWarning({ type: 'exact', match: dup.match }); return; }
        setWarning({ type: 'similar', match: dup.match }); return;
      }
    }
    setDraft([...draft, trimmed]);
    setNewItem('');
    setWarning(null);
  }

  function removeItem(i) { setDraft(draft.filter((_, idx) => idx !== i)); }

  function save() {
    onSave(draft);
    setEditing(false);
    setWarning(null);
  }

  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-sm font-medium text-gray-700">{label}</span>
          {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
        </div>
        {!editing ? (
          <button onClick={() => setEditing(true)} className="text-xs text-brand-600 font-medium hover:bg-brand-50 px-2 py-1 rounded-lg">{t.edit}</button>
        ) : (
          <div className="flex gap-1">
            <button onClick={save} className="text-xs text-white bg-brand-600 px-2 py-1 rounded-lg">{t.save}</button>
            <button onClick={() => { setEditing(false); setDraft(items); setWarning(null); }} className="text-xs text-gray-400">✕</button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(editing ? draft : items).map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs px-2.5 py-1 rounded-full">
            {item}
            {editing && (
              <button onClick={() => removeItem(i)} className="text-gray-400 hover:text-red-500 ml-0.5">✕</button>
            )}
          </span>
        ))}
      </div>
      {editing && (
        <>
          <div className="flex gap-1.5 mt-2">
            <input
              value={newItem}
              onChange={e => { setNewItem(e.target.value); setWarning(null); }}
              onKeyDown={e => e.key === 'Enter' && addItem()}
              placeholder={t.addItem + '...'}
              className="flex-1 text-sm px-2 py-1 border rounded-lg"
            />
            <button onClick={() => addItem()} className="text-xs bg-gray-200 px-2 py-1 rounded-lg">+</button>
          </div>
          {warning?.type === 'exact' && (
            <p className="text-xs text-red-500 mt-1">{t.alreadyExists}: "{warning.match}"</p>
          )}
          {warning?.type === 'similar' && (
            <div className="flex items-center gap-2 mt-1">
              <p className="text-xs text-amber-600">{t.similarTo}: "{warning.match}". {t.addAnyway}</p>
              <button onClick={() => addItem(true)} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">{t.confirm}</button>
              <button onClick={() => setWarning(null)} className="text-xs text-gray-400">✕</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Section({ title, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm px-5 py-4 mb-4">
      <h3 className="text-base font-semibold text-gray-800 mb-2">{title}</h3>
      {children}
    </div>
  );
}
