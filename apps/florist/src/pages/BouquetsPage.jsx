import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, X, Flower2 } from 'lucide-react';
import {
  IconButton,
  EmptyState,
  FilterBar,
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

  async function pushToWix() {
    setPushing(true);
    try {
      const { data } = await client.post('/products/push', {});
      const stats = data?.stats || {};
      const parts = [];
      if (stats.pricesSynced) parts.push(`${stats.pricesSynced} prices`);
      if (stats.visibilitySynced) parts.push(`${stats.visibilitySynced} visibility`);
      if (stats.stockSynced) parts.push(`${stats.stockSynced} stock`);
      showToast(`${t.syncSuccess}${parts.length ? ' · ' + parts.join(', ') : ''}`, 'success');
      setDirtyIds(new Set());
    } catch (err) {
      const msg = err.response?.data?.error || t.syncFailed;
      showToast(msg, 'error');
    } finally {
      setPushing(false);
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
          />
        ))}
      </div>

      <PushBar count={dirtyIds.size} pushing={pushing} onPush={pushToWix} />
    </div>
  );
}
