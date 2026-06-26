import { useState, useEffect } from 'react';
import apiClient from '../api/client.js';

// Shared name + translation editor for a storefront product (bouquet).
// Owns the EN product name (canonical, ADR-0008), per-language PL/RU/UK
// title+description, and the one-click auto-translate. Consumed by the
// dashboard Products tab and the florist BouquetsPage. `t` is passed in by
// the host app (florist/dashboard each have their own translations.js).
export default function ProductTranslationEditor({ group, onUpdateAll, t }) {
  const [editing, setEditing] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [transLang, setTransLang] = useState('en');

  const rawTrans = group.variants[0]?.['Translations'];
  let translations = {};
  if (rawTrans && typeof rawTrans === 'string') {
    try { translations = JSON.parse(rawTrans); } catch { /* skip */ }
  } else if (rawTrans && typeof rawTrans === 'object') {
    translations = rawTrans;
  }
  const description = group.variants[0]?.['Description'] || '';

  const [draft, setDraft] = useState({ description, translations });

  useEffect(() => {
    const raw = group.variants[0]?.['Translations'];
    let next = {};
    if (raw && typeof raw === 'string') { try { next = JSON.parse(raw); } catch { /* skip */ } }
    else if (raw && typeof raw === 'object') next = raw;
    setDraft({ description: group.variants[0]?.['Description'] || '', translations: next });
  }, [group.variants[0]?.['Description'], group.variants[0]?.['Translations']]);

  async function handleTranslate() {
    setTranslating(true);
    try {
      const trans = { ...(draft.translations || {}) };
      const sourceTitle = draft.translations?.en?.title || group.name;
      if (sourceTitle) {
        const titleRes = await apiClient.post('/products/translate', { text: sourceTitle, type: 'title' });
        for (const lang of ['en', 'pl', 'ru', 'uk']) {
          trans[lang] = { ...(trans[lang] || {}), title: titleRes.data[lang] || '' };
        }
      }
      if (draft.description) {
        const descRes = await apiClient.post('/products/translate', { text: draft.description, type: 'description' });
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

  function handleSave() {
    const enTitle = draft.translations?.en?.title?.trim();
    if (enTitle) onUpdateAll(group, 'Product Name', enTitle);
    onUpdateAll(group, 'Description', draft.description);
    onUpdateAll(group, 'Translations', JSON.stringify(draft.translations));
    setEditing(false);
  }

  const hasAnyTranslation = Object.values(translations).some(l => l?.title || l?.description);

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-xs py-2 border-b border-gray-100 dark:border-dark-separator">
        <span className="text-gray-500">{t.prodDescription}:</span>
        <span className="text-gray-600 truncate max-w-[300px]">{description || translations?.en?.description || '—'}</span>
        {hasAnyTranslation && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">{t.prodHasTranslations}</span>}
        <button onClick={() => setEditing(true)} className="text-xs text-brand-600 font-medium ml-auto">{t.edit}</button>
      </div>
    );
  }

  return (
    <div className="py-2 border-b border-gray-100 dark:border-dark-separator space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-medium">{t.prodDescription}</span>
        <button onClick={handleTranslate} disabled={translating || (!(draft.translations?.en?.title || group.name) && !draft.description)}
          className="text-xs text-white bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 px-3 py-1 rounded-lg ml-auto">
          {translating ? t.prodTranslating : t.prodTranslate}
        </button>
        <button onClick={handleSave} className="text-xs text-white bg-brand-600 px-3 py-1 rounded-lg">{t.save}</button>
        <button onClick={() => setEditing(false)} className="text-xs text-gray-400">✕</button>
      </div>
      <input
        value={draft.translations.en?.title || ''}
        onChange={e => setDraft(d => ({ ...d, translations: { ...d.translations, en: { ...(d.translations.en || {}), title: e.target.value } } }))}
        placeholder={t.prodNamePlaceholder || 'Product name (English)'}
        className="w-full text-sm font-medium px-2 py-1 border rounded-lg mb-1"
      />
      <textarea value={draft.description || ''} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
        placeholder={t.prodDescriptionHint} rows={2} className="w-full text-sm px-2 py-1 border rounded-lg resize-none" />
      <div className="border border-gray-100 dark:border-dark-separator rounded-lg overflow-hidden">
        <div className="flex border-b border-gray-100 dark:border-dark-separator">
          {['en', 'pl', 'ru', 'uk'].map(lang => (
            <button key={lang} onClick={() => setTransLang(lang)}
              className={`flex-1 text-xs py-1.5 font-medium ${transLang === lang ? 'bg-brand-50 text-brand-700 border-b-2 border-brand-600' : 'text-gray-400'}`}>
              {lang.toUpperCase()}{lang === 'en' ? ' (Wix)' : ''}
            </button>
          ))}
        </div>
        <div className="p-2 space-y-1">
          <input value={draft.translations[transLang]?.title || ''}
            onChange={e => setDraft(d => ({ ...d, translations: { ...d.translations, [transLang]: { ...(d.translations[transLang] || {}), title: e.target.value } } }))}
            placeholder="Title" className="w-full text-xs px-2 py-1 border rounded" />
          <textarea value={draft.translations[transLang]?.description || ''}
            onChange={e => setDraft(d => ({ ...d, translations: { ...d.translations, [transLang]: { ...(d.translations[transLang] || {}), description: e.target.value } } }))}
            placeholder="Description" rows={2} className="w-full text-xs px-2 py-1 border rounded resize-none" />
        </div>
      </div>
    </div>
  );
}
