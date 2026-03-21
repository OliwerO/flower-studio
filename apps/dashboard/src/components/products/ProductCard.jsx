import { useState, useEffect } from 'react';
import t from '../../translations.js';
import client from '../../api/client.js';
import { parseCats } from './helpers.js';

const PRODUCT_TYPES = ['mono', 'mix'];

function KeyFlowerSelector({ group, stockMap, stockList, onUpdateAll }) {
  const keyFlower = group.variants[0]?.['Key Flower'];
  const stockId = Array.isArray(keyFlower) ? keyFlower[0] : keyFlower;
  const stockItem = stockId ? stockMap[stockId] : null;

  return (
    <div className="flex items-center gap-2 text-xs pb-2 border-b border-gray-100">
      <span className="text-gray-500">{t.prodKeyFlower}:</span>
      <select
        value={stockId || ''}
        onChange={e => {
          const val = e.target.value ? [e.target.value] : [];
          onUpdateAll(group, 'Key Flower', val);
        }}
        className="border border-gray-200 rounded-lg px-2 py-1 text-xs min-w-[180px]"
      >
        <option value="">{t.prodSelectFlower}</option>
        {stockList
          .sort((a, b) => (a['Display Name'] || '').localeCompare(b['Display Name'] || ''))
          .map(s => (
            <option key={s.id} value={s.id}>
              {s['Display Name']} ({s['Current Quantity'] || 0} {t.prodInStock})
            </option>
          ))}
      </select>
      {stockItem && (
        <span className="text-green-600">{stockItem['Current Quantity'] || 0} {t.prodInStock}</span>
      )}
    </div>
  );
}

function ProductDescriptionEditor({ group, onUpdateAll }) {
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
    let t = {};
    if (raw && typeof raw === 'string') { try { t = JSON.parse(raw); } catch {} }
    else if (raw && typeof raw === 'object') t = raw;
    setDraft({ description: group.variants[0]?.['Description'] || '', translations: t });
  }, [group.variants[0]?.['Description'], group.variants[0]?.['Translations']]);

  async function handleTranslate() {
    setTranslating(true);
    try {
      const trans = { ...(draft.translations || {}) };
      if (group.name) {
        const titleRes = await client.post('/products/translate', { text: group.name, type: 'title' });
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

  function handleSave() {
    onUpdateAll(group, 'Description', draft.description);
    onUpdateAll(group, 'Translations', JSON.stringify(draft.translations));
    setEditing(false);
  }

  const hasAnyTranslation = Object.values(translations).some(l => l?.title || l?.description);

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-xs py-2 border-b border-gray-100">
        <span className="text-gray-500">{t.prodDescription}:</span>
        <span className="text-gray-600 truncate max-w-[300px]">{description || translations?.en?.description || '—'}</span>
        {hasAnyTranslation && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">{t.prodHasTranslations}</span>}
        <button onClick={() => setEditing(true)} className="text-xs text-brand-600 font-medium ml-auto">{t.edit}</button>
      </div>
    );
  }

  return (
    <div className="py-2 border-b border-gray-100 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-medium">{t.prodDescription}</span>
        <button onClick={handleTranslate} disabled={translating || (!group.name && !draft.description)}
          className="text-xs text-white bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 px-3 py-1 rounded-lg ml-auto">
          {translating ? t.prodTranslating : t.prodTranslate}
        </button>
        <button onClick={handleSave} className="text-xs text-white bg-brand-600 px-3 py-1 rounded-lg">{t.save}</button>
        <button onClick={() => setEditing(false)} className="text-xs text-gray-400">✕</button>
      </div>
      <textarea value={draft.description || ''} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
        placeholder={t.prodDescriptionHint} rows={2} className="w-full text-sm px-2 py-1 border rounded-lg resize-none" />
      <div className="border border-gray-100 rounded-lg overflow-hidden">
        <div className="flex border-b border-gray-100">
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

function VariantRow({ variant, productType, stockMap, onUpdate }) {
  const price = Number(variant['Price'] || 0);
  const lt = Number(variant['Lead Time Days'] ?? 1);
  const active = variant['Active'] || false;
  const minStems = Number(variant['Min Stems'] || 0);

  let suggested = null;
  if (productType === 'mono' && minStems > 0) {
    const keyFlower = variant['Key Flower'];
    const stockId = Array.isArray(keyFlower) ? keyFlower[0] : keyFlower;
    const stockItem = stockId ? stockMap[stockId] : null;
    if (stockItem) {
      const sellPerStem = Number(stockItem['Current Sell Price'] || 0);
      suggested = minStems * sellPerStem;
    }
  }

  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className="py-2 pr-2">
        <span className="font-medium text-gray-700">{variant['Variant Name']}</span>
        {minStems > 0 && <span className="text-xs text-gray-400 ml-1">({minStems} {t.prodStems})</span>}
      </td>
      <td className="py-2 px-2 text-right">
        <input type="number" value={price} onChange={e => onUpdate(variant.id, 'Price', Number(e.target.value))}
          className="w-20 text-right border border-gray-200 rounded-lg px-2 py-1 text-sm" min="0" />
      </td>
      {productType === 'mono' && (
        <td className="py-2 px-2 text-right">
          {suggested !== null ? (
            <span className="flex items-center justify-end gap-1">
              <span className={`text-xs ${Math.abs(price - suggested) < 1 ? 'text-green-600' : 'text-amber-600'}`}>
                {Math.round(suggested)} zl {Math.abs(price - suggested) < 1 ? '\u2713' : '\u26A0'}
              </span>
              {Math.abs(price - suggested) >= 1 && (
                <button onClick={() => onUpdate(variant.id, 'Price', Math.round(suggested))}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium" title={t.prodApplySuggested}>\u2190</button>
              )}
            </span>
          ) : (
            <span className="text-xs text-gray-300">-</span>
          )}
        </td>
      )}
      <td className="py-2 px-2 text-center">
        <input type="number" value={lt} onChange={e => onUpdate(variant.id, 'Lead Time Days', Number(e.target.value))}
          className="w-14 text-center border border-gray-200 rounded-lg px-1 py-1 text-sm" min="0" />
      </td>
      <td className="py-2 px-2 text-center">
        <input type="checkbox" checked={active} onChange={e => onUpdate(variant.id, 'Active', e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
      </td>
    </tr>
  );
}

export default function ProductCard({ group, stockMap, stockList, categories, expanded, onToggle, onUpdate, onUpdateAll }) {
  const allActive = group.variants.every(v => v['Active']);
  const anyActive = group.variants.some(v => v['Active']);
  const productType = group.variants[0]?.['Product Type'] || 'mix';
  const currentCats = parseCats(group.variants[0]?.['Category']);

  const hasStock = anyActive && group.variants.some(v => {
    if (!v['Active']) return false;
    const kf = v['Key Flower'];
    const sid = Array.isArray(kf) ? kf[0] : kf;
    if (!sid) return true;
    const si = stockMap[sid];
    if (!si) return false;
    return Number(si['Current Quantity'] || 0) >= Number(v['Min Stems'] || 0);
  });

  const wixTrans = group.variants[0]?.['Translations'];
  const hasTranslations = wixTrans && typeof wixTrans === 'object'
    ? Object.keys(wixTrans).length > 0
    : Boolean(wixTrans);

  return (
    <div className={`bg-white rounded-2xl border ${anyActive ? 'border-gray-200' : 'border-amber-200'} shadow-sm overflow-hidden`}>
      <button onClick={onToggle} className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors">
        {group.imageUrl ? (
          <img src={group.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-gray-900 truncate">{group.name}</span>
            <span className="text-xs text-gray-400">({productType})</span>
            {!allActive && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{t.prodNew}</span>}
            {anyActive && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${hasStock ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
                {hasStock ? t.prodStockOk : t.prodNoStock}
              </span>
            )}
            {hasTranslations && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">{t.prodHasTranslations}</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-400">{group.variants.length} {t.prodVariants}</span>
            {currentCats.length > 0 && <span className="text-xs text-gray-400">· {currentCats.join(', ')}</span>}
          </div>
        </div>
        <span className="text-gray-300 text-lg">{expanded ? '\u2212' : '+'}</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3">
          <div className="flex gap-4 mb-3 flex-wrap items-start">
            <label className="flex items-center gap-2 text-xs text-gray-600">
              {t.prodType}:
              <select value={productType} onChange={e => onUpdateAll(group, 'Product Type', e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1 text-xs">
                {PRODUCT_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
              </select>
            </label>
            <div className="text-xs text-gray-600">
              <span className="mr-2">{t.category}:</span>
              <div className="inline-flex flex-wrap gap-1.5 mt-0.5">
                {categories.map(cat => {
                  const checked = currentCats.includes(cat);
                  return (
                    <label key={cat} className={`flex items-center gap-1 px-2 py-0.5 rounded-full border cursor-pointer transition-colors ${
                      checked ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-gray-50 border-gray-200 text-gray-500'
                    }`}>
                      <input type="checkbox" checked={checked}
                        onChange={() => {
                          const next = checked ? currentCats.filter(c => c !== cat) : [...currentCats, cat];
                          onUpdateAll(group, 'Category', next);
                        }}
                        className="sr-only" />
                      {cat}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <KeyFlowerSelector group={group} stockMap={stockMap} stockList={stockList} onUpdateAll={onUpdateAll} />
          <ProductDescriptionEditor group={group} onUpdateAll={onUpdateAll} />

          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left py-1 pr-2">{t.prodVariant}</th>
                  <th className="text-right py-1 px-2">{t.price} (zl)</th>
                  {productType === 'mono' && <th className="text-right py-1 px-2">{t.prodSuggested}</th>}
                  <th className="text-center py-1 px-2">{t.prodLeadTime}</th>
                  <th className="text-center py-1 px-2">{t.prodActive}</th>
                </tr>
              </thead>
              <tbody>
                {group.variants
                  .sort((a, b) => (a['Sort Order'] || 0) - (b['Sort Order'] || 0))
                  .map(v => (
                    <VariantRow key={v.id} variant={v} productType={productType} stockMap={stockMap} onUpdate={onUpdate} />
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
