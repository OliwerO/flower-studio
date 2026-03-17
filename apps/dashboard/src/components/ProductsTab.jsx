// ProductsTab — Wix product catalog management for the owner.
// Like a product master data screen: see all items from the supplier (Wix),
// set prices, lead times, categories, and toggle visibility.
// New products from Wix sync appear with a "New" badge.

import { useState, useEffect, useCallback } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';

const PRODUCT_TYPES = ['mono', 'mix'];

export default function ProductsTab() {
  const [products, setProducts] = useState([]);
  const [stock, setStock] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [syncLog, setSyncLog] = useState(null);
  const [syncHistory, setSyncHistory] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedProduct, setExpandedProduct] = useState(null);
  const { showToast } = useToast();

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const [prodRes, stockRes, logRes, catRes] = await Promise.all([
        client.get('/products'),
        client.get('/stock?includeEmpty=true'),
        client.get('/products/sync-log'),
        client.get('/public/categories').catch(() => ({ data: { allCategories: [] } })),
      ]);
      setProducts(prodRes.data);
      setStock(stockRes.data);
      setSyncLog(logRes.data?.[0] || null);
      setSyncHistory(logRes.data || []);
      setCategories(catRes.data?.allCategories || catRes.data?.all || []);
    } catch {
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const [catFilter, setCatFilter] = useState('');

  const stockMap = Object.fromEntries(stock.map(s => [s.id, s]));

  // Group variants by Wix Product ID
  const grouped = groupByProduct(products);

  // Check if a variant qualifies for "Available Today" (matches backend push logic)
  function isAvailableToday(variant) {
    if (!variant['Active']) return false;
    if (Number(variant['Lead Time Days'] ?? 1) !== 0) return false;
    const keyFlower = variant['Key Flower'];
    const stockId = Array.isArray(keyFlower) ? keyFlower[0] : keyFlower;
    if (!stockId) return true; // no key flower = no stock constraint
    const si = stockMap[stockId];
    if (!si) return false;
    const minStems = Number(variant['Min Stems'] || 0);
    return Number(si['Current Quantity'] || 0) >= minStems;
  }

  // Filter
  const filtered = grouped.filter(g => {
    if (filter === 'review') return g.variants.every(v => !v['Active']) && !g.variants.some(v => v['Category']?.length > 0);
    if (filter === 'active') return g.variants.some(v => v['Active']);
    if (filter === 'inactive') return g.variants.every(v => !v['Active']);
    if (filter === 'today') return g.variants.some(v => isAvailableToday(v));
    return true;
  }).filter(g => {
    if (catFilter) {
      const cats = parseCats(g.variants[0]?.['Category']);
      if (!cats.includes(catFilter)) return false;
    }
    return true;
  }).filter(g => {
    if (!search) return true;
    const s = search.toLowerCase();
    return g.name.toLowerCase().includes(s);
  });

  // "Needs review" = inactive AND no categories assigned (never configured by owner)
  const needsReview = grouped.filter(g =>
    g.variants.every(v => !v['Active']) && !g.variants.some(v => v['Category']?.length > 0)
  ).length;

  // Available today count (for banner)
  const availableTodayProducts = grouped.filter(g =>
    g.variants.some(v => isAvailableToday(v))
  );

  async function handlePull() {
    setPulling(true);
    try {
      const res = await client.post('/products/pull');
      const s = res.data;
      showToast(`${t.prodPullDone}: ${s.new} ${t.prodNew}, ${s.updated} ${t.prodUpdated}`, 'success');
      fetchProducts();
    } catch {
      showToast(t.prodSyncFailed, 'error');
    } finally {
      setPulling(false);
    }
  }

  async function handlePush() {
    setPushing(true);
    try {
      const res = await client.post('/products/push');
      const s = res.data;
      const parts = [];
      if (s.pricesSynced) parts.push(`${s.pricesSynced} ${t.prodPriceSyncs}`);
      if (s.visibilitySynced) parts.push(`${s.visibilitySynced} ${t.prodVisibility}`);
      if (s.stockSynced) parts.push(`${s.stockSynced} ${t.prodStockSyncs}`);
      if (s.categoriesSynced) parts.push(`${s.categoriesSynced} ${t.prodCategorySyncs}`);
      showToast(`${t.prodPushDone}${parts.length ? ': ' + parts.join(', ') : ''}`, 'success');
      fetchProducts();
    } catch {
      showToast(t.prodSyncFailed, 'error');
    } finally {
      setPushing(false);
    }
  }

  async function updateVariant(id, field, value) {
    setProducts(prev => prev.map(p =>
      p.id === id ? { ...p, [field]: value } : p
    ));
    try {
      await client.patch(`/products/${id}`, { [field]: value });
    } catch {
      showToast(t.error, 'error');
      fetchProducts();
    }
  }

  // Update all variants of a product at once (for product-level fields)
  async function updateAllVariants(group, field, value) {
    for (const v of group.variants) {
      await updateVariant(v.id, field, value);
    }
  }

  // Show all stock items for Key Flower mapping (not just active/in-stock ones)
  const stockList = stock;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t.tabProducts}</h2>
          {syncHistory.length > 0 && <SyncStatus logs={syncHistory} />}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handlePull}
            disabled={pulling || pushing}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium
                       hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {pulling ? t.prodSyncing : t.prodPullFromWix}
          </button>
          <button
            onClick={handlePush}
            disabled={pulling || pushing}
            className="px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium
                       hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {pushing ? t.prodSyncing : t.prodPushToWix}
          </button>
        </div>
      </div>

      {/* Available Today banner */}
      <AvailableTodayBanner
        products={availableTodayProducts}
        onFilter={() => setFilter('today')}
      />

      {/* Review banner */}
      {needsReview > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-amber-800 font-medium">
            {needsReview} {t.prodNeedReview}
          </span>
          <button
            onClick={() => setFilter('review')}
            className="text-xs text-amber-700 font-medium px-3 py-1 rounded-full bg-amber-100 hover:bg-amber-200"
          >
            {t.prodShowReview}
          </button>
        </div>
      )}

      {/* Filters + search */}
      <div className="flex gap-2 items-center mb-4 flex-wrap">
        <div className="flex bg-gray-100 rounded-full p-0.5">
          {[
            ['all', t.prodFilterAll],
            ['active', t.prodFilterActive],
            ['today', t.prodFilterToday],
            ['inactive', t.prodFilterInactive],
            ['review', t.prodFilterReview],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === key ? 'bg-white shadow-sm text-brand-600' : 'text-gray-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Category chip filter */}
        {categories.length > 0 && (
          <select
            value={catFilter}
            onChange={e => setCatFilter(e.target.value)}
            className="border border-gray-200 rounded-xl px-2 py-1.5 text-xs text-gray-600"
          >
            <option value="">{t.category}: {t.prodFilterAll}</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        )}
        <input
          type="text"
          placeholder={t.search}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm flex-1 min-w-[200px]"
        />
        <span className="text-xs text-gray-400">
          {filtered.length} {t.prodProducts}
        </span>
      </div>

      {/* Product list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(group => (
            <ProductCard
              key={group.wixProductId}
              group={group}
              stockMap={stockMap}
              stockList={stockList}
              categories={categories}
              expanded={expandedProduct === group.wixProductId}
              onToggle={() => setExpandedProduct(
                expandedProduct === group.wixProductId ? null : group.wixProductId
              )}
              onUpdate={updateVariant}
              onUpdateAll={updateAllVariants}
            />
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-gray-400 py-8">{t.noResults}</p>
          )}
        </div>
      )}

      {/* Sync log — expandable at bottom */}
      {!loading && <SyncLogSection logs={syncHistory} />}
    </div>
  );
}

// ── Product card ──

function ProductCard({ group, stockMap, stockList, categories, expanded, onToggle, onUpdate, onUpdateAll }) {
  const allActive = group.variants.every(v => v['Active']);
  const anyActive = group.variants.some(v => v['Active']);
  const productType = group.variants[0]?.['Product Type'] || 'mix';
  const currentCats = parseCats(group.variants[0]?.['Category']);

  // Stock status: check if key flower has sufficient stock for at least one variant
  const hasStock = anyActive && group.variants.some(v => {
    if (!v['Active']) return false;
    const kf = v['Key Flower'];
    const sid = Array.isArray(kf) ? kf[0] : kf;
    if (!sid) return true;
    const si = stockMap[sid];
    if (!si) return false;
    return Number(si['Current Quantity'] || 0) >= Number(v['Min Stems'] || 0);
  });

  // Translation status: check if Wix product has translations set
  const wixTrans = group.variants[0]?.['Translations'];
  const hasTranslations = wixTrans && typeof wixTrans === 'object'
    ? Object.keys(wixTrans).length > 0
    : Boolean(wixTrans);

  return (
    <div className={`bg-white rounded-2xl border ${anyActive ? 'border-gray-200' : 'border-amber-200'} shadow-sm overflow-hidden`}>
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
      >
        {group.imageUrl ? (
          <img src={group.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-gray-900 truncate">{group.name}</span>
            <span className="text-xs text-gray-400">({productType})</span>
            {!allActive && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                {t.prodNew}
              </span>
            )}
            {anyActive && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                hasStock ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'
              }`}>
                {hasStock ? t.prodStockOk : t.prodNoStock}
              </span>
            )}
            {hasTranslations && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                {t.prodHasTranslations}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-400">
              {group.variants.length} {t.prodVariants}
            </span>
            {currentCats.length > 0 && (
              <span className="text-xs text-gray-400">
                · {currentCats.join(', ')}
              </span>
            )}
          </div>
        </div>

        <span className="text-gray-300 text-lg">{expanded ? '\u2212' : '+'}</span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3">
          {/* Product-level fields */}
          <div className="flex gap-4 mb-3 flex-wrap items-start">
            {/* Type selector */}
            <label className="flex items-center gap-2 text-xs text-gray-600">
              {t.prodType}:
              <select
                value={productType}
                onChange={e => onUpdateAll(group, 'Product Type', e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1 text-xs"
              >
                {PRODUCT_TYPES.map(pt => (
                  <option key={pt} value={pt}>{pt}</option>
                ))}
              </select>
            </label>

            {/* Category multi-select (checkboxes) */}
            <div className="text-xs text-gray-600">
              <span className="mr-2">{t.category}:</span>
              <div className="inline-flex flex-wrap gap-1.5 mt-0.5">
                {categories.map(cat => {
                  const checked = currentCats.includes(cat);
                  return (
                    <label key={cat} className={`flex items-center gap-1 px-2 py-0.5 rounded-full border cursor-pointer transition-colors ${
                      checked ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-gray-50 border-gray-200 text-gray-500'
                    }`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? currentCats.filter(c => c !== cat)
                            : [...currentCats, cat];
                          onUpdateAll(group, 'Category', next);
                        }}
                        className="sr-only"
                      />
                      {cat}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Key flower selector */}
          <KeyFlowerSelector
            group={group}
            stockMap={stockMap}
            stockList={stockList}
            onUpdateAll={onUpdateAll}
          />

          {/* Description + translations */}
          <ProductDescriptionEditor
            group={group}
            onUpdateAll={onUpdateAll}
          />

          {/* Variant rows */}
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left py-1 pr-2">{t.prodVariant}</th>
                  <th className="text-right py-1 px-2">{t.price} (zl)</th>
                  {productType === 'mono' && (
                    <th className="text-right py-1 px-2">{t.prodSuggested}</th>
                  )}
                  <th className="text-center py-1 px-2">{t.prodLeadTime}</th>
                  <th className="text-center py-1 px-2">{t.prodActive}</th>
                </tr>
              </thead>
              <tbody>
                {group.variants
                  .sort((a, b) => (a['Sort Order'] || 0) - (b['Sort Order'] || 0))
                  .map(v => (
                    <VariantRow
                      key={v.id}
                      variant={v}
                      productType={productType}
                      stockMap={stockMap}
                      onUpdate={onUpdate}
                    />
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Product description + translations ──

function ProductDescriptionEditor({ group, onUpdateAll }) {
  const [editing, setEditing] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [transLang, setTransLang] = useState('en');

  // Read current values from first variant (product-level field)
  const rawTrans = group.variants[0]?.['Translations'];
  let translations = {};
  if (rawTrans && typeof rawTrans === 'string') {
    try { translations = JSON.parse(rawTrans); } catch { /* skip */ }
  } else if (rawTrans && typeof rawTrans === 'object') {
    translations = rawTrans;
  }
  const description = group.variants[0]?.['Description'] || '';

  const [draft, setDraft] = useState({ description, translations });

  // Sync draft when group changes (e.g. after save)
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
      // Translate product name
      if (group.name) {
        const titleRes = await client.post('/products/translate', { text: group.name, type: 'title' });
        for (const lang of ['en', 'pl', 'ru', 'uk']) {
          trans[lang] = { ...(trans[lang] || {}), title: titleRes.data[lang] || '' };
        }
      }
      // Translate description
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

  const hasAnyTranslation = Object.values(translations).some(
    l => l?.title || l?.description
  );

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-xs py-2 border-b border-gray-100">
        <span className="text-gray-500">{t.prodDescription}:</span>
        <span className="text-gray-600 truncate max-w-[300px]">
          {description || translations?.en?.description || '—'}
        </span>
        {hasAnyTranslation && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">{t.prodHasTranslations}</span>
        )}
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-brand-600 font-medium ml-auto"
        >{t.edit}</button>
      </div>
    );
  }

  return (
    <div className="py-2 border-b border-gray-100 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-medium">{t.prodDescription}</span>
        <button
          onClick={handleTranslate}
          disabled={translating || (!group.name && !draft.description)}
          className="text-xs text-white bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 px-3 py-1 rounded-lg ml-auto"
        >
          {translating ? t.prodTranslating : t.prodTranslate}
        </button>
        <button onClick={handleSave} className="text-xs text-white bg-brand-600 px-3 py-1 rounded-lg">{t.save}</button>
        <button onClick={() => setEditing(false)} className="text-xs text-gray-400">✕</button>
      </div>
      <textarea
        value={draft.description || ''}
        onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
        placeholder={t.prodDescriptionHint}
        rows={2}
        className="w-full text-sm px-2 py-1 border rounded-lg resize-none"
      />
      {/* Language tabs */}
      <div className="border border-gray-100 rounded-lg overflow-hidden">
        <div className="flex border-b border-gray-100">
          {['en', 'pl', 'ru', 'uk'].map(lang => (
            <button
              key={lang}
              onClick={() => setTransLang(lang)}
              className={`flex-1 text-xs py-1.5 font-medium ${
                transLang === lang ? 'bg-brand-50 text-brand-700 border-b-2 border-brand-600' : 'text-gray-400'
              }`}
            >{lang.toUpperCase()}{lang === 'en' ? ' (Wix)' : ''}</button>
          ))}
        </div>
        <div className="p-2 space-y-1">
          <input
            value={draft.translations[transLang]?.title || ''}
            onChange={e => setDraft(d => ({
              ...d,
              translations: {
                ...d.translations,
                [transLang]: { ...(d.translations[transLang] || {}), title: e.target.value },
              },
            }))}
            placeholder="Title"
            className="w-full text-xs px-2 py-1 border rounded"
          />
          <textarea
            value={draft.translations[transLang]?.description || ''}
            onChange={e => setDraft(d => ({
              ...d,
              translations: {
                ...d.translations,
                [transLang]: { ...(d.translations[transLang] || {}), description: e.target.value },
              },
            }))}
            placeholder="Description"
            rows={2}
            className="w-full text-xs px-2 py-1 border rounded resize-none"
          />
        </div>
      </div>
    </div>
  );
}

// ── Key flower selector ──

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
        <span className="text-green-600">
          {stockItem['Current Quantity'] || 0} {t.prodInStock}
        </span>
      )}
    </div>
  );
}

// ── Variant row ──

function VariantRow({ variant, productType, stockMap, onUpdate }) {
  const price = Number(variant['Price'] || 0);
  const lt = Number(variant['Lead Time Days'] ?? 1);
  const active = variant['Active'] || false;
  const minStems = Number(variant['Min Stems'] || 0);

  // Suggested price for mono bouquets
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
        {minStems > 0 && (
          <span className="text-xs text-gray-400 ml-1">({minStems} {t.prodStems})</span>
        )}
      </td>
      <td className="py-2 px-2 text-right">
        <input
          type="number"
          value={price}
          onChange={e => onUpdate(variant.id, 'Price', Number(e.target.value))}
          className="w-20 text-right border border-gray-200 rounded-lg px-2 py-1 text-sm"
          min="0"
        />
      </td>
      {productType === 'mono' && (
        <td className="py-2 px-2 text-right">
          {suggested !== null ? (
            <span className="flex items-center justify-end gap-1">
              <span className={`text-xs ${Math.abs(price - suggested) < 1 ? 'text-green-600' : 'text-amber-600'}`}>
                {Math.round(suggested)} zl
                {Math.abs(price - suggested) < 1 ? ' \u2713' : ' \u26A0'}
              </span>
              {Math.abs(price - suggested) >= 1 && (
                <button
                  onClick={() => onUpdate(variant.id, 'Price', Math.round(suggested))}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                  title={t.prodApplySuggested}
                >
                  \u2190
                </button>
              )}
            </span>
          ) : (
            <span className="text-xs text-gray-300">-</span>
          )}
        </td>
      )}
      <td className="py-2 px-2 text-center">
        <input
          type="number"
          value={lt}
          onChange={e => onUpdate(variant.id, 'Lead Time Days', Number(e.target.value))}
          className="w-14 text-center border border-gray-200 rounded-lg px-1 py-1 text-sm"
          min="0"
        />
      </td>
      <td className="py-2 px-2 text-center">
        <input
          type="checkbox"
          checked={active}
          onChange={e => onUpdate(variant.id, 'Active', e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
        />
      </td>
    </tr>
  );
}

// ── Sync status badge ──

function SyncStatus({ logs }) {
  const lastPull = logs.find(l => l['Status']?.includes('pull'));
  const lastPush = logs.find(l => l['Status']?.includes('push'));
  // Fallback to latest log if no direction tag (legacy entries)
  const latest = logs[0];

  function formatAgo(log) {
    if (!log) return null;
    const ago = Math.round((Date.now() - new Date(log['Timestamp']).getTime()) / 60000);
    const failed = log['Status']?.includes('failed');
    let color = 'text-green-600';
    if (failed) color = 'text-red-500';
    else if (ago > 360) color = 'text-red-500';
    else if (ago > 60) color = 'text-amber-500';
    const timeStr = ago < 60 ? `${ago}m` : `${Math.round(ago / 60)}h`;
    return { color, timeStr, failed };
  }

  const pull = formatAgo(lastPull);
  const push = formatAgo(lastPush);

  // If no direction-tagged entries, show legacy format
  if (!pull && !push && latest) {
    const f = formatAgo(latest);
    return <span className={`text-xs ${f.color}`}>{f.failed ? '\u2717' : '\u2713'} {t.prodLastSync}: {f.timeStr} {t.prodAgo}</span>;
  }

  return (
    <span className="text-xs text-gray-500 flex gap-3">
      {pull && <span className={pull.color}>{pull.failed ? '\u2717' : '\u2193'} Pull: {pull.timeStr} {t.prodAgo}</span>}
      {push && <span className={push.color}>{push.failed ? '\u2717' : '\u2191'} Push: {push.timeStr} {t.prodAgo}</span>}
    </span>
  );
}

// ── Sync log section ──

function SyncLogSection({ logs }) {
  const [expanded, setExpanded] = useState(false);

  if (!logs || logs.length === 0) return null;

  return (
    <div className="mt-6 border-t border-gray-100 pt-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <span>{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="font-medium">{t.prodSyncLog}</span>
        <span className="text-xs text-gray-400">({logs.length})</span>
      </button>

      {expanded && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-100">
                <th className="text-left py-1.5 pr-3">{t.date}</th>
                <th className="text-left py-1.5 px-3">{t.status}</th>
                <th className="text-right py-1.5 px-2">{t.prodNewProducts}</th>
                <th className="text-right py-1.5 px-2">{t.prodUpdated}</th>
                <th className="text-right py-1.5 px-2">{t.prodDeactivated}</th>
                <th className="text-right py-1.5 px-2">{t.prodPriceSyncs}</th>
                <th className="text-right py-1.5 px-2">{t.prodStockSyncs}</th>
                <th className="text-left py-1.5 pl-3">{t.prodErrors}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const ts = new Date(log['Timestamp']);
                const ok = log['Status'] === 'success';
                const errMsg = log['Error Message'];
                return (
                  <tr key={log.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap">
                      {ts.toLocaleDateString()} {ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-1.5 px-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${
                        ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                      }`}>
                        {ok ? '\u2713' : '\u2717'} {log['Status']}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right text-gray-700">{log['New Products'] || 0}</td>
                    <td className="py-1.5 px-2 text-right text-gray-700">{log['Updated'] || 0}</td>
                    <td className="py-1.5 px-2 text-right text-gray-700">{log['Deactivated'] || 0}</td>
                    <td className="py-1.5 px-2 text-right text-gray-700">{log['Price Syncs'] || 0}</td>
                    <td className="py-1.5 px-2 text-right text-gray-700">{log['Stock Syncs'] || 0}</td>
                    <td className="py-1.5 pl-3 text-red-500 max-w-[200px] truncate" title={errMsg || ''}>
                      {errMsg || '\u2014'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Available Today banner ──
// Shows which products will appear in the Wix "Available Today" collection after next push.
// Think of it as a live preview of the storefront's same-day delivery section.

function AvailableTodayBanner({ products, onFilter }) {
  if (products.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
        <span className="text-lg">📦</span>
        <span className="text-sm text-gray-500">{t.prodAvailTodayNone}</span>
      </div>
    );
  }

  return (
    <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚡</span>
          <span className="text-sm font-medium text-green-800">
            {t.prodAvailTodayBanner}: {products.length}
          </span>
        </div>
        <button
          onClick={onFilter}
          className="text-xs font-medium px-3 py-1 rounded-full text-green-700 bg-green-100 hover:bg-green-200"
        >
          {t.prodFilterToday}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {products.map(g => {
          const prices = g.variants
            .filter(v => v['Active'] && Number(v['Lead Time Days'] ?? 1) === 0)
            .map(v => Number(v['Price'] || 0))
            .filter(p => p > 0);
          const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
          return (
            <div key={g.wixProductId} className="flex items-center gap-1.5 bg-white rounded-lg px-2 py-1 border border-green-100">
              {g.imageUrl && <img src={g.imageUrl} alt="" className="w-5 h-5 rounded object-cover" />}
              <span className="text-xs font-medium text-gray-700">{g.name}</span>
              {minPrice > 0 && <span className="text-xs text-gray-400">{t.fromPrice} {minPrice} zł</span>}
            </div>
          );
        })}
      </div>
      <p className="text-xs mt-1.5 text-green-600">{t.prodAvailTodayHint}</p>
    </div>
  );
}

// ── Helpers ──

function groupByProduct(rows) {
  const map = new Map();
  for (const row of rows) {
    const pid = row['Wix Product ID'] || row.id;
    if (!map.has(pid)) {
      map.set(pid, {
        wixProductId: pid,
        name: row['Product Name'] || 'Unknown',
        imageUrl: row['Image URL'] || '',
        variants: [],
      });
    }
    map.get(pid).variants.push(row);
  }
  return Array.from(map.values());
}

function parseCats(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return val.split(',').map(s => s.trim()).filter(Boolean);
}
