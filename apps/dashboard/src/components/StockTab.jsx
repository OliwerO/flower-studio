// StockTab — inventory management table for the owner.
// Like a warehouse management screen: see every item, adjust quantities,
// receive deliveries, track waste. All fields inline-editable.

import { useState, useEffect, useCallback, useRef, Fragment, useMemo } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import { stockBaseName, renderDateTag, parseBatchName } from '@flower-studio/shared';
import StockReceiveForm from './StockReceiveForm.jsx';
import StockOrderPanel from './StockOrderPanel.jsx';
import ReconciliationSection from './ReconciliationSection.jsx';
import InlineEdit from './InlineEdit.jsx';
import { SkeletonTable } from './Skeleton.jsx';

function formatDateTag(dateStr, color = 'gray') {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const label = `${d.getDate()}.${months[d.getMonth()]}.`;
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-200',
    amber: 'bg-amber-50 text-amber-600 border-amber-200',
    gray: 'bg-gray-100 text-gray-500 border-gray-200',
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-medium border px-1.5 py-0.5 rounded-md ${colors[color] || colors.gray}`}>
      {label}
    </span>
  );
}

export default function StockTab({ initialFilter, onNavigate }) {
  const [stock, setStock]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [showReceive, setShowReceive] = useState(false);
  const [showPurchaseOrders, setShowPurchaseOrders] = useState(initialFilter?.action === 'createPO');
  const [showReconcile, setShowReconcile] = useState(false);
  const [view, setView]             = useState('all'); // 'all' | 'waste' | 'slow' | 'negative'
  const [hideZero, setHideZero]     = useState(true);
  // Per-row "Reconcile" button on premade chips. Gated on a backend setting
  // (Settings → Stock → Stock repair tools) so it syncs across devices and
  // stays hidden from the florist's daily flow by default. The setting is
  // fetched alongside the normal stock data below.
  const [showRepairTools, setShowRepairTools] = useState(false);
  const [wastePeriod, setWastePeriod] = useState('month'); // 'month' | '30d' | '90d'
  const [wasteGroupBy, setWasteGroupBy] = useState('supplier'); // 'supplier' | 'all'
  const [wasteSortBy, setWasteSortBy] = useState('date'); // 'date' | 'batch'
  const [wasteEditId, setWasteEditId] = useState(null);
  const [wasteEditForm, setWasteEditForm] = useState({ quantity: '', reason: '' });
  const [wasteDeleteId, setWasteDeleteId] = useState(null);
  const [pendingPO, setPendingPO] = useState({});
  const [committedMap, setCommittedMap] = useState({});
  // Premade-bouquet reservations per stock item:
  // { stockId: { qty, bouquets: [{ bouquetId, name, qty }] } }
  const [premadeMap, setPremadeMap] = useState({});
  const [plannedCollapsed, setPlannedCollapsed] = useState(false);
  const [expandedPlanned, setExpandedPlanned] = useState(null);
  const { showToast } = useToast();

  const stockLoaded = useRef(false);

  const fetchStock = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [stockRes, poRes, comRes, premadeRes, settingsRes] = await Promise.all([
        client.get('/stock?includeEmpty=true'),
        client.get('/stock/pending-po'),
        client.get('/stock/committed'),
        client.get('/stock/premade-committed').catch(() => ({ data: {} })),
        client.get('/settings').catch(() => ({ data: { config: {} } })),
      ]);
      setStock(prev => {
        if (!stockLoaded.current) return stockRes.data;
        // Merge: update existing items in place, preserve local UI state
        const newMap = new Map(stockRes.data.map(s => [s.id, s]));
        const merged = prev.map(s => newMap.get(s.id) || s).filter(s => newMap.has(s.id));
        for (const s of stockRes.data) {
          if (!merged.find(m => m.id === s.id)) merged.push(s);
        }
        return merged;
      });
      setPendingPO(poRes.data);
      setCommittedMap(comRes.data);
      setPremadeMap(premadeRes.data || {});
      setShowRepairTools(!!settingsRes.data?.config?.showStockRepairTools);
      stockLoaded.current = true;
    } catch {
      if (!silent) showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    stockLoaded.current = false;
    fetchStock();
    const interval = setInterval(() => { if (!document.hidden) fetchStock(true); }, 60000);
    function onVisible() { if (!document.hidden) fetchStock(true); }
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [fetchStock]);

  const [lossLog, setLossLog] = useState([]);

  function wasteDateRange(period) {
    const now = new Date();
    const to = now.toISOString().split('T')[0];
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

  function fetchLossLog(period) {
    const { from, to } = wasteDateRange(period || wastePeriod);
    client.get(`/stock-loss?from=${from}&to=${to}`).then(r => setLossLog(r.data)).catch(() => {});
  }

  useEffect(() => {
    fetchLossLog();
  }, []);

  useEffect(() => { fetchLossLog(wastePeriod); }, [wastePeriod]);

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

  async function adjustQty(id, delta) {
    // Optimistic update: change local state immediately, revert on failure
    setStock(prev => prev.map(item =>
      item.id === id
        ? { ...item, 'Current Quantity': (item['Current Quantity'] || 0) + delta }
        : item
    ));
    try {
      await client.post(`/stock/${id}/adjust`, { delta });
    } catch {
      // Revert the optimistic update
      setStock(prev => prev.map(item =>
        item.id === id
          ? { ...item, 'Current Quantity': (item['Current Quantity'] || 0) - delta }
          : item
      ));
      showToast(t.error, 'error');
    }
  }

  async function patchStock(id, fields) {
    try {
      await client.patch(`/stock/${id}`, fields);
      showToast(t.stockUpdated);
      fetchStock();
    } catch {
      showToast(t.error, 'error');
    }
  }

  async function writeOff(id, quantity, reason) {
    try {
      await client.post(`/stock/${id}/write-off`, { quantity, reason });
      showToast(t.stockWrittenOff);
      fetchStock();
      fetchLossLog();
    } catch {
      showToast(t.error, 'error');
    }
  }

  const [sortCol, setSortCol] = useState('name');
  const [sortAsc, setSortAsc] = useState(false);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(col === 'name'); }
  }

  // Client-side search
  let filtered = search
    ? stock.filter(s => (s['Display Name'] || '').toLowerCase().includes(search.toLowerCase())
        || (s.Supplier || '').toLowerCase().includes(search.toLowerCase())
        || (s.Farmer || '').toLowerCase().includes(search.toLowerCase()))
    : stock;

  // View filters (waste view uses lossLog instead of stock table)
  if (view === 'negative') {
    filtered = filtered.filter(s => (s['Current Quantity'] || 0) < 0);
  }
  if (view === 'slow') {
    const fourteenDaysAgo = Date.now() - 14 * 86400000;
    filtered = filtered.filter(s =>
      (s['Current Quantity'] || 0) > 0
      && s['Last Restocked']
      && new Date(s['Last Restocked']).getTime() < fourteenDaysAgo
    );
  }

  // Hide zero-stock items (default on)
  if (hideZero && view === 'all') {
    // Keep zero-qty rows when premade bouquets still hold stems of that
    // flower — the owner needs to see them to reconcile physical reality.
    // Without this, ~30 stems locked in premades can be invisible.
    filtered = filtered.filter(s => {
      const qty = Number(s['Current Quantity']) || 0;
      if (qty !== 0) return true;
      return (premadeMap[s.id]?.qty || 0) > 0;
    });
  }

  // Sort
  const sortFns = {
    name: (a, b) => (a['Display Name'] || '').localeCompare(b['Display Name'] || ''),
    qty: (a, b) => (a['Current Quantity'] || 0) - (b['Current Quantity'] || 0),
    cost: (a, b) => (a['Current Cost Price'] || 0) - (b['Current Cost Price'] || 0),
    sell: (a, b) => (a['Current Sell Price'] || 0) - (b['Current Sell Price'] || 0),
    supplier: (a, b) => (a.Supplier || '').localeCompare(b.Supplier || ''),
    lastRestocked: (a, b) => {
      const da = a['Last Restocked'] ? new Date(a['Last Restocked']).getTime() : 0;
      const db = b['Last Restocked'] ? new Date(b['Last Restocked']).getTime() : 0;
      return da - db;
    },
  };
  if (sortFns[sortCol]) {
    const fn = sortFns[sortCol];
    filtered = [...filtered].sort((a, b) => {
      // Always show negative stock on top regardless of sort column
      const aNeg = (a['Current Quantity'] || 0) < 0 ? 1 : 0;
      const bNeg = (b['Current Quantity'] || 0) < 0 ? 1 : 0;
      if (aNeg !== bNeg) return bNeg - aNeg;
      return sortAsc ? fn(a, b) : fn(b, a);
    });
  }

  // Planned rows — flowers arriving from pending POs, cross-referenced with committed orders
  const plannedRows = useMemo(() => {
    const nameMap = {};
    for (const s of stock) nameMap[s.id] = stockBaseName(s['Display Name']) || s['Purchase Name'] || '';
    let rows = Object.keys(pendingPO).map(stockId => {
      const po = pendingPO[stockId] || { ordered: 0, pos: [], flowerName: '' };
      const com = committedMap[stockId] || { committed: 0, orders: [] };
      // Only count "New" orders as committed — Ready orders already have flowers composed
      const newOrders = (com.orders || []).filter(o => o.status === 'New');
      const committedQty = newOrders.reduce((sum, o) => sum + (o.qty || 0), 0);
      const stockName = nameMap[stockId] || '';
      const poName = stockBaseName(po.flowerName) || '';
      return {
        stockId,
        name: (poName.length >= stockName.length ? poName : stockName) || '—',
        ordered: po.ordered,
        committed: committedQty,
        net: po.ordered - committedQty,
        pos: po.pos || [],
        orders: newOrders,
        plannedDate: po.plannedDate || null,
      };
    }).filter(r => r.ordered > 0).sort((a, b) => a.name.localeCompare(b.name));
    if (search) rows = rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
    return rows;
  }, [pendingPO, committedMap, stock, search]);

  // The old "Needed for Orders" panel has been removed. It was built on a
  // brittle assumption (all order lines reserve future demand not reflected in
  // stock) that produced double-counts whenever stock was already deducted at
  // creation. Now that we surface premade reservations directly on each stock
  // row and allow on-demand dissolving during bouquet save, the shortfall
  // panel added more noise than signal. Real shortages still surface via
  // negative Current Quantity on the stock row itself.

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
        <div className="glass-card px-4 py-2 flex items-center gap-2">
          {[
            { key: 'month', label: t.thisMonth || 'This month' },
            { key: '30d',   label: t.last30d || 'Last 30 days' },
            { key: '90d',   label: t.last90d || 'Last 3 months' },
          ].map(p => (
            <button key={p.key} onClick={() => setWastePeriod(p.key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                wastePeriod === p.key ? 'bg-brand-600 text-white' : 'bg-gray-100 text-ios-secondary hover:bg-gray-200'
              }`}>{p.label}</button>
          ))}
        </div>
      )}
      {view === 'waste' && !loading && (() => {
        // Filter by search
        let filteredLog = search
          ? lossLog.filter(e => (e.flowerName || '').toLowerCase().includes(search.toLowerCase())
              || (e.supplier || '').toLowerCase().includes(search.toLowerCase()))
          : lossLog;

        // Sort entries
        if (wasteSortBy === 'batch') {
          filteredLog = [...filteredLog].sort((a, b) => {
            const batchA = parseBatchName(a.flowerName || '').batch || '';
            const batchB = parseBatchName(b.flowerName || '').batch || '';
            return batchA.localeCompare(batchB) || (a.Date || '').localeCompare(b.Date || '');
          });
        } else {
          filteredLog = [...filteredLog].sort((a, b) => (b.Date || '').localeCompare(a.Date || ''));
        }

        let totalLost = 0;
        let totalCostLost = 0;
        for (const e of filteredLog) {
          totalLost += e.Quantity || 0;
          totalCostLost += (e.Quantity || 0) * (e.costPrice || 0);
        }

        // Get unique suppliers for filter
        const allSuppliers = [...new Set(filteredLog.map(e => e.supplier || '—'))].sort();

        // Group by supplier (when not in "all" mode)
        const bySupplier = {};
        for (const e of filteredLog) {
          const sup = e.supplier || '—';
          if (!bySupplier[sup]) bySupplier[sup] = { entries: [], totalQty: 0, totalCost: 0 };
          bySupplier[sup].entries.push(e);
          bySupplier[sup].totalQty += e.Quantity || 0;
          bySupplier[sup].totalCost += (e.Quantity || 0) * (e.costPrice || 0);
        }

        // Render a waste table row with batch tag + edit/delete
        function WasteRow({ e, showSupplier }) {
          const { name: baseName, batch } = parseBatchName(e.flowerName || '');
          // If no batch in the name, use the stock item's Last Restocked date as fallback tag
          const batchTag = batch
            ? <span className="inline-flex items-center text-[10px] font-medium border px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 border-gray-200">{batch}</span>
            : (e.lastRestocked ? renderDateTag(null, e.lastRestocked) : null);
          const isEditing = wasteEditId === e.id;

          if (isEditing) {
            return (
              <tr key={e.id} className="border-b border-gray-50 bg-blue-50/50">
                <td className="px-3 py-1.5 text-xs text-ios-tertiary">{e.Date}</td>
                <td className="px-3 py-1.5 text-xs font-medium text-ios-label">{baseName}</td>
                <td className="px-3 py-1.5 text-xs">{batchTag}</td>
                {showSupplier && <td className="px-3 py-1.5 text-xs text-ios-secondary">{e.supplier || '—'}</td>}
                <td className="px-3 py-1.5 text-xs text-right">
                  <input type="number" min="1" value={wasteEditForm.quantity}
                    onChange={ev => setWasteEditForm(f => ({ ...f, quantity: ev.target.value }))}
                    className="w-14 text-xs px-1 py-0.5 border rounded text-right" />
                </td>
                <td className="px-3 py-1.5 text-xs">
                  <select value={wasteEditForm.reason}
                    onChange={ev => setWasteEditForm(f => ({ ...f, reason: ev.target.value }))}
                    className="text-xs px-1 py-0.5 border rounded">
                    {['Wilted','Damaged','Arrived Broken','Overstock','Other'].map(r => <option key={r} value={r}>{r}</option>)}
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
              <td className="px-3 py-1.5 text-xs text-ios-tertiary">{e.Date}</td>
              <td className="px-3 py-1.5 text-xs font-medium text-ios-label">{baseName}</td>
              <td className="px-3 py-1.5 text-xs">{batchTag}</td>
              {showSupplier && <td className="px-3 py-1.5 text-xs text-ios-secondary">{e.supplier || '—'}</td>}
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
            {/* Waste toolbar: group by + sort */}
            <div className="glass-card px-4 py-2 flex flex-wrap items-center gap-2">
              <div className="flex gap-1">
                {[
                  { key: 'supplier', label: t.supplier },
                  { key: 'all',      label: t.allStatuses },
                ].map(g => (
                  <button key={g.key} onClick={() => setWasteGroupBy(g.key)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      wasteGroupBy === g.key ? 'bg-brand-600 text-white' : 'bg-gray-100 text-ios-secondary hover:bg-gray-200'
                    }`}>{g.label}</button>
                ))}
              </div>
              <span className="text-xs text-ios-tertiary">·</span>
              <div className="flex gap-1">
                {[
                  { key: 'date',  label: t.date },
                  { key: 'batch', label: t.receivedDate || 'Batch' },
                ].map(s => (
                  <button key={s.key} onClick={() => setWasteSortBy(s.key)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                      wasteSortBy === s.key ? 'bg-brand-100 text-brand-700' : 'bg-gray-50 text-ios-tertiary'
                    }`}>{s.label} {wasteSortBy === s.key ? '↓' : ''}</button>
                ))}
              </div>
            </div>

            {/* Summary bar */}
            {filteredLog.length > 0 && (
              <div className="glass-card px-4 py-3 flex flex-wrap gap-6">
                <div>
                  <span className="text-xs text-ios-tertiary">{t.totalLost || 'Total lost'}</span>
                  <p className="text-lg font-bold text-ios-red">{totalLost} {t.stems}</p>
                </div>
                <div>
                  <span className="text-xs text-ios-tertiary">{t.revenueLost || 'Revenue lost'}</span>
                  <p className="text-lg font-bold text-ios-red">{totalCostLost.toFixed(0)} {t.zl}</p>
                </div>
                <div>
                  <span className="text-xs text-ios-tertiary">{t.suppliers || 'Suppliers'}</span>
                  <p className="text-lg font-bold text-ios-label">{allSuppliers.length}</p>
                </div>
              </div>
            )}

            {/* Grouped by supplier */}
            {wasteGroupBy === 'supplier' && Object.entries(bySupplier).sort(([,a], [,b]) => b.totalQty - a.totalQty).map(([sup, data]) => (
              <div key={sup} className="glass-card overflow-hidden">
                <div className="px-4 py-2 bg-brand-50/40 border-b border-white/40 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-brand-700 uppercase tracking-wide">
                    {sup}
                  </h3>
                  <span className="text-xs text-ios-tertiary">
                    {data.totalQty} {t.stems} · {data.totalCost.toFixed(0)} {t.zl}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-ios-tertiary border-b border-gray-100 bg-gray-50/60">
                      <th className="text-left px-3 py-2 font-medium">{t.date}</th>
                      <th className="text-left px-3 py-2 font-medium">{t.stockName}</th>
                      <th className="text-left px-3 py-2 font-medium">{t.receivedDate || 'Batch'}</th>
                      <th className="text-right px-3 py-2 font-medium">{t.quantity}</th>
                      <th className="text-left px-3 py-2 font-medium">{t.reason}</th>
                      <th className="text-right px-3 py-2 font-medium">{t.daysSurvived}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map(e => <WasteRow key={e.id} e={e} showSupplier={false} />)}
                  </tbody>
                </table>
              </div>
            ))}

            {/* All entries — flat table */}
            {wasteGroupBy === 'all' && filteredLog.length > 0 && (
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
                    {filteredLog.map(e => <WasteRow key={e.id} e={e} showSupplier={true} />)}
                  </tbody>
                </table>
              </div>
            )}

            {filteredLog.length === 0 && (
              <p className="text-center text-sm text-ios-tertiary py-8">{t.noData}</p>
            )}
          </>
        );
      })()}

      {/* ── Three aligned stock tables: Planned → Needed → Available ── */}
      {view !== 'waste' && !loading && (
        <div className="glass-card overflow-x-auto">
          {/* ── PLANNED — flowers arriving from pending POs ── */}
          {plannedRows.length > 0 && (
            <table className="w-full text-sm whitespace-nowrap" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '24%' }} /><col style={{ width: '7%' }} /><col style={{ width: '6%' }} />
                <col style={{ width: '7%' }} /><col style={{ width: '7%' }} /><col style={{ width: '5%' }} />
                <col style={{ width: '8%' }} /><col style={{ width: '7%' }} /><col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} /><col style={{ width: '17%' }} />
              </colgroup>
              <thead>
                <tr className="bg-indigo-50/60">
                  <th colSpan={11} className="px-3 py-2 border-b border-indigo-100 text-left font-normal">
                    <button onClick={() => setPlannedCollapsed(v => !v)} className="w-full flex items-center justify-between">
                      <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
                        {t.pendingArrivals} ({plannedRows.length})
                      </span>
                      <span className="text-xs text-indigo-400">{plannedCollapsed ? '▼' : '▲'}</span>
                    </button>
                  </th>
                </tr>
                {!plannedCollapsed && (
                  <tr className="text-xs text-ios-tertiary border-b border-indigo-100 bg-indigo-50/20">
                    <th className="text-left px-2 py-1.5 font-medium">{t.stockName}</th>
                    <th className="text-left px-2 py-1.5 font-medium">{t.planned}</th>
                    <th className="text-right px-2 py-1.5 font-medium">{t.ordered}</th>
                    <th className="text-right px-2 py-1.5 font-medium">{t.committedToOrders}</th>
                    <th className="text-right px-2 py-1.5 font-medium">{t.netQty}</th>
                    <th colSpan={6}></th>
                  </tr>
                )}
              </thead>
              {!plannedCollapsed && (
                <tbody>
                  {plannedRows.map(row => (
                    <Fragment key={row.stockId}>
                      <tr
                        className="border-b border-gray-100 hover:bg-indigo-50/20 cursor-pointer"
                        onClick={() => setExpandedPlanned(expandedPlanned === row.stockId ? null : row.stockId)}
                      >
                        <td className="px-2 py-1.5 text-ios-label font-medium text-sm truncate">{row.name}</td>
                        <td className="px-2 py-1.5">{formatDateTag(row.plannedDate, 'indigo')}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-base font-bold text-indigo-600">{row.ordered}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-amber-600 font-medium">
                          {row.committed > 0 ? row.committed : '—'}
                        </td>
                        <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${
                          row.net > 0 ? 'text-green-600' : row.net < 0 ? 'text-red-600' : 'text-ios-label'
                        }`}>
                          {row.net > 0 ? '+' : ''}{row.net}
                        </td>
                        <td colSpan={6}></td>
                      </tr>
                      {expandedPlanned === row.stockId && row.orders.length > 0 && (
                        <tr className="bg-amber-50/50">
                          <td colSpan={11} className="px-6 py-1.5">
                            <div className="space-y-0.5">
                              {row.orders.map((o, i) => (
                                <div key={i} className="flex items-center justify-between text-xs cursor-pointer hover:underline text-amber-700"
                                     onClick={e => { e.stopPropagation(); onNavigate?.({ tab: 'orders', filter: { orderId: o.orderId } }); }}>
                                  <span>#{o.appOrderId} — {o.customerName} ({o.requiredBy || '—'})</span>
                                  <span className="tabular-nums font-medium">{o.qty} {t.stems}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              )}
            </table>
          )}

          {/* ── AVAILABLE — current stock inventory ── */}
          <table className="w-full text-sm whitespace-nowrap" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '24%' }} /><col style={{ width: '7%' }} /><col style={{ width: '6%' }} />
              <col style={{ width: '7%' }} /><col style={{ width: '7%' }} /><col style={{ width: '5%' }} />
              <col style={{ width: '8%' }} /><col style={{ width: '7%' }} /><col style={{ width: '6%' }} />
              <col style={{ width: '6%' }} /><col style={{ width: '17%' }} />
            </colgroup>
            <thead>
              <tr className="bg-green-50/60">
                <th colSpan={11} className="px-3 py-2 border-b border-green-100 text-left font-normal">
                  <span className="text-xs font-semibold text-green-700 uppercase tracking-wide">
                    {t.flowersInStock || 'Flowers in Stock'} ({filtered.length})
                  </span>
                </th>
              </tr>
              <tr className="text-xs text-ios-tertiary border-b border-gray-200 bg-gray-50/60">
                {[
                  { key: 'name',           label: t.stockName, align: 'left' },
                  { key: 'lastRestocked',  label: t.receivedDate, align: 'left' },
                  { key: 'qty',            label: t.available, align: 'right' },
                  { key: 'cost',           label: t.costPrice, align: 'right' },
                  { key: 'sell',           label: t.sellPrice, align: 'right' },
                  { key: null,             label: t.markup, align: 'right' },
                  { key: 'supplier',       label: t.supplier, align: 'left' },
                  { key: null,             label: t.farmer, align: 'left' },
                  { key: null,             label: t.lotSize, align: 'right' },
                  { key: null,             label: t.threshold || 'Threshold', align: 'right' },
                  { key: null,             label: '', align: 'right' },
                ].map((col, i) => (
                  <th key={i}
                    onClick={col.key ? () => toggleSort(col.key) : undefined}
                    className={`px-2 py-2 font-medium ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.key ? 'cursor-pointer hover:text-ios-label select-none' : ''}`}
                  >
                    {col.label}
                    {col.key && sortCol === col.key && (
                      <span className="ml-0.5">{sortAsc ? '↑' : '↓'}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <StockRow
                  key={item.id}
                  item={item}
                  premade={premadeMap[item.id]}
                  showRepairTools={showRepairTools}
                  onAdjust={adjustQty}
                  onWriteOff={writeOff}
                  onPatch={patchStock}
                  onNavigate={onNavigate}
                />
              ))}
            </tbody>
            {(() => {
              const inStock = filtered;
              return inStock.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50/80 font-semibold text-xs">
                  <td className="px-2 py-2 text-ios-label uppercase tracking-wide">
                    {t.total || 'Total'} ({inStock.length})
                  </td>
                  <td></td>
                  <td className="px-2 py-2 text-right text-ios-label text-base">
                    {inStock.reduce((sum, s) => sum + (s['Current Quantity'] || 0), 0)}
                  </td>
                  <td className="px-2 py-2 text-right text-ios-label">
                    {inStock.reduce((sum, s) => sum + (s['Current Quantity'] || 0) * (s['Current Cost Price'] || 0), 0).toFixed(2)} {t.zl}
                  </td>
                  <td className="px-2 py-2 text-right text-ios-label">
                    {inStock.reduce((sum, s) => sum + (s['Current Quantity'] || 0) * (s['Current Sell Price'] || 0), 0).toFixed(2)} {t.zl}
                  </td>
                  <td colSpan={6}></td>
                </tr>
              </tfoot>
            ); })()}
          </table>
        </div>
      )}
    </div>
  );
}

// Inline date editor — click the tag to reveal a date input, blur to save.
function InlineDate({ value, displayName, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function startEdit() {
    setDraft(value ? value.split('T')[0] : '');
    setEditing(true);
  }

  function commitEdit() {
    setEditing(false);
    const newVal = draft || null;
    const oldVal = value ? value.split('T')[0] : null;
    if (newVal !== oldVal) onSave(draft || null);
  }

  if (editing) {
    return (
      <input
        type="date"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
        autoFocus
        className="field-input text-xs w-28 py-0.5"
      />
    );
  }

  const dateTag = renderDateTag(displayName || null, value);
  return (
    <span onClick={startEdit} className="cursor-pointer" title={t.edit || 'Edit'}>
      {dateTag || <span className="text-xs text-ios-tertiary/40">—</span>}
    </span>
  );
}

// Individual stock row — flat: name, qty, cost, sell, markup, supplier, farmer, lot, threshold, days in stock, actions
function StockRow({ item, premade, showRepairTools, onAdjust, onWriteOff, onPatch, onNavigate }) {
  const [showPremadeDetail, setShowPremadeDetail] = useState(false);
  const [woQty, setWoQty]       = useState(1);
  const [woReason, setWoReason] = useState('');
  const [showWo, setShowWo]     = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [usageTrail, setUsageTrail] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);

  function toggleUsage() {
    if (showUsage) { setShowUsage(false); return; }
    setShowUsage(true);
    if (usageTrail) return; // already loaded
    setUsageLoading(true);
    client.get(`/stock/${item.id}/usage`)
      .then(r => setUsageTrail(r.data.trail || []))
      .catch(() => setUsageTrail([]))
      .finally(() => setUsageLoading(false));
  }

  const qty = item['Current Quantity'] || 0;
  const threshold = item['Reorder Threshold'] || 0;
  const isLow = qty > 0 && qty <= threshold;
  const isZero = qty === 0;
  const isNegative = qty < 0;
  const cost = item['Current Cost Price'] || 0;
  const sell = item['Current Sell Price'] || 0;
  const markup = cost > 0 && sell > 0 ? (sell / cost).toFixed(1) : null;
  const lotSize = item['Lot Size'] || '';
  const lastRestocked = item['Last Restocked'];
  const rowColor = isNegative ? 'bg-red-50' : isZero ? 'bg-ios-red/8' : isLow ? 'bg-ios-orange/8' : '';

  return (
    <>
      <tr className={`border-b border-gray-100 ${rowColor} hover:bg-gray-50/50`}>
        <td className="px-2 py-1.5 text-ios-label font-medium text-sm">{stockBaseName(item['Display Name'])}</td>
        <td className="px-2 py-1.5">
          <InlineDate value={lastRestocked} displayName={item['Display Name']} onSave={v => onPatch(item.id, { 'Last Restocked': v || null })} />
        </td>
        <td className={`px-2 py-1.5 text-right tabular-nums text-base font-bold ${
          isNegative ? 'text-red-600' : isZero ? 'text-ios-red' : isLow ? 'text-ios-orange' : 'text-ios-label'
        }`}>
          <div>{qty}</div>
          {premade && premade.qty > 0 && (
            <button
              onClick={e => { e.stopPropagation(); setShowPremadeDetail(v => !v); }}
              className="text-[10px] font-medium text-indigo-600 hover:text-indigo-800 normal-case"
              title={t.clickToSeePremades || 'Click to see which bouquets'}
            >
              +{premade.qty} {t.inPremades || 'in premades'}
            </button>
          )}
        </td>
        <td className="px-2 py-1.5 text-right">
          <InlineEdit
            value={cost > 0 ? String(cost.toFixed(2)) : ''}
            type="number"
            placeholder="—"
            onSave={v => onPatch(item.id, { 'Current Cost Price': v ? Number(v) : 0 })}
          />
        </td>
        <td className="px-2 py-1.5 text-right">
          <InlineEdit
            value={sell > 0 ? String(sell.toFixed(2)) : ''}
            type="number"
            placeholder="—"
            onSave={v => onPatch(item.id, { 'Current Sell Price': v ? Number(v) : 0 })}
          />
        </td>
        <td className="px-2 py-1.5 text-right">
          {markup && (
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
              Number(markup) >= 2.0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}>×{markup}</span>
          )}
        </td>
        <td className="px-2 py-1.5 text-xs text-ios-secondary">{item.Supplier || '—'}</td>
        <td className="px-2 py-1.5 text-xs text-ios-secondary">{item.Farmer || '—'}</td>
        <td className="px-2 py-1.5 text-right">
          <InlineEdit
            value={lotSize ? String(lotSize) : ''}
            type="number"
            placeholder="—"
            onSave={v => onPatch(item.id, { 'Lot Size': v ? Number(v) : 0 })}
          />
        </td>
        <td className="px-2 py-1.5 text-right">
          <InlineEdit
            value={threshold ? String(threshold) : ''}
            type="number"
            placeholder="—"
            onSave={v => onPatch(item.id, { 'Reorder Threshold': v ? Number(v) : 0 })}
          />
        </td>
        <td className="px-2 py-1.5 text-right">
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => onAdjust(item.id, -1)}
              className="w-6 h-6 rounded bg-gray-100 text-ios-label text-xs hover:bg-gray-200">−</button>
            <button onClick={() => onAdjust(item.id, 1)}
              className="w-6 h-6 rounded bg-gray-100 text-ios-label text-xs hover:bg-gray-200">+</button>
            {qty > 0 && (
              <button onClick={() => setShowWo(!showWo)}
                className="ml-0.5 px-1.5 py-0.5 rounded bg-ios-red/10 text-ios-red text-[10px] hover:bg-ios-red/20">
                {t.writeOff}
              </button>
            )}
            <button onClick={toggleUsage}
              className={`ml-0.5 px-1.5 py-0.5 rounded text-[10px] ${showUsage ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}>
              {t.trace || 'Trace'}
            </button>
          </div>
        </td>
      </tr>
      {showPremadeDetail && premade && premade.bouquets?.length > 0 && (
        <tr className="bg-indigo-50/60">
          <td colSpan={11} className="px-6 py-2">
            <p className="text-[10px] text-indigo-600 uppercase font-semibold tracking-wide mb-1">
              {t.lockedInPremades || 'Locked in premade bouquets'}
            </p>
            <div className="space-y-0.5">
              {premade.bouquets.map((b, i) => (
                <div key={i} className="flex items-center justify-between text-xs text-indigo-800">
                  <span>{b.name}</span>
                  <span className="tabular-nums font-medium">{b.qty} {t.stems || 'stems'}</span>
                </div>
              ))}
            </div>
            {/* Historical repair button — gated behind a Settings toggle so
                it doesn't show in normal daily view. Owner enables it from
                the Stock-tab toolbar when she needs to fix an item where
                premade deduction never fired. Irreversible — confirms first. */}
            {showRepairTools && (
              <div className="mt-2 pt-2 border-t border-indigo-200 flex items-center justify-between gap-2">
                <span className="text-[11px] text-indigo-700">
                  {t.reconcilePremadeHint || 'If stock looks too high, subtract premade qty'}: {qty} − {premade.qty} = {qty - premade.qty}
                </span>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    const target = qty - premade.qty;
                    if (!window.confirm(
                      `${t.reconcilePremadeConfirm || 'Subtract premade qty from Current Quantity?'}\n\n${item['Display Name']}: ${qty} → ${target}`,
                    )) return;
                    onAdjust(item.id, -premade.qty);
                    setShowPremadeDetail(false);
                  }}
                  className="px-2.5 py-1 rounded-md bg-indigo-600 text-white text-[11px] font-semibold active-scale"
                >
                  {t.reconcilePremade || 'Reconcile'} −{premade.qty}
                </button>
              </div>
            )}
          </td>
        </tr>
      )}
      {showUsage && (
        <tr className="bg-blue-50/50">
          <td colSpan={11} className="px-3 py-2">
            {usageLoading ? (
              <p className="text-xs text-ios-tertiary">{t.loading}...</p>
            ) : !usageTrail || usageTrail.length === 0 ? (
              <p className="text-xs text-ios-tertiary">{t.noUsageData || 'No usage history found.'}</p>
            ) : (
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-ios-tertiary uppercase border-b border-blue-100">
                      <th className="text-left py-1 pr-2">{t.date}</th>
                      <th className="text-left py-1 pr-2">{t.deliveryDate}</th>
                      <th className="text-left py-1 pr-2">{t.usageType || 'Type'}</th>
                      <th className="text-left py-1 pr-2">{t.usageDetail || 'Details'}</th>
                      <th className="text-right py-1">{t.quantity}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageTrail.map((entry, i) => (
                      <tr key={i} className="border-b border-blue-50">
                        <td className="py-1 pr-2 text-ios-secondary">{entry.date || '—'}</td>
                        <td className="py-1 pr-2 text-ios-secondary">
                          {entry.type === 'order' && entry.requiredBy ? entry.requiredBy : '—'}
                        </td>
                        <td className="py-1 pr-2">
                          {entry.type === 'order' && <span className="px-1.5 py-0.5 rounded bg-brand-100 text-brand-700 text-[10px] font-medium">{t.usageOrder || 'Order'}</span>}
                          {entry.type === 'writeoff' && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-medium">{t.writeOff}</span>}
                          {entry.type === 'purchase' && <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[10px] font-medium">{t.usagePurchase || 'Purchase'}</span>}
                        </td>
                        <td className="py-1 pr-2 text-ios-label">
                          {entry.type === 'order' && (
                            <span
                              className={entry.orderRecordId ? 'cursor-pointer text-brand-600 hover:underline' : ''}
                              onClick={() => entry.orderRecordId && onNavigate?.({ tab: 'orders', filter: { orderId: entry.orderRecordId } })}
                            >
                              {entry.orderId} — {entry.customer} ({entry.status})
                            </span>
                          )}
                          {entry.type === 'writeoff' && `${entry.reason}${entry.notes ? ': ' + entry.notes : ''}`}
                          {entry.type === 'purchase' && (
                            <span>
                              {entry.poDisplayId ? (
                                <>
                                  <span className="font-medium text-ios-label">{entry.poDisplayId}</span>
                                  {' · '}{entry.supplier || '—'}
                                  {entry.variant && entry.variant !== 'primary' && (
                                    <span className="ml-1 px-1 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px]">
                                      {entry.variant}
                                    </span>
                                  )}
                                </>
                              ) : (
                                // Manual stock receive (no PO) — just show supplier + any notes
                                <>{entry.supplier || '—'}{entry.notes ? ` — ${entry.notes}` : ''}</>
                              )}
                            </span>
                          )}
                        </td>
                        <td className={`py-1 text-right font-medium tabular-nums ${entry.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {entry.quantity > 0 ? '+' : ''}{entry.quantity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
      {showWo && (
        <tr className="bg-ios-red/5">
          <td colSpan={11} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <input type="number" inputMode="numeric" min="1" max={qty} value={woQty}
                onFocus={e => e.target.select()}
                onChange={e => {
                  const raw = e.target.value;
                  if (raw === '') { setWoQty(''); return; }
                  const n = parseInt(raw, 10);
                  if (!isNaN(n) && n >= 0) setWoQty(Math.min(n, qty));
                }}
                onBlur={() => {
                  const n = Number(woQty);
                  if (!n || n < 1) setWoQty(1);
                  else if (n > qty) setWoQty(qty);
                }}
                className="field-input w-16" />
              <select value={woReason} onChange={e => setWoReason(e.target.value)}
                className="field-input flex-1">
                <option value="">{t.reason}</option>
                <option value="Wilted">{t.reasonWilted || 'Wilted'}</option>
                <option value="Damaged">{t.reasonDamaged || 'Broken at delivery'}</option>
                <option value="Arrived Broken">{t.arrivedBroken || 'Arrived Broken'}</option>
              </select>
              <button
                onClick={() => { onWriteOff(item.id, woQty, woReason); setShowWo(false); setWoQty(1); setWoReason(''); }}
                className="px-3 py-1.5 rounded-lg bg-ios-red text-white text-xs font-semibold">
                {t.confirm}
              </button>
              <button onClick={() => setShowWo(false)}
                className="px-3 py-1.5 rounded-lg bg-white/50 text-xs">
                {t.cancel}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
