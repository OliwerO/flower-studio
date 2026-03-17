// StockTab — inventory management table for the owner.
// Like a warehouse management screen: see every item, adjust quantities,
// receive deliveries, track waste. All fields inline-editable.

import { useState, useEffect, useCallback, useRef } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import StockReceiveForm from './StockReceiveForm.jsx';
import StockOrderPanel from './StockOrderPanel.jsx';
import InlineEdit from './InlineEdit.jsx';

export default function StockTab({ initialFilter }) {
  const [stock, setStock]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [showReceive, setShowReceive] = useState(false);
  const [showPurchaseOrders, setShowPurchaseOrders] = useState(initialFilter?.action === 'createPO');
  const [view, setView]             = useState('all'); // 'all' | 'waste' | 'slow' | 'negative'
  const [wastePeriod, setWastePeriod] = useState('month'); // 'month' | '30d' | '90d'
  const { showToast } = useToast();

  const stockLoaded = useRef(false);

  const fetchStock = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await client.get('/stock?includeEmpty=true');
      setStock(prev => {
        if (!stockLoaded.current) return res.data;
        // Merge: update existing items in place, preserve local UI state
        const newMap = new Map(res.data.map(s => [s.id, s]));
        const merged = prev.map(s => newMap.get(s.id) || s).filter(s => newMap.has(s.id));
        for (const s of res.data) {
          if (!merged.find(m => m.id === s.id)) merged.push(s);
        }
        return merged;
      });
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

  const [sortCol, setSortCol] = useState('lastRestocked');
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
    filtered = [...filtered].sort((a, b) => sortAsc ? fn(a, b) : fn(b, a));
  }

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

        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setShowPurchaseOrders(!showPurchaseOrders)}
            className="px-3 py-1.5 rounded-xl bg-blue-100 text-blue-700 text-xs font-semibold"
          >
            {t.stockOrders || 'Purchase Orders'}
          </button>
          <button
            onClick={() => setShowReceive(!showReceive)}
            className="px-3 py-1.5 rounded-xl bg-ios-green/15 text-ios-green text-xs font-semibold"
          >
            {t.receiveStock}
          </button>
        </div>
      </div>

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

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
        </div>
      )}

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
        const filteredLog = search
          ? lossLog.filter(e => (e.flowerName || '').toLowerCase().includes(search.toLowerCase())
              || (e.supplier || '').toLowerCase().includes(search.toLowerCase()))
          : lossLog;
        // Group by supplier
        const bySupplier = {};
        let totalLost = 0;
        let totalCostLost = 0;
        for (const e of filteredLog) {
          const sup = e.supplier || '—';
          if (!bySupplier[sup]) bySupplier[sup] = { entries: [], totalQty: 0, totalCost: 0 };
          bySupplier[sup].entries.push(e);
          bySupplier[sup].totalQty += e.Quantity || 0;
          bySupplier[sup].totalCost += (e.Quantity || 0) * (e.costPrice || 0);
          totalLost += e.Quantity || 0;
          totalCostLost += (e.Quantity || 0) * (e.costPrice || 0);
        }
        return (
          <>
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
                  <p className="text-lg font-bold text-ios-label">{Object.keys(bySupplier).length}</p>
                </div>
              </div>
            )}

            {/* Write-off log grouped by supplier */}
            {Object.entries(bySupplier).sort(([,a], [,b]) => b.totalQty - a.totalQty).map(([sup, data]) => (
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
                      <th className="text-right px-3 py-2 font-medium">{t.quantity}</th>
                      <th className="text-left px-3 py-2 font-medium">{t.reason}</th>
                      <th className="text-right px-3 py-2 font-medium">{t.daysSurvived}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map(e => (
                      <tr key={e.id} className="border-b border-gray-50">
                        <td className="px-3 py-1.5 text-xs text-ios-tertiary">{e.Date}</td>
                        <td className="px-3 py-1.5 text-xs font-medium text-ios-label">{e.flowerName}</td>
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
                        <td className="px-3 py-1.5 text-xs text-right text-ios-tertiary">
                          {e['Days Survived'] != null ? e['Days Survived'] : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {filteredLog.length === 0 && (
              <p className="text-center text-sm text-ios-tertiary py-8">{t.noData}</p>
            )}
          </>
        );
      })()}

      {/* ── Stock table — flat sortable view (all/slow/negative views) ── */}
      {view !== 'waste' && !loading && (
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-xs text-ios-tertiary border-b border-gray-200 bg-gray-50/60">
                {[
                  { key: 'name',           label: t.stockName, align: 'left' },
                  { key: 'qty',            label: t.quantity, align: 'right' },
                  { key: 'cost',           label: t.costPrice, align: 'right' },
                  { key: 'sell',           label: t.sellPrice, align: 'right' },
                  { key: null,             label: t.markup, align: 'right' },
                  { key: 'supplier',       label: t.supplier, align: 'left' },
                  { key: null,             label: t.farmer, align: 'left' },
                  { key: null,             label: t.lotSize, align: 'right' },
                  { key: null,             label: t.threshold || 'Threshold', align: 'right' },
                  { key: 'lastRestocked',  label: t.daysInStock || 'Days in stock', align: 'right' },
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
                  onAdjust={adjustQty}
                  onWriteOff={writeOff}
                  onPatch={patchStock}
                />
              ))}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50/80 font-semibold text-xs">
                  <td className="px-2 py-2 text-ios-label uppercase tracking-wide">
                    {t.total || 'Total'} ({filtered.length})
                  </td>
                  <td className="px-2 py-2 text-right text-ios-label text-base">
                    {filtered.reduce((sum, s) => sum + (s['Current Quantity'] || 0), 0)}
                  </td>
                  <td className="px-2 py-2 text-right text-ios-label">
                    {filtered.reduce((sum, s) => sum + (s['Current Quantity'] || 0) * (s['Current Cost Price'] || 0), 0).toFixed(2)} {t.zl}
                  </td>
                  <td className="px-2 py-2 text-right text-ios-label">
                    {filtered.reduce((sum, s) => sum + (s['Current Quantity'] || 0) * (s['Current Sell Price'] || 0), 0).toFixed(2)} {t.zl}
                  </td>
                  <td colSpan={7}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

// Individual stock row — flat: name, qty, cost, sell, markup, supplier, farmer, lot, threshold, days in stock, actions
function StockRow({ item, onAdjust, onWriteOff, onPatch }) {
  const [woQty, setWoQty]       = useState(1);
  const [woReason, setWoReason] = useState('');
  const [showWo, setShowWo]     = useState(false);

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
  const daysInStock = lastRestocked
    ? Math.floor((Date.now() - new Date(lastRestocked).getTime()) / 86400000)
    : null;
  const rowColor = isNegative ? 'bg-red-50' : isZero ? 'bg-ios-red/8' : isLow ? 'bg-ios-orange/8' : '';

  return (
    <>
      <tr className={`border-b border-gray-100 ${rowColor} hover:bg-gray-50/50`}>
        <td className="px-2 py-1.5 text-ios-label font-medium text-sm">{item['Display Name']}</td>
        <td className={`px-2 py-1.5 text-right tabular-nums text-base font-bold ${
          isNegative ? 'text-red-600' : isZero ? 'text-ios-red' : isLow ? 'text-ios-orange' : 'text-ios-label'
        }`}>
          {qty}
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
        <td className="px-2 py-1.5 text-right text-xs text-ios-tertiary tabular-nums">{lotSize || '—'}</td>
        <td className="px-2 py-1.5 text-right text-xs text-ios-tertiary tabular-nums">{threshold || '—'}</td>
        <td className={`px-2 py-1.5 text-right text-xs tabular-nums ${
          daysInStock != null && daysInStock > 7 ? 'text-ios-orange font-medium' :
          daysInStock != null && daysInStock > 14 ? 'text-ios-red font-semibold' :
          'text-ios-tertiary'
        }`}>
          {daysInStock != null ? daysInStock : '—'}
        </td>
        <td className="px-2 py-1.5 text-right">
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => onAdjust(item.id, -1)}
              className="w-6 h-6 rounded bg-gray-100 text-ios-label text-xs hover:bg-gray-200">−</button>
            <button onClick={() => onAdjust(item.id, 1)}
              className="w-6 h-6 rounded bg-gray-100 text-ios-label text-xs hover:bg-gray-200">+</button>
            <button onClick={() => setShowWo(!showWo)}
              className="ml-0.5 px-1.5 py-0.5 rounded bg-ios-red/10 text-ios-red text-[10px] hover:bg-ios-red/20">
              {t.writeOff}
            </button>
          </div>
        </td>
      </tr>
      {showWo && (
        <tr className="bg-ios-red/5">
          <td colSpan={11} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <input type="number" min="1" value={woQty}
                onChange={e => setWoQty(Number(e.target.value))}
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
