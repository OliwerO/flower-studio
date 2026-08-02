// StockOrderPanel — Purchase Order management for the dashboard Stock tab.
// Like a procurement kanban: create POs, assign drivers, track progress, view history.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';
import useConfigLists from '../hooks/useConfigLists.js';
import {
  ValueCombobox,
  DateTag, PoLineForm, apiLineToCanonical, canonicalDiffToApiFields,
} from '@flower-studio/shared';

const STATUS_COLORS = {
  Draft:        'bg-gray-100 text-gray-700',
  Sent:         'bg-blue-100 text-blue-700',
  Shopping:     'bg-amber-100 text-amber-700',
  Reviewing:    'bg-orange-100 text-orange-700',
  Evaluating:   'bg-purple-100 text-purple-700',
  'Eval Error': 'bg-red-100 text-red-700',
  Complete:     'bg-emerald-100 text-emerald-700',
  Cancelled:    'bg-gray-200 text-gray-500',
};

export default function StockOrderPanel({ negativeStock, poSuggestions, stock, autoCreate, onClose }) {
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
  const [showCancelled, setShowCancelled] = useState(false);
  const [formNotes, setFormNotes] = useState('');
  const [formDriver, setFormDriver] = useState('Nikita');
  const [formPlannedDate, setFormPlannedDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Separate driver state for expanded/existing POs (keyed by PO id)
  // Prevents editing an existing PO's driver from changing the new-PO form.
  const [editDrivers, setEditDrivers] = useState({});
  const [committedMap, setCommittedMap] = useState({});

  // Owner ask 2026-05-31: suggest existing Type / Colour / Cultivar / Farmer
  // values when typing on a new-Variety PO line — prevents duplicates from
  // misspellings ("Peon" vs "Peony"). Sourced from current Stock.
  const typeSuggestions = useMemo(
    () => Array.from(new Set((stock || []).map(s => s['Type'] ?? s.type_name).filter(Boolean))).sort(),
    [stock],
  );
  const colourSuggestions = useMemo(
    () => Array.from(new Set((stock || []).map(s => s['Colour'] ?? s.colour).filter(Boolean))).sort(),
    [stock],
  );
  const cultivarSuggestions = useMemo(
    () => Array.from(new Set((stock || []).map(s => s['Cultivar'] ?? s.cultivar).filter(Boolean))).sort(),
    [stock],
  );
  const farmerSuggestions = useMemo(
    () => Array.from(new Set((stock || []).map(s => s['Farmer'] ?? s.farmer).filter(Boolean))).sort(),
    [stock],
  );

  const fetchOrders = useCallback(async () => {
    try {
      // include=lines lets us render the per-PO cost total inline (how much
      // cash the driver needs for suppliers) without an extra round-trip
      // per row. Backend already supports it (stockOrders.js:84).
      const [res, comRes] = await Promise.all([
        client.get('/stock-orders?include=lines'),
        client.get('/stock/committed'),
      ]);
      setOrders(res.data);
      setCommittedMap(comRes.data);
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
    // Y-model has no flat `stock` (grouped fetch) — fire on poSuggestions instead.
    if (autoCreate && !autoCreated.current && (stock?.length > 0 || poSuggestions?.length > 0)) {
      autoCreated.current = true;
      startNewPO();
    }
  }, [autoCreate, stock, poSuggestions]);

  // Pre-fill from the netted per-Variety shortfall, in stems. The form shows
  // the equivalent package count beside it (derived, never stored — D1).
  function startNewPO() {
    // Netted per-Variety shortfall suggestions from the parent (drops
    // Varieties covered by stock or an open PO, incl. late ones). Falls back to
    // one line per negative stock row when the parent has none to suggest.
    const lines = poSuggestions
      ? poSuggestions
      : (negativeStock || []).map(item => {
      const si = (stock || []).find(s => s.id === item.id);
      const cost = si ? (Number(si['Current Cost Price']) || 0) : 0;
      const sell = si ? (Number(si['Current Sell Price']) || 0) : 0;
      return {
        stockItemId: item.id,
        flowerName: item.name,
        qty: String(Math.abs(item.qty)),
        lotSize: String(Number(si?.['Lot Size']) || 0),
        supplier: item.supplier || si?.Supplier || '',
        costPerStem: cost > 0 ? String(cost) : '',
        sellPerStem: sell > 0 ? String(sell) : '',
        farmer: si?.Farmer || '',
        notes: '',
        // Carry the Variety so the line form shows it (ADR-0014).
        type: si?.Type ?? si?.type_name ?? '',
        colour: si?.Colour ?? si?.colour ?? '',
        size: (si?.Size ?? si?.size_cm) != null ? String(si.Size ?? si.size_cm) : '',
        cultivar: si?.Cultivar ?? si?.cultivar ?? '',
      };
    });

    setFormLines(lines.length > 0 ? lines : [emptyLine()]);
    setFormNotes('');
    setFormDriver('Nikita');
    setFormPlannedDate('');
    setShowForm(true);
  }

  // PoLineForm's canonical line shape — same shape buildPoSuggestions emits.
  function emptyLine() {
    return {
      stockItemId: '', flowerName: '', qty: '1', lotSize: '0',
      supplier: '', costPerStem: '', sellPerStem: '',
      farmer: '', notes: '',
      type: '', colour: '', size: '', cultivar: '',
    };
  }

  // A plain merge now — PoLineForm owns the Packages ⇄ stems math, the
  // stock-pick adoption and the markup suggestion that used to live here.
  function updateFormLine(idx, patch) {
    setFormLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeFormLine(idx) {
    setFormLines(prev => prev.filter((_, i) => i !== idx));
  }


  async function createPO() {
    if (formLines.length === 0) return;
    setSubmitting(true);
    try {
      await client.post('/stock-orders', {
        notes: formNotes,
        driver: formDriver,
        plannedDate: formPlannedDate || null,
        // `qty` is already total stems — Packages is a display-only view of it
        // (plan D1), so there is no pkgs × lot reconciliation to do here.
        lines: formLines.filter(l => l.flowerName || l.type).map(l => ({
          stockItemId: l.stockItemId || '',
          flowerName: l.flowerName?.trim() || [
            l.type, l.colour, l.size ? `${l.size}cm` : null, l.cultivar,
          ].filter(Boolean).join(' '),
          quantity:  Number(l.qty) || 0,
          lotSize:   Number(l.lotSize) || 0,
          costPrice: Number(l.costPerStem) || 0,
          sellPrice: Number(l.sellPerStem) || 0,
          supplier:  l.supplier || '',
          farmer:    l.farmer || '',
          notes:     l.notes || '',
          type:      (l.type || '').trim() || null,
          colour:    (l.colour || '').trim() || null,
          size:      l.size !== '' && l.size != null ? Number(l.size) : null,
          cultivar:  (l.cultivar || '').trim() || null,
          // Her confirmation that this flower really is one she does not stock
          // yet (#607). Without it the server refuses the whole PO rather than
          // minting a Variety from a typo.
          newVariety: !!l.isNewVariety,
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
      // Temp lines (not yet persisted) — create via POST when flower name is set
      if (typeof lineId === 'string' && lineId.startsWith('_temp_')) {
        if (!fields['Flower Name']?.trim()) {
          // Just update local state until they pick a flower
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
          newVariety: !!(fields['New Variety'] ?? merged['New Variety']),
        };
        const created = await client.post(`/stock-orders/${orderId}/lines`, payload);
        setExpandedLines(prev => prev.map(l => l.id === lineId ? created.data : l));
        return;
      }
      await client.patch(`/stock-orders/${orderId}/lines/${lineId}`, fields);
      const res = await client.get(`/stock-orders/${orderId}`);
      setExpandedLines(res.data.lines || []);
    } catch (err) {
      console.error('PO line update failed:', err.response?.data || err.message);
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  async function removeDraftLine(orderId, lineId) {
    // Temp lines haven't been persisted yet — just remove from local state
    if (typeof lineId === 'string' && lineId.startsWith('_temp_')) {
      setExpandedLines(prev => prev.filter(l => l.id !== lineId));
      return;
    }
    try {
      await client.delete(`/stock-orders/${orderId}/lines/${lineId}`);
      setExpandedLines(prev => prev.filter(l => l.id !== lineId));
    } catch (err) {
      console.error('PO line remove failed:', err.response?.data || err.message);
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  // Add a brand-new line to an existing PO — flower name + quantity are
  // required up front (identity rule, pitfall #6); supplier + cost/stem are
  // optional and can be filled in later (#524). POSTs straight to the
  // backend; no "temp local line" that can silently vanish on refresh.
  // Returns true on success so the inline form can collapse itself.
  // Issue #550: identity now mirrors DraftLineEditor — either an existing
  // Stock Item link (stockItemId) or a new-Variety Type/Colour/Size/Cultivar,
  // in addition to a plain typed Flower Name. The backend endpoint already
  // accepted all of these (see stockOrders.js POST /:id/lines) — only the
  // frontend form was missing the fields.
  async function addPersistedLine(orderId, line) {
    try {
      const poStatus = orders.find(o => o.id === orderId)?.Status;
      const stems = Number(line.qty) || 0;
      const created = await client.post(`/stock-orders/${orderId}/lines`, {
        flowerName: (line.flowerName || '').trim(),
        stockItemId: line.stockItemId || '',
        supplier: (line.supplier || '').trim(),
        farmer: (line.farmer || '').trim(),
        notes: (line.notes || '').trim(),
        quantity: stems,
        costPrice: Number(line.costPerStem) || 0,
        sellPrice: Number(line.sellPerStem) || 0,
        lotSize: Number(line.lotSize) || 0,
        type: (line.type || '').trim() || null,
        colour: (line.colour || '').trim() || null,
        size: line.size !== '' && line.size != null ? Number(line.size) : null,
        cultivar: (line.cultivar || '').trim() || null,
        newVariety: !!line.isNewVariety,
      });
      // If the PO is already in Shopping, the owner adds lines because the
      // flowers have been physically bought — mark Found All so the florist
      // sees them for evaluation.
      if (poStatus === 'Shopping') {
        await client.patch(`/stock-orders/${orderId}/lines/${created.data.id}`, {
          'Driver Status': 'Found All',
          'Quantity Found': stems,
        });
      }
      const res = await client.get(`/stock-orders/${orderId}`);
      setExpandedLines(res.data.lines || []);
      showToast(t.lineAddedAndSent || t.stockOrderUpdated);
      return true;
    } catch (err) {
      console.error('PO add-line failed:', err.response?.data || err.message);
      showToast(err.response?.data?.error || t.error, 'error');
      return false;
    }
  }

  // Termination (ADR-0015). Before the driver starts shopping the order is
  // deleted outright; from Shopping onward it is cancelled, which keeps the
  // record and — when stems are already bought — routes it to Reviewing so
  // they still get received. Mirrors the florist app.
  async function terminatePO(orderId, status) {
    const cancelling = status === 'Shopping';
    const prompt = cancelling
      ? (t.cancelPOConfirm || 'Cancel this purchase run? The driver will be told.')
      : (t.deletePOConfirm || 'Delete this PO?');
    if (!confirm(prompt)) return;
    try {
      if (cancelling) {
        const res = await client.post(`/stock-orders/${orderId}/cancel`);
        // "Cancel" does not always land on Cancelled — say which happened.
        showToast(
          res.data.keptLines > 0
            ? (t.poCancelledToReviewing || 'Cancelled — already-bought lines moved to review')
            : (t.poCancelled || 'Purchase run cancelled'),
          'success',
        );
      } else {
        await client.delete(`/stock-orders/${orderId}`);
        showToast(t.poDeleted || 'PO deleted', 'success');
      }
      fetchOrders();
    } catch (err) {
      showToast(err.response?.data?.error || t.error, 'error');
    }
  }

  async function cancelLine(orderId, lineId) {
    try {
      await client.post(`/stock-orders/${orderId}/lines/${lineId}/cancel`);
      const res = await client.get(`/stock-orders/${orderId}`);
      setExpandedLines(res.data.lines || []);
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
      {/* Typeahead suggestion sources for new-variety + farmer inputs
          (issue: duplicate spellings like "Peon" vs "Peony"). */}
      <datalist id="po-type-suggestions">
        {typeSuggestions.map(s => <option key={s} value={s} />)}
      </datalist>
      <datalist id="po-colour-suggestions">
        {colourSuggestions.map(s => <option key={s} value={s} />)}
      </datalist>
      <datalist id="po-cultivar-suggestions">
        {cultivarSuggestions.map(s => <option key={s} value={s} />)}
      </datalist>
      <datalist id="po-farmer-suggestions">
        {farmerSuggestions.map(s => <option key={s} value={s} />)}
      </datalist>
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
              {lines.map(line => (
                <div key={line._idx} className="px-3 py-2 border-t border-gray-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-ios-tertiary">#{line._idx + 1}</span>
                    <button onClick={() => removeFormLine(line._idx)} className="text-ios-red text-sm px-1">✕</button>
                  </div>
                  <PoLineForm
                    value={line}
                    onChange={patch => updateFormLine(line._idx, patch)}
                    stock={stock}
                    suppliers={SUPPLIERS}
                    targetMarkup={targetMarkup}
                    t={t}
                    mode="draft"
                  />
                </div>
              ))}
            </div>
          ))}

          <button
            onClick={() => setFormLines(prev => [...prev, emptyLine()])}
            className="text-brand-600 text-sm font-medium"
          >
            + {t.addLine}
          </button>

          {/* Grand total — qty is total stems outright (D1). */}
          {(() => {
            const stemsOf = (l) => Number(l.qty) || 0;
            const grandCost = formLines.reduce((sum, l) => sum + stemsOf(l) * (Number(l.costPerStem) || 0), 0);
            const grandSell = formLines.reduce((sum, l) => sum + stemsOf(l) * (Number(l.sellPerStem) || 0), 0);
            const grandStems = formLines.reduce((sum, l) => sum + stemsOf(l), 0);
            return grandCost > 0 ? (
              <div className="flex items-center gap-4 text-sm px-1">
                <span className="text-ios-tertiary">{t.totalStems || 'Stems'}: <span className="font-semibold text-ios-label">{grandStems}</span></span>
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
            {/* PG-6: a line may be Type-only (no Flower Name) — the submit
                filter already accepts `l.flowerName || l.type`, so the guard
                must mirror it. */}
            <button
              onClick={createPO}
              disabled={submitting || formLines.every(l => !l.flowerName && !l.type)}
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
          {/* Cancelled runs are kept but hidden by default. */}
          {orders.filter(o => showCancelled || o.Status !== 'Cancelled').map(order => {
            // Cost total from pre-fetched lines (backend returns them via
            // ?include=lines). Owner can scan PO list and see cash needed
            // per run without expanding each row.
            const costTotal = (order.lines || []).reduce(
              (sum, l) => sum + (Number(l['Quantity Needed']) || 0) * (Number(l['Cost Price']) || 0), 0
            );
            return (
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
                  {costTotal > 0 && (
                    <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                      {costTotal.toFixed(0)} {t.zl}
                    </span>
                  )}
                  {order['Assigned Driver'] && (
                    <span className="text-xs text-ios-secondary">{order['Assigned Driver']}</span>
                  )}
                  {order['Planned Date'] && (
                    <span className="inline-flex items-center gap-1 text-xs text-ios-secondary">
                      {t.plannedDate || 'Planned'}:
                      <DateTag date={order['Planned Date']} kind="arriving" t={t} />
                    </span>
                  )}
                </div>
                <span className="text-xs text-ios-tertiary">{order['Created Date']}</span>
              </div>

              {/* Expanded detail */}
              {expandedId === order.id && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-2">
                  {/* The Driver Note (D6) — what the driver sees at the top of
                      their run. Editable at any status; it used to be settable
                      only on the create form. */}
                  <div>
                    <label className="text-[10px] uppercase tracking-wide text-ios-tertiary block mb-0.5">
                      {t.driverNote || 'Note for the driver'}
                    </label>
                    <textarea
                      defaultValue={order.Notes || ''}
                      rows={2}
                      placeholder={t.driverNotePlaceholder || 'e.g. pay in cash, stall on the left'}
                      onBlur={async e => {
                        if (e.target.value === (order.Notes || '')) return;
                        try {
                          await client.patch(`/stock-orders/${order.id}`, { Notes: e.target.value });
                          setOrders(prev => prev.map(o => o.id === order.id ? { ...o, Notes: e.target.value } : o));
                        } catch (err) {
                          showToast(err.response?.data?.error || t.error, 'error');
                        }
                      }}
                      className="field-input w-full text-sm"
                    />
                  </div>

                  {['Draft', 'Sent', 'Shopping'].includes(order.Status) && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-ios-tertiary shrink-0">{t.plannedDate || 'Planned date'}</label>
                      <input
                        type="date"
                        value={order['Planned Date'] || ''}
                        onChange={e => setOrders(prev => prev.map(o => o.id === order.id ? { ...o, 'Planned Date': e.target.value } : o))}
                        onBlur={async e => {
                          try {
                            await client.patch(`/stock-orders/${order.id}`, { 'Planned Date': e.target.value || null });
                          } catch (err) {
                            showToast(err.response?.data?.error || t.error, 'error');
                          }
                        }}
                        className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 flex-1"
                      />
                    </div>
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
                          onCancel={(lineId) => cancelLine(order.id, lineId)}
                          poStatus={order.Status}
                          targetMarkup={targetMarkup}
                          suppliers={SUPPLIERS}
                        />
                      ))}
                      {/* One add-line form on every editable status (D8).
                          Draft used to POST a blank row and let the owner fill
                          it in place — the only path that could leave an
                          identity-less line behind. */}
                      <AddLineInlineForm
                        orderId={order.id}
                        onAdd={addPersistedLine}
                        suppliers={SUPPLIERS}
                        stock={stock}
                        targetMarkup={targetMarkup}
                      />

                      {/* Live cost total — reads from expandedLines so it
                          reflects in-progress edits rather than the stale
                          snapshot on order.lines from the list fetch. */}
                      {(() => {
                        const liveTotal = expandedLines.reduce(
                          (s, l) => s + (Number(l['Quantity Needed']) || 0) * (Number(l['Cost Price']) || 0), 0
                        );
                        return liveTotal > 0 ? (
                          <div className="text-sm px-1 pt-1">
                            <span className="text-ios-tertiary">{t.costTotal}: </span>
                            <span className="font-semibold text-ios-label">{liveTotal.toFixed(0)} {t.zl}</span>
                          </div>
                        ) : null;
                      })()}

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
                        <button
                          onClick={() => terminatePO(order.id, order.Status)}
                          className="px-3 py-2 rounded-xl bg-ios-red/10 text-ios-red text-sm font-medium"
                        >
                          {order.Status === 'Shopping'
                            ? (t.cancelPO || 'Cancel')
                            : (t.deletePO || 'Delete PO')}
                        </button>
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
                              {/* Pending + no qty + no alt = line was on the PO
                                  but never received — flag it so the owner can
                                  reconcile via Receive Stock if needed. */}
                              {(!line['Driver Status'] || line['Driver Status'] === 'Pending') &&
                                !(Number(line['Quantity Found']) > 0) &&
                                !(Number(line['Alt Quantity Found']) > 0) && (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-600">
                                  {t.notReceived || 'Not received'}
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
                            {/* Impacted orders warning for Not Found / substitute lines */}
                            {(() => {
                              const drvStatus = line['Driver Status'];
                              if (drvStatus !== 'Not Found' && drvStatus !== 'Partial') return null;
                              const sid = line['Stock Item']?.[0];
                              const cd = sid ? committedMap[sid] : null;
                              if (!cd?.orders?.length) return null;
                              return (
                                <div className="bg-amber-50 rounded-lg px-3 py-1.5 border border-amber-200 text-xs">
                                  <span className="font-medium text-amber-700">
                                    ⚠ {cd.committed} {t.stemsCommitted} → {cd.orders.length} {t.ordersNeedSwap}:
                                  </span>
                                  {cd.orders.map((o, i) => (
                                    <span key={i} className="ml-1 text-amber-600">
                                      #{o.appOrderId} ({o.qty})
                                    </span>
                                  ))}
                                </div>
                              );
                            })()}
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
            );
          })}
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
          {/* Picker, not free text (#610): a supplier typed slightly differently
              is a second supplier in every report she reads. Committing IS the
              save here — the combobox reverts uncommitted text on blur, so an
              onBlur save would persist nothing. */}
          <ValueCombobox
            value={altSupplier}
            onChange={next => { setAltSupplier(next); onSave({ 'Alt Supplier': next }); }}
            options={suppliers || []}
            placeholder={t.altSupplier || 'Supplier'}
            testId={`owner-alt-supplier-${line.id}`}
            className="field-input w-full text-sm"
            t={t}
          />
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

// ── Draft line editor ─────────────────────────────────────────────────────
// Wraps the shared PoLineForm around a persisted line. Edits live in local
// state and flush as ONE diffed PATCH when focus leaves the whole editor —
// the previous version fired a PATCH per field on every blur, which is how a
// half-typed "h" once overwrote "Hydrangea". Mirrors the florist app exactly.
function DraftLineEditor({ line, stock, onUpdate, onRemove, onCancel, poStatus, targetMarkup, suppliers }) {
  const [draft, setDraft] = useState(() => apiLineToCanonical(line));
  const savedRef = useRef(draft);

  useEffect(() => {
    const next = apiLineToCanonical(line);
    setDraft(next);
    savedRef.current = next;
  }, [line]);

  function flush() {
    // ADR-0016 replaced #593's hard lock: identity MAY move, but only onto a
    // Variety that already exists — the backend 409s VARIETY_NOT_FOUND
    // otherwise, and a deliberate create re-sends with `New Variety: true`.
    // So identity is sent normally again; the server is the guard.
    const fields = canonicalDiffToApiFields(savedRef.current, draft);
    if (Object.keys(fields).length === 0) return;
    savedRef.current = draft;
    onUpdate(line.id, fields);
  }

  const isBlank = !draft.flowerName.trim() && !draft.stockItemId && !draft.type.trim();

  // Cancelled mid-shopping (ADR-0015) — kept visible, struck through.
  if (line['Cancelled At']) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 flex items-center gap-2 opacity-70">
        <span className="text-sm line-through text-ios-secondary flex-1">{line['Flower Name']}</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">
          {t.lineCancelled || 'cancelled'}
        </span>
      </div>
    );
  }

  const cancelling = poStatus === 'Shopping';

  return (
    <div
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) flush(); }}
      className={`rounded-xl border px-3 py-2.5 space-y-2 ${
        isBlank ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-100'
      }`}
    >
      <div className="flex items-center justify-end">
        <button
          onClick={() => (cancelling ? onCancel?.(line.id) : onRemove(line.id))}
          title={cancelling ? (t.cancelLine || 'Cancel this line') : (t.removeLine || 'Remove')}
          className="w-7 h-7 rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 text-sm flex items-center justify-center"
        >✕</button>
      </div>
      <PoLineForm
        value={draft}
        onChange={patch => setDraft(d => ({ ...d, ...patch }))}
        stock={stock}
        suppliers={suppliers}
        targetMarkup={targetMarkup}
        t={t}
        mode="draft"
      />
      {isBlank && (
        <p className="text-[11px] text-amber-700">
          {t.blankLineHint || 'Pick a flower or type a name before sending the PO.'}
        </p>
      )}
    </div>
  );
}

// ── Inline add-line form ──────────────────────────────────────────────────
// Used on every editable status (plan D8): fill the form, then Save. The Draft
// one-tap "add a blank row and fill it in place" shortcut is gone.
function AddLineInlineForm({ orderId, onAdd, suppliers = [], stock, targetMarkup }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(blankCanonicalLine);

  function reset() {
    setForm(blankCanonicalLine());
    setOpen(false);
  }

  // Mirrors the backend gate on POST /:id/lines (pitfall #6).
  const hasIdentity = !!(form.stockItemId || form.flowerName.trim() || form.type.trim());
  const ready = hasIdentity && (Number(form.qty) || 0) > 0;

  async function submit() {
    if (!ready || submitting) return;
    setSubmitting(true);
    const ok = await onAdd(orderId, form);
    setSubmitting(false);
    if (ok) reset();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-2 text-sm text-brand-600 font-medium bg-brand-50 rounded-xl hover:bg-brand-100"
      >
        + {t.addLine || 'Add line'}
      </button>
    );
  }

  return (
    <div className="bg-brand-50/50 border border-brand-200 rounded-xl p-3 space-y-2">
      <PoLineForm
        value={form}
        onChange={patch => setForm(f => ({ ...f, ...patch }))}
        stock={stock}
        suppliers={suppliers}
        targetMarkup={targetMarkup}
        t={t}
        mode="sent"
      />
      {!ready && <p className="text-[11px] text-amber-600">{t.fillAllFields}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={!ready || submitting}
          className="flex-1 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold disabled:opacity-40"
        >
          {submitting ? '...' : (t.save || 'Save')}
        </button>
        <button
          onClick={reset}
          disabled={submitting}
          className="px-4 py-2 rounded-xl bg-gray-100 text-ios-secondary text-sm font-medium"
        >
          {t.cancel || 'Cancel'}
        </button>
      </div>
    </div>
  );
}

function blankCanonicalLine() {
  return {
    stockItemId: '', flowerName: '', qty: '', lotSize: '',
    supplier: '', costPerStem: '', sellPerStem: '',
    farmer: '', notes: '',
    type: '', colour: '', size: '', cultivar: '',
  };
}
