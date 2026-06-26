import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, X, Flower2, Download, Upload, Loader2 } from 'lucide-react';
import {
  IconButton,
  EmptyState,
  FilterBar,
  WixPushModal,
  groupByProduct,
  parseCats,
  activeCount,
  allActive,
  anyActive,
  useToast,
} from '@flower-studio/shared';
import { useAuth } from '../context/AuthContext.jsx';
import client from '../api/client.js';
import t from '../translations.js';
import BouquetCard from '../components/bouquets/BouquetCard.jsx';
import PushBar from '../components/bouquets/PushBar.jsx';
import { useNotifications } from '../hooks/useNotifications.js';

export default function BouquetsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { role } = useAuth();

  const [rows, setRows]       = useState([]);
  const [categories, setCategories] = useState([]);
  const [stock, setStock]     = useState([]);
  const [filter, setFilter]   = useState('all');
  const [search, setSearch]   = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [syncLog, setSyncLog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  // Async-job UX: opening the modal kicks off POST /products/push and the
  // component polls for progress until done. The modal stays as a small
  // floating pill after completion until the user dismisses it, so we
  // track `pushing` separately to drive button-disable state during the
  // active job only.
  const [pushModalOpen, setPushModalOpen] = useState(false);
  const [pushing, setPushing] = useState(false);
  // Tracks bouquet product IDs that have been modified locally since the last
  // successful push. Cleared on a successful POST /products/push.
  const [dirtyIds, setDirtyIds] = useState(() => new Set());

  useEffect(() => {
    loadAll();
    client.get('/products/sync-log').catch(() => ({ data: null })).then(res => {
      setSyncLog(res?.data || null);
    });
  }, []);

  // SSE: when an image is uploaded/deleted from another tab or the dashboard,
  // patch matching variant rows in-place so the card re-renders without
  // refetching the full product list. Image URL is mirrored across every
  // variant of a bouquet by the backend (productRepo.setImage).
  useNotifications(undefined, (event) => {
    if (event.type !== 'product_image_changed') return;
    setRows(prev => prev.map(r =>
      (r['Wix Product ID'] || r.id) === event.wixProductId
        ? { ...r, 'Image URL': event.imageUrl || '' }
        : r
    ));
  });

  async function loadAll() {
    setLoading(true);
    try {
      const [prodRes, catRes, stockRes] = await Promise.all([
        client.get('/products'),
        client.get('/public/categories').catch(() => ({ data: { allCategories: [] } })),
        client.get('/stock').catch(() => ({ data: [] })),
      ]);
      setRows(prodRes.data || []);
      setCategories(catRes.data?.allCategories || []);
      setStock(stockRes.data || []);
    } catch {
      showToast(t.stockLoadError || 'Load failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  const stockList = stock;
  const stockMap = useMemo(() => Object.fromEntries(stock.map(s => [s.id, s])), [stock]);

  // Grouped by bouquet — then filtered, then searched.
  const filteredGroups = useMemo(() => {
    const groups = groupByProduct(rows);
    return groups.filter(g => {
      if (filter === 'active' && !allActive(g)) return false;
      if (filter === 'inactive' && anyActive(g)) return false;
      if (filter === 'review' && (anyActive(g) || g.variants.some(v => parseCats(v.Category).length > 0))) return false;
      if (filter === 'today') {
        const hasToday = g.variants.some(v => parseCats(v.Category).includes('Available Today'));
        if (!hasToday) return false;
      }
      if (categoryFilter) {
        const hasCat = g.variants.some(v => parseCats(v.Category).includes(categoryFilter));
        if (!hasCat) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!g.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, search, categoryFilter]);

  const totalGroups = useMemo(() => groupByProduct(rows), [rows]);
  const totalActive = totalGroups.filter(g => anyActive(g)).length;

  // Optimistic updates: mutate local state first, fire API in background.
  // Matches the dashboard's pattern so behavior is consistent across apps.
  async function markDirty(productId) {
    setDirtyIds(prev => {
      const next = new Set(prev);
      next.add(productId);
      return next;
    });
  }

  async function updateImage(wixProductId, newUrl) {
    // Backend already wrote the URL to all variant rows on successful upload.
    // Mirror the change in local state so the card re-renders with the new
    // image without a full reload. Mark dirty so the next Wix push picks it up
    // (defensive — image was already attached to the Wix product directly,
    // but staying in lock-step with other field updates avoids surprises).
    setRows(prev => prev.map(r =>
      (r['Wix Product ID'] || r.id) === wixProductId
        ? { ...r, 'Image URL': newUrl }
        : r
    ));
    markDirty(wixProductId);
  }

  async function toggleAll(group, nextActive) {
    const productId = group.wixProductId;
    markDirty(productId);
    // Optimistic local flip
    setRows(prev => prev.map(r =>
      (r['Wix Product ID'] || r.id) === productId ? { ...r, Active: nextActive } : r
    ));
    // Fire a PATCH per variant — the backend queue + Airtable rate limit keep
    // this safe even for 5 variants.
    await Promise.allSettled(
      group.variants.map(v => client.patch(`/products/${v.id}`, { Active: nextActive }))
    );
  }

  async function toggleVariant(variant, nextActive) {
    const productId = variant['Wix Product ID'] || variant.id;
    markDirty(productId);
    setRows(prev => prev.map(r => r.id === variant.id ? { ...r, Active: nextActive } : r));
    try {
      await client.patch(`/products/${variant.id}`, { Active: nextActive });
    } catch {
      // Roll back on failure
      setRows(prev => prev.map(r => r.id === variant.id ? { ...r, Active: !nextActive } : r));
      showToast(t.syncFailed, 'error');
    }
  }

  // Toggle a category on/off across every variant of a bouquet group.
  // Mirrors the dashboard ProductCard checkbox UX. Categories are stored
  // per-variant (multi-select Airtable field), but the owner conceptually
  // edits them at the bouquet level — so all variants of the group get the
  // same array. PATCHing per variant keeps the UI consistent with how
  // toggleAll/toggleVariant work.
  async function updateCategories(group, nextCats) {
    const productId = group.wixProductId;
    markDirty(productId);
    setRows(prev => prev.map(r =>
      (r['Wix Product ID'] || r.id) === productId ? { ...r, Category: nextCats } : r
    ));
    const results = await Promise.allSettled(
      group.variants.map(v => client.patch(`/products/${v.id}`, { Category: nextCats }))
    );
    if (results.some(r => r.status === 'rejected')) {
      showToast(t.syncFailed, 'error');
      // Reload from server to recover ground truth — partial failures leave
      // some variants on the new array and some on the old.
      loadAll();
    }
  }

  // Generic per-bouquet field update — PATCHes `field`=`value` across every
  // variant of the group, optimistic + dirty-marked. Used by the shared
  // ProductTranslationEditor (Product Name / Description / Translations) and
  // by the Key Flower / Product Type controls.
  async function updateAll(group, field, value) {
    const productId = group.wixProductId;
    markDirty(productId);
    setRows(prev => prev.map(r =>
      (r['Wix Product ID'] || r.id) === productId ? { ...r, [field]: value } : r
    ));
    const results = await Promise.allSettled(
      group.variants.map(v => client.patch(`/products/${v.id}`, { [field]: value }))
    );
    if (results.some(r => r.status === 'rejected')) {
      showToast(t.syncFailed, 'error');
      loadAll();
    }
  }

  // Inline price edit — mirrors dashboard ProductCard.jsx.
  // The change is local-only until the next push (matches active-toggle semantics).
  async function updateVariantPrice(variant, nextPrice) {
    const productId = variant['Wix Product ID'] || variant.id;
    const prevPrice = Number(variant.Price || 0);
    markDirty(productId);
    setRows(prev => prev.map(r => r.id === variant.id ? { ...r, Price: nextPrice } : r));
    try {
      await client.patch(`/products/${variant.id}`, { Price: nextPrice });
    } catch (err) {
      setRows(prev => prev.map(r => r.id === variant.id ? { ...r, Price: prevPrice } : r));
      const msg = err.response?.data?.error || t.syncFailed;
      showToast(msg, 'error');
    }
  }

  // Per-variant field update — Lead Time Days, Quantity, etc. Optimistic + dirty-marked,
  // mirrors updateVariantPrice. `value` may be null (clears Quantity back to untracked).
  async function updateVariantField(variantId, field, value) {
    const variant = rows.find(r => r.id === variantId);
    if (!variant) return;
    const productId = variant['Wix Product ID'] || variant.id;
    const prev = variant[field];
    markDirty(productId);
    setRows(rs => rs.map(r => r.id === variantId ? { ...r, [field]: value } : r));
    try {
      await client.patch(`/products/${variantId}`, { [field]: value });
    } catch (err) {
      setRows(rs => rs.map(r => r.id === variantId ? { ...r, [field]: prev } : r));
      showToast(err.response?.data?.error || t.syncFailed, 'error');
    }
  }

  // Pull — brings fresh data from Wix back into Airtable (new products, price
  // changes, image updates). Use this when the owner added a bouquet on Wix
  // directly and wants it visible here without waiting for a scheduled sync.
  async function pullFromWix() {
    if (pulling) return;
    setPulling(true);
    try {
      // Backend returns the stats object directly (no wrapping).
      // Pull shape: { new, updated, deactivated, errors }
      const { data } = await client.post('/products/pull', {});
      // Defensive: runPull() in wixProductSync.js wraps its entire body in a
      // try/catch that pushes fatal errors into stats.errors and STILL returns
      // 200. Without checking here, a failed Wix API call (bad token, expired
      // session, network error) looks like a no-op success — the toast just
      // says "Updated from Wix" with zero counts and the owner thinks the
      // sync worked. Surface the actual errors so they can be diagnosed.
      if (data?.errors?.length > 0) {
        showToast(data.errors.join(' · '), 'error');
        return;
      }
      const parts = [];
      if (data?.new) parts.push(`+${data.new}`);
      if (data?.updated) parts.push(`~${data.updated}`);
      if (data?.deactivated) parts.push(`−${data.deactivated}`);
      const summary = parts.length ? ` · ${parts.join(' ')}` : '';
      showToast(`${t.pullSuccess || 'Updated from Wix'}${summary}`, 'success');
      await loadAll();
    } catch (err) {
      const msg = err.response?.data?.error || t.pullFailed || 'Pull failed';
      showToast(msg, 'error');
    } finally {
      setPulling(false);
    }
  }

  function pushToWix() {
    setPushModalOpen(true);
    setPushing(true);
  }

  function onPushComplete(result) {
    setPushing(false);
    setDirtyIds(new Set());
    if (!result) {
      showToast(t.syncFailed, 'error');
    } else if (result.errors?.length > 0) {
      showToast(`${t.syncFailed}: ${result.errors.length}`, 'error');
    } else {
      showToast(t.syncSuccess, 'success');
    }
  }

  // Compact sync indicator helper — mirrors SyncStatus.jsx logic (dashboard).
  // Returns { label, color } or null. Guards every field defensively.
  function fmtSyncEntry(log) {
    if (!log?.['Timestamp']) return null;
    const ago = Math.round((Date.now() - new Date(log['Timestamp']).getTime()) / 60000);
    const failed = log['Status']?.includes('failed');
    const color = failed || ago > 360 ? 'text-red-500' : ago > 60 ? 'text-amber-500' : 'text-emerald-600';
    const timeStr = ago < 60 ? `${ago}m` : `${Math.round(ago / 60)}h`;
    const icon = failed ? '✗' : log['Status']?.includes('push') ? '↑' : '↓';
    return { label: `${icon} ${timeStr} ${t.prodAgo || 'ago'}`, color };
  }

  const filterChips = [
    { value: 'all',      label: t.bouquetsFilterAll },
    { value: 'active',   label: t.bouquetsFilterActive },
    { value: 'today',    label: t.bouquetsFilterToday },
    { value: 'inactive', label: t.bouquetsFilterInactive },
    { value: 'review',   label: t.bouquetsFilterReview },
  ];

  return (
    <div className="min-h-screen bg-ios-bg dark:bg-dark-bg pb-28">
      {/* Sticky header */}
      <header className="sticky top-0 z-20 glass-nav safe-area-top px-2 py-2 flex items-center gap-2">
        <IconButton onClick={() => navigate(-1)} ariaLabel="Back">
          <ArrowLeft size={22} />
        </IconButton>
        <h1 className="text-base font-semibold text-ios-label dark:text-dark-label flex-1">
          {t.bouquetsTitle}
        </h1>
        {/* Explicit Pull + Push buttons so both sync directions are discoverable.
            Replaces the old generic RefreshCw icon that looked like a page refresh. */}
        <button
          type="button"
          onClick={pullFromWix}
          disabled={pulling || pushing}
          aria-label={t.pullFromWix}
          className="flex items-center gap-1 px-2.5 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/20
                     text-ios-blue text-sm font-semibold active-scale disabled:opacity-50"
        >
          {pulling ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          <span>{t.pullShort}</span>
        </button>
        {role === 'owner' && (
          <button
            type="button"
            onClick={pushToWix}
            disabled={pulling || pushing}
            aria-label={t.pushToWix}
            className="flex items-center gap-1 px-2.5 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-900/20
                       text-emerald-700 dark:text-emerald-400 text-sm font-semibold active-scale disabled:opacity-50"
          >
            {pushing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            <span>{t.pushShort}</span>
          </button>
        )}
      </header>

      <div className="container-mobile py-3">
        {/* Sync-status indicator — compact last-pull/push badge */}
        {Array.isArray(syncLog) && syncLog.length > 0 && (() => {
          const lastPull = syncLog.find(l => l['Status']?.includes('pull'));
          const lastPush = syncLog.find(l => l['Status']?.includes('push'));
          const pull = fmtSyncEntry(lastPull);
          const push = fmtSyncEntry(lastPush);
          if (!pull && !push) return null;
          return (
            <div className="flex items-center gap-3 px-1 pb-2 text-[11px]">
              <span className="text-ios-tertiary">{t.prodLastSync || 'Last sync'}:</span>
              {pull && <span className={pull.color}>{pull.label}</span>}
              {push && <span className={push.color}>{push.label}</span>}
            </div>
          );
        })()}

        {/* Search + category filter row */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ios-tertiary" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t.bouquetsSearch}
              className="w-full pl-9 pr-9 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-dark-separator
                         bg-white dark:bg-dark-elevated text-ios-label dark:text-dark-label outline-none
                         focus:border-brand-400"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ios-tertiary"
              >
                <X size={16} />
              </button>
            )}
          </div>
          {categories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="py-2.5 px-3 text-sm rounded-xl border border-gray-200 dark:border-dark-separator
                         bg-white dark:bg-dark-elevated text-ios-label dark:text-dark-label outline-none
                         focus:border-brand-400"
            >
              <option value="">{t.prodAllCategories || 'All categories'}</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          )}
        </div>

        <FilterBar
          className="mb-2"
          chips={filterChips}
          value={filter}
          onChange={setFilter}
        />

        <div className="flex items-baseline gap-3 px-1 py-2 text-[11px] uppercase tracking-wide text-ios-tertiary font-semibold">
          <span>{totalGroups.length} {t.bouquetsCount}</span>
          <span>·</span>
          <span>{totalActive} {t.bouquetsActive}</span>
        </div>

        {loading && (
          <div className="py-10 text-center text-sm text-ios-tertiary">…</div>
        )}

        {!loading && filteredGroups.length === 0 && (
          <EmptyState
            icon={<Flower2 size={40} />}
            title={search ? (t.noResults || 'No results') : (t.bouquetsTitle)}
            description={search ? '' : ''}
          />
        )}

        {!loading && filteredGroups.map(group => (
          <BouquetCard
            key={group.wixProductId}
            group={group}
            categories={categories}
            onToggleAll={toggleAll}
            onToggleVariant={toggleVariant}
            onUpdatePrice={updateVariantPrice}
            onUpdateCategories={updateCategories}
            onUpdateImage={updateImage}
            onUpdateAll={updateAll}
            stockMap={stockMap}
            stockList={stockList}
            onUpdate={updateVariantField}
          />
        ))}
      </div>

      <PushBar count={dirtyIds.size} pushing={pushing} />

      {role === 'owner' && (
        <WixPushModal
          open={pushModalOpen}
          onClose={() => setPushModalOpen(false)}
          onComplete={onPushComplete}
        />
      )}
    </div>
  );
}
