import { useState, useEffect, useCallback } from 'react';
import { WixPushModal } from '@flower-studio/shared';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useNotifications } from '../hooks/useNotifications.js';
import t from '../translations.js';
import { groupByProduct, parseCats } from './products/helpers.js';
import SyncStatus from './products/SyncStatus.jsx';
import SyncLogSection from './products/SyncLogSection.jsx';
import AvailableTodayBanner from './products/AvailableTodayBanner.jsx';
import ProductCard from './products/ProductCard.jsx';
import { SkeletonCard } from './Skeleton.jsx';

export default function ProductsTab() {
  const [products, setProducts] = useState([]);
  const [stock, setStock] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  // Async-job UX: opening the modal kicks off POST /products/push and the
  // modal polls for progress until done. See WixPushModal in shared.
  // The modal stays as a dismissable floating pill after completion, so
  // we track `pushing` separately to drive the button state during the
  // active job only.
  const [pushModalOpen, setPushModalOpen] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [syncHistory, setSyncHistory] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedProduct, setExpandedProduct] = useState(null);
  const [catFilter, setCatFilter] = useState('');
  // Add-to-category picker — only opens when a specific category is being
  // filtered AND the owner wants to assign more bouquets to it. See the
  // "+ Add bouquets to this category" button rendered next to the filter.
  const [showAddToCategory, setShowAddToCategory] = useState(false);
  const [addToCategorySelected, setAddToCategorySelected] = useState(() => new Set());
  const [addingToCategory, setAddingToCategory] = useState(false);
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
      setSyncHistory(logRes.data || []);
      setCategories(catRes.data?.allCategories || catRes.data?.all || []);
    } catch {
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // SSE: when an image is uploaded/deleted from another tab or the florist
  // app, patch matching variant rows in-place so the card re-renders without
  // refetching. Image URL is mirrored across every variant of a bouquet by
  // the backend (productRepo.setImage).
  useNotifications(undefined, (event) => {
    if (event.type !== 'product_image_changed') return;
    setProducts(prev => prev.map(p =>
      (p['Wix Product ID'] || p.id) === event.wixProductId
        ? { ...p, 'Image URL': event.imageUrl || '' }
        : p
    ));
  });

  const stockMap = Object.fromEntries(stock.map(s => [s.id, s]));
  const grouped = groupByProduct(products);

  function isAvailableToday(variant) {
    if (!variant['Active']) return false;
    if (Number(variant['Lead Time Days'] ?? 1) !== 0) return false;
    // Must carry the "Available Today" Category tag — this is what the Wix
    // storefront filters on (see backend/src/routes/public.js productCount
    // and the push criteria in wixProductSync.js). Without this gate the
    // dashboard reports any LT=0 product as Available Today, while Wix only
    // shows the ones tagged in the collection.
    if (!parseCats(variant['Category']).includes('Available Today')) return false;
    const keyFlower = variant['Key Flower'];
    const stockId = Array.isArray(keyFlower) ? keyFlower[0] : keyFlower;
    if (!stockId) return true;
    const si = stockMap[stockId];
    if (!si) return false;
    const minStems = Number(variant['Min Stems'] || 0);
    return Number(si['Current Quantity'] || 0) >= minStems;
  }

  const filtered = grouped.filter(g => {
    if (filter === 'review') return g.variants.every(v => !v['Active']) && !g.variants.some(v => v['Category']?.length > 0);
    if (filter === 'active') return g.variants.some(v => v['Active']);
    if (filter === 'inactive') return g.variants.every(v => !v['Active']);
    if (filter === 'today') return g.variants.some(v => isAvailableToday(v));
    return true;
  }).filter(g => {
    if (catFilter) {
      const allCats = [...new Set(g.variants.flatMap(v => parseCats(v['Category'])))];
      if (!allCats.includes(catFilter)) return false;
    }
    return true;
  }).filter(g => {
    if (!search) return true;
    return g.name.toLowerCase().includes(search.toLowerCase());
  });

  const needsReview = grouped.filter(g =>
    g.variants.every(v => !v['Active']) && !g.variants.some(v => v['Category']?.length > 0)
  ).length;

  const availableTodayProducts = grouped.filter(g => g.variants.some(v => isAvailableToday(v)));

  async function handlePull() {
    setPulling(true);
    try {
      const res = await client.post('/products/pull');
      const s = res.data;
      // Defensive: runPull() in wixProductSync.js wraps its entire body in a
      // try/catch that pushes fatal errors into stats.errors and STILL returns
      // 200. Without this check a failed Wix API call (bad token, network
      // error) looks like a no-op success with zero counts. Surface the actual
      // errors so they can be diagnosed.
      if (s.errors?.length > 0) {
        showToast(s.errors.join(' · '), 'error');
        return;
      }
      showToast(`${t.prodPullDone}: ${s.new} ${t.prodNew}, ${s.updated} ${t.prodUpdated}`, 'success');
      fetchProducts();
    } catch {
      showToast(t.prodSyncFailed, 'error');
    } finally {
      setPulling(false);
    }
  }

  function handlePush() {
    setPushModalOpen(true);
    setPushing(true);
  }

  function onPushComplete(result) {
    setPushing(false);
    fetchProducts();
    if (result?.errors?.length > 0) {
      showToast(`${t.prodPushDone} (${result.errors.length})`, 'success');
    } else {
      showToast(t.prodPushDone, 'success');
    }
  }

  async function updateVariant(id, field, value) {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
    try {
      await client.patch(`/products/${id}`, { [field]: value });
    } catch {
      showToast(t.error, 'error');
      fetchProducts();
    }
  }

  async function updateAllVariants(group, field, value) {
    for (const v of group.variants) {
      await updateVariant(v.id, field, value);
    }
  }

  // Image upload happens directly through BouquetImageEditor → backend
  // (POST /products/:wixProductId/image). The backend mirrors Image URL onto
  // every variant row sharing the Wix Product ID. We only need to reflect
  // that change in local state so the card re-renders without a full refetch.
  function updateImage(wixProductId, newUrl) {
    setProducts(prev => prev.map(p =>
      (p['Wix Product ID'] || p.id) === wixProductId
        ? { ...p, 'Image URL': newUrl }
        : p
    ));
  }

  // Add currently-filtered category to every selected bouquet's variants.
  // Runs PATCH /products/:id once per variant (reuses the existing single-
  // product endpoint). We append the category to the existing list rather
  // than replacing, so a bouquet already in other categories keeps them.
  async function addBouquetsToFilteredCategory() {
    if (!catFilter || addToCategorySelected.size === 0) return;
    setAddingToCategory(true);
    try {
      for (const wixProductId of addToCategorySelected) {
        const group = grouped.find(g => g.wixProductId === wixProductId);
        if (!group) continue;
        const current = parseCats(group.variants[0]?.['Category']);
        if (current.includes(catFilter)) continue; // already there
        const next = [...current, catFilter];
        await updateAllVariants(group, 'Category', next);
      }
      showToast(t.prodAddedToCategory || `Added ${addToCategorySelected.size} bouquets to ${catFilter}`, 'success');
      setAddToCategorySelected(new Set());
      setShowAddToCategory(false);
      fetchProducts();
    } catch {
      showToast(t.error, 'error');
    } finally {
      setAddingToCategory(false);
    }
  }

  // Products not yet in the currently-filtered category — that's the picker's
  // contents. Memo-ish: cheap enough to recompute on every render since
  // grouped is already derived.
  const pickerCandidates = catFilter
    ? grouped.filter(g => {
        const cats = [...new Set(g.variants.flatMap(v => parseCats(v['Category'])))];
        return !cats.includes(catFilter);
      })
    : [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t.tabProducts}</h2>
          {syncHistory.length > 0 && <SyncStatus logs={syncHistory} />}
        </div>
        <div className="flex gap-2">
          <button onClick={handlePull} disabled={pulling || pushing}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {pulling ? t.prodSyncing : t.prodPullFromWix}
          </button>
          <button onClick={handlePush} disabled={pulling || pushing}
            className="px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors">
            {pushing ? t.prodSyncing : t.prodPushToWix}
          </button>
        </div>
      </div>

      <AvailableTodayBanner products={availableTodayProducts} onFilter={() => setFilter('today')} />

      {needsReview > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-amber-800 font-medium">{needsReview} {t.prodNeedReview}</span>
          <button onClick={() => setFilter('review')}
            className="text-xs text-amber-700 font-medium px-3 py-1 rounded-full bg-amber-100 hover:bg-amber-200">{t.prodShowReview}</button>
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
            <button key={key} onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === key ? 'bg-white shadow-sm text-brand-600' : 'text-gray-500'
              }`}>{label}</button>
          ))}
        </div>
        {categories.length > 0 && (
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="border border-gray-200 rounded-xl px-2 py-1.5 text-xs text-gray-600">
            <option value="">{t.category}: {t.prodFilterAll}</option>
            {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        )}
        {/* Quick "add bouquets to this category" entry — only when a
            specific category is filtered. Avoids the owner having to open
            each bouquet card and tick the category checkbox individually. */}
        {catFilter && (
          <button
            onClick={() => setShowAddToCategory(true)}
            className="px-2.5 py-1.5 rounded-xl bg-brand-50 text-brand-700 border border-brand-200 text-xs font-medium hover:bg-brand-100"
            title={t.prodAddToCategoryTooltip || 'Assign more bouquets to this category'}
          >
            + {t.prodAddToCategory || 'Add to category'}
          </button>
        )}
        <input type="text" placeholder={t.search} value={search} onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm flex-1 min-w-[200px]" />
        <span className="text-xs text-gray-400">{filtered.length} {t.prodProducts}</span>
      </div>

      {/* Product list */}
      {loading ? (
        <div className="space-y-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : (
        <div className="space-y-3">
          {filtered.map(group => (
            <ProductCard key={group.wixProductId} group={group} stockMap={stockMap} stockList={stock}
              categories={categories} expanded={expandedProduct === group.wixProductId}
              onToggle={() => setExpandedProduct(expandedProduct === group.wixProductId ? null : group.wixProductId)}
              onUpdate={updateVariant} onUpdateAll={updateAllVariants} onUpdateImage={updateImage} />
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-8 space-y-3">
              <p className="text-gray-400">{t.noResults}</p>
              {catFilter && pickerCandidates.length > 0 && (
                <button
                  onClick={() => setShowAddToCategory(true)}
                  className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
                >
                  + {t.prodAddBouquetsToCategory || `Add bouquets to "${catFilter}"`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Picker modal — owner selects bouquets to assign to the filtered category */}
      {showAddToCategory && catFilter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => !addingToCategory && setShowAddToCategory(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">
                {t.prodAddToCategory || 'Add to category'}: <span className="text-brand-600">{catFilter}</span>
              </h2>
              <p className="text-xs text-gray-400 mt-1">
                {t.prodAddToCategoryHint || 'Pick bouquets to assign. Their other categories stay intact.'}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {pickerCandidates.length === 0 ? (
                <p className="text-center text-gray-400 py-6 text-sm">
                  {t.prodAllAlreadyAssigned || 'All bouquets are already in this category.'}
                </p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {pickerCandidates.map(g => {
                    const checked = addToCategorySelected.has(g.wixProductId);
                    const currentCats = [...new Set(g.variants.flatMap(v => parseCats(v['Category'])))];
                    return (
                      <label key={g.wixProductId}
                        className={`flex items-center gap-3 px-2 py-2 cursor-pointer rounded-lg ${checked ? 'bg-brand-50' : 'hover:bg-gray-50'}`}>
                        <input type="checkbox" checked={checked}
                          onChange={() => {
                            setAddToCategorySelected(prev => {
                              const next = new Set(prev);
                              if (next.has(g.wixProductId)) next.delete(g.wixProductId);
                              else next.add(g.wixProductId);
                              return next;
                            });
                          }}
                          className="w-4 h-4 accent-brand-600" />
                        {g.imageUrl ? (
                          <img src={g.imageUrl} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-gray-100 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{g.name}</p>
                          <p className="text-[11px] text-gray-400">
                            {g.variants.length} {t.prodVariants}
                            {currentCats.length > 0 && ` · ${currentCats.join(', ')}`}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex gap-2">
              <button onClick={() => { setAddToCategorySelected(new Set()); setShowAddToCategory(false); }}
                disabled={addingToCategory}
                className="flex-1 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-medium">
                {t.cancel}
              </button>
              <button onClick={addBouquetsToFilteredCategory}
                disabled={addingToCategory || addToCategorySelected.size === 0}
                className="flex-1 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold disabled:opacity-40">
                {addingToCategory ? '...' : `${t.add || 'Add'} (${addToCategorySelected.size})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && <SyncLogSection logs={syncHistory} />}

      <WixPushModal
        open={pushModalOpen}
        onClose={() => setPushModalOpen(false)}
        onComplete={onPushComplete}
      />
    </div>
  );
}
