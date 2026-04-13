import { useState, useEffect, useCallback } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
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
  const [pushing, setPushing] = useState(false);
  const [syncHistory, setSyncHistory] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedProduct, setExpandedProduct] = useState(null);
  const [catFilter, setCatFilter] = useState('');
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

  const stockMap = Object.fromEntries(stock.map(s => [s.id, s]));
  const grouped = groupByProduct(products);

  function isAvailableToday(variant) {
    if (!variant['Active']) return false;
    if (Number(variant['Lead Time Days'] ?? 1) !== 0) return false;
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
      const errCount = s.errors?.length || 0;
      if (errCount) parts.push(`${errCount} ${t.prodErrors || 'errors'}`);
      showToast(
        `${t.prodPushDone}${parts.length ? ': ' + parts.join(', ') : ''}`,
        errCount ? 'warning' : 'success'
      );
      fetchProducts();
    } catch {
      showToast(t.prodSyncFailed, 'error');
    } finally {
      setPushing(false);
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
              onUpdate={updateVariant} onUpdateAll={updateAllVariants} />
          ))}
          {filtered.length === 0 && <p className="text-center text-gray-400 py-8">{t.noResults}</p>}
        </div>
      )}

      {!loading && <SyncLogSection logs={syncHistory} />}
    </div>
  );
}
