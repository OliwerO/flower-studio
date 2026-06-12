import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, ShoppingCart, ClipboardCheck, Trash2 } from 'lucide-react';
import {
  useDebouncedValue,
  useStockYModelFlag,
  TypeGroupHeader,
  VarietyListItem,
  ShortfallSummary,
  BatchArrivalList,
  PendingArrivalsPanel,
  BatchTraceModal,
  VarietyTracePanel,
  WriteOffBatchPicker,
  LOSS_REASONS,
  reasonLabel,
} from '@flower-studio/shared';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import StockItem from '../components/StockItem.jsx';
import ReceiveStockForm from '../components/ReceiveStockForm.jsx';
import HelpPanel from '../components/HelpPanel.jsx';
import PendingArrivalsSection from '../components/PendingArrivalsSection.jsx';
import t from '../translations.js';

const SORT_OPTIONS = [
  { key: 'name',     label: () => t.sortByName },
  { key: 'qty',      label: () => t.sortByQty },
  { key: 'sell',     label: () => t.sortBySell },
  { key: 'supplier', label: () => t.sortBySupplier },
  { key: 'received', label: () => t.sortByReceived || 'Date' },
];

const VIEW_OPTIONS = [
  { key: 'all',       label: () => t.viewAll },
  { key: 'negative',  label: () => t.viewNegative },
  { key: 'low',       label: () => t.viewLow },
  { key: 'slow',      label: () => t.viewSlowMovers },
];

const SORT_FNS = {
  name:     (a, b) => (a['Display Name'] || '').localeCompare(b['Display Name'] || ''),
  qty:      (a, b) => (Number(a['Current Quantity']) || 0) - (Number(b['Current Quantity']) || 0),
  sell:     (a, b) => (Number(a['Current Sell Price']) || 0) - (Number(b['Current Sell Price']) || 0),
  supplier: (a, b) => (a.Supplier || '').localeCompare(b.Supplier || ''),
  received: (a, b) => (a['Last Restocked'] || '').localeCompare(b['Last Restocked'] || ''),
};

export default function StockPanelPage() {
  const navigate          = useNavigate();
  const { showToast }     = useToast();
  const { role }          = useAuth();
  const yEnabled          = useStockYModelFlag();
  const [stock, setStock] = useState([]);
  const [groups, setGroups] = useState([]); // Y-model: array from /stock?grouped=true
  const [loading, setLoading]     = useState(true);
  const [showReceive, setShowReceive] = useState(false);
  const [editMode, setEditMode]       = useState(false);
  const [showHelp, setShowHelp]       = useState(false);
  const [committedMap, setCommittedMap] = useState({}); // stockId → { committed, orders }
  const [pendingPO, setPendingPO] = useState({}); // stockId → { ordered, plannedDate, pos[] }
  // Premade-bouquet reservations: { stockId: { qty, bouquets: [{ bouquetId, name, qty }] } }
  const [premadeMap, setPremadeMap] = useState({});

  // Y-model UI state
  // expandedKey: which Variety is expanded (string key = variety.key, or null)
  const [expandedKey, setExpandedKey] = useState(null);
  // collapsedTypes: Set of type_name strings that are collapsed
  const [collapsedTypes, setCollapsedTypes] = useState(new Set());
  // viewMode: 'variety' = Type→Variety grouped list (default), 'batch' = arrival-date list
  const [viewMode, setViewMode] = useState(
    () => localStorage.getItem('blossom-stock-view') || 'batch',
  );
  function setStockViewMode(v) {
    setViewMode(v);
    localStorage.setItem('blossom-stock-view', v);
  }
  // Trace modal state
  const [traceStockId, setTraceStockId] = useState(null);
  const [traceTrail, setTraceTrail] = useState(null);
  const [traceLoading, setTraceLoading] = useState(false);
  // Variety-level trace modal state (mirror of per-Batch trace, but at Variety scope)
  const [varietyTraceKey, setVarietyTraceKey]         = useState(null);
  const [varietyTrail, setVarietyTrail]               = useState([]);
  const [varietyUnaccounted, setVarietyUnaccounted]   = useState(0);
  const [varietyTraceLoading, setVarietyTraceLoading] = useState(false);
  // Write-off modal state
  const [writeOffVariety, setWriteOffVariety] = useState(null);

  // Search, sort, view
  const [search, setSearch]   = useState('');
  // Debounce so the filter+sort compute over ~300 stock rows doesn't run on
  // every keystroke. Input stays responsive; results settle after 300ms.
  const debouncedSearch       = useDebouncedValue(search, 300);
  const [sortKey, setSortKey] = useState('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [view, setView]       = useState('all');
  const [hideZero, setHideZero] = useState(true);

  const fetchStock = useCallback(async () => {
    setLoading(true);
    try {
      if (yEnabled) {
        // Y-model: fetch grouped stock + premade reservations + pending POs.
        const [groupedRes, premadeRes, pendingPoRes] = await Promise.all([
          client.get('/stock?grouped=true'),
          client.get('/stock/premade-committed').catch(() => ({ data: {} })),
          client.get('/stock/pending-po').catch(() => ({ data: {} })),
        ]);
        setGroups(groupedRes.data.groups || []);
        setPremadeMap(premadeRes.data || {});
        setPendingPO(pendingPoRes.data || {});
      } else {
        // Legacy flat list
        const [stockRes, committedRes, premadeRes] = await Promise.all([
          client.get('/stock?includeEmpty=true'),
          client.get('/stock/committed'),
          client.get('/stock/premade-committed').catch(() => ({ data: {} })),
        ]);
        setStock(stockRes.data);
        setCommittedMap(committedRes.data);
        setPremadeMap(premadeRes.data || {});
      }
    } catch (err) { showToast(err.response?.data?.error || t.adjustError, 'error'); }
    finally   { setLoading(false); }
  }, [yEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchStock(); }, [fetchStock]);

  async function handleAdjust(id, delta) {
    try {
      const res = await client.post(`/stock/${id}/adjust`, { delta });
      setStock(prev => prev.map(s => s.id === id ? { ...s, ...res.data } : s));
    } catch (err) { showToast(err.response?.data?.error || t.adjustError, 'error'); }
  }

  // Y-model quick-adjust: qty lives on the per-Batch row inside `groups`.
  // Optimistically bump current_quantity, POST the delta, revert on failure.
  async function handleAdjustGroup(id, delta) {
    const bump = (rows, d) =>
      (rows || []).map(r =>
        r.id === id ? { ...r, current_quantity: (Number(r.current_quantity) || 0) + d } : r
      );
    setGroups(prev => prev.map(g => ({ ...g, rows: bump(g.rows, delta) })));
    try {
      await client.post(`/stock/${id}/adjust`, { delta });
    } catch (err) {
      setGroups(prev => prev.map(g => ({ ...g, rows: bump(g.rows, -delta) })));
      showToast(err.response?.data?.error || t.adjustError, 'error');
    }
  }

  async function handleWriteOff(id, quantity, reason) {
    try {
      const res = await client.post(`/stock/${id}/write-off`, { quantity, reason: reason || undefined });
      setStock(prev => prev.map(s => s.id === id ? { ...s, ...res.data } : s));
      showToast(`${quantity} stems written off`, 'success');
    } catch (err) { showToast(err.response?.data?.error || t.writeOffError, 'error'); }
  }

  async function handleReceive(data) {
    try {
      await client.post('/stock-purchases', data);
      showToast(t.success, 'success');
      setShowReceive(false);
      fetchStock();
    } catch (err) { showToast(err.response?.data?.error || t.receiveError, 'error'); }
  }

  async function handlePatch(id, fields) {
    try {
      const res = await client.patch(`/stock/${id}`, fields);
      setStock(prev => prev.map(s => s.id === id ? { ...s, ...res.data } : s));
    } catch (err) { showToast(err.response?.data?.error || t.adjustError, 'error'); }
  }

  async function handlePatchPrice(id, fields) {
    try {
      const res = await client.patch(`/stock/${id}`, fields);
      setStock(prev => prev.map(s => s.id === id ? { ...s, ...res.data } : s));
      showToast(t.stockUpdated, 'success');
    } catch (err) { showToast(err.response?.data?.error || t.adjustError, 'error'); }
  }

  // Bulk price patch for the Y-model merged Stock row — patches every
  // underlying stock_id so the whole physical bucket re-prices in one tap.
  // `fields` keys: `cost` and/or `sell` (raw numbers; mapped to backend keys).
  async function handlePatchPriceBulk(stockIds, fields) {
    const body = {};
    if (fields.cost != null) body['Current Cost Price'] = Number(fields.cost);
    if (fields.sell != null) body['Current Sell Price'] = Number(fields.sell);
    if (Object.keys(body).length === 0) return;
    try {
      await Promise.all(stockIds.map(id => client.patch(`/stock/${id}`, body)));
      showToast(`${t.stockUpdated} (${stockIds.length})`, 'success');
      fetchStock();
    } catch (err) { showToast(err.response?.data?.error || t.adjustError, 'error'); }
  }

  function toggleSort(key) {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  // ── Y-model: derived Maps from premadeMap ──
  // premadesByStockId: Map<stockId (string), Array<{ id, name, qty }>>
  // reservations:      Map<stockId (string), number>
  // Both are derived from the same /stock/premade-committed response.
  const { premadesByStockId, reservations: reservationsMap } = useMemo(() => {
    const premadesByStockId = new Map();
    const reservations = new Map();
    for (const [stockId, data] of Object.entries(premadeMap)) {
      const qty = Number(data?.qty) || 0;
      if (qty > 0) {
        reservations.set(stockId, qty);
        // bouquets array may be empty in the Y-model backend path (returns []).
        const bouquets = data?.bouquets || [];
        premadesByStockId.set(stockId, bouquets);
      }
    }
    return { premadesByStockId, reservations };
  }, [premadeMap]);

  // ── Y-model: group groups by type_name ──
  // typeGroups: Map<typeName, group[]>  (preserving insertion order)
  const typeGroups = useMemo(() => {
    const map = new Map();
    for (const group of groups) {
      const key = group.type_name || '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(group);
    }
    return map;
  }, [groups]);

  // ── Y-model: batch trace fetch ──
  // traceStockId can be a single id (string) for the legacy By Variety expand
  // path, or a comma-separated list when the By Batch view (now merged across
  // arrival date / supplier) wants the union trace across multiple stock_ids.
  useEffect(() => {
    if (!traceStockId) return;
    setTraceTrail(null);
    setTraceLoading(true);
    const ids = String(traceStockId).split(',').filter(Boolean);
    Promise.all(ids.map(id => client.get(`/stock/${id}/usage`).then(r => r.data.trail || []).catch(() => [])))
      .then(trails => setTraceTrail(trails.flat()))
      .finally(() => setTraceLoading(false));
  }, [traceStockId]);

  // ── Y-model: write-off handler ──
  // Write-off spread across a merged sell tier in FEFO order. `stockIds` is
  // pre-sorted oldest → newest by WriteOffBatchPicker; we drain from the head
  // until the requested qty is exhausted, allowing one tap to clear stems
  // that span multiple underlying receives.
  async function handleWriteOffY({ stockIds, stockId, qty, reason }) {
    // Back-compat: hosts that still pass a single stockId continue to work.
    const ids = Array.isArray(stockIds) && stockIds.length ? stockIds : (stockId ? [stockId] : []);
    if (!ids.length) return;
    try {
      let remaining = qty;
      // Build a stock-id → currentQty lookup to size each POST.
      const allRows = (groups ?? []).flatMap(g => g.rows ?? []);
      const qtyById = new Map(allRows.map(r => [r.id, Number(r.current_quantity) || 0]));
      for (const id of ids) {
        if (remaining <= 0) break;
        const avail = Math.max(0, qtyById.get(id) ?? 0);
        if (avail === 0) continue;
        const chunk = Math.min(remaining, avail);
        await client.post(`/stock/${id}/write-off`, { quantity: chunk, reason: reason || undefined });
        remaining -= chunk;
      }
      showToast(`${qty} ${t.stems} — ${t.writeOff}`, 'success');
      setWriteOffVariety(null);
      fetchStock();
    } catch (err) { showToast(err.response?.data?.error || t.writeOffError, 'error'); }
  }

  // Build reason options for WriteOffBatchPicker
  const writeOffReasons = useMemo(() =>
    LOSS_REASONS.map(r => ({ value: r, label: reasonLabel(t, r) })),
  []);

  // ── Y-model: "show cleared rows" toggle maps to hideZero ──
  // hideZero=true  → hide zero-qty groups (same semantics as today)
  // hideZero=false → show all groups including zero-qty

  // Filtered group list for Y-model path
  const filteredGroups = useMemo(() => {
    if (!yEnabled) return [];
    let list = groups;
    // Search across Variety identity + every row's display name + supplier.
    const q = debouncedSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(g => {
        const ident = [g.type_name, g.colour, g.size_cm != null ? `${g.size_cm}cm` : null, g.cultivar]
          .filter(Boolean).join(' ').toLowerCase();
        if (ident.includes(q)) return true;
        return (g.rows || []).some(r =>
          ((r['Display Name'] || r.display_name || '') + ' ' + (r.Supplier || r.supplier || ''))
            .toLowerCase().includes(q)
        );
      });
    }
    if (hideZero) {
      list = list.filter(g => {
        const totalQty = (g.rows || []).reduce((sum, r) => sum + (Number(r.current_quantity) || 0), 0);
        if (totalQty !== 0) return true;
        return (g.rows || []).some(r => (reservationsMap.get(r.id) || 0) > 0);
      });
    }
    return list;
  }, [groups, hideZero, yEnabled, reservationsMap, debouncedSearch]);

  // Filtered + sorted stock (legacy path)
  const filteredStock = useMemo(() => {
    const now = Date.now();
    const SLOW_DAYS = 14;

    let items = stock;

    // Hide zero-stock items (default on, same as dashboard)
    if (hideZero && view === 'all') {
      // Keep zero-qty rows when premade bouquets still hold stems — those
      // stems physically exist on the shelf and must stay visible so the
      // owner/florist can reconcile them.
      items = items.filter(s => {
        const qty = Number(s['Current Quantity']) || 0;
        if (qty !== 0) return true;
        return (premadeMap[s.id]?.qty || 0) > 0;
      });
    }

    // View filter
    if (view === 'negative') {
      items = items.filter(s => (Number(s['Current Quantity']) || 0) < 0);
    } else if (view === 'low') {
      items = items.filter(s => {
        const qty = Number(s['Current Quantity']) || 0;
        const threshold = Number(s['Reorder Threshold']) || 5;
        return qty > 0 && qty <= threshold;
      });
    } else if (view === 'slow') {
      items = items.filter(s => {
        const qty = Number(s['Current Quantity']) || 0;
        if (qty <= 0) return false;
        const last = s['Last Restocked'];
        if (!last) return true; // never restocked = slow
        const age = now - new Date(last).getTime();
        return age > SLOW_DAYS * 86400000;
      });
    }

    // Search filter
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase().trim();
      items = items.filter(s =>
        (s['Display Name'] || '').toLowerCase().includes(q) ||
        (s.Supplier || '').toLowerCase().includes(q) ||
        (s.Farmer || '').toLowerCase().includes(q)
      );
    }

    // Sort — negative items pinned to top (they're the true "owe stems" signal)
    const sortFn = SORT_FNS[sortKey] || SORT_FNS.name;
    const sorted = [...items].sort((a, b) => {
      const aNeg = (Number(a['Current Quantity']) || 0) < 0;
      const bNeg = (Number(b['Current Quantity']) || 0) < 0;
      if (aNeg !== bNeg) return aNeg ? -1 : 1;
      const cmp = sortFn(a, b);
      return sortAsc ? cmp : -cmp;
    });

    return sorted;
  }, [stock, debouncedSearch, sortKey, sortAsc, view, hideZero, premadeMap]);

  // Counts for view badges
  const negativeCount = useMemo(() => stock.filter(s => (Number(s['Current Quantity']) || 0) < 0).length, [stock]);
  const lowCount = useMemo(() => stock.filter(s => {
    const qty = Number(s['Current Quantity']) || 0;
    return qty > 0 && qty <= (Number(s['Reorder Threshold']) || 5);
  }).length, [stock]);

  return (
    <div className="min-h-screen">

      {/* Nav */}
      <header className="glass-nav px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <button onClick={() => navigate('/orders')} className="text-brand-600 font-medium text-base active-scale">
            ‹ {t.navOrders}
          </button>
          <h1 className="text-base font-semibold text-ios-label">{t.stockTitle}</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHelp(true)}
              className="text-xs font-bold w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300
                         hover:bg-gray-200 dark:hover:bg-gray-600 active-scale flex items-center justify-center"
            >?</button>
            <button onClick={fetchStock} className="text-ios-tertiary text-base active-scale">↻</button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 pb-28">

        {/* Owner operations — a compact 2×2 tile grid replaces the stacked
            Purchase Orders + Waste Log buttons from before. Moved here in 2026-04
            to consolidate every stock-adjacent workflow under the Stock tab
            (Shopping was its own bottom-nav tab before; Purchase Orders and
            Waste Log were in the burger menu). */}
        {role === 'owner' ? (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <OpsTile Icon={Truck}          label={t.po?.title || 'Purchase Orders'} onClick={() => navigate('/purchase-orders')} />
            <OpsTile Icon={ShoppingCart}   label={t.tabShopping}                    onClick={() => navigate('/shopping-support')} />
            <OpsTile Icon={ClipboardCheck} label={t.stockEvaluation}                onClick={() => navigate('/stock-evaluation')} />
            <OpsTile Icon={Trash2}         label={t.wasteLog}                       onClick={() => navigate('/stock/waste')} variant="muted" />
          </div>
        ) : (
          /* Florist: only Waste Log — stock-adjacent ops like POs and Shopping
             are owner-only workflows. */
          <button
            onClick={() => navigate('/stock/waste')}
            className="w-full mb-3 h-11 rounded-2xl bg-red-50 dark:bg-red-900/20 text-ios-red
                       text-sm font-semibold active:bg-red-100 active-scale flex items-center justify-center gap-2"
          >
            <Trash2 size={16} /> {t.wasteLog}
          </button>
        )}

        {/* Legacy per-stockId pending table (flag off). Under Y-model the
            date-grouped PendingArrivalsPanel renders directly above the
            ShortfallSummary instead — see below (CR-34). */}
        {!yEnabled && (
          <PendingArrivalsSection
            stock={stock}
            committedMap={committedMap}
            onOrderClick={(id) => navigate(`/orders/${id}`)}
          />
        )}

        {/* Receive stock */}
        <button
          onClick={() => setShowReceive(!showReceive)}
          className={`w-full mb-4 h-12 rounded-2xl text-base font-semibold transition-colors ${
            showReceive
              ? 'bg-ios-fill2 text-ios-secondary'
              : 'bg-brand-600 text-white shadow-sm active:bg-brand-700'
          }`}
        >
          {showReceive ? `✕ ${t.cancel}` : `+ ${t.receiveStock}`}
        </button>

        {showReceive && (
          <div className="mb-5">
            <ReceiveStockForm stock={stock} onSave={handleReceive} onCancel={() => setShowReceive(false)} />
          </div>
        )}

        {/* Search */}
        <div className="ios-card flex items-center px-4 gap-3 mb-3">
          <span className="text-ios-tertiary text-sm">🔍</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t.searchStock}
            className="flex-1 py-3 text-base bg-transparent outline-none placeholder-ios-tertiary/50"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-ios-tertiary text-sm">✕</button>
          )}
        </div>

        {/* View filter pills */}
        <div className="flex gap-2 mb-3 overflow-x-auto">
          {VIEW_OPTIONS.map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors active-scale ${
                view === v.key
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300'
              }`}
            >
              {v.label()}
              {v.key === 'negative' && negativeCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">{negativeCount}</span>
              )}
              {v.key === 'low' && lowCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">{lowCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* Hide-zero / show-cleared toggle — same semantics, different label in Y-model */}
        <div className="flex justify-end mb-2">
          <button
            onClick={() => setHideZero(!hideZero)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors active-scale ${
              hideZero
                ? 'bg-brand-100 text-brand-700 ring-1 ring-brand-200'
                : 'bg-gray-200 dark:bg-gray-600 text-ios-label dark:text-gray-200'
            }`}
          >
            {yEnabled
              ? (hideZero ? (t.showClearedRows || 'Show cleared') : (t.showClearedRows || 'Show cleared'))
              : (hideZero ? (t.inStockOnly || 'In stock') : (t.showAll || 'All stock'))}
          </button>
        </div>

        {/* Sort pills — legacy only; Y-model groups by type, then variety */}
        {!yEnabled && (
          <div className="flex gap-2 mb-4 overflow-x-auto">
            {SORT_OPTIONS.map(s => (
              <button
                key={s.key}
                onClick={() => toggleSort(s.key)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors active-scale ${
                  sortKey === s.key
                    ? 'bg-brand-100 text-brand-700'
                    : 'bg-gray-50 text-ios-tertiary'
                }`}
              >
                {s.label()} {sortKey === s.key && (sortAsc ? '↑' : '↓')}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center mt-20">
            <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : yEnabled ? (
          /* ── Y-model: grouped Type → Variety list ── */
          filteredGroups.length === 0 ? (
            <p className="text-ios-tertiary text-sm text-center py-12">{t.noStockFound || 'No items found'}</p>
          ) : (
            <>
              {/* Pending arrivals stacked directly above shortfalls — the two
                  "coming / missing" signal panels read together (CR-34). */}
              <PendingArrivalsPanel
                pendingPO={pendingPO}
                stock={(groups || []).flatMap(g => (g.rows || []).map(r => ({
                  ...r,
                  Type: g.type_name, Colour: g.colour, Size: g.size_cm, Cultivar: g.cultivar,
                })))}
                t={t}
              />
              <ShortfallSummary
                groups={filteredGroups}
                reservations={reservationsMap}
                t={t}
                onVarietyClick={(key) => setExpandedKey(k => k === key ? null : key)}
                fetchUsage={async (stockId) => {
                  const res = await client.get(`/stock/${stockId}/usage`);
                  return res.data?.trail || [];
                }}
              />
              {/* View toggle: Variety / Batch */}
              <div className="flex items-center gap-1 mb-3 p-1 bg-gray-100 rounded-full w-fit">
                <button
                  type="button"
                  data-testid="view-variety"
                  onClick={() => setStockViewMode('variety')}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    viewMode === 'variety' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                  }`}
                >
                  {t.viewVariety || 'By Variety'}
                </button>
                <button
                  type="button"
                  data-testid="view-batch"
                  onClick={() => setStockViewMode('batch')}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    viewMode === 'batch' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                  }`}
                >
                  {t.viewBatch || 'Flat table'}
                </button>
              </div>
              {viewMode === 'batch' ? (
                <BatchArrivalList
                  groups={filteredGroups}
                  reservations={reservationsMap}
                  t={t}
                  onRowClick={(stockIds) => setTraceStockId(stockIds.join(','))}
                  onPatchPriceBulk={role === 'owner' ? handlePatchPriceBulk : undefined}
                />
              ) : (
            <div className="ios-card overflow-hidden">
              {Array.from(typeGroups.entries()).map(([typeName, typeRows]) => {
                // Only show types that have at least one visible group after filtering
                const visibleRows = hideZero
                  ? typeRows.filter(g => filteredGroups.includes(g))
                  : typeRows;
                if (visibleRows.length === 0) return null;

                const isCollapsed = collapsedTypes.has(typeName);
                const totalQty = typeRows.reduce((sum, g) =>
                  sum + (g.rows || []).reduce((s, r) => s + (Number(r.current_quantity) || 0), 0), 0);
                const varietyCount = typeRows.length;

                return (
                  <div key={typeName}>
                    <TypeGroupHeader
                      typeName={typeName}
                      totalQty={totalQty}
                      varietyCount={varietyCount}
                      collapsed={isCollapsed}
                      onToggle={() => setCollapsedTypes(prev => {
                        const next = new Set(prev);
                        if (next.has(typeName)) next.delete(typeName);
                        else next.add(typeName);
                        return next;
                      })}
                      t={t}
                    />
                    {!isCollapsed && visibleRows.map(group => (
                      <div key={group.key}>
                        <VarietyListItem
                          variety={group}
                          reservations={reservationsMap}
                          hideType={false}
                          expanded={expandedKey === group.key}
                          onToggle={() => setExpandedKey(k => k === group.key ? null : group.key)}
                          onRowClick={(stockId) => setTraceStockId(stockId)}
                          onVarietyTrace={async (key) => {
                            setVarietyTraceKey(key);
                            setVarietyTrail([]);
                            setVarietyUnaccounted(0);
                            setVarietyTraceLoading(true);
                            try {
                              const res = await client.get(`/stock/varieties/${encodeURIComponent(key)}/usage`);
                              setVarietyTrail(res.data.events || []);
                              setVarietyUnaccounted(res.data.unaccountedStems ?? 0);
                            } catch {
                              setVarietyTrail([]);
                            } finally {
                              setVarietyTraceLoading(false);
                            }
                          }}
                          onWriteOff={(v) => setWriteOffVariety(v)}
                          onAdjust={handleAdjustGroup}
                          premadesByStockId={premadesByStockId}
                          t={t}
                        />
                        {/* Write-off picker inline when this variety is selected */}
                        {writeOffVariety?.key === group.key && (
                          <div className="px-4 pb-3">
                            <WriteOffBatchPicker
                              variety={group}
                              reasons={writeOffReasons}
                              t={{ ...t, writeOffQty: t.writeOffPickerQty }}
                              onConfirm={handleWriteOffY}
                              onCancel={() => setWriteOffVariety(null)}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
              )}
            </>
          )
        ) : (
          /* ── Legacy flat list ── */
          filteredStock.length === 0 ? (
            <p className="text-ios-tertiary text-sm text-center py-12">{t.noStockFound || 'No items found'}</p>
          ) : (
            <div className="ios-card overflow-hidden divide-y divide-ios-separator/40">
              {filteredStock.map(item => (
                <StockItem
                  key={item.id}
                  item={item}
                  editMode={editMode}
                  onAdjust={delta => handleAdjust(item.id, delta)}
                  onWriteOff={(qty, reason) => handleWriteOff(item.id, qty, reason)}
                  onPatch={fields => handlePatch(item.id, fields)}
                  onPatchPrice={fields => handlePatchPrice(item.id, fields)}
                  committedData={committedMap[item.id]}
                  premadeData={premadeMap[item.id]}
                  role={role}
                />
              ))}
            </div>
          )
        )}

        {/* Summary bar — legacy path only */}
        {!loading && !yEnabled && filteredStock.length > 0 && (
          <div className="mt-3 flex items-center justify-between px-2 text-xs text-ios-tertiary">
            <span>{filteredStock.length} {t.stems}</span>
            <span>
              {filteredStock.reduce((s, i) => s + (Number(i['Current Quantity']) || 0), 0)} {t.stems} {t.sortByQty?.toLowerCase()}
            </span>
          </div>
        )}

        {/* Owner-only edit mode toggle — legacy path only */}
        {role === 'owner' && !loading && !yEnabled && (
          <button
            onClick={() => setEditMode(!editMode)}
            className={`w-full mt-4 h-11 rounded-2xl text-sm font-semibold transition-colors ${
              editMode
                ? 'bg-brand-600 text-white active:bg-brand-700'
                : 'bg-ios-fill2 text-ios-secondary active:bg-ios-separator'
            }`}
          >
            {editMode ? `✓ ${t.doneEditing}` : `✎ ${t.editStock}`}
          </button>
        )}
      </main>

      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}

      {/* ── Y-model: Batch trace modal ── */}
      {yEnabled && traceStockId && (
        <BatchTraceModal
          trail={traceLoading ? [] : (traceTrail || [])}
          t={t}
          onClose={() => { setTraceStockId(null); setTraceTrail(null); }}
        />
      )}

      {/* ── Y-model: Variety trace modal — mirrors BatchTraceModal UX ── */}
      {yEnabled && varietyTraceKey && (
        <div
          data-testid="variety-trace-modal-backdrop"
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => { setVarietyTraceKey(null); setVarietyTrail([]); setVarietyUnaccounted(0); }}
        >
          <div
            data-testid="variety-trace-modal-content"
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 pt-4 pb-2 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-800">{t.varietyTraceTitle ?? 'Variety history'}</h2>
            </div>
            <div className="px-4 py-3">
              {varietyTraceLoading ? (
                <p className="text-xs text-ios-tertiary">{t.loading}</p>
              ) : (
                <VarietyTracePanel events={varietyTrail} unaccountedStems={varietyUnaccounted} t={t} />
              )}
            </div>
            <div className="px-4 pb-4 pt-1 border-t border-gray-50">
              <button
                type="button"
                onClick={() => { setVarietyTraceKey(null); setVarietyTrail([]); setVarietyUnaccounted(0); }}
                className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
              >
                {t.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Compact operations tile used in the owner's 2×2 grid at the top of the
// Stock page. Icon over label, 80 px tall, rounded-2xl. The "muted" variant
// uses the red palette for destructive-ish actions (Waste Log) so it reads
// as the "exception" tile in the grid.
function OpsTile({ Icon, label, onClick, variant = 'default' }) {
  const palette = variant === 'muted'
    ? 'bg-red-50 dark:bg-red-900/20 text-ios-red'
    : 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-20 rounded-2xl flex flex-col items-center justify-center gap-1
                  active-scale ${palette}`}
    >
      <Icon size={22} />
      <span className="text-[12px] font-semibold text-center px-2 leading-tight line-clamp-2">
        {label}
      </span>
    </button>
  );
}
