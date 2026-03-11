// ProductsTab — Wix product catalog management for the owner.
// Like a product master data screen: see all items from the supplier (Wix),
// set prices, lead times, categories, and toggle visibility.
// New products from Wix sync appear with a review badge.

import { useState, useEffect, useCallback } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';

const PRODUCT_TYPES = ['mono', 'mix'];

export default function ProductsTab() {
  const [products, setProducts] = useState([]);
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' | 'review' | 'active' | 'inactive'
  const [search, setSearch] = useState('');
  const [expandedProduct, setExpandedProduct] = useState(null);
  const { showToast } = useToast();

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const [prodRes, stockRes, logRes] = await Promise.all([
        client.get('/products'),
        client.get('/stock'),
        client.get('/products/sync-log'),
      ]);
      setProducts(prodRes.data);
      setStock(stockRes.data);
      setSyncLog(logRes.data?.[0] || null);
    } catch {
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Group variants by Wix Product ID
  const grouped = groupByProduct(products);

  // Filter
  const filtered = grouped.filter(g => {
    if (filter === 'review') return g.variants.some(v => !v['Active']);
    if (filter === 'active') return g.variants.some(v => v['Active']);
    if (filter === 'inactive') return g.variants.every(v => !v['Active']);
    return true;
  }).filter(g => {
    if (!search) return true;
    const s = search.toLowerCase();
    return g.name.toLowerCase().includes(s);
  });

  const needsReview = grouped.filter(g => g.variants.some(v => !v['Active'])).length;

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await client.post('/products/sync');
      const s = res.data;
      showToast(`${t.prodSyncDone}: ${s.new} ${t.prodNew}, ${s.updated} ${t.prodUpdated}`, 'success');
      fetchProducts();
    } catch {
      showToast(t.prodSyncFailed, 'error');
    } finally {
      setSyncing(false);
    }
  }

  async function updateVariant(id, field, value) {
    // Optimistic update
    setProducts(prev => prev.map(p =>
      p.id === id ? { ...p, [field]: value } : p
    ));
    try {
      await client.patch(`/products/${id}`, { [field]: value });
    } catch {
      showToast(t.error, 'error');
      fetchProducts(); // revert
    }
  }

  // Build stock lookup for suggested price
  const stockMap = Object.fromEntries(
    stock.map(s => [s.id, s])
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t.tabProducts}</h2>
          {syncLog && (
            <SyncStatus log={syncLog} />
          )}
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium
                     hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {syncing ? t.prodSyncing : t.prodSyncFromWix}
        </button>
      </div>

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
              expanded={expandedProduct === group.wixProductId}
              onToggle={() => setExpandedProduct(
                expandedProduct === group.wixProductId ? null : group.wixProductId
              )}
              onUpdate={updateVariant}
            />
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-gray-400 py-8">{t.noResults}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Product card (one per Wix product, shows all variants) ──

function ProductCard({ group, stockMap, expanded, onToggle, onUpdate }) {
  const allActive = group.variants.every(v => v['Active']);
  const anyActive = group.variants.some(v => v['Active']);
  const productType = group.variants[0]?.['Product Type'] || 'mix';
  const categories = parseCats(group.variants[0]?.['Category']);

  return (
    <div className={`bg-white rounded-2xl border ${anyActive ? 'border-gray-200' : 'border-amber-200'} shadow-sm overflow-hidden`}>
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
      >
        {/* Thumbnail */}
        {group.imageUrl ? (
          <img src={group.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-900 truncate">{group.name}</span>
            <span className="text-xs text-gray-400">({productType})</span>
            {!allActive && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                {t.prodNeedsSetup}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-400">
              {group.variants.length} {t.prodVariants}
            </span>
            {categories.length > 0 && (
              <span className="text-xs text-gray-400">
                · {categories.join(', ')}
              </span>
            )}
          </div>
        </div>

        <span className="text-gray-300 text-lg">{expanded ? '−' : '+'}</span>
      </button>

      {/* Expanded: variant table */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3">
          {/* Product-level fields */}
          <div className="flex gap-3 mb-3 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-gray-600">
              {t.prodType}:
              <select
                value={productType}
                onChange={e => {
                  for (const v of group.variants) {
                    onUpdate(v.id, 'Product Type', e.target.value);
                  }
                }}
                className="border border-gray-200 rounded-lg px-2 py-1 text-xs"
              >
                {PRODUCT_TYPES.map(pt => (
                  <option key={pt} value={pt}>{pt}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              {t.category}:
              <input
                type="text"
                defaultValue={categories.join(', ')}
                onBlur={e => {
                  const cats = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                  for (const v of group.variants) {
                    onUpdate(v.id, 'Category', cats);
                  }
                }}
                className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-48"
                placeholder="All Bouquets, Bestsellers"
              />
            </label>
          </div>

          {/* Variant rows */}
          <div className="overflow-x-auto">
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

          {/* Stock mapping */}
          <StockMapping variant={group.variants[0]} stockMap={stockMap} onUpdate={onUpdate} />
        </div>
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

// ── Stock mapping indicator ──

function StockMapping({ variant, stockMap, onUpdate }) {
  const keyFlower = variant?.['Key Flower'];
  const stockId = Array.isArray(keyFlower) ? keyFlower[0] : keyFlower;
  const stockItem = stockId ? stockMap[stockId] : null;

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 text-xs">
      <span className="text-gray-500">{t.prodKeyFlower}:</span>
      {stockItem ? (
        <span className="text-green-600 font-medium">
          {stockItem['Display Name']} ({stockItem['Current Quantity'] || 0} {t.prodInStock})
        </span>
      ) : (
        <span className="text-amber-500">{t.prodNotMapped}</span>
      )}
    </div>
  );
}

// ── Sync status badge ──

function SyncStatus({ log }) {
  const ts = new Date(log['Timestamp']);
  const ago = Math.round((Date.now() - ts.getTime()) / 60000);
  const status = log['Status'];

  let color = 'text-green-600';
  let icon = '\u2713';
  if (status === 'failed') { color = 'text-red-500'; icon = '\u2717'; }
  else if (ago > 360) { color = 'text-red-500'; icon = '\u26A0'; }
  else if (ago > 60) { color = 'text-amber-500'; icon = '\u26A0'; }

  const timeStr = ago < 60
    ? `${ago}m ${t.prodAgo}`
    : `${Math.round(ago / 60)}h ${t.prodAgo}`;

  return (
    <span className={`text-xs ${color}`}>
      {icon} {t.prodLastSync}: {timeStr}
    </span>
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
