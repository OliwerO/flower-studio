// PurchaseOrderPage — mobile-optimized PO management for the owner in the florist app.
// Full lifecycle: create POs, edit drafts, send to driver, track status, manage payments.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import useConfigLists from '../hooks/useConfigLists.js';
import t from '../translations.js';

const STATUS_COLORS = {
  Draft:      'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  Sent:       'bg-blue-100 text-blue-700',
  Shopping:   'bg-amber-100 text-amber-700',
  Reviewing:  'bg-orange-100 text-orange-700',
  Evaluating: 'bg-purple-100 text-purple-700',
  Complete:   'bg-emerald-100 text-emerald-700',
};

const STATUS_LABELS = {
  Draft: () => t.po?.draft || 'Draft',
  Sent: () => t.po?.sent || 'Sent',
  Shopping: () => t.po?.shopping || 'Shopping',
  Reviewing: () => t.po?.reviewing || 'Reviewing',
  Evaluating: () => t.po?.evaluating || 'Evaluating',
  Complete: () => t.po?.complete || 'Complete',
};

export default function PurchaseOrderPage() {
  const navigate = useNavigate();
  const { suppliers: SUPPLIERS, targetMarkup, drivers: configDrivers } = useConfigLists();
  const { showToast } = useToast();

  const [orders, setOrders] = useState([]);
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedLines, setExpandedLines] = useState([]);
  const [drivers, setDrivers] = useState([]);

  // New PO form
  const [showForm, setShowForm] = useState(false);
  const [formLines, setFormLines] = useState([]);
  const [formNotes, setFormNotes] = useState('');
  const [formDriver, setFormDriver] = useState('');
  const [formPlannedDate, setFormPlannedDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Driver selection per expanded PO
  const [editDrivers, setEditDrivers] = useState({});

  const fetchOrders = useCallback(async () => {
    try {
      const res = await client.get('/stock-orders');
      setOrders(res.data);
    } catch {
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchOrders();
    client.get('/stock').then(r => setStock(r.data)).catch(() => {});
    client.get('/settings').then(r => setDrivers(r.data.drivers || [])).catch(() => {});
  }, [fetchOrders]);

  // Negative stock items for pre-filling new POs
  const negativeStock = stock.filter(s => (Number(s['Current Quantity']) || 0) < 0);

  function emptyLine() {
    return { stockItemId: '', flowerName: '', quantity: 1, lotSize: 0, supplier: '', costPrice: '', sellPrice: '', sellPriceManual: false, farmer: '', notes: '' };
  }

  function startNewPO() {
    const lines = negativeStock.map(item => {
      const lotSize = Number(item['Lot Size']) || 0;
      const rawQty = Math.abs(Number(item['Current Quantity']) || 0);
      const quantity = lotSize > 1 ? Math.ceil(rawQty / lotSize) * lotSize : rawQty;
      const cost = Number(item['Current Cost Price']) || 0;
      const sell = Number(item['Current Sell Price']) || 0;
      return {
        stockItemId: item.id,
        flowerName: item['Display Name'],
        quantity,
        lotSize,
        supplier: item.Supplier || '',
        costPrice: cost > 0 ? String(cost) : '',
        sellPrice: sell > 0 ? String(sell) : '',
        sellPriceManual: sell > 0,
        farmer: item.Farmer || '',
        notes: '',
      };
    });
    setFormLines(lines.length > 0 ? lines : [emptyLine()]);
    setFormNotes('');
    setFormDriver(drivers[0] || configDrivers[0] || 'Nikita');
    setFormPlannedDate('');
    setShowForm(true);
  }

  function updateFormLine(idx, patch) {
    setFormLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }

  function removeFormLine(idx) {
    setFormLines(prev => prev.filter((_, i) => i !== idx));
  }

  function handleStockSelect(idx, stockItem) {
    const cost = Number(stockItem['Current Cost Price']) || 0;
    const sell = Number(stockItem['Current Sell Price']) || 0;
    updateFormLine(idx, {
      stockItemId: stockItem.id,
      flowerName: stockItem['Display Name'],
      lotSize: Number(stockItem['Lot Size']) || 0,
      costPrice: cost > 0 ? String(cost) : '',
      sellPrice: sell > 0 ? String(sell) : (cost > 0 && targetMarkup ? String(Math.round(cost * targetMarkup)) : ''),
      sellPriceManual: sell > 0,
      supplier: stockItem.Supplier || '',
      farmer: stockItem.Farmer || '',
    });
  }

  function handleLineCostChange(idx, value) {
    const patch = { costPrice: value };
    const line = formLines[idx];
    if (!line.sellPriceManual && value && targetMarkup) {
      patch.sellPrice = String(Math.round(Number(value) * targetMarkup));
    }
    updateFormLine(idx, patch);
  }

  function handleLineSellChange(idx, value) {
    updateFormLine(idx, { sellPrice: value, sellPriceManual: true });
  }

  async function createPO() {
    if (formLines.length === 0) return;
    setSubmitting(true);
    try {
      await client.post('/stock-orders', {
        notes: formNotes,
        driver: formDriver,
        plannedDate: formPlannedDate || null,
        lines: formLines.filter(l => l.flowerName).map(l => ({
          ...l,
          costPrice: Number(l.costPrice) || 0,
          sellPrice: Number(l.sellPrice) || 0,
        })),
      });
      showToast(t.po?.created || 'PO created');
      setShowForm(false);
      fetchOrders();
    } catch {
      showToast(t.error, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function updateDraftLine(orderId, lineId, fields) {
    try {
      // Temp lines (not yet persisted) — create via POST when flower name is set
      if (typeof lineId === 'string' && lineId.startsWith('_temp_')) {
        if (!fields['Flower Name']?.trim()) {
          setExpandedLines(prev => prev.map(l => l.id === lineId ? { ...l, ...fields } : l));
          return;
        }
        const merged = expandedLines.find(l => l.id === lineId) || {};
        const payload = {
          flowerName: fields['Flower Name'] || merged['Flower Name'] || '',
          quantity: fields['Quantity Needed'] ?? merged['Quantity Needed'] ?? 1,
          supplier: fields.Supplier ?? merged.Supplier ?? '',
          costPrice: Number(fields['Cost Price'] ?? merged['Cost Price']) || 0,
          sellPrice: Number(fields['Sell Price'] ?? merged['Sell Price']) || 0,
          lotSize: Number(fields['Lot Size'] ?? merged['Lot Size']) || 0,
          farmer: fields.Farmer ?? merged.Farmer ?? '',
          notes: fields.Notes ?? merged.Notes ?? '',
          stockItemId: fields['Stock Item']?.[0] || '',
        };
        const created = await client.post(`/stock-orders/${orderId}/lines`, payload);
        setExpandedLines(prev => prev.map(l => l.id === lineId ? created.data : l));
        return;
      }
      await client.patch(`/stock-orders/${orderId}/lines/${lineId}`, fields);
      const res = await client.get(`/stock-orders/${orderId}`);
      setExpandedLines(res.data.lines || []);
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  async function removeDraftLine(orderId, lineId) {
    if (typeof lineId === 'string' && lineId.startsWith('_temp_')) {
      setExpandedLines(prev => prev.filter(l => l.id !== lineId));
      return;
    }
    try {
      await client.delete(`/stock-orders/${orderId}/lines/${lineId}`);
      setExpandedLines(prev => prev.filter(l => l.id !== lineId));
    } catch {
      showToast(t.error, 'error');
    }
  }

  function addDraftLine() {
    const tempLine = {
      id: `_temp_${Date.now()}`,
      'Flower Name': '',
      'Quantity Needed': 1,
      'Lot Size': 0,
      Supplier: '',
      'Cost Price': 0,
      'Sell Price': 0,
      Farmer: '',
      Notes: '',
    };
    setExpandedLines(prev => [...prev, tempLine]);
  }

  async function deleteDraftPO(orderId) {
    try {
      await client.delete(`/stock-orders/${orderId}`);
      showToast(t.po?.deleted || 'PO deleted', 'success');
      fetchOrders();
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  async function sendToDriver(orderId) {
    const driverName = editDrivers[orderId] || drivers[0] || 'Nikita';
    try {
      await client.post(`/stock-orders/${orderId}/send`, { driverName });
      showToast(t.po?.sentMsg || 'Sent');
      fetchOrders();
    } catch {
      showToast(t.error, 'error');
    }
  }

  async function toggleExpand(orderId) {
    if (expandedId === orderId) { setExpandedId(null); return; }
    try {
      const res = await client.get(`/stock-orders/${orderId}`);
      setExpandedLines(res.data.lines || []);
      setExpandedId(orderId);
    } catch {
      showToast(t.error, 'error');
    }
  }

  // Grand total for form
  const grandCost = formLines.reduce((sum, l) => {
    const qty = Number(l.quantity) || 0;
    const ls = Number(l.lotSize) || 0;
    const effectiveQty = ls > 1 ? Math.ceil(qty / ls) * ls : qty;
    return sum + effectiveQty * (Number(l.costPrice) || 0);
  }, 0);

  const allDrivers = drivers.length > 0 ? drivers : configDrivers.length > 0 ? configDrivers : ['Nikita'];

  return (
    <div className="min-h-screen">
      <header className="glass-nav px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <button onClick={() => navigate('/stock')} className="text-brand-600 font-medium text-base active-scale">
            ‹ {t.tabStock}
          </button>
          <h1 className="text-base font-semibold text-ios-label">{t.po?.title || 'Purchase Orders'}</h1>
          <button onClick={fetchOrders} className="text-ios-tertiary text-base active-scale">↻</button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 pb-28 space-y-4">

        {/* New PO button */}
        <button
          onClick={startNewPO}
          className="w-full h-12 rounded-2xl bg-brand-600 text-white text-base font-semibold shadow-sm active:bg-brand-700 active-scale"
        >
          + {t.po?.newOrder || 'New Purchase Order'}
          {negativeStock.length > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-white/20 text-xs">{negativeStock.length}</span>
          )}
        </button>

        {/* ── New PO Form ── */}
        {showForm && (
          <div className="ios-card p-4 space-y-4">
            <p className="text-sm font-semibold text-ios-label">{t.po?.newOrder}</p>

            {/* Lines */}
            {formLines.map((line, idx) => {
              const ls = Number(line.lotSize) || 0;
              const lotsNeeded = ls > 1 ? Math.ceil((line.quantity || 0) / ls) : 0;
              const lineCost = Number(line.costPrice) || 0;
              const lineSell = Number(line.sellPrice) || 0;
              const lineMarkup = lineCost > 0 && lineSell > 0 ? (lineSell / lineCost).toFixed(1) : null;
              return (
                <div key={idx} className="border border-gray-200 rounded-xl p-3 space-y-2">
                  {/* Flower name search */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <StockSearchInput
                        stock={stock}
                        value={line.flowerName}
                        onChange={val => updateFormLine(idx, { flowerName: val, stockItemId: '' })}
                        onSelect={item => handleStockSelect(idx, item)}
                      />
                    </div>
                    <button onClick={() => removeFormLine(idx)} className="text-ios-red text-sm px-1">✕</button>
                  </div>
                  {/* Qty + Lot + Supplier */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-ios-tertiary">{t.quantity || 'Qty'}:</span>
                      <input type="number" value={line.quantity}
                        onChange={e => updateFormLine(idx, { quantity: Number(e.target.value) })}
                        className="field-input w-16 text-center text-sm" min="1" />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-ios-tertiary">{t.lotSize}:</span>
                      <input type="number" value={line.lotSize || ''}
                        onChange={e => updateFormLine(idx, { lotSize: Number(e.target.value) || 0 })}
                        className="field-input w-14 text-center text-xs" min="0" placeholder="—" />
                    </div>
                    {lotsNeeded > 0 && (
                      <span className="text-xs text-ios-secondary font-medium">= {lotsNeeded} × {ls}</span>
                    )}
                    <select value={line.supplier}
                      onChange={e => updateFormLine(idx, { supplier: e.target.value })}
                      className="field-input flex-1 min-w-[100px] text-sm">
                      <option value="">{t.supplier || 'Supplier'}...</option>
                      {SUPPLIERS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  {/* Cost + Sell + Markup */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-ios-tertiary">{t.costPrice}:</span>
                      <input type="number" step="0.01" value={line.costPrice}
                        onChange={e => handleLineCostChange(idx, e.target.value)}
                        className="field-input w-20 text-sm text-right" placeholder="0" />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-ios-tertiary">{t.sellPrice}:</span>
                      <input type="number" step="0.01" value={line.sellPrice}
                        onChange={e => handleLineSellChange(idx, e.target.value)}
                        className="field-input w-20 text-sm text-right"
                        placeholder={lineCost && targetMarkup ? String(Math.round(lineCost * targetMarkup)) : '0'} />
                    </div>
                    {lineMarkup && (
                      <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
                        Number(lineMarkup) >= targetMarkup ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>×{lineMarkup}</span>
                    )}
                  </div>
                  {/* Farmer + Notes */}
                  <div className="flex items-center gap-2">
                    <input type="text" value={line.farmer || ''}
                      onChange={e => updateFormLine(idx, { farmer: e.target.value })}
                      className="field-input flex-1 text-sm" placeholder={t.farmer || 'Farmer'} />
                    <input type="text" value={line.notes || ''}
                      onChange={e => updateFormLine(idx, { notes: e.target.value })}
                      className="field-input flex-1 text-sm" placeholder={t.po?.notes || 'Notes'} />
                  </div>
                </div>
              );
            })}

            <button onClick={() => setFormLines(prev => [...prev, emptyLine()])}
              className="text-brand-600 text-sm font-medium">
              + {t.po?.addLine || 'Add line'}
            </button>

            {/* Grand total */}
            {grandCost > 0 && (
              <div className="text-sm px-1">
                <span className="text-ios-tertiary">{t.po?.costTotal || 'Cost total'}: </span>
                <span className="font-semibold text-ios-label">{grandCost.toFixed(0)} zł</span>
              </div>
            )}

            {/* Notes + Driver + Date */}
            <div className="space-y-3">
              <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)}
                className="field-input w-full text-sm" rows={2}
                placeholder={t.po?.notes || 'Notes'} />
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-ios-tertiary">{t.assignedDriver}</label>
                  <select value={formDriver} onChange={e => setFormDriver(e.target.value)}
                    className="field-input w-full text-sm">
                    {allDrivers.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-ios-tertiary">{t.po?.plannedDate || 'Date'}</label>
                  <input type="date" value={formPlannedDate}
                    onChange={e => setFormPlannedDate(e.target.value)}
                    className="field-input w-full text-sm" />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button onClick={createPO}
                disabled={submitting || formLines.every(l => !l.flowerName)}
                className="flex-1 py-3 rounded-2xl bg-brand-600 text-white text-sm font-semibold disabled:opacity-50 active-scale">
                {submitting ? (t.saving || 'Saving...') : (t.save || 'Save')}
              </button>
              <button onClick={() => setShowForm(false)}
                className="px-6 py-3 rounded-2xl bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 text-sm active-scale">
                {t.cancel}
              </button>
            </div>
          </div>
        )}

        {/* ── PO List ── */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : orders.length === 0 && !showForm ? (
          <p className="text-sm text-ios-tertiary text-center py-12">{t.po?.noOrders || 'No purchase orders'}</p>
        ) : (
          <div className="space-y-2">
            {orders.map(order => (
              <div key={order.id} className="ios-card overflow-hidden">
                {/* PO header row */}
                <button
                  onClick={() => toggleExpand(order.id)}
                  className="w-full text-left px-4 py-3 active:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.Status] || 'bg-gray-100 dark:bg-gray-700'}`}>
                        {(STATUS_LABELS[order.Status] || (() => order.Status))()}
                      </span>
                      <span className="text-sm font-medium text-ios-label">
                        PO #{order['Stock Order ID'] || '—'}
                      </span>
                    </div>
                    <span className="text-xs text-ios-tertiary">{order['Created Date']}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {order['Assigned Driver'] && (
                      <span className="text-xs text-ios-secondary">{order['Assigned Driver']}</span>
                    )}
                    {order['Planned Date'] && (
                      <span className="text-xs text-blue-600 font-medium">{order['Planned Date']}</span>
                    )}
                  </div>
                </button>

                {/* Expanded detail */}
                {expandedId === order.id && (
                  <div className="border-t border-gray-100 px-4 py-3 space-y-3">
                    {order.Notes && <p className="text-xs text-ios-secondary">{order.Notes}</p>}

                    {order.Status === 'Draft' ? (
                      /* ── Draft PO: editable lines ── */
                      <>
                        {expandedLines.map(line => (
                          <DraftLineEditor
                            key={line.id}
                            line={line}
                            stock={stock}
                            onUpdate={(lineId, fields) => updateDraftLine(order.id, lineId, fields)}
                            onRemove={(lineId) => removeDraftLine(order.id, lineId)}
                            targetMarkup={targetMarkup}
                            suppliers={SUPPLIERS}
                          />
                        ))}
                        <button onClick={() => addDraftLine()}
                          className="w-full py-2 text-sm text-brand-600 font-medium bg-brand-50 rounded-xl active:bg-brand-100 active-scale">
                          + {t.po?.addLine || 'Add line'}
                        </button>
                        <div className="flex items-center gap-2 pt-2">
                          <select
                            value={editDrivers[order.id] || order['Assigned Driver'] || allDrivers[0]}
                            onChange={e => setEditDrivers(prev => ({ ...prev, [order.id]: e.target.value }))}
                            className="field-input flex-1 text-sm">
                            {allDrivers.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                          <button onClick={() => sendToDriver(order.id)}
                            className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold active-scale">
                            {t.po?.sendToDriver || 'Send'}
                          </button>
                          <button onClick={() => { if (confirm(t.po?.deleteConfirm || 'Delete this draft PO?')) deleteDraftPO(order.id); }}
                            className="px-3 py-2.5 rounded-xl bg-ios-red/10 text-ios-red text-sm font-medium active-scale">
                            {t.po?.deletePO || 'Delete'}
                          </button>
                        </div>
                      </>
                    ) : (
                      /* ── Non-draft PO: read-only lines with driver results ── */
                      <>
                        {expandedLines.map(line => {
                          const lineLotSize = Number(line['Lot Size']) || 1;
                          const lineNeeded = Number(line['Quantity Needed']) || 0;
                          const lineLots = lineLotSize > 1 ? Math.ceil(lineNeeded / lineLotSize) : 0;
                          const costPrice = Number(line['Cost Price']) || 0;
                          const qtyFound = line['Quantity Found'];
                          const altName = line['Alt Flower Name'];
                          const altSupplier = line['Alt Supplier'];
                          const altQty = Number(line['Alt Quantity Found']) || 0;
                          return (
                            <div key={line.id} className="bg-gray-50 rounded-xl px-3 py-2 space-y-1">
                              <div className="flex items-center justify-between">
                                <div className="min-w-0">
                                  <span className="font-medium text-ios-label text-sm">{line['Flower Name']}</span>
                                  <span className="text-xs text-ios-tertiary ml-2">{line.Supplier}</span>
                                </div>
                                {line['Driver Status'] && line['Driver Status'] !== 'Pending' && (
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${
                                    line['Driver Status'] === 'Found All' ? 'bg-emerald-100 text-emerald-700' :
                                    line['Driver Status'] === 'Partial' ? 'bg-amber-100 text-amber-700' :
                                    'bg-red-100 text-red-700'
                                  }`}>{line['Driver Status']}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-ios-secondary flex-wrap">
                                <span>{t.po?.qtyNeeded || 'Need'}: {lineNeeded}{lineLots > 0 && ` (${lineLots}×${lineLotSize})`}</span>
                                {qtyFound != null && <span>{t.po?.found || 'Found'}: {qtyFound}</span>}
                                {costPrice > 0 && <span>{costPrice} zł</span>}
                              </div>
                              {(altName || altSupplier) && altQty > 0 && (
                                <div className="text-xs text-indigo-600">
                                  ↳ {altName || '?'} ({altSupplier}) × {altQty}
                                </div>
                              )}
                              {line['Quantity Accepted'] != null && (
                                <div className="text-xs text-emerald-600">✓ {t.po?.accepted || 'Accepted'}: {line['Quantity Accepted']}</div>
                              )}
                            </div>
                          );
                        })}

                        {/* Supplier + driver payments */}
                        {['Shopping', 'Reviewing'].includes(order.Status) && (() => {
                          let payments = {};
                          try { payments = JSON.parse(order['Supplier Payments'] || '{}'); } catch {}
                          const suppliers = [...new Set(expandedLines.map(l => l.Supplier).filter(Boolean))];
                          return (
                            <div className="space-y-2 pt-2 border-t border-gray-100">
                              {suppliers.map(sup => (
                                <div key={sup} className="flex items-center gap-2">
                                  <span className="text-xs text-ios-secondary flex-1 truncate">{t.po?.paidTo || 'Paid'} {sup}:</span>
                                  <input type="number" value={payments[sup] ?? ''}
                                    onChange={e => {
                                      const val = e.target.value;
                                      const updated = { ...payments, [sup]: val === '' ? '' : Number(val) || 0 };
                                      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, 'Supplier Payments': JSON.stringify(updated) } : o));
                                    }}
                                    onBlur={async () => {
                                      try {
                                        const current = orders.find(o => o.id === order.id);
                                        await client.patch(`/stock-orders/${order.id}`, { 'Supplier Payments': current['Supplier Payments'] });
                                      } catch { showToast(t.error, 'error'); }
                                    }}
                                    className="w-20 text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-right" />
                                  <span className="text-xs text-ios-tertiary">zł</span>
                                </div>
                              ))}
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-ios-secondary flex-1">{t.po?.driverPayment || 'Driver'}:</span>
                                <input type="number" value={order['Driver Payment'] ?? ''}
                                  onChange={e => setOrders(prev => prev.map(o => o.id === order.id ? { ...o, 'Driver Payment': e.target.value } : o))}
                                  onBlur={async () => {
                                    try {
                                      await client.patch(`/stock-orders/${order.id}`, { 'Driver Payment': Number(order['Driver Payment']) || 0 });
                                    } catch { showToast(t.error, 'error'); }
                                  }}
                                  className="w-20 text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-right" />
                                <span className="text-xs text-ios-tertiary">zł</span>
                              </div>
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ── Stock search dropdown (mobile-optimized) ──
function StockSearchInput({ stock, value, onChange, onSelect, onBlur: onBlurCb }) {
  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);
  // Track whether the user selected from the dropdown — skip onBlur save
  // to avoid a race between the select PATCH and a redundant blur PATCH.
  const selectedRef = useRef(false);

  useEffect(() => { setQuery(value || ''); }, [value]);

  const filtered = query
    ? (stock || []).filter(s =>
        (s['Display Name'] || '').toLowerCase().includes(query.toLowerCase())
      ).slice(0, 6)
    : [];

  const exactMatch = query && (stock || []).some(s =>
    (s['Display Name'] || '').toLowerCase() === query.toLowerCase()
  );

  return (
    <div className="relative">
      <input type="text" value={query}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => { if (query) setOpen(true); }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 200);
          if (!selectedRef.current) onBlurCb?.(query);
          selectedRef.current = false;
        }}
        placeholder={t.po?.flowerSearch || 'Search...'}
        className="field-input w-full text-sm" />
      {open && query && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
          {filtered.map(s => (
            <button key={s.id} type="button"
              onMouseDown={() => { selectedRef.current = true; onSelect(s); setQuery(s['Display Name']); setOpen(false); }}
              className="w-full text-left px-3 py-2.5 text-sm active:bg-gray-50 border-b border-gray-50">
              <span className="font-medium">{s['Display Name']}</span>
              <span className="text-xs text-ios-secondary ml-1">({s['Current Quantity'] ?? 0})</span>
            </button>
          ))}
          {!exactMatch && query.length >= 2 && (
            <button type="button"
              onMouseDown={() => { selectedRef.current = true; onChange(query); setOpen(false); }}
              className="w-full text-left px-3 py-2.5 text-sm border-t border-gray-100 text-brand-600 font-medium active:bg-brand-50">
              + {t.po?.addNewFlower || 'Add'} "{query}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Draft line editor (mobile layout) ──
function DraftLineEditor({ line, stock, onUpdate, onRemove, targetMarkup, suppliers }) {
  const storedLs = Number(line['Lot Size']) || 0;
  const storedQty = Number(line['Quantity Needed']) || 1;
  // Display qty as lots (user enters lots, not stems)
  const initLots = storedLs > 1 ? Math.max(1, Math.round(storedQty / storedLs)) : storedQty;
  const [qty, setQty] = useState(initLots);
  const [costPrice, setCostPrice] = useState(line['Cost Price'] || '');
  const [sellPrice, setSellPrice] = useState(line['Sell Price'] || '');
  const [sellPriceManual, setSellPriceManual] = useState(Number(line['Sell Price']) > 0);
  const [farmer, setFarmer] = useState(line.Farmer || '');
  const [notes, setNotes] = useState(line.Notes || '');
  const [lotSize, setLotSize] = useState(storedLs);
  // Local flower name — avoids PATCHing partial names on every keystroke
  // which caused a race condition where "Hydrangea" got overwritten with "h".
  const [flowerName, setFlowerName] = useState(line['Flower Name'] || '');
  useEffect(() => { setFlowerName(line['Flower Name'] || ''); }, [line['Flower Name']]);

  const cost = Number(costPrice) || 0;
  const sell = Number(sellPrice) || 0;
  const computedMarkup = cost > 0 && sell > 0 ? (sell / cost).toFixed(1) : null;

  function handleStockSelect(item) {
    const itemCost = Number(item['Current Cost Price']) || 0;
    const itemSell = Number(item['Current Sell Price']) || 0;
    setCostPrice(itemCost > 0 ? String(itemCost) : '');
    setSellPrice(itemSell > 0 ? String(itemSell) : (itemCost > 0 && targetMarkup ? String(Math.round(itemCost * targetMarkup)) : ''));
    setSellPriceManual(itemSell > 0);
    setFarmer(item.Farmer || '');
    setLotSize(Number(item['Lot Size']) || 0);
    setFlowerName(item['Display Name']);
    onUpdate(line.id, {
      'Flower Name': item['Display Name'],
      'Stock Item': [item.id],
      Supplier: item.Supplier || '',
      'Cost Price': itemCost,
      'Sell Price': itemSell || (itemCost > 0 && targetMarkup ? Math.round(itemCost * targetMarkup) : 0),
      'Lot Size': Number(item['Lot Size']) || 0,
      'Quantity Needed': qty,
      Farmer: item.Farmer || '',
    });
  }

  function handleCostChange(value) {
    setCostPrice(value);
    if (!sellPriceManual && value && targetMarkup) {
      setSellPrice(String(Math.round(Number(value) * targetMarkup)));
    }
  }

  function handleSellChange(value) {
    setSellPrice(value);
    setSellPriceManual(true);
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-3.5 py-3 space-y-3">
      {/* Header: Flower name + remove */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <StockSearchInput stock={stock}
            value={flowerName}
            onChange={name => setFlowerName(name)}
            onSelect={handleStockSelect}
            onBlur={name => {
              if (name && name !== (line['Flower Name'] || '')) {
                onUpdate(line.id, { 'Flower Name': name });
              }
            }} />
        </div>
        <button onClick={() => onRemove(line.id)} className="w-7 h-7 rounded-full bg-red-50 text-red-400 active:bg-red-100 active:text-red-600 text-sm flex items-center justify-center">✕</button>
      </div>

      {/* Quantity row */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 bg-gray-50 rounded-xl px-2.5 py-1.5">
          <input type="number" value={qty}
            onChange={e => setQty(Number(e.target.value) || 0)}
            onBlur={() => {
              const stems = lotSize > 1 ? qty * lotSize : qty;
              onUpdate(line.id, { 'Quantity Needed': stems });
            }}
            className="w-10 text-center text-sm font-bold bg-transparent outline-none" min="1" />
          <span className="text-ios-tertiary text-xs">×</span>
          <input type="number" value={lotSize || ''}
            onChange={e => setLotSize(Number(e.target.value) || 0)}
            onBlur={() => {
              onUpdate(line.id, { 'Lot Size': lotSize, 'Quantity Needed': lotSize > 1 ? qty * lotSize : qty });
            }}
            className="w-10 text-center text-sm bg-transparent outline-none" min="0" placeholder="lot" />
        </div>
        {lotSize > 1 && qty > 0 && (
          <span className="text-base font-bold text-brand-700">
            = {qty * lotSize} <span className="text-xs font-normal text-ios-tertiary">{t.stems || 'pcs'}</span>
          </span>
        )}
        <div className="ml-auto">
          <select value={line.Supplier || ''}
            onChange={e => onUpdate(line.id, { Supplier: e.target.value })}
            className="field-input text-sm py-1.5">
            <option value="">{t.supplier || 'Supplier'}...</option>
            {(suppliers || []).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Prices row */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 flex-1">
          <span className="text-[10px] text-ios-tertiary shrink-0">{t.costPrice || 'Cost'}:</span>
          <input type="number" step="0.01" value={costPrice}
            onChange={e => handleCostChange(e.target.value)}
            onBlur={() => onUpdate(line.id, { 'Cost Price': Number(costPrice) || 0, 'Sell Price': Number(sellPrice) || 0 })}
            className="field-input w-full text-sm text-right py-1" placeholder="0" />
        </div>
        <div className="flex items-center gap-1 flex-1">
          <span className="text-[10px] text-ios-tertiary shrink-0">{t.sellPrice || 'Sell'}:</span>
          <input type="number" step="0.01" value={sellPrice}
            onChange={e => handleSellChange(e.target.value)}
            onBlur={() => onUpdate(line.id, { 'Sell Price': Number(sellPrice) || 0 })}
            className="field-input w-full text-sm text-right py-1" placeholder="0" />
        </div>
        {computedMarkup && (
          <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
            Number(computedMarkup) >= targetMarkup ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>×{computedMarkup}</span>
        )}
      </div>

      {/* Farmer + Notes row */}
      <div className="flex items-center gap-2">
        <input type="text" value={farmer}
          onChange={e => setFarmer(e.target.value)}
          onBlur={() => onUpdate(line.id, { Farmer: farmer })}
          className="field-input flex-1 text-sm py-1" placeholder={t.farmer || 'Farmer'} />
        <input type="text" value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={() => onUpdate(line.id, { Notes: notes })}
          className="field-input flex-1 text-sm py-1" placeholder={t.po?.notes || 'Notes'} />
      </div>
    </div>
  );
}
