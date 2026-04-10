// StockOrderPanel — Purchase Order management for the dashboard Stock tab.
// Like a procurement kanban: create POs, assign drivers, track progress, view history.

import { useState, useEffect, useCallback, useRef } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import useConfigLists from '../hooks/useConfigLists.js';

const STATUS_COLORS = {
  Draft:        'bg-gray-100 text-gray-700',
  Sent:         'bg-blue-100 text-blue-700',
  Shopping:     'bg-amber-100 text-amber-700',
  Reviewing:    'bg-orange-100 text-orange-700',
  Evaluating:   'bg-purple-100 text-purple-700',
  'Eval Error': 'bg-red-100 text-red-700',
  Complete:     'bg-emerald-100 text-emerald-700',
};

export default function StockOrderPanel({ negativeStock, stock, autoCreate, onClose }) {
  const { suppliers: SUPPLIERS, targetMarkup } = useConfigLists();
  const { showToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedLines, setExpandedLines] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [drivers, setDrivers] = useState([]);

  // New PO form state
  const [formLines, setFormLines] = useState([]);
  const [formNotes, setFormNotes] = useState('');
  const [formDriver, setFormDriver] = useState('Nikita');
  const [formPlannedDate, setFormPlannedDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Separate driver state for expanded/existing POs (keyed by PO id)
  // Prevents editing an existing PO's driver from changing the new-PO form.
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
    client.get('/settings').then(r => setDrivers(r.data.drivers || [])).catch(() => {});
  }, [fetchOrders]);

  // Auto-open "New PO" form when navigating from Today tab's "Create Purchase Order" button.
  // Like a kanban card automatically moving to the next station — no extra click needed.
  const autoCreated = useRef(false);
  useEffect(() => {
    if (autoCreate && !autoCreated.current && stock?.length > 0) {
      autoCreated.current = true;
      startNewPO();
    }
  }, [autoCreate, stock]);

  // Pre-fill form from negative stock items
  // Quantity defaults to full lots (rounded up) so the driver buys in pack multiples.
  function startNewPO() {
    const lines = (negativeStock || []).map(item => {
      const si = (stock || []).find(s => s.id === item.id);
      const lotSize = Number(si?.['Lot Size']) || 0;
      const rawQty = Math.abs(item.qty);
      const quantity = lotSize > 1 ? Math.ceil(rawQty / lotSize) * lotSize : rawQty;
      const cost = si ? (Number(si['Current Cost Price']) || 0) : 0;
      const sell = si ? (Number(si['Current Sell Price']) || 0) : 0;
      return {
        stockItemId: item.id,
        flowerName: item.name,
        quantity,
        lotSize,
        supplier: item.supplier || si?.Supplier || '',
        costPrice: cost > 0 ? String(cost) : '',
        sellPrice: sell > 0 ? String(sell) : '',
        sellPriceManual: sell > 0,
        farmer: si?.Farmer || '',
        notes: '',
      };
    });

    setFormLines(lines.length > 0 ? lines : [emptyLine()]);
    setFormNotes('');
    setFormDriver('Nikita');
    setFormPlannedDate('');
    setShowForm(true);
  }

  function emptyLine() {
    return { stockItemId: '', flowerName: '', quantity: 1, lotSize: 0, supplier: '', costPrice: '', sellPrice: '', sellPriceManual: false, farmer: '', notes: '' };
  }

  function updateFormLine(idx, patch) {
    setFormLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }

  function removeFormLine(idx) {
    setFormLines(prev => prev.filter((_, i) => i !== idx));
  }

  // Stock search for adding lines — auto-fill cost/sell/farmer from stock data
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

  // Auto-calculate sell price when cost changes (unless manually overridden)
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
      showToast(t.stockOrderCreated);
      setShowForm(false);
      fetchOrders();
    } catch (err) {
      console.error('PO create failed:', err.response?.data || err.message);
      showToast(err.response?.data?.error || t.error, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // Draft PO line editing
  async function updateDraftLine(orderId, lineId, fields) {
    try {
      await client.patch(`/stock-orders/${orderId}/lines/${lineId}`, fields);
      const res = await client.get(`/stock-orders/${orderId}`);
      setExpandedLines(res.data.lines || []);
    } catch (err) {
      console.error('PO line update failed:', err.response?.data || err.message);
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  async function removeDraftLine(orderId, lineId) {
    try {
      await client.delete(`/stock-orders/${orderId}/lines/${lineId}`);
      setExpandedLines(prev => prev.filter(l => l.id !== lineId));
    } catch (err) {
      console.error('PO line remove failed:', err.response?.data || err.message);
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  async function addDraftLine(orderId) {
    try {
      const line = await client.post(`/stock-orders/${orderId}/lines`, {
        flowerName: '', quantity: 1,
      });
      setExpandedLines(prev => [...prev, line.data]);
    } catch (err) {
      console.error('PO line add failed:', err.response?.data || err.message);
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  async function deleteDraftPO(orderId) {
    try {
      await client.delete(`/stock-orders/${orderId}`);
      showToast(t.poDeleted || 'PO deleted', 'success');
      fetchOrders();
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  // Resolve the driver currently shown in the dropdown for a given PO.
  // CRITICAL: UI display and send-payload MUST use the exact same fallback chain,
  // otherwise the owner sees "Nikita" but the PO silently goes to drivers[0].
  function resolveDriverFor(order) {
    return editDrivers[order.id] || order['Assigned Driver'] || drivers[0] || 'Nikita';
  }

  async function sendToDriver(order) {
    const driverName = resolveDriverFor(order);
    try {
      if (order.Status === 'Draft') {
        // First release: /send transitions Draft → Sent AND stamps the driver.
        await client.post(`/stock-orders/${order.id}/send`, { driverName });
      } else {
        // Already live: just reassign via header PATCH. Backend broadcasts
        // stock_pickup_assigned so the new driver's app refetches immediately.
        await client.patch(`/stock-orders/${order.id}`, { 'Assigned Driver': driverName });
      }
      showToast(t.stockOrderSentMsg);
      fetchOrders();
    } catch (err) {
      console.error('PO send failed:', err.response?.data || err.message);
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  async function toggleExpand(orderId) {
    if (expandedId === orderId) {
      setExpandedId(null);
      return;
    }
    try {
      const res = await client.get(`/stock-orders/${orderId}`);
      setExpandedLines(res.data.lines || []);
      setExpandedId(orderId);
    } catch (err) {
      console.error('PO expand failed:', err.response?.data || err.message);
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  // Group form lines by supplier for display
  const formLinesBySupplier = {};
  for (const [idx, line] of formLines.entries()) {
    const sup = line.supplier || '—';
    if (!formLinesBySupplier[sup]) formLinesBySupplier[sup] = [];
    formLinesBySupplier[sup].push({ ...line, _idx: idx });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-ios-label">{t.stockOrders}</h2>
        <div className="flex gap-2">
          <button
            onClick={startNewPO}
            className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold active-scale"
          >
            {t.newStockOrder}
          </button>
          {onClose && (
            <button onClick={onClose} className="px-3 py-2 rounded-xl bg-gray-100 text-ios-secondary text-sm">
              {t.close}
            </button>
          )}
        </div>
      </div>

      {/* New PO form */}
      {showForm && (
        <div className="glass-card p-4 space-y-4">
          <h3 className="text-sm font-semibold text-ios-label">{t.newStockOrder}</h3>

          {/* Lines grouped by supplier */}
          {Object.entries(formLinesBySupplier).map(([sup, lines]) => (
            <div key={sup} className="border border-gray-200 rounded-xl overflow-visible">
              <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-ios-secondary uppercase">
                {sup}
              </div>
              {lines.map(line => {
                const ls = Number(line.lotSize) || 0;
                const lotsNeeded = ls > 1 ? Math.ceil((line.quantity || 0) / ls) : 0;
                const lineCost = Number(line.costPrice) || 0;
                const lineSell = Number(line.sellPrice) || 0;
                const lineQty = Number(line.quantity) || 0;
                const lineMarkup = lineCost > 0 && lineSell > 0 ? (lineSell / lineCost).toFixed(1) : null;
                return (
                <div key={line._idx} className="px-3 py-2 border-t border-gray-100 space-y-2">
                  {/* Row 1: Item + Qty + Lot + Supplier + Remove */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <StockSearchInput
                        stock={stock}
                        value={line.flowerName}
                        onChange={val => updateFormLine(line._idx, { flowerName: val, stockItemId: '' })}
                        onSelect={item => handleStockSelect(line._idx, item)}
                      />
                    </div>
                    <input
                      type="number"
                      value={line.quantity}
                      onChange={e => updateFormLine(line._idx, { quantity: Number(e.target.value) })}
                      className="field-input w-16 text-center"
                      min="1"
                      title={t.quantity}
                      placeholder={t.quantity}
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-ios-tertiary">{t.lotSize}:</span>
                      <input
                        type="number"
                        value={line.lotSize || ''}
                        onChange={e => updateFormLine(line._idx, { lotSize: Number(e.target.value) || 0 })}
                        className="field-input w-14 text-center text-xs"
                        min="0"
                        placeholder="—"
                      />
                    </div>
                    {lotsNeeded > 0 && (
                      <span className="text-xs text-ios-secondary whitespace-nowrap font-medium">
                        = {lotsNeeded} × {ls}
                      </span>
                    )}
                    <select
                      value={line.supplier}
                      onChange={e => updateFormLine(line._idx, { supplier: e.target.value })}
                      className="field-input w-28"
                    >
                      <option value="">—</option>
                      {SUPPLIERS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button
                      onClick={() => removeFormLine(line._idx)}
                      className="text-ios-red text-sm px-1"
                    >✕</button>
                  </div>
                  {/* Row 2: Cost + Sell + Markup + Farmer + Notes */}
                  <div className="flex items-center gap-2 pl-1">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-ios-tertiary">{t.costPrice}:</span>
                      <input
                        type="number" step="0.01"
                        value={line.costPrice}
                        onChange={e => handleLineCostChange(line._idx, e.target.value)}
                        className="field-input w-20 text-sm text-right"
                        placeholder="0"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-ios-tertiary">{t.sellPrice}:</span>
                      <input
                        type="number" step="0.01"
                        value={line.sellPrice}
                        onChange={e => handleLineSellChange(line._idx, e.target.value)}
                        className="field-input w-20 text-sm text-right"
                        placeholder={lineCost && targetMarkup ? String(Math.round(lineCost * targetMarkup)) : '0'}
                      />
                    </div>
                    {lineMarkup && (
                      <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
                        Number(lineMarkup) >= targetMarkup
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        ×{lineMarkup}
                      </span>
                    )}
                    {lineQty > 0 && lineCost > 0 && (
                      <span className="text-xs text-ios-tertiary whitespace-nowrap">
                        = {((ls > 1 ? Math.ceil(lineQty / ls) * ls : lineQty) * lineCost).toFixed(0)} {t.zl}
                      </span>
                    )}
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-ios-tertiary">{t.farmer}:</span>
                      <input
                        type="text"
                        value={line.farmer || ''}
                        onChange={e => updateFormLine(line._idx, { farmer: e.target.value })}
                        className="field-input w-28 text-sm"
                        placeholder="—"
                      />
                    </div>
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <span className="text-[10px] text-ios-tertiary">{t.notes}:</span>
                      <input
                        type="text"
                        value={line.notes || ''}
                        onChange={e => updateFormLine(line._idx, { notes: e.target.value })}
                        className="field-input w-full text-sm"
                        placeholder="—"
                      />
                    </div>
                  </div>
                </div>
              );})}
            </div>
          ))}

          <button
            onClick={() => setFormLines(prev => [...prev, emptyLine()])}
            className="text-brand-600 text-sm font-medium"
          >
            + {t.addLine}
          </button>

          {/* Grand total — uses lot-rounded quantities for cost calculation */}
          {(() => {
            const grandCost = formLines.reduce((sum, l) => {
              const qty = Number(l.quantity) || 0;
              const ls = Number(l.lotSize) || 0;
              const effectiveQty = ls > 1 ? Math.ceil(qty / ls) * ls : qty;
              return sum + effectiveQty * (Number(l.costPrice) || 0);
            }, 0);
            const grandSell = formLines.reduce((sum, l) => {
              const qty = Number(l.quantity) || 0;
              const ls = Number(l.lotSize) || 0;
              const effectiveQty = ls > 1 ? Math.ceil(qty / ls) * ls : qty;
              return sum + effectiveQty * (Number(l.sellPrice) || 0);
            }, 0);
            return grandCost > 0 ? (
              <div className="flex items-center gap-4 text-sm px-1">
                <span className="text-ios-tertiary">{t.costTotal}: <span className="font-semibold text-ios-label">{grandCost.toFixed(0)} {t.zl}</span></span>
                {grandSell > 0 && (
                  <span className="text-ios-tertiary">{t.sellTotal}: <span className="font-semibold text-ios-green">{grandSell.toFixed(0)} {t.zl}</span></span>
                )}
              </div>
            ) : null;
          })()}

          {/* Notes + driver + planned date + actions */}
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-ios-tertiary">{t.stockOrderNotes}</label>
              <textarea
                value={formNotes}
                onChange={e => setFormNotes(e.target.value)}
                className="field-input w-full"
                rows={2}
              />
            </div>
            <div>
              <label className="text-xs text-ios-tertiary">{t.plannedDate || 'Planned date'}</label>
              <input
                type="date"
                value={formPlannedDate}
                onChange={e => setFormPlannedDate(e.target.value)}
                className="field-input block w-36"
              />
            </div>
            <div>
              <label className="text-xs text-ios-tertiary">{t.assignedDriver}</label>
              <select
                value={formDriver}
                onChange={e => setFormDriver(e.target.value)}
                className="field-input block w-32"
              >
                {drivers.map(d => <option key={d} value={d}>{d}</option>)}
                {drivers.length === 0 && <option value="Nikita">Nikita</option>}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={createPO}
              disabled={submitting || formLines.every(l => !l.flowerName)}
              className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              {submitting ? t.saving : t.save}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-xl bg-gray-100 text-ios-secondary text-sm"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {/* PO list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <p className="text-sm text-ios-tertiary text-center py-8">{t.noStockOrders}</p>
      ) : (
        <div className="space-y-2">
          {orders.map(order => (
            <div key={order.id} className="glass-card overflow-hidden">
              <div
                onClick={() => toggleExpand(order.id)}
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.Status] || 'bg-gray-100'}`}>
                    {order.Status}
                  </span>
                  <span className="text-sm font-medium text-ios-label">
                    PO #{order['Stock Order ID'] || '—'}
                  </span>
                  {order['Assigned Driver'] && (
                    <span className="text-xs text-ios-secondary">{order['Assigned Driver']}</span>
                  )}
                  {order['Planned Date'] && (
                    <span className="text-xs text-blue-600 font-medium">
                      {t.plannedDate || 'Planned'}: {order['Planned Date']}
                    </span>
                  )}
                </div>
                <span className="text-xs text-ios-tertiary">{order['Created Date']}</span>
              </div>

              {/* Expanded detail */}
              {expandedId === order.id && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-2">
                  {order.Notes && (
                    <p className="text-xs text-ios-secondary">{order.Notes}</p>
                  )}

                  {/* Editable POs: Draft + Sent + Shopping. Reviewing/Evaluating/Complete stay read-only. */}
                  {['Draft', 'Sent', 'Shopping'].includes(order.Status) ? (
                    <>
                      {expandedLines.map((line, idx) => (
                        <DraftLineEditor
                          key={line.id}
                          line={line}
                          stock={stock}
                          orderId={order.id}
                          onUpdate={(lineId, fields) => updateDraftLine(order.id, lineId, fields)}
                          onRemove={(lineId) => removeDraftLine(order.id, lineId)}
                          targetMarkup={targetMarkup}
                          suppliers={SUPPLIERS}
                        />
                      ))}
                      <button
                        onClick={() => addDraftLine(order.id)}
                        className="w-full py-2 text-sm text-brand-600 font-medium bg-brand-50 rounded-lg hover:bg-brand-100 transition-colors"
                      >
                        + {t.addLine || 'Add line'}
                      </button>
                      <div className="flex items-center gap-2 pt-2">
                        <select
                          value={resolveDriverFor(order)}
                          onChange={e => setEditDrivers(prev => ({ ...prev, [order.id]: e.target.value }))}
                          className="field-input w-32"
                        >
                          {drivers.map(d => <option key={d} value={d}>{d}</option>)}
                          {drivers.length === 0 && <option value="Nikita">Nikita</option>}
                        </select>
                        <button
                          onClick={() => sendToDriver(order)}
                          className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold active-scale"
                        >
                          {order.Status === 'Draft' ? t.sendToDriver : (t.reassignDriver || t.sendToDriver)}
                        </button>
                        {order.Status === 'Draft' && (
                          <button
                            onClick={() => { if (confirm(t.deletePOConfirm || 'Delete this draft PO?')) deleteDraftPO(order.id); }}
                            className="px-3 py-2 rounded-xl bg-ios-red/10 text-ios-red text-sm font-medium"
                          >
                            {t.deletePO || 'Delete PO'}
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    /* Non-draft POs: detailed line view with driver results.
                       Owner can correct alt entries during Reviewing — these
                       are the substitutions the driver made on the road. */
                    <>
                      {expandedLines.map(line => {
                        const lineLotSize = Number(line['Lot Size']) || 1;
                        const lineNeeded = Number(line['Quantity Needed']) || 0;
                        const lineLots = lineLotSize > 1 ? Math.ceil(lineNeeded / lineLotSize) : 0;
                        const costPrice = Number(line['Cost Price']) || 0;
                        const qtyFound = line['Quantity Found'];
                        const editable = order.Status === 'Reviewing';
                        return (
                          <div key={line.id} className="bg-gray-50 rounded-lg px-3 py-2 text-sm space-y-1">
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="font-medium text-ios-label">{line['Flower Name']}</span>
                                <span className="text-xs text-ios-tertiary ml-2">{line.Supplier}</span>
                              </div>
                              {line['Driver Status'] && line['Driver Status'] !== 'Pending' && (
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                  line['Driver Status'] === 'Found All' ? 'bg-emerald-100 text-emerald-700' :
                                  line['Driver Status'] === 'Partial' ? 'bg-amber-100 text-amber-700' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {line['Driver Status']}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-4 text-xs text-ios-secondary">
                              <span>{t.qtyNeeded}: {lineNeeded}{lineLots > 0 && ` (${lineLots}×${lineLotSize})`}</span>
                              {qtyFound != null && <span>{t.found || 'Found'}: {qtyFound}</span>}
                              {costPrice > 0 && <span>{costPrice} zł/{t.unit || 'pc'}</span>}
                            </div>
                            <AltLineEditor
                              line={line}
                              orderId={order.id}
                              stock={stock}
                              suppliers={SUPPLIERS}
                              editable={editable}
                              onSave={async (fields) => {
                                try {
                                  await client.patch(`/stock-orders/${order.id}/lines/${line.id}`, fields);
                                  const res = await client.get(`/stock-orders/${order.id}`);
                                  setExpandedLines(res.data.lines || []);
                                } catch (err) {
                                  showToast(err.response?.data?.error || t.error, 'error');
                                }
                              }}
                            />
                            {line['Quantity Accepted'] != null && (
                              <div className="text-xs text-emerald-600">✓ {t.accepted || 'Accepted'}: {line['Quantity Accepted']}</div>
                            )}
                          </div>
                        );
                      })}

                      {/* Supplier + driver payments for Shopping/Reviewing POs.
                          Union with alt suppliers — see same fix in driver app. */}
                      {['Shopping', 'Reviewing'].includes(order.Status) && (() => {
                        let payments = {};
                        try { payments = JSON.parse(order['Supplier Payments'] || '{}'); } catch {}
                        const plannedSuppliers = expandedLines.map(l => l.Supplier).filter(Boolean);
                        const altSuppliers = expandedLines
                          .filter(l => l['Alt Supplier'] && Number(l['Alt Quantity Found']) > 0)
                          .map(l => l['Alt Supplier']);
                        const suppliers = [...new Set([...plannedSuppliers, ...altSuppliers])];
                        return (
                          <div className="space-y-2 pt-2 border-t border-gray-100">
                            {suppliers.map(sup => (
                              <div key={sup} className="flex items-center gap-2">
                                <span className="text-xs text-ios-secondary w-28 truncate">{t.paidTo || 'Paid'} {sup}:</span>
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
                                  className="w-20 text-sm border border-gray-200 rounded-lg px-2 py-1 text-right" />
                                <span className="text-xs text-ios-tertiary">zł</span>
                              </div>
                            ))}
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-ios-secondary w-28">{t.driverPayment || 'Driver payment'}:</span>
                              <input type="number" value={order['Driver Payment'] ?? ''}
                                onChange={e => setOrders(prev => prev.map(o => o.id === order.id ? { ...o, 'Driver Payment': e.target.value } : o))}
                                onBlur={async () => {
                                  try {
                                    await client.patch(`/stock-orders/${order.id}`, { 'Driver Payment': Number(order['Driver Payment']) || 0 });
                                  } catch { showToast(t.error, 'error'); }
                                }}
                                className="w-20 text-sm border border-gray-200 rounded-lg px-2 py-1 text-right" />
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
    </div>
  );
}

// AltLineEditor — owner's view of a substituted line during Reviewing.
// Read-only chip when nothing was substituted; editable form (with flower +
// supplier dropdowns and an alt cost field) when the driver flagged Partial /
// Not Found OR an alt supplier is already populated. Uses native datalist for
// the dropdowns — same UX as the driver app but desktop-styled.
function AltLineEditor({ line, stock, suppliers, editable, onSave }) {
  const [altName, setAltName] = useState(line['Alt Flower Name'] || '');
  const [altSupplier, setAltSupplier] = useState(line['Alt Supplier'] || '');
  const [altQty, setAltQty] = useState(line['Alt Quantity Found'] || '');
  const [altCost, setAltCost] = useState(line['Alt Cost'] || '');

  // Sync external updates (e.g. SSE refresh after driver edit)
  useEffect(() => {
    setAltName(line['Alt Flower Name'] || '');
    setAltSupplier(line['Alt Supplier'] || '');
    setAltQty(line['Alt Quantity Found'] || '');
    setAltCost(line['Alt Cost'] || '');
  }, [line.id, line['Alt Flower Name'], line['Alt Supplier'], line['Alt Quantity Found'], line['Alt Cost']]);

  const driverStatus = line['Driver Status'] || 'Pending';
  const hasAlt = !!(altName || altSupplier || Number(altQty) > 0);
  const showEditor = editable && (driverStatus === 'Partial' || driverStatus === 'Not Found' || hasAlt);

  // Read-only chip — same look as before, just preserved for non-editable view
  if (!editable) {
    if (!hasAlt) return null;
    return (
      <div className="text-xs text-indigo-600">
        ↳ {altName || '?'} ({altSupplier || '?'}) × {altQty || 0}
        {altCost ? <span className="ml-1">· {altCost} zł</span> : null}
      </div>
    );
  }

  if (!showEditor) return null;

  return (
    <div className="mt-2 p-2 bg-indigo-50 rounded-lg space-y-2">
      <p className="text-xs font-semibold text-indigo-700">↳ {t.substitution || 'Substitution'}</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-ios-tertiary uppercase">{t.altFlowerName || 'Flower'}</label>
          <input
            type="text"
            list={`owner-alt-flowers-${line.id}`}
            value={altName}
            onChange={e => setAltName(e.target.value)}
            onBlur={() => onSave({ 'Alt Flower Name': altName })}
            className="field-input w-full text-sm"
            placeholder={t.altFlowerName || 'Flower'}
          />
          <datalist id={`owner-alt-flowers-${line.id}`}>
            {(stock || []).map(s => <option key={s.id} value={s['Display Name']} />)}
          </datalist>
        </div>
        <div>
          <label className="text-[10px] text-ios-tertiary uppercase">{t.altSupplier || 'Supplier'}</label>
          <input
            type="text"
            list={`owner-alt-suppliers-${line.id}`}
            value={altSupplier}
            onChange={e => setAltSupplier(e.target.value)}
            onBlur={() => onSave({ 'Alt Supplier': altSupplier })}
            className="field-input w-full text-sm"
            placeholder={t.altSupplier || 'Supplier'}
          />
          <datalist id={`owner-alt-suppliers-${line.id}`}>
            {(suppliers || []).map(s => <option key={s} value={s} />)}
          </datalist>
        </div>
        <div>
          <label className="text-[10px] text-ios-tertiary uppercase">{t.altAmount || 'Qty'}</label>
          <input
            type="number"
            value={altQty}
            onChange={e => setAltQty(e.target.value)}
            onBlur={() => onSave({ 'Alt Quantity Found': Number(altQty) || 0 })}
            className="field-input w-full text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] text-ios-tertiary uppercase">{t.altCost || 'Cost zł'}</label>
          <input
            type="number"
            value={altCost}
            onChange={e => setAltCost(e.target.value)}
            onBlur={() => onSave({ 'Alt Cost': Number(altCost) || 0 })}
            className="field-input w-full text-sm"
          />
        </div>
      </div>
    </div>
  );
}

// Inline stock search dropdown — shows matching stock items + "add new" option.
// Works like the customer search in the order form: type to filter, click to select,
// or use the "add new" button for flowers not yet in the stock catalog.
function StockSearchInput({ stock, value, onChange, onSelect }) {
  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);

  // Sync external value changes (e.g. pre-filled from negative stock)
  useEffect(() => { setQuery(value || ''); }, [value]);

  const filtered = query
    ? (stock || []).filter(s =>
        (s['Display Name'] || '').toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8)
    : [];

  const exactMatch = query && (stock || []).some(s =>
    (s['Display Name'] || '').toLowerCase() === query.toLowerCase()
  );

  function handleInputChange(e) {
    const val = e.target.value;
    setQuery(val);
    onChange(val);
    setOpen(true);
  }

  function handleSelect(item) {
    onSelect(item);
    setQuery(item['Display Name']);
    setOpen(false);
  }

  // "Add as new" — keep the freetext name, no stockItemId linked
  function handleAddNew() {
    onChange(query);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={handleInputChange}
        onFocus={() => { if (query) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={t.flowerSearch || 'Search...'}
        className="field-input w-full text-sm"
      />
      {open && query && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
          {filtered.map(s => (
            <button
              key={s.id}
              type="button"
              onMouseDown={() => handleSelect(s)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
            >
              <span className="font-medium">{s['Display Name']}</span>
              <span className="text-xs text-ios-tertiary ml-2">{s.Supplier || ''}</span>
              <span className="text-xs text-ios-secondary ml-1">
                ({s['Current Quantity'] ?? 0} {t.inStock || 'in stock'})
              </span>
            </button>
          ))}
          {/* "Add as new" option — when typed name doesn't match any stock item */}
          {!exactMatch && query.length >= 2 && (
            <button
              type="button"
              onMouseDown={handleAddNew}
              className="w-full text-left px-3 py-2 text-sm border-t border-gray-100 text-brand-600 font-medium hover:bg-brand-50 transition-colors"
            >
              + {t.addNewFlower || 'Add'} "{query}"
            </button>
          )}
          {filtered.length === 0 && query.length >= 2 && (
            <div className="px-3 py-2 text-xs text-ios-tertiary">
              {t.noResults || 'No matches found'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Inline editor for a single Draft PO line — flower search, qty, cost, sell, supplier, farmer, notes.
// Auto-saves on blur so changes persist immediately without a "save" button.
function DraftLineEditor({ line, stock, onUpdate, onRemove, targetMarkup, suppliers }) {
  const [qty, setQty] = useState(line['Quantity Needed'] || 1);
  const [costPrice, setCostPrice] = useState(line['Cost Price'] || '');
  const [sellPrice, setSellPrice] = useState(line['Sell Price'] || '');
  const [sellPriceManual, setSellPriceManual] = useState(Number(line['Sell Price']) > 0);
  const [farmer, setFarmer] = useState(line.Farmer || '');
  const [notes, setNotes] = useState(line.Notes || '');
  const [lotSize, setLotSize] = useState(Number(line['Lot Size']) || 0);

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
    onUpdate(line.id, {
      'Flower Name': item['Display Name'],
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
      const auto = String(Math.round(Number(value) * targetMarkup));
      setSellPrice(auto);
    }
  }

  function handleSellChange(value) {
    setSellPrice(value);
    setSellPriceManual(true);
  }

  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-1.5">
      {/* Row 1: Item + Qty + Supplier + Remove */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <StockSearchInput
            stock={stock}
            value={line['Flower Name'] || ''}
            onChange={name => onUpdate(line.id, { 'Flower Name': name })}
            onSelect={handleStockSelect}
          />
        </div>
        <input
          type="number"
          value={qty}
          onChange={e => setQty(Number(e.target.value) || 0)}
          onBlur={() => onUpdate(line.id, { 'Quantity Needed': qty })}
          className="field-input w-16 text-sm text-center"
          min="1"
          placeholder={t.quantity}
        />
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-ios-tertiary">{t.lotSize}:</span>
          <input
            type="number"
            value={lotSize || ''}
            onChange={e => setLotSize(Number(e.target.value) || 0)}
            onBlur={() => onUpdate(line.id, { 'Lot Size': lotSize })}
            className="field-input w-14 text-center text-xs"
            min="0"
            placeholder="—"
          />
        </div>
        {lotSize > 1 && qty > 0 && (
          <span className="text-xs text-ios-secondary whitespace-nowrap font-medium">
            = {Math.ceil(qty / lotSize)} × {lotSize}
          </span>
        )}
        <select
          value={line.Supplier || ''}
          onChange={e => onUpdate(line.id, { Supplier: e.target.value })}
          className="field-input w-28 text-sm"
        >
          <option value="">—</option>
          {(suppliers || []).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          onClick={() => onRemove(line.id)}
          className="text-red-400 hover:text-red-600 text-sm px-1"
        >
          ✕
        </button>
      </div>
      {/* Row 2: Cost + Sell + Markup + Farmer + Notes */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-ios-tertiary">{t.costPrice}:</span>
          <input
            type="number" step="0.01"
            value={costPrice}
            onChange={e => handleCostChange(e.target.value)}
            onBlur={() => onUpdate(line.id, { 'Cost Price': Number(costPrice) || 0, 'Sell Price': Number(sellPrice) || 0 })}
            className="field-input w-20 text-sm text-right"
            placeholder="0"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-ios-tertiary">{t.sellPrice}:</span>
          <input
            type="number" step="0.01"
            value={sellPrice}
            onChange={e => handleSellChange(e.target.value)}
            onBlur={() => onUpdate(line.id, { 'Sell Price': Number(sellPrice) || 0 })}
            className="field-input w-20 text-sm text-right"
            placeholder={cost && targetMarkup ? String(Math.round(cost * targetMarkup)) : '0'}
          />
        </div>
        {computedMarkup && (
          <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
            Number(computedMarkup) >= targetMarkup
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-700'
          }`}>
            ×{computedMarkup}
          </span>
        )}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-ios-tertiary">{t.farmer}:</span>
          <input
            type="text"
            value={farmer}
            onChange={e => setFarmer(e.target.value)}
            onBlur={() => onUpdate(line.id, { Farmer: farmer })}
            className="field-input w-28 text-sm"
            placeholder="—"
          />
        </div>
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <span className="text-[10px] text-ios-tertiary">{t.notes}:</span>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => onUpdate(line.id, { Notes: notes })}
            className="field-input w-full text-sm"
            placeholder="—"
          />
        </div>
      </div>
    </div>
  );
}
