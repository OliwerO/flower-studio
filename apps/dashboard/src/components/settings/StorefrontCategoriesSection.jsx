import { useState } from 'react';
import t from '../../translations.js';
import client from '../../api/client.js';
import { Section } from './SettingsPrimitives.jsx';

export default function StorefrontCategoriesSection({ config: cfg, onUpdate }) {
  const sc = cfg.storefrontCategories || {};
  const [editingType, setEditingType] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null);
  const [draft, setDraft] = useState({ name: '', slug: '', from: '', to: '', description: '', translations: {} });
  const [translating, setTranslating] = useState(false);
  const [transLang, setTransLang] = useState('en');

  const permanentList = (sc.permanent || []).map(p => typeof p === 'string' ? { name: p, slug: p.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, ''), description: '', translations: {} } : p);
  const autoList = (sc.auto || []).map(a => typeof a === 'string' ? { name: a, slug: a.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, ''), description: '', translations: {} } : a);

  function startEdit(type, i) {
    const entry = type === 'seasonal' ? sc.seasonal[i]
      : type === 'permanent' ? permanentList[i]
      : autoList[i];
    if (i === 'new') {
      setDraft({ name: '', slug: '', from: '', to: '', description: '', translations: {} });
    } else if (type === 'seasonal') {
      setDraft({ ...entry, from: toDisplay(entry.from), to: toDisplay(entry.to) });
    } else {
      setDraft({ ...entry });
    }
    setEditingType(type);
    setEditingIndex(i);
  }

  function closeEdit() { setEditingType(null); setEditingIndex(null); }

  async function translateDraft() {
    if (!draft.name && !draft.description) return;
    setTranslating(true);
    try {
      const trans = { ...(draft.translations || {}) };
      if (draft.name) {
        const titleRes = await client.post('/products/translate', { text: draft.name, type: 'title' });
        for (const lang of ['en', 'pl', 'ru', 'uk']) {
          trans[lang] = { ...(trans[lang] || {}), title: titleRes.data[lang] || '' };
        }
      }
      if (draft.description) {
        const descRes = await client.post('/products/translate', { text: draft.description, type: 'description' });
        for (const lang of ['en', 'pl', 'ru', 'uk']) {
          trans[lang] = { ...(trans[lang] || {}), description: descRes.data[lang] || '' };
        }
      }
      setDraft(d => ({ ...d, translations: trans }));
    } catch (err) {
      console.error('Translation failed:', err);
    }
    setTranslating(false);
  }

  function toInternal(ddmm) {
    if (!ddmm) return ddmm;
    const clean = ddmm.replace(/\./g, '-');
    const parts = clean.split('-');
    if (parts.length !== 2) return clean;
    const [a, b] = parts.map(p => p.trim().padStart(2, '0'));
    if (Number(a) > 12) return `${b}-${a}`;
    return `${b}-${a}`;
  }
  function toDisplay(mmdd) {
    if (!mmdd) return '';
    const parts = mmdd.split('-');
    if (parts.length !== 2) return mmdd;
    return `${parts[1]}-${parts[0]}`;
  }

  function saveDraft() {
    if (!draft.name) return;
    const slug = draft.slug || draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');

    if (editingType === 'seasonal') {
      if (!draft.from || !draft.to) return;
      const entry = { ...draft, slug, from: toInternal(draft.from), to: toInternal(draft.to) };
      const updated = [...(sc.seasonal || [])];
      if (editingIndex === 'new') updated.push(entry);
      else updated[editingIndex] = entry;
      updated.sort((a, b) => a.from.localeCompare(b.from));
      onUpdate({ storefrontCategories: { ...sc, seasonal: updated } });
    } else if (editingType === 'permanent') {
      const entry = { ...draft, slug };
      delete entry.from; delete entry.to;
      const updated = [...permanentList];
      if (editingIndex === 'new') updated.push(entry);
      else updated[editingIndex] = entry;
      onUpdate({ storefrontCategories: { ...sc, permanent: updated } });
    } else if (editingType === 'auto') {
      const entry = { ...draft, slug };
      delete entry.from; delete entry.to;
      const updated = [...autoList];
      updated[editingIndex] = entry;
      onUpdate({ storefrontCategories: { ...sc, auto: updated } });
    }
    closeEdit();
  }

  function removeCategory(type, i) {
    if (type === 'seasonal') {
      onUpdate({ storefrontCategories: { ...sc, seasonal: sc.seasonal.filter((_, idx) => idx !== i) } });
    } else if (type === 'permanent') {
      onUpdate({ storefrontCategories: { ...sc, permanent: permanentList.filter((_, idx) => idx !== i) } });
    }
  }

  function renderEditForm() {
    if (!editingType) return null;
    const showDates = editingType === 'seasonal';
    return (
      <div className="mt-2 p-3 bg-white border border-gray-200 rounded-xl space-y-2">
        <div className="flex gap-2">
          <input
            value={draft.name}
            onChange={e => setDraft({ ...draft, name: e.target.value })}
            placeholder={t.sfCategoryName}
            className="flex-1 text-sm px-2 py-1 border rounded-lg"
            readOnly={editingType === 'auto'}
          />
        </div>
        {showDates && (
          <div className="flex gap-2 items-center">
            <label className="text-xs text-gray-500">{t.sfFrom}:</label>
            <input value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} placeholder="DD-MM" className="w-20 text-sm px-2 py-1 border rounded-lg" />
            <label className="text-xs text-gray-500">{t.sfTo}:</label>
            <input value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} placeholder="DD-MM" className="w-20 text-sm px-2 py-1 border rounded-lg" />
          </div>
        )}
        <textarea
          value={draft.description || ''}
          onChange={e => setDraft({ ...draft, description: e.target.value })}
          placeholder={t.sfDescriptionHint}
          rows={2}
          className="w-full text-sm px-2 py-1 border rounded-lg resize-none"
        />
        <div className="flex items-center gap-2">
          <button onClick={translateDraft} disabled={translating || (!draft.name && !draft.description)} className="text-xs text-white bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 px-3 py-1 rounded-lg">
            {translating ? t.sfTranslating : t.sfTranslate}
          </button>
          <button onClick={saveDraft} className="text-xs text-white bg-brand-600 px-3 py-1 rounded-lg">{t.save}</button>
          <button onClick={closeEdit} className="text-xs text-gray-400">✕</button>
        </div>
        <div className="border border-gray-100 rounded-lg overflow-hidden">
          <div className="flex border-b border-gray-100">
            {['en', 'pl', 'ru', 'uk'].map(lang => (
              <button key={lang} onClick={() => setTransLang(lang)} className={`flex-1 text-xs py-1.5 font-medium ${transLang === lang ? 'bg-brand-50 text-brand-700 border-b-2 border-brand-600' : 'text-gray-400'}`}>
                {lang.toUpperCase()}{lang === 'pl' ? ' (Wix)' : ''}
              </button>
            ))}
          </div>
          <div className="p-2 space-y-1">
            <input
              value={draft.translations[transLang]?.title || ''}
              onChange={e => setDraft(d => ({ ...d, translations: { ...d.translations, [transLang]: { ...(d.translations[transLang] || {}), title: e.target.value } } }))}
              placeholder="Title"
              className="w-full text-xs px-2 py-1 border rounded"
            />
            <textarea
              value={draft.translations[transLang]?.description || ''}
              onChange={e => setDraft(d => ({ ...d, translations: { ...d.translations, [transLang]: { ...(d.translations[transLang] || {}), description: e.target.value } } }))}
              placeholder="Description"
              rows={2}
              className="w-full text-xs px-2 py-1 border rounded resize-none"
            />
          </div>
        </div>
      </div>
    );
  }

  function renderCategoryRow(cat, type, i, extra) {
    return (
      <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm ${extra?.highlight ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-100'}`}>
        <span className="flex-1 font-medium text-gray-700">{cat.name}</span>
        {cat.description && <span className="text-xs text-gray-400 truncate max-w-[120px]" title={cat.description}>{cat.description}</span>}
        {extra?.dates && <span className="text-xs text-gray-400">{toDisplay(cat.from)} → {toDisplay(cat.to)}</span>}
        {cat.translations?.pl?.title && <span className="text-xs text-blue-500 font-medium">{t.sfTranslated}</span>}
        {extra?.highlight && <span className="text-xs text-green-600 font-medium">{t.sfLive}</span>}
        <button onClick={() => startEdit(type, i)} className="text-xs text-brand-600">{t.edit}</button>
        {type !== 'auto' && <button onClick={() => removeCategory(type, i)} className="text-xs text-red-400 hover:text-red-600">✕</button>}
      </div>
    );
  }

  const now = new Date();
  const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return (
    <Section title={t.sfCategories}>
      <div className="py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className="text-sm font-medium text-gray-700">{t.sfPermanent}</span>
            <p className="text-xs text-gray-400 mt-0.5">{t.sfPermanentHint}</p>
          </div>
          <button onClick={() => startEdit('permanent', 'new')} className="text-xs text-brand-600 font-medium hover:bg-brand-50 px-2 py-1 rounded-lg">+ {t.addItem}</button>
        </div>
        <div className="space-y-1.5">{permanentList.map((p, i) => renderCategoryRow(p, 'permanent', i))}</div>
        {editingType === 'permanent' && renderEditForm()}
      </div>

      <div className="py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className="text-sm font-medium text-gray-700">{t.sfSeasonal}</span>
            <p className="text-xs text-gray-400 mt-0.5">{t.sfSeasonalHint}</p>
          </div>
          <button onClick={() => startEdit('seasonal', 'new')} className="text-xs text-brand-600 font-medium hover:bg-brand-50 px-2 py-1 rounded-lg">+ {t.addItem}</button>
        </div>
        <div className="space-y-1.5">
          {(sc.seasonal || []).map((s, i) => {
            const isActive = sc.manualOverride === s.slug
              || (sc.autoSchedule && !sc.manualOverride && mmdd >= s.from && mmdd <= s.to);
            return renderCategoryRow(s, 'seasonal', i, { dates: true, highlight: isActive });
          })}
        </div>
        {editingType === 'seasonal' && renderEditForm()}
      </div>

      <div className="py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className="text-sm font-medium text-gray-700">{t.sfAuto}</span>
            <p className="text-xs text-gray-400 mt-0.5">{t.sfAutoHint}</p>
          </div>
        </div>
        <div className="space-y-1.5">{autoList.map((a, i) => renderCategoryRow(a, 'auto', i))}</div>
        {editingType === 'auto' && renderEditForm()}
      </div>

      <div className="flex items-center justify-between py-3 border-b border-gray-100">
        <div>
          <span className="text-sm font-medium text-gray-700">{t.sfAutoSchedule}</span>
          <p className="text-xs text-gray-400 mt-0.5">{t.sfAutoScheduleHint}</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" checked={sc.autoSchedule !== false} onChange={e => onUpdate({ storefrontCategories: { ...sc, autoSchedule: e.target.checked } })} className="sr-only peer" />
          <div className="w-9 h-5 bg-gray-200 peer-checked:bg-brand-600 rounded-full transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
        </label>
      </div>

      <div className="flex items-center justify-between py-3">
        <div>
          <span className="text-sm font-medium text-gray-700">{t.sfManualOverride}</span>
          <p className="text-xs text-gray-400 mt-0.5">{t.sfManualOverrideHint}</p>
        </div>
        <select value={sc.manualOverride || ''} onChange={e => onUpdate({ storefrontCategories: { ...sc, manualOverride: e.target.value || null } })} className="text-sm border border-gray-200 rounded-lg px-2 py-1">
          <option value="">{t.sfNone}</option>
          {(sc.seasonal || []).map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}
        </select>
      </div>
    </Section>
  );
}
