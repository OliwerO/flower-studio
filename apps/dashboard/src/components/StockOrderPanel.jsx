// StockOrderPanel — Purchase Order management for the dashboard Stock tab.
// Like a procurement kanban: create POs, assign drivers, track progress, view history.

import { useState, useEffect, useCallback, useRef } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import useConfigLists from '../hooks/useConfigLists.js';

const STATUS_COLORS = {
  Draft:      'bg-gray-100 text-gray-700',
  Sent:       'bg-blue-100 text-blue-700',
  Shopping:   'bg-amber-100 text-amber-700',
  Evaluating: 'bg-purple-100 text-purple-700',
  Complete:   'bg-emerald-100 text-emerald-700',
};

export default function StockOrderPanel({ negativeStock, stock, autoCreate, onClose }) {
  const { suppliers: SUPPLIERS } = useConfigLists();
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
      return {
        stockItemId: item.id,
        flowerName: item.name,
        quantity,
        lotSize,
        supplier: item.supplier || '',
        costPrice: 0,
        sellPrice: 0,
        notes: '',
      };
    });

    // Enrich cost/sell from stock data
    for (const line of lines) {
      const si = (stock || []).find(s => s.id === line.stockItemId);
      if (si) {
        line.costPrice = Number(si['Current Cost Price']) || 0;
        line.sellPrice = Number(si['Current Sell Price']) || 0;
        line.supplier = line.supplier || si.Supplier || '';
      }
    }

    setFormLines(lines.length > 0 ? lines : [emptyLine()]);
    setFormNotes('');
    setFormDriver('Nikita');
    setShowForm(true);
  }

  function emptyLine() {
    return { stockItemId: '', flowerName: '', quantity: 1, lotSize: 0, supplier: '', costPrice: 0, sellPrice: 0, notes: '' };
  }

  function updateFormLine(idx, patch) {
    setFormLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }

  function removeFormLine(idx) {
    setFormLines(prev => prev.filter((_, i) => i !== idx));
  }

  // Stock search for adding lines
  function handleStockSelect(idx, stockItem) {
    updateFormLine(idx, {
      stockItemId: stockItem.id,
      flowerName: stockItem['Display Name'],
      lotSize: Number(stockItem['Lot Size']) || 0,
      costPrice: Number(stockItem['Current Cost Price']) || 0,
      sellPrice: Number(stockItem['Current Sell Price']) || 0,
      supplier: stockItem.Supplier || '',
    });
  }

  async function createPO() {
    if (formLines.length === 0) return;
    setSubmitting(true);
    try {
      await client.post('/stock-orders', {
        notes: formNotes,
        lines: formLines.filter(l => l.flowerName),
      });
      showToast(t.stockOrderCreated);
      setShowForm(false);
      fetchOrders();
    } catch {
      showToast(t.error, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function sendToDriver(orderId) {
    const driverName = editDrivers[orderId] || drivers[0] || 'Nikita';
    try {
      await client.post(`/stock-orders/${orderId}/send`, { driverName });
      showToast(t.stockOrderSentMsg);
      fetchOrders();
    } catch {
      showToast(t.error, 'error');
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
    } catch {
      showToast(t.error, 'error');
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
                return (
                <div key={line._idx} className="flex items-center gap-2 px-3 py-2 border-t border-gray-100">
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
                  />
                  {/* Lot size — editable so owner can set it at PO creation time */}
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
              );})}
            </div>
          ))}

          <button
            onClick={() => setFormLines(prev => [...prev, emptyLine()])}
            className="text-brand-600 text-sm font-medium"
          >
            + {t.addLine}
          </button>

          {/* Notes + driver + actions */}
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
                </div>
                <span className="text-xs text-ios-tertiary">{order['Created Date']}</span>
              </div>

              {/* Expanded detail */}
              {expandedId === order.id && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-2">
                  {order.Notes && (
                    <p className="text-xs text-ios-secondary">{order.Notes}</p>
                  )}
                  {expandedLines.map(line => {
                    const lineLotSize = Number(line['Lot Size']) || 1;
                    const lineNeeded = Number(line['Quantity Needed']) || 0;
                    const lineLots = lineLotSize > 1 ? Math.ceil(lineNeeded / lineLotSize) : 0;
                    return (
                    <div key={line.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                      <div>
                        <span className="font-medium text-ios-label">{line['Flower Name']}</span>
                        <span className="text-xs text-ios-tertiary ml-2">{line.Supplier}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span>
                          {t.qtyNeeded}: {lineNeeded}
                          {lineLots > 0 && (
                            <span className="ml-1 text-ios-secondary">
                              → {lineLots} × {lineLotSize}
                            </span>
                          )}
                        </span>
                        {line['Driver Status'] && line['Driver Status'] !== 'Pending' && (
                          <span className={`px-2 py-0.5 rounded-full font-medium ${
                            line['Driver Status'] === 'Found All' ? 'bg-emerald-100 text-emerald-700' :
                            line['Driver Status'] === 'Partial' ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {line['Driver Status']}
                            {line['Quantity Found'] != null && ` (${line['Quantity Found']})`}
                          </span>
                        )}
                        {line['Quantity Accepted'] != null && (
                          <span className="text-emerald-600">✓ {line['Quantity Accepted']}</span>
                        )}
                      </div>
                    </div>
                  );})}

                  {/* Actions based on status */}
                  {order.Status === 'Draft' && (
                    <div className="flex items-center gap-2 pt-2">
                      <select
                        value={editDrivers[order.id] || drivers[0] || 'Nikita'}
                        onChange={e => setEditDrivers(prev => ({ ...prev, [order.id]: e.target.value }))}
                        className="field-input w-32"
                      >
                        {drivers.map(d => <option key={d} value={d}>{d}</option>)}
                        {drivers.length === 0 && <option value="Nikita">Nikita</option>}
                      </select>
                      <button
                        onClick={() => sendToDriver(order.id)}
                        className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold active-scale"
                      >
                        {t.sendToDriver}
                      </button>
                    </div>
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
