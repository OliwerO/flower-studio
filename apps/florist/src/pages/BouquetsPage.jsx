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
import client from '../api/client.js';
import t from '../translations.js';
import BouquetCard from '../components/bouquets/BouquetCard.jsx';
import PushBar from '../components/bouquets/PushBar.jsx';

export default function BouquetsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [rows, setRows]       = useState([]);
  const [filter, setFilter]   = useState('all');
  const [search, setSearch]   = useState('');
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

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const { data } = await client.get('/products');
      setRows(data || []);
    } catch {
      showToast(t.stockLoadError || 'Load failed', 'error');
    } finally {
      setLoading(false);
    }
  }

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
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!g.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, search]);

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
    if (result?.errors?.length > 0) {
      showToast(`${t.syncSuccess} (${result.errors.length} предупр.)`, 'success');
    } else {
      showToast(t.syncSuccess, 'success');
    }
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
      </header>

      <div className="container-mobile py-3">
        {/* Search */}
        <div className="relative mb-3">
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
            onToggleAll={toggleAll}
            onToggleVariant={toggleVariant}
            onUpdatePrice={updateVariantPrice}
          />
        ))}
      </div>

      <PushBar count={dirtyIds.size} pushing={pushing} />

      <WixPushModal
        open={pushModalOpen}
        onClose={() => setPushModalOpen(false)}
        onComplete={onPushComplete}
      />
    </div>
  );
}
