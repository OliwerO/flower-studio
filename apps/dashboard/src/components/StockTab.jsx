// StockTab — inventory management table for the owner.
// Like a warehouse management screen: see every item, adjust quantities,
// receive deliveries, track waste. All fields inline-editable.

import { useState, useEffect, useCallback } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import StockReceiveForm from './StockReceiveForm.jsx';
import InlineEdit from './InlineEdit.jsx';
import Pills from './Pills.jsx';

const SUPPLIERS = ['Stojek', '4f', 'Stefan', 'Mateusz', 'Other'];

export default function StockTab() {
  const [stock, setStock]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [showReceive, setShowReceive] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItem, setNewItem]       = useState({ displayName: '', category: '', quantity: 0, costPrice: 0 });
  const [view, setView]             = useState('all'); // 'all' | 'waste' | 'slow'
  const [velocity, setVelocity]     = useState({});
  const { showToast } = useToast();

  const fetchStock = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('/stock');
      setStock(res.data);
    } catch {
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchStock(); }, [fetchStock]);

  useEffect(() => {
    client.get('/stock/velocity').then(r => setVelocity(r.data)).catch(() => {});
  }, []);

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
    } catch {
      showToast(t.error, 'error');
    }
  }

  async function createItem() {
    if (!newItem.displayName) return;
    try {
      await client.post('/stock', newItem);
      showToast(t.itemCreated);
      setNewItem({ displayName: '', category: '', quantity: 0, costPrice: 0 });
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

  // View filters
  if (view === 'waste') {
    filtered = filtered.filter(s => (s['Dead/Unsold Stems'] || 0) > 0);
  } else if (view === 'slow') {
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
            { key: 'all',   label: t.allStatuses },
            { key: 'waste', label: t.wasteLog },
            { key: 'slow',  label: t.slowMovers },
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
            <input value={newItem.category}
              onChange={e => setNewItem({ ...newItem, category: e.target.value })}
              className="field-input block w-28" />
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
          <button onClick={createItem} className="px-3 py-1.5 rounded-xl bg-brand-600 text-white text-xs font-semibold">
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

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
        </div>
      )}

      {/* Stock table grouped by category */}
      {!loading && Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => (
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
                <th className="text-right px-3 py-2 font-medium">{t.threshold}</th>
                <th className="text-right px-3 py-2 font-medium">{t.daysOfSupplyHeader}</th>
                {view === 'waste' && (
                  <th className="text-right px-3 py-2 font-medium">{t.deadStems}</th>
                )}
                <th className="text-right px-3 py-2 font-medium w-36"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <StockRow
                  key={item.id}
                  item={item}
                  showWaste={view === 'waste'}
                  onAdjust={adjustQty}
                  onWriteOff={writeOff}
                  onPatch={patchStock}
                  velocity={velocity[item.id]}
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
function StockRow({ item, showWaste, onAdjust, onWriteOff, onPatch, velocity }) {
  const [woQty, setWoQty]       = useState(1);
  const [woReason, setWoReason] = useState('');
  const [showWo, setShowWo]     = useState(false);
  const [editSupplier, setEditSupplier] = useState(false);

  const qty = item['Current Quantity'] || 0;
  const threshold = item['Reorder Threshold'] || 0;
  const isLow = qty > 0 && qty <= threshold;
  const isZero = qty === 0;
  const cost = item['Current Cost Price'] || 0;
  const sell = item['Current Sell Price'] || 0;
  const markupPct = cost > 0 && sell > 0 ? ((sell / cost - 1) * 100).toFixed(0) : '—';
  const dead = item['Dead/Unsold Stems'] || 0;
  const rowColor = isZero ? 'bg-ios-red/8' : isLow ? 'bg-ios-orange/8' : '';

  return (
    <>
      <tr className={`border-b border-gray-100 ${rowColor}`}>
        <td className="px-3 py-2 text-ios-label font-medium">{item['Display Name']}</td>
        <td className={`px-3 py-2 text-right font-semibold ${
          isZero ? 'text-ios-red' : isLow ? 'text-ios-orange' : 'text-ios-label'
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
                options={SUPPLIERS.map(s => ({ value: s, label: s }))}
                value={item.Supplier || ''}
                onChange={v => { onPatch(item.id, { Supplier: v }); setEditSupplier(false); }}
              />
            </div>
          )}
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
          <td colSpan={showWaste ? 10 : 9} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <input type="number" min="1" value={woQty}
                onChange={e => setWoQty(Number(e.target.value))}
                className="field-input w-16" />
              <input value={woReason} onChange={e => setWoReason(e.target.value)}
                placeholder={t.reason}
                className="field-input flex-1" />
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
