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
import Pills from './Pills.jsx';
import useConfigLists from '../hooks/useConfigLists.js';

export default function StockTab({ initialFilter }) {
  const { suppliers: SUPPLIERS } = useConfigLists();
  const [stock, setStock]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [showReceive, setShowReceive] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showPurchaseOrders, setShowPurchaseOrders] = useState(initialFilter?.action === 'createPO');
  const [newItem, setNewItem]       = useState({ displayName: '', category: '', quantity: 0, costPrice: 0, sellPrice: 0, supplier: '', unit: 'Stems' });
  const [view, setView]             = useState('all'); // 'all' | 'waste' | 'slow' | 'negative'
  const [velocity, setVelocity]     = useState({});
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
    client.get('/stock/velocity').then(r => setVelocity(r.data)).catch(() => {});
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

  async function createItem() {
    if (!newItem.displayName) return;
    try {
      await client.post('/stock', newItem);
      showToast(t.itemCreated);
      setNewItem({ displayName: '', category: '', quantity: 0, costPrice: 0, sellPrice: 0, supplier: '', unit: 'Stems' });
      setShowAddItem(false);
      fetchStock();
    } catch {
      showToast(t.error, 'error');
    }
  }

  // Client-side search
  let filtered = search
    ? stock.filter(s => (s['Display Name'] || '').toLowerCase().includes(search.toLowerCase()))
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

  // Group by category
  const grouped = {};
  for (const item of filtered) {
    const cat = item.Category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
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
            onClick={() => setShowAddItem(!showAddItem)}
            className="px-3 py-1.5 rounded-xl bg-brand-100 text-brand-700 text-xs font-semibold"
          >
            {t.addItem}
          </button>
          <button
            onClick={() => setShowReceive(!showReceive)}
            className="px-3 py-1.5 rounded-xl bg-ios-green/15 text-ios-green text-xs font-semibold"
          >
            {t.receiveStock}
          </button>
        </div>
      </div>

      {/* Add item form */}
      {showAddItem && (
        <div className="glass-card px-4 py-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-ios-tertiary">{t.stockName}</label>
            <input value={newItem.displayName}
              onChange={e => setNewItem({ ...newItem, displayName: e.target.value })}
              className="field-input block w-40" />
          </div>
          <div>
            <label className="text-xs text-ios-tertiary">{t.category}</label>
            <select value={newItem.category}
              onChange={e => setNewItem({ ...newItem, category: e.target.value })}
              className="field-input block w-32">
              <option value="">— Select —</option>
              {['Roses', 'Tulips', 'Seasonal', 'Greenery', 'Accessories', 'Other'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-ios-tertiary">{t.quantity}</label>
            <input type="number" value={newItem.quantity}
              onChange={e => setNewItem({ ...newItem, quantity: Number(e.target.value) })}
              className="field-input block w-20" />
          </div>
          <div>
            <label className="text-xs text-ios-tertiary">{t.costPrice}</label>
            <input type="number" value={newItem.costPrice}
              onChange={e => setNewItem({ ...newItem, costPrice: Number(e.target.value) })}
              className="field-input block w-20" />
          </div>
          <div>
            <label className="text-xs text-ios-tertiary">{t.sellPrice}</label>
            <input type="number" value={newItem.sellPrice}
              onChange={e => setNewItem({ ...newItem, sellPrice: Number(e.target.value) })}
              className="field-input block w-20" />
          </div>
          <div>
            <label className="text-xs text-ios-tertiary">{t.supplier}</label>
            <select value={newItem.supplier}
              onChange={e => setNewItem({ ...newItem, supplier: e.target.value })}
              className="field-input block w-28">
              <option value="">— Select —</option>
              {SUPPLIERS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-ios-tertiary">{t.unit || 'Unit'}</label>
            <select value={newItem.unit}
              onChange={e => setNewItem({ ...newItem, unit: e.target.value })}
              className="field-input block w-24">
              {['Stems', 'Bunches', 'Pots', 'Pieces'].map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          <button onClick={createItem} disabled={!newItem.displayName}
            className="px-3 py-1.5 rounded-xl bg-brand-600 text-white text-xs font-semibold disabled:opacity-50">
            {t.save}
          </button>
        </div>
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
                            e.Reason === 'Overstock' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>{e.Reason}</span>
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

      {/* ── Stock table grouped by category (all/slow views) ── */}
      {view !== 'waste' && !loading && Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => (
        <div key={cat} className="glass-card overflow-hidden">
          <div className="px-4 py-2 bg-brand-50/40 border-b border-white/40">
            <h3 className="text-xs font-semibold text-brand-700 uppercase tracking-wide">
              {cat} ({items.length})
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-ios-tertiary border-b border-gray-100 bg-gray-50/60">
                <th className="text-left px-3 py-2 font-medium">{t.stockName}</th>
                <th className="text-right px-3 py-2 font-medium">{t.quantity}</th>
                <th className="text-right px-3 py-2 font-medium">{t.costPrice}</th>
                <th className="text-right px-3 py-2 font-medium">{t.sellPrice}</th>
                <th className="text-right px-3 py-2 font-medium">{t.markup}</th>
                <th className="text-left px-3 py-2 font-medium">{t.supplier}</th>
                <th className="text-right px-3 py-2 font-medium">{t.lotSize}</th>
                <th className="text-right px-3 py-2 font-medium">{t.threshold}</th>
                <th className="text-right px-3 py-2 font-medium">{t.daysOfSupplyHeader}</th>
                <th className="text-right px-3 py-2 font-medium w-36"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <StockRow
                  key={item.id}
                  item={item}
                  showWaste={false}
                  onAdjust={adjustQty}
                  onWriteOff={writeOff}
                  onPatch={patchStock}
                  velocity={velocity[item.id]}
                  suppliers={SUPPLIERS}
                />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// Individual stock row with inline editing
function StockRow({ item, showWaste, onAdjust, onWriteOff, onPatch, velocity, suppliers = [] }) {
  const [woQty, setWoQty]       = useState(1);
  const [woReason, setWoReason] = useState('');
  const [showWo, setShowWo]     = useState(false);
  const [editSupplier, setEditSupplier] = useState(false);

  const qty = item['Current Quantity'] || 0;
  const threshold = item['Reorder Threshold'] || 0;
  const lotSize = item['Lot Size'] || 1;
  const isLow = qty > 0 && qty <= threshold;
  const isZero = qty === 0;
  const isNegative = qty < 0;
  const cost = item['Current Cost Price'] || 0;
  const sell = item['Current Sell Price'] || 0;
  const markupPct = cost > 0 && sell > 0 ? ((sell / cost - 1) * 100).toFixed(0) : '—';
  const dead = item['Dead/Unsold Stems'] || 0;
  const rowColor = isNegative ? 'bg-red-50' : isZero ? 'bg-ios-red/8' : isLow ? 'bg-ios-orange/8' : '';

  return (
    <>
      <tr className={`border-b border-gray-100 ${rowColor}`}>
        <td className="px-3 py-2 text-ios-label font-medium">{item['Display Name']}</td>
        <td className={`px-3 py-2 text-right font-semibold ${
          isNegative ? 'text-red-600 font-bold' : isZero ? 'text-ios-red' : isLow ? 'text-ios-orange' : 'text-ios-label'
        }`}>
          {qty}
        </td>
        {/* Editable cost price */}
        <td className="px-3 py-2 text-right">
          <InlineEdit
            value={cost > 0 ? String(cost.toFixed(0)) : ''}
            type="number"
            placeholder="—"
            onSave={v => onPatch(item.id, { 'Current Cost Price': v ? Number(v) : 0 })}
          />
        </td>
        {/* Editable sell price */}
        <td className="px-3 py-2 text-right">
          <InlineEdit
            value={sell > 0 ? String(sell.toFixed(0)) : ''}
            type="number"
            placeholder="—"
            onSave={v => onPatch(item.id, { 'Current Sell Price': v ? Number(v) : 0 })}
          />
        </td>
        <td className="px-3 py-2 text-right text-ios-tertiary">{markupPct === '—' ? '—' : `${markupPct}%`}</td>
        {/* Editable supplier */}
        <td className="px-3 py-2 relative">
          <span
            onClick={() => setEditSupplier(!editSupplier)}
            className="text-ios-tertiary cursor-pointer hover:bg-gray-100 rounded px-1 -mx-1 transition-colors text-sm"
          >
            {item.Supplier || '—'}
          </span>
          {editSupplier && (
            <div className="absolute left-0 top-full z-20 mt-1 bg-white rounded-xl border border-gray-200 shadow-lg p-2">
              <Pills
                options={suppliers.map(s => ({ value: s, label: s }))}
                value={item.Supplier || ''}
                onChange={v => { onPatch(item.id, { Supplier: v }); setEditSupplier(false); }}
              />
            </div>
          )}
        </td>
        {/* Editable lot size */}
        <td className="px-3 py-2 text-right">
          <InlineEdit
            value={lotSize > 1 ? String(lotSize) : ''}
            type="number"
            placeholder="1"
            onSave={v => onPatch(item.id, { 'Lot Size': v ? Number(v) : 1 })}
          />
        </td>
        {/* Editable threshold */}
        <td className="px-3 py-2 text-right">
          <InlineEdit
            value={threshold > 0 ? String(threshold) : ''}
            type="number"
            placeholder="—"
            onSave={v => onPatch(item.id, { 'Reorder Threshold': v ? Number(v) : 0 })}
          />
        </td>
        {/* Days of supply — qty / avg daily usage */}
        <td className="px-3 py-2 text-right">
          {velocity ? (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              velocity.avgDailyUsage === 0 ? 'bg-gray-100 text-ios-tertiary'
              : qty / velocity.avgDailyUsage < 2 ? 'bg-rose-100 text-rose-600'
              : qty / velocity.avgDailyUsage < 5 ? 'bg-amber-100 text-amber-600'
              : 'bg-emerald-100 text-emerald-600'
            }`}>
              {velocity.avgDailyUsage > 0 ? Math.round(qty / velocity.avgDailyUsage) : '—'}
            </span>
          ) : (
            <span className="text-xs text-ios-tertiary">—</span>
          )}
        </td>
        {showWaste && (
          <td className="px-3 py-2 text-right text-ios-red font-medium">{dead}</td>
        )}
        <td className="px-3 py-2 text-right">
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => onAdjust(item.id, -1)}
              className="w-7 h-7 rounded-lg bg-gray-100 text-ios-label text-sm hover:bg-gray-200">−</button>
            <button onClick={() => onAdjust(item.id, 1)}
              className="w-7 h-7 rounded-lg bg-gray-100 text-ios-label text-sm hover:bg-gray-200">+</button>
            <button onClick={() => setShowWo(!showWo)}
              className="ml-1 px-2 py-1 rounded-lg bg-ios-red/10 text-ios-red text-xs hover:bg-ios-red/20">
              {t.writeOff}
            </button>
          </div>
        </td>
      </tr>
      {showWo && (
        <tr className="bg-ios-red/5">
          <td colSpan={showWaste ? 11 : 10} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <input type="number" min="1" value={woQty}
                onChange={e => setWoQty(Number(e.target.value))}
                className="field-input w-16" />
              <select value={woReason} onChange={e => setWoReason(e.target.value)}
                className="field-input flex-1">
                <option value="">{t.reason}</option>
                <option value="Wilted">{t.reasonWilted || 'Wilted'}</option>
                <option value="Damaged">{t.reasonDamaged || 'Broken at delivery'}</option>
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
