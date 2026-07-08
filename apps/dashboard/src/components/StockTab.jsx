// StockTab — inventory management table for the owner.
// Like a warehouse management screen: see every item, adjust quantities,
// receive deliveries, track waste. All fields inline-editable.

import { useState, useEffect, useCallback, useMemo } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import {
  renderDateTag, parseBatchName, LOSS_REASONS, reasonLabel,
  formatDateDMY,
  TypeGroupHeader,
  VarietyListItem,
  ShortfallSummary,
  PendingArrivalsPanel,
  BatchArrivalList,
  BatchTracePanel,
  VarietyTracePanel,
  OrderQuickViewModal,
  WriteOffBatchPicker,
  buildPoSuggestions,
  varietyGroupMatchesView,
  varietyGroupHasVisibleStock,
  getVarietyTotals,
  EMPTY_STOCK_FILTER,
  clearStockFilter,
  activeStockFilterCount,
} from '@flower-studio/shared';
import StockReceiveForm from './StockReceiveForm.jsx';
import StockOrderPanel from './StockOrderPanel.jsx';
import ReconciliationSection from './ReconciliationSection.jsx';
import DatePicker from './DatePicker.jsx';
import { SkeletonTable } from './Skeleton.jsx';

export default function StockTab({ initialFilter, onNavigate, isActive = true }) {
  const [stock, setStock]           = useState([]);
  const [groups, setGroups]         = useState([]); // Y-model: array from /stock?grouped=true
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [showReceive, setShowReceive] = useState(false);
  const [showPurchaseOrders, setShowPurchaseOrders] = useState(initialFilter?.action === 'createPO');
  const [showReconcile, setShowReconcile] = useState(false);
  const [view, setView]             = useState('all'); // 'all' | 'waste' | 'slow' | 'negative'
  const [hideZero, setHideZero]     = useState(true);
  // E1: per-column filter for the Flat table (client-side over the loaded set).
  const [stockFilter, setStockFilter] = useState(EMPTY_STOCK_FILTER);
  const stockFilterCount = activeStockFilterCount(stockFilter);
  // Y-model UI state
  const [expandedKey, setExpandedKey]       = useState(null);   // which Variety row is expanded
  const [collapsedTypes, setCollapsedTypes] = useState(new Set()); // collapsed Type group keys
  const [viewMode, setViewMode] = useState(
    () => localStorage.getItem('blossom-stock-view') || 'batch',
  );
  function setStockViewMode(v) {
    setViewMode(v);
    localStorage.setItem('blossom-stock-view', v);
  }
  const [traceStockId, setTraceStockId]     = useState(null);   // inline trace: stock item id
  const [traceTrail, setTraceTrail]         = useState(null);
  const [traceLoading, setTraceLoading]     = useState(false);
  // Variety-level trace (inline, independent of per-Batch trace above)
  // Round-2: order rows/markers in a trace open a read-only popup OVER the
  // trace instead of switching to the Orders tab (owner keeps her place).
  const [quickViewOrderId, setQuickViewOrderId]         = useState(null);
  const [varietyTraceKey, setVarietyTraceKey]           = useState(null);
  const [varietyTrail, setVarietyTrail]                 = useState([]);
  const [varietyUnaccounted, setVarietyUnaccounted]     = useState(0);
  const [varietyDrift, setVarietyDrift]                 = useState(0);
  const [varietyOpening, setVarietyOpening]             = useState(0);
  const [varietyTraceLoading, setVarietyTraceLoading]   = useState(false);
  const [writeOffVariety, setWriteOffVariety] = useState(null); // write-off picker (modal)
  const [wastePeriod, setWastePeriod] = useState('month'); // 'today' | 'month' | '30d' | '90d' | 'custom'
  const [wasteCustomFrom, setWasteCustomFrom] = useState('');
  const [wasteCustomTo, setWasteCustomTo] = useState('');
  const [wasteSupplier, setWasteSupplier] = useState('all'); // 'all' | <supplier name> — combines with the time filter
  const [wasteEditId, setWasteEditId] = useState(null);
  const [wasteEditForm, setWasteEditForm] = useState({ quantity: '', reason: '' });
  const [wasteDeleteId, setWasteDeleteId] = useState(null);
  const [pendingPO, setPendingPO] = useState({});
  // Premade-bouquet reservations per stock item:
  // { stockId: { qty, bouquets: [{ bouquetId, name, qty }] } }
  const [premadeMap, setPremadeMap] = useState({});
  const { showToast } = useToast();

  const fetchStock = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Fetch grouped stock (the Variety browse view) + a flat list + premade
      // reservations + pending POs in parallel. The flat `stock` list feeds
      // StockReceiveForm's item picker / supplier list and StockOrderPanel's
      // Type/Colour/Cultivar/Farmer datalists — those take a flat array, not
      // Variety groups. (Before the Y-model cutover this flat fetch lived in
      // the flag-off branch, so under Y-model those pickers were empty; mirrors
      // florist StockPanelPage.) pendingPO feeds the PendingArrivalsPanel.
      const [groupedRes, flatRes, premadeRes, pendingPoRes] = await Promise.all([
        client.get('/stock?grouped=true'),
        client.get('/stock?includeEmpty=true'),
        client.get('/stock/premade-committed').catch(() => ({ data: {} })),
        client.get('/stock/pending-po').catch(() => ({ data: {} })),
      ]);
      setGroups(groupedRes.data.groups || []);
      setStock(flatRes.data || []);
      setPremadeMap(premadeRes.data || {});
      setPendingPO(pendingPoRes.data || {});
    } catch {
      if (!silent) showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!isActive) return undefined;
    fetchStock(false);
    const interval = setInterval(() => { if (!document.hidden) fetchStock(true); }, 120000);
    function onVisible() { if (!document.hidden) fetchStock(true); }
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [fetchStock, isActive]);

  const [lossLog, setLossLog] = useState([]);

  function wasteDateRange(period, customFrom, customTo) {
    const now = new Date();
    const to = now.toISOString().split('T')[0];
    if (period === 'today') return { from: to, to };
    if (period === 'custom') {
      // Caller guarantees both ends are set before fetching; fall back to today
      // so an in-progress selection never queries an open-ended range.
      return { from: customFrom || to, to: customTo || to };
    }
    let from;
    if (period === 'month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    } else if (period === '30d') {
      from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    } else {
      from = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    }
    return { from, to };
  }

  function fetchLossLog(period, customFrom, customTo) {
    const p = period || wastePeriod;
    const cf = customFrom ?? wasteCustomFrom;
    const ct = customTo ?? wasteCustomTo;
    // Custom range needs both ends chosen — otherwise wait for the user.
    if (p === 'custom' && (!cf || !ct)) return;
    const { from, to } = wasteDateRange(p, cf, ct);
    client.get(`/stock-loss?from=${from}&to=${to}`).then(r => setLossLog(r.data)).catch(() => {});
  }

  // Refetch whenever the period (or the custom range, while custom is active) changes.
  // Fires on mount with the default period, so no separate initial-load effect is needed.
  useEffect(() => { fetchLossLog(wastePeriod, wasteCustomFrom, wasteCustomTo); }, [wastePeriod, wasteCustomFrom, wasteCustomTo]);

  // Supplier dropdown options — suppliers present in the loaded period, plus the
  // current selection (so it stays valid even if a period change drops its rows).
  const wasteSupplierOptions = useMemo(() => {
    const set = new Set(lossLog.map(e => e.supplier || '—'));
    if (wasteSupplier !== 'all') set.add(wasteSupplier);
    return [...set].sort();
  }, [lossLog, wasteSupplier]);

  async function handleWasteEdit(id) {
    try {
      await client.patch(`/stock-loss/${id}`, {
        quantity: Number(wasteEditForm.quantity),
        reason: wasteEditForm.reason,
      });
      setWasteEditId(null);
      showToast(t.entryUpdated, 'success');
      fetchLossLog();
      fetchStock();
    } catch (err) { showToast(err.response?.data?.error || t.error, 'error'); }
  }

  async function handleWasteDelete(id) {
    try {
      await client.delete(`/stock-loss/${id}`);
      setWasteDeleteId(null);
      showToast(t.entryDeleted, 'success');
      fetchLossLog();
      fetchStock();
    } catch (err) { showToast(err.response?.data?.error || t.error, 'error'); }
  }

  // Y-model quick-adjust: qty lives on the per-Batch row inside `groups`, not the
  // legacy flat `stock` array. Optimistically bump the matching row's
  // current_quantity, POST the delta, revert on failure.
  async function adjustGroupQty(id, delta) {
    const bump = (rows, d) =>
      (rows || []).map(r =>
        r.id === id ? { ...r, current_quantity: (Number(r.current_quantity) || 0) + d } : r
      );
    setGroups(prev => prev.map(g => ({ ...g, rows: bump(g.rows, delta) })));
    try {
      await client.post(`/stock/${id}/adjust`, { delta });
    } catch {
      setGroups(prev => prev.map(g => ({ ...g, rows: bump(g.rows, -delta) })));
      showToast(t.error, 'error');
    }
  }

  // Bulk price patch — re-prices every underlying stock_id of a merged Y-model
  // Stock row in one tap. `fields` keys: `cost` and/or `sell` (raw numbers).
  async function patchPriceBulk(stockIds, fields) {
    const body = {};
    if (fields.cost != null) body['Current Cost Price'] = Number(fields.cost);
    if (fields.sell != null) body['Current Sell Price'] = Number(fields.sell);
    // E2b: reorder threshold + lot size (already the API field names).
    if (fields['Reorder Threshold'] != null) body['Reorder Threshold'] = Number(fields['Reorder Threshold']);
    if (fields['Lot Size'] != null) body['Lot Size'] = Number(fields['Lot Size']);
    if (Object.keys(body).length === 0) return;
    try {
      await Promise.all(stockIds.map(id => client.patch(`/stock/${id}`, body)));
      showToast(`${t.stockUpdated} (${stockIds.length})`);
      fetchStock();
    } catch {
      showToast(t.error, 'error');
    }
  }

  // The old "Needed for Orders" panel has been removed. It was built on a
  // brittle assumption (all order lines reserve future demand not reflected in
  // stock) that produced double-counts whenever stock was already deducted at
  // creation. Now that we surface premade reservations directly on each stock
  // row and allow on-demand dissolving during bouquet save, the shortfall
  // panel added more noise than signal. Real shortages still surface via
  // negative Current Quantity on the stock row itself.

  // ── Y-model: derived Maps from premadeMap ──
  const { premadesByStockId, reservations: reservationsMap } = useMemo(() => {
    const premadesByStockId = new Map();
    const reservations = new Map();
    for (const [stockId, data] of Object.entries(premadeMap)) {
      const qty = Number(data?.qty) || 0;
      if (qty > 0) {
        reservations.set(stockId, qty);
        premadesByStockId.set(stockId, data?.bouquets || []);
      }
    }
    return { premadesByStockId, reservations };
  }, [premadeMap]);

  // ── Y-model: group groups by type_name ──
  const typeGroups = useMemo(() => {
    const map = new Map();
    for (const group of groups) {
      const key = group.type_name || '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(group);
    }
    return map;
  }, [groups]);

  // ── Y-model: filter groups by search + hideZero ──
  const filteredGroups = useMemo(() => {
    let list = groups;
    const q = (search || '').trim().toLowerCase();
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
    // View pills (Negative / Slow) filter by per-Variety net — the same number
    // the row badge shows. hideZero only applies in the 'all' view (the legacy
    // flat list does the same), so a short variety with no on-hand stems still
    // surfaces under Negative. 'waste' renders its own panel above, not groups.
    if (view !== 'all' && view !== 'waste') {
      list = list.filter(g => varietyGroupMatchesView(g, view, reservationsMap));
    } else if (hideZero && view === 'all') {
      list = list.filter(g => varietyGroupHasVisibleStock(g, reservationsMap));
    }
    return list;
  }, [groups, hideZero, view, reservationsMap, search]);

  // D3 round-2: reserve the Planned column only when some visible Variety has
  // pending order demand; otherwise collapse it so In-premade sits next to
  // On-hand (kills the empty-column gap). Mirrors the florist StockPanelPage.
  const anyPlanned = useMemo(
    () => filteredGroups.some(g => getVarietyTotals(g.rows, reservationsMap).planned > 0),
    [filteredGroups, reservationsMap],
  );

  // ── Y-model: batch trace fetch triggered by traceStockId ──
  // traceStockId can be a single id or comma-separated list (merged batch in
  // By Batch view) — union trails for all underlying stock_ids.
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
  // pre-sorted oldest → newest by WriteOffBatchPicker.
  async function handleWriteOffY({ stockIds, stockId, qty, reason }) {
    const ids = Array.isArray(stockIds) && stockIds.length ? stockIds : (stockId ? [stockId] : []);
    if (!ids.length) return;
    try {
      let remaining = qty;
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
    } catch (err) { showToast(err.response?.data?.error || t.error, 'error'); }
  }

  // ── Y-model: build reason options for WriteOffBatchPicker ──
  const writeOffReasons = useMemo(() =>
    LOSS_REASONS.map(r => ({ value: r, label: reasonLabel(t, r) })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="glass-card px-4 py-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t.search + '...'}
          className="field-input w-48"
        />

        {/* View toggles */}
        <div className="flex gap-1">
          {[
            { key: 'all',      label: t.allStatuses },
            { key: 'negative', label: t.negativeFilter || 'Negative' },
            { key: 'waste',    label: t.wasteLog },
            { key: 'slow',     label: t.slowMovers },
          ].map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                view === v.key
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 text-ios-secondary hover:bg-gray-200'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setHideZero(!hideZero)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            hideZero
              ? 'bg-brand-100 text-brand-700 ring-1 ring-brand-200'
              : 'bg-gray-200 text-ios-label'
          }`}
        >
          {hideZero ? (t.inStockOnly || 'In stock') : (t.showAll || 'All stock')}
        </button>

        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setShowPurchaseOrders(!showPurchaseOrders)}
            className="px-3 py-1.5 rounded-xl bg-blue-100 text-blue-700 text-xs font-semibold"
          >
            {t.stockOrders || 'Purchase Orders'}
          </button>
          <button
            onClick={() => setShowReconcile(!showReconcile)}
            className="px-3 py-1.5 rounded-xl bg-amber-100 text-amber-700 text-xs font-semibold"
          >
            {t.reconcile}
          </button>
          <button
            onClick={() => setShowReceive(!showReceive)}
            className="px-3 py-1.5 rounded-xl bg-ios-green/15 text-ios-green text-xs font-semibold"
          >
            {t.receiveStock}
          </button>
        </div>
      </div>

      {/* Reconciliation panel */}
      {showReconcile && (
        <ReconciliationSection onClose={() => { setShowReconcile(false); fetchStock(); }} />
      )}

      {/* Receive stock form */}
      {showReceive && (
        <StockReceiveForm
          stock={stock}
          onDone={() => { setShowReceive(false); fetchStock(); }}
        />
      )}

      {/* Purchase Orders panel */}
      {showPurchaseOrders && (
        <StockOrderPanel
          negativeStock={stock.filter(s => (s['Current Quantity'] || 0) < 0).map(s => ({
            id: s.id,
            name: s['Display Name'],
            qty: s['Current Quantity'],
            supplier: s.Supplier,
          }))}
          // Netted per-Variety shortfall suggestions (the negativeStock list
          // above is empty since `stock` is never populated — grouped fetch instead).
          poSuggestions={buildPoSuggestions(groups, pendingPO, premadeMap)}
          stock={stock}
          autoCreate={initialFilter?.action === 'createPO'}
          onClose={() => setShowPurchaseOrders(false)}
        />
      )}

      {/* Restock cost estimate — how much cash needed for the next restock */}
      {!loading && (() => {
        const restockCost = stock.reduce((sum, item) => {
          const qty = item['Current Quantity'] || 0;
          const threshold = item['Reorder Threshold'] || 0;
          const cost = item['Current Cost Price'] || 0;
          if (qty < threshold && cost > 0) {
            return sum + (threshold - qty) * cost;
          }
          return sum;
        }, 0);
        if (restockCost <= 0) return null;
        return (
          <div className="glass-card px-4 py-3 flex items-center gap-3">
            <span className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">
              {t.restockEstimate}
            </span>
            <span className="text-lg font-bold text-ios-red">
              {restockCost.toFixed(0)} {t.zl}
            </span>
          </div>
        );
      })()}

      {/* Planned + Needed + Available sections rendered in unified table below */}

      {loading && <SkeletonTable rows={10} cols={5} />}

      {/* ── Waste view: period filter + dedicated write-off log ── */}
      {view === 'waste' && (
        <div className="glass-card px-4 py-2 flex flex-wrap items-center gap-2">
          {[
            { key: 'today',  label: t.today || 'Today' },
            { key: 'month',  label: t.thisMonth || 'This month' },
            { key: '30d',    label: t.last30d || 'Last 30 days' },
            { key: '90d',    label: t.last90d || 'Last 3 months' },
            { key: 'custom', label: t.customRange || 'Custom range' },
          ].map(p => (
            <button key={p.key} onClick={() => setWastePeriod(p.key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                wastePeriod === p.key ? 'bg-brand-600 text-white' : 'bg-gray-100 text-ios-secondary hover:bg-gray-200'
              }`}>{p.label}</button>
          ))}
          {wastePeriod === 'custom' && (
            <div className="flex items-center gap-2 ml-1">
              <DatePicker value={wasteCustomFrom} onChange={setWasteCustomFrom} placeholder={t.dateFrom || 'From'} />
              <span className="text-xs text-ios-tertiary">→</span>
              <DatePicker value={wasteCustomTo} onChange={setWasteCustomTo} placeholder={t.dateTo || 'To'} />
            </div>
          )}
          {/* Supplier filter — combines with the time filter above */}
          <select
            value={wasteSupplier}
            onChange={e => setWasteSupplier(e.target.value)}
            className="ml-auto text-xs px-2.5 py-1 rounded-full border border-gray-200 bg-gray-100 text-ios-secondary focus:outline-none focus:ring-1 focus:ring-brand-400"
          >
            <option value="all">{t.supplierAll || 'All suppliers'}</option>
            {wasteSupplierOptions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}
      {view === 'waste' && !loading && (() => {
        // Filter by search (flower name or supplier) + supplier dropdown (combines
        // with the time filter), then sort newest-first by date. No supplier grouping —
        // owner wants one flat list ordered by date desc.
        const filteredLog = lossLog.filter(e => {
          if (wasteSupplier !== 'all' && (e.supplier || '—') !== wasteSupplier) return false;
          if (search) {
            const q = search.toLowerCase();
            if (!(e.flowerName || '').toLowerCase().includes(q)
                && !(e.supplier || '').toLowerCase().includes(q)) return false;
          }
          return true;
        });
        const sortedLog = [...filteredLog].sort((a, b) => (b.Date || '').localeCompare(a.Date || ''));

        let totalLost = 0;
        let totalCostLost = 0;
        for (const e of sortedLog) {
          totalLost += e.Quantity || 0;
          totalCostLost += (e.Quantity || 0) * (e.costPrice || 0);
        }

        // Render a waste table row with batch tag + edit/delete
        function WasteRow({ e }) {
          const { name: baseName, batch } = parseBatchName(e.flowerName || '');
          // If no batch in the name, use the stock item's Last Restocked date as fallback tag
          const batchTag = batch
            ? <span className="inline-flex items-center text-[10px] font-medium border px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 border-gray-200">{batch}</span>
            : (e.lastRestocked ? renderDateTag(null, e.lastRestocked) : null);
          const isEditing = wasteEditId === e.id;

          if (isEditing) {
            return (
              <tr key={e.id} className="border-b border-gray-50 bg-blue-50/50">
                <td className="px-3 py-1.5 text-xs text-ios-tertiary">{formatDateDMY(e.Date)}</td>
                <td className="px-3 py-1.5 text-xs font-medium text-ios-label">{baseName}</td>
                <td className="px-3 py-1.5 text-xs">{batchTag}</td>
                <td className="px-3 py-1.5 text-xs text-ios-secondary">{e.supplier || '—'}</td>
                <td className="px-3 py-1.5 text-xs text-right">
                  <input type="number" min="1" value={wasteEditForm.quantity}
                    onChange={ev => setWasteEditForm(f => ({ ...f, quantity: ev.target.value }))}
                    className="w-14 text-xs px-1 py-0.5 border rounded text-right" />
                </td>
                <td className="px-3 py-1.5 text-xs">
                  <select value={wasteEditForm.reason}
                    onChange={ev => setWasteEditForm(f => ({ ...f, reason: ev.target.value }))}
                    className="text-xs px-1 py-0.5 border rounded">
                    {LOSS_REASONS.map(r => <option key={r} value={r}>{reasonLabel(t, r)}</option>)}
                  </select>
                </td>
                <td className="px-3 py-1.5 text-xs text-right whitespace-nowrap">
                  <button onClick={() => handleWasteEdit(e.id)} className="text-green-600 hover:underline mr-1">✓</button>
                  <button onClick={() => setWasteEditId(null)} className="text-gray-400 hover:underline">✕</button>
                </td>
              </tr>
            );
          }

          return (
            <tr key={e.id} className="border-b border-gray-50 group">
              <td className="px-3 py-1.5 text-xs text-ios-tertiary">{formatDateDMY(e.Date)}</td>
              <td className="px-3 py-1.5 text-xs font-medium text-ios-label">{baseName}</td>
              <td className="px-3 py-1.5 text-xs">{batchTag}</td>
              <td className="px-3 py-1.5 text-xs text-ios-secondary">{e.supplier || '—'}</td>
              <td className="px-3 py-1.5 text-xs text-right">{e.Quantity}</td>
              <td className="px-3 py-1.5 text-xs">
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                  e.Reason === 'Wilted' ? 'bg-yellow-100 text-yellow-800' :
                  e.Reason === 'Damaged' ? 'bg-red-100 text-red-700' :
                  e.Reason === 'Arrived Broken' ? 'bg-orange-100 text-orange-700' :
                  e.Reason === 'Overstock' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-600'
                }`}>{e.Reason}</span>
              </td>
              <td className="px-3 py-1.5 text-xs text-right text-ios-tertiary whitespace-nowrap">
                {e['Days Survived'] != null ? e['Days Survived'] : '—'}
                <span className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setWasteEditId(e.id); setWasteEditForm({ quantity: String(e.Quantity || ''), reason: e.Reason || '' }); }}
                    className="text-blue-500 hover:underline mr-1 text-[10px]">{t.editEntry || '✎'}</button>
                  <button onClick={() => setWasteDeleteId(e.id)}
                    className="text-red-400 hover:underline text-[10px]">{t.deleteEntry || '✕'}</button>
                </span>
              </td>
            </tr>
          );
        }

        return (
          <>
            {/* Delete confirmation modal */}
            {wasteDeleteId && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setWasteDeleteId(null)}>
                <div className="bg-white rounded-2xl p-5 shadow-xl max-w-xs" onClick={ev => ev.stopPropagation()}>
                  <p className="text-sm mb-3">{t.confirmDeleteWaste}</p>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setWasteDeleteId(null)} className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50">{t.cancel}</button>
                    <button onClick={() => handleWasteDelete(wasteDeleteId)} className="text-sm px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600">{t.deleteEntry}</button>
                  </div>
                </div>
              </div>
            )}
            {/* Summary bar */}
            {sortedLog.length > 0 && (
              <div className="glass-card px-4 py-3 flex flex-wrap gap-6">
                <div>
                  <span className="text-xs text-ios-tertiary">{t.totalLost || 'Total lost'}</span>
                  <p className="text-lg font-bold text-ios-red">{totalLost} {t.stems}</p>
                </div>
                <div>
                  <span className="text-xs text-ios-tertiary">{t.revenueLost || 'Revenue lost'}</span>
                  <p className="text-lg font-bold text-ios-red">{totalCostLost.toFixed(0)} {t.zl}</p>
                </div>
              </div>
            )}

            {/* Flat list — newest write-offs on top, no supplier grouping */}
            {sortedLog.length > 0 && (
              <div className="glass-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-ios-tertiary border-b border-gray-100 bg-gray-50/60">
                      <th className="text-left px-3 py-2 font-medium">{t.date}</th>
                      <th className="text-left px-3 py-2 font-medium">{t.stockName}</th>
                      <th className="text-left px-3 py-2 font-medium">{t.receivedDate || 'Batch'}</th>
                      <th className="text-left px-3 py-2 font-medium">{t.supplier}</th>
                      <th className="text-right px-3 py-2 font-medium">{t.quantity}</th>
                      <th className="text-left px-3 py-2 font-medium">{t.reason}</th>
                      <th className="text-right px-3 py-2 font-medium">{t.daysSurvived}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLog.map(e => <WasteRow key={e.id} e={e} />)}
                  </tbody>
                </table>
              </div>
            )}

            {sortedLog.length === 0 && (
              <p className="text-center text-sm text-ios-tertiary py-8">{t.noData}</p>
            )}
          </>
        );
      })()}

      {/* ── Type→Variety grouped list ── */}
      {view !== 'waste' && !loading && (
        <div className="space-y-0">
          {filteredGroups.length === 0 ? (
            <p className="text-center text-sm text-ios-tertiary py-12">{t.noStockFound || 'No items found'}</p>
          ) : (
            <>
            <ShortfallSummary
              groups={filteredGroups}
              reservations={reservationsMap}
              pendingPO={pendingPO}
              t={t}
              onVarietyClick={(key) => setExpandedKey(k => k === key ? null : key)}
              fetchVarietyUsage={async (key) => {
                const res = await client.get(`/stock/varieties/${encodeURIComponent(key)}/usage`);
                return res.data; // { variety, events, unaccountedStems }
              }}
              splitType
              onPatchPriceBulk={patchPriceBulk}
              onOrderClick={(recordId) => setQuickViewOrderId(recordId)}
            />
            <PendingArrivalsPanel
              pendingPO={pendingPO}
              stock={(groups || []).flatMap(g => (g.rows || []).map(r => ({
                ...r,
                Type: g.type_name, Colour: g.colour, Size: g.size_cm, Cultivar: g.cultivar,
              })))}
              t={t}
              splitType
              onPatchPriceBulk={patchPriceBulk}
              fetchVarietyUsage={async (key) => {
                const res = await client.get(`/stock/varieties/${encodeURIComponent(key)}/usage`);
                return res.data; // { variety, events, unaccountedStems }
              }}
              onOrderClick={(recordId) => setQuickViewOrderId(recordId)}
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
              <div className="glass-card overflow-hidden">
                {/* E1: active-filter summary + one-click reset (the column
                    popovers live in the table header below). */}
                {stockFilterCount > 0 && (
                  <div data-testid="stock-filter-bar" className="flex items-center justify-between px-4 py-2 bg-brand-50 border-b border-brand-100 text-xs">
                    <span className="text-brand-700 font-medium">{(t.filtersActive ?? 'Filters')} ({stockFilterCount})</span>
                    <button
                      type="button"
                      data-testid="stock-filter-reset"
                      onClick={() => setStockFilter(clearStockFilter())}
                      className="text-brand-600 hover:text-brand-800 font-medium"
                    >
                      {t.resetFilters ?? 'Reset'}
                    </button>
                  </div>
                )}
                <BatchArrivalList
                  groups={filteredGroups}
                  reservations={reservationsMap}
                  t={t}
                  filter={stockFilter}
                  onFilterChange={setStockFilter}
                  footer
                  // "In stock" filter (A): also drop 0-qty tiers within a
                  // surviving Variety, not just whole empty Varieties.
                  hideEmpty={hideZero && view === 'all'}
                  onRowClick={(stockIds) => {
                    const joined = stockIds.join(',');
                    setTraceStockId(prev => prev === joined ? null : joined);
                  }}
                  onPatchPriceBulk={patchPriceBulk}
                  traceStockIds={traceStockId}
                  traceNode={traceStockId ? (
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                          {t.batchTraceTitle}
                        </span>
                        <button
                          onClick={() => { setTraceStockId(null); setTraceTrail(null); }}
                          className="text-xs text-blue-400 hover:text-blue-600"
                        >
                          ✕
                        </button>
                      </div>
                      {traceLoading ? (
                        <p className="text-xs text-ios-tertiary">{t.loading}</p>
                      ) : (
                        <BatchTracePanel trail={traceTrail || []} t={t} onOrderClick={(recordId) => setQuickViewOrderId(recordId)} />
                      )}
                    </div>
                  ) : null}
                />
              </div>
            ) : (
            <div className="glass-card overflow-hidden">
              {Array.from(typeGroups.entries()).map(([typeName, typeRows]) => {
                // filteredGroups already encodes search + hide-zero + the view pill.
                const visibleRows = typeRows.filter(g => filteredGroups.includes(g));
                if (visibleRows.length === 0) return null;
                const isCollapsed = collapsedTypes.has(typeName);
                const totalQty = typeRows.reduce((sum, g) =>
                  sum + (g.rows || []).reduce((s, r) => s + (Number(r.current_quantity) || 0), 0), 0);
                return (
                  <div key={typeName}>
                    <TypeGroupHeader
                      typeName={typeName}
                      totalQty={totalQty}
                      varietyCount={typeRows.length}
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
                          pendingPO={pendingPO}
                          hideType={false}
                          isOwner={true}
                          showPlanned={anyPlanned}
                          onEditField={patchPriceBulk}
                          expanded={expandedKey === group.key}
                          onToggle={() => setExpandedKey(k => k === group.key ? null : group.key)}
                          onRowClick={(stockId) => setTraceStockId(prev => prev === stockId ? null : stockId)}
                          onVarietyTrace={async (key) => {
                            if (varietyTraceKey === key) {
                              // Toggle off
                              setVarietyTraceKey(null);
                              setVarietyTrail([]);
                              setVarietyUnaccounted(0);
                              setVarietyDrift(0);
                              return;
                            }
                            setVarietyTraceKey(key);
                            setVarietyTrail([]);
                            setVarietyUnaccounted(0);
                            setVarietyDrift(0);
                            setVarietyTraceLoading(true);
                            try {
                              const res = await client.get(`/stock/varieties/${encodeURIComponent(key)}/usage`);
                              setVarietyTrail(res.data.events || []);
                              setVarietyUnaccounted(res.data.unaccountedStems ?? 0);
                              setVarietyDrift(res.data.drift ?? 0);
                              setVarietyOpening(res.data.openingBalance ?? 0);
                            } catch {
                              setVarietyTrail([]);
                            } finally {
                              setVarietyTraceLoading(false);
                            }
                          }}
                          onWriteOff={(v) => setWriteOffVariety(v)}
                          onAdjust={adjustGroupQty}
                          premadesByStockId={premadesByStockId}
                          t={t}
                        />
                        {/* Inline VarietyTracePanel — renders below the Variety row when active. */}
                        {varietyTraceKey === group.key && (
                          <div className="px-4 py-3 bg-indigo-50/60 border-t border-indigo-100">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
                                {t.varietyTraceTitle ?? 'Variety history'}
                              </span>
                              <button
                                onClick={() => { setVarietyTraceKey(null); setVarietyTrail([]); setVarietyUnaccounted(0); setVarietyDrift(0); }}
                                className="text-xs text-indigo-400 hover:text-indigo-600"
                              >
                                ✕
                              </button>
                            </div>
                            {varietyTraceLoading ? (
                              <p className="text-xs text-ios-tertiary">{t.loading}</p>
                            ) : (
                              <VarietyTracePanel events={varietyTrail} unaccountedStems={varietyUnaccounted} drift={varietyDrift} openingBalance={varietyOpening} t={t} onOrderClick={(recordId) => setQuickViewOrderId(recordId)} />
                            )}
                          </div>
                        )}
                        {/* Inline BatchTracePanel — renders below the Variety row when active.
                            Dashboard UX: inline (not modal), per Q5b spec. */}
                        {traceStockId && (group.rows || []).some(r => r.id === traceStockId) && (
                          <div className="px-4 py-3 bg-blue-50/60 border-t border-blue-100">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                                {t.batchTraceTitle}
                              </span>
                              <button
                                onClick={() => { setTraceStockId(null); setTraceTrail(null); }}
                                className="text-xs text-blue-400 hover:text-blue-600"
                              >
                                ✕
                              </button>
                            </div>
                            {traceLoading ? (
                              <p className="text-xs text-ios-tertiary">{t.loading}</p>
                            ) : (
                              <BatchTracePanel trail={traceTrail || []} t={t} onOrderClick={(recordId) => setQuickViewOrderId(recordId)} />
                            )}
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
          )}
          {/* Write-off picker modal (small form — modal is fine per spec) */}
          {writeOffVariety && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
              onClick={() => setWriteOffVariety(null)}
            >
              <div
                className="bg-white rounded-2xl p-5 shadow-xl max-w-sm w-full mx-4"
                onClick={e => e.stopPropagation()}
              >
                <h3 className="text-sm font-semibold text-ios-label mb-3">{t.writeOffPickerTitle}</h3>
                <WriteOffBatchPicker
                  variety={writeOffVariety}
                  reasons={writeOffReasons}
                  t={{ ...t, writeOffQty: t.writeOffPickerQty }}
                  onConfirm={handleWriteOffY}
                  onCancel={() => setWriteOffVariety(null)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Order preview popup — opened from any trace order row/marker; sits
          above everything (z-60) so closing returns to the inline trace. */}
      <OrderQuickViewModal
        orderId={quickViewOrderId}
        apiClient={client}
        t={t}
        onClose={() => setQuickViewOrderId(null)}
        onOpenFull={(id) => { setQuickViewOrderId(null); onNavigate?.({ tab: 'orders', filter: { orderId: id } }); }}
      />
    </div>
  );
}
