// PurchaseOrderPage — mobile-optimized PO management for the owner in the florist app.
// Full lifecycle: create POs, edit drafts, send to driver, track status, manage payments.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import useConfigLists from '../hooks/useConfigLists.js';
import {
  DateTag, buildPoSuggestions, PoLineForm,
  apiLineToCanonical, canonicalDiffToApiFields,
} from '@flower-studio/shared';
import t from '../translations.js';

const STATUS_COLORS = {
  Draft:      'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  Sent:       'bg-blue-100 text-blue-700',
  Shopping:   'bg-amber-100 text-amber-700',
  Reviewing:  'bg-orange-100 text-orange-700',
  Evaluating: 'bg-purple-100 text-purple-700',
  Complete:   'bg-emerald-100 text-emerald-700',
  Cancelled:  'bg-gray-200 text-gray-500',
};

const STATUS_LABELS = {
  Draft: () => t.po?.draft || 'Draft',
  Sent: () => t.po?.sent || 'Sent',
  Shopping: () => t.po?.shopping || 'Shopping',
  Reviewing: () => t.po?.reviewing || 'Reviewing',
  Evaluating: () => t.po?.evaluating || 'Evaluating',
  Complete: () => t.po?.complete || 'Complete',
  Cancelled: () => t.po?.cancelledStatus || 'Cancelled',
};

export default function PurchaseOrderPage() {
  const navigate = useNavigate();
  const { suppliers: SUPPLIERS, targetMarkup, drivers: configDrivers } = useConfigLists();
  const { showToast } = useToast();

  const [orders, setOrders] = useState([]);
  const [stock, setStock] = useState([]);
  // Y-model PO-suggestion inputs: grouped Varieties + pending POs + premade
  // reservations, used by buildPoSuggestions to pre-fill the new-PO form with
  // netted shortfalls instead of raw negative rows. Legacy path ignores these.
  const [groups, setGroups] = useState([]);
  const [pendingPO, setPendingPO] = useState({});
  const [premadeMap, setPremadeMap] = useState({});
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
  const [showCancelled, setShowCancelled] = useState(false);

  // Driver selection per expanded PO
  const [editDrivers, setEditDrivers] = useState({});

  const fetchOrders = useCallback(async () => {
    try {
      // include=lines lets us render the per-PO cost total without an extra
      // round-trip per row. Backend already supports it (stockOrders.js:84).
      const res = await client.get('/stock-orders?include=lines');
      setOrders(res.data);
    } catch {
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchOrders();
    client.get('/stock?includeEmpty=true').then(r => setStock(r.data)).catch(() => {});
    client.get('/settings').then(r => setDrivers(r.data.drivers || [])).catch(() => {});
  }, [fetchOrders]);

  // Grouped Varieties + pending POs + premade reservations feed buildPoSuggestions.
  useEffect(() => {
    Promise.all([
      client.get('/stock?grouped=true').catch(() => ({ data: {} })),
      client.get('/stock/pending-po').catch(() => ({ data: {} })),
      client.get('/stock/premade-committed').catch(() => ({ data: {} })),
    ]).then(([g, p, pm]) => {
      setGroups(g.data.groups || []);
      setPendingPO(p.data || {});
      setPremadeMap(pm.data || {});
    });
  }, []);

  // Negative stock items for pre-filling new POs
  const negativeStock = stock.filter(s => (Number(s['Current Quantity']) || 0) < 0);

  // PoLineForm's canonical line shape — the same shape buildPoSuggestions emits,
  // so a suggested line and a hand-added one are indistinguishable to the form.
  function emptyLine() {
    return {
      stockItemId: '', flowerName: '', qty: '1', lotSize: '0',
      supplier: '', costPerStem: '', sellPerStem: '',
      farmer: '', notes: '',
      type: '', colour: '', size: '', cultivar: '',
    };
  }

  // Pre-fill from the netted per-Variety shortfall, in stems. The form shows
  // the equivalent package count beside it (derived, never stored — D1).
  function startNewPO() {
    // Pre-fill from netted per-Variety shortfalls (drops Varieties covered by
    // on-hand stock or already on an open PO, incl. late ones).
    const lines = buildPoSuggestions(groups, pendingPO, premadeMap);
    setFormLines(lines.length > 0 ? lines : [emptyLine()]);
    setFormNotes('');
    setFormDriver('Nikita');
    setFormPlannedDate('');
    setShowForm(true);
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
          // Compose a name from the Variety when the owner typed identity
          // instead of picking a card. The backend composes too, but sending a
          // name keeps the line readable if it is inspected before evaluation.
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

  // Add a brand-new line to an existing PO — identity + quantity are required
  // up front; supplier + cost/stem are optional and can be filled in later
  // (#524). Returns true on success so the inline form can collapse.
  // Issue #550: identity mirrors DraftLineEditor — either an existing Stock
  // Item link (stockItemId) or a new-Variety Type/Colour/Size/Cultivar, in
  // addition to a plain typed Flower Name. The backend endpoint already
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
      // Lines added during Shopping are for flowers already physically bought,
      // so mark Found All and stamp Quantity Found so the florist can see them.
      if (poStatus === 'Shopping') {
        await client.patch(`/stock-orders/${orderId}/lines/${created.data.id}`, {
          'Driver Status': 'Found All',
          'Quantity Found': stems,
        });
      }
      const res = await client.get(`/stock-orders/${orderId}`);
      setExpandedLines(res.data.lines || []);
      showToast(t.shopping?.lineAddedAndSent || t.po?.sentMsg || 'Added');
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
  // they still get received.
  async function terminatePO(orderId, status) {
    const cancelling = status === 'Shopping';
    const prompt = cancelling
      ? (t.po?.cancelConfirm || 'Cancel this purchase run? The driver will be told.')
      : (t.po?.deleteConfirm || 'Delete this PO?');
    if (!confirm(prompt)) return;
    try {
      if (cancelling) {
        const res = await client.post(`/stock-orders/${orderId}/cancel`);
        // "Cancel" does not always land on Cancelled — say which happened.
        showToast(
          res.data.keptLines > 0
            ? (t.po?.cancelledToReviewing || 'Cancelled — already-bought lines moved to review')
            : (t.po?.cancelled || 'Purchase run cancelled'),
          'success',
        );
      } else {
        await client.delete(`/stock-orders/${orderId}`);
        showToast(t.po?.deleted || 'PO deleted', 'success');
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

  async function sendToDriver(orderId) {
    const order = orders.find(o => o.id === orderId);
    const driverName = editDrivers[orderId] || 'Nikita';
    try {
      if (!order || order.Status === 'Draft') {
        await client.post(`/stock-orders/${orderId}/send`, { driverName });
      } else {
        // Already live: just reassign driver via header PATCH
        await client.patch(`/stock-orders/${orderId}`, { 'Assigned Driver': driverName });
      }
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

  // `qty` is total stems outright — Packages is derived for display only (D1).
  const grandCost = formLines.reduce(
    (sum, l) => sum + (Number(l.qty) || 0) * (Number(l.costPerStem) || 0),
    0,
  );

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

        {orders.some(o => o.Status === 'Cancelled') && (
          <button
            onClick={() => setShowCancelled(v => !v)}
            className="text-xs text-ios-tertiary underline"
          >
            {showCancelled
              ? (t.po?.hideCancelled || 'Hide cancelled')
              : (t.po?.showCancelled || 'Show cancelled')}
          </button>
        )}

        {/* ── New PO Form ── */}
        {showForm && (
          <div className="ios-card p-4 space-y-4">
            <p className="text-sm font-semibold text-ios-label">{t.po?.newOrder}</p>

            {/* Lines */}
            {formLines.map((line, idx) => (
              <div key={idx} className="border border-gray-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-ios-tertiary">#{idx + 1}</span>
                  <button onClick={() => removeFormLine(idx)} className="text-ios-red text-sm px-1">✕</button>
                </div>
                <PoLineForm
                  value={line}
                  onChange={patch => updateFormLine(idx, patch)}
                  stock={stock}
                  suppliers={SUPPLIERS}
                  targetMarkup={targetMarkup}
                  t={t}
                  mode="draft"
                />
              </div>
            ))}

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
              {/* PG-6: a line may be Type-only (no Flower Name) — the submit
                  filter already accepts `l.flowerName || l.type`, so the
                  disabled-guard must mirror it. */}
              <button onClick={createPO}
                disabled={submitting || formLines.every(l => !l.flowerName && !l.type)}
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
            {/* Cancelled runs are kept but hidden by default — the owner has
                enough on this screen. Toggled by the pill above. */}
            {orders.filter(o => showCancelled || o.Status !== 'Cancelled').map(order => {
              // Cost total from pre-fetched lines (backend returns them when
              // we pass ?include=lines). Owner sees at a glance how much cash
              // this PO will need; avoids mentally summing the line prices.
              const costTotal = (order.lines || []).reduce(
                (sum, l) => sum + (Number(l['Quantity Needed']) || 0) * (Number(l['Cost Price']) || 0), 0
              );
              return (
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
                      {costTotal > 0 && (
                        <span className="text-xs font-semibold text-ios-label bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                          {costTotal.toFixed(0)} zł
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-ios-tertiary">{order['Created Date']}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {order['Assigned Driver'] && (
                      <span className="text-xs text-ios-secondary">{order['Assigned Driver']}</span>
                    )}
                    {order['Planned Date'] && (
                      <DateTag date={order['Planned Date']} kind="arriving" t={t} />
                    )}
                  </div>
                </button>

                {/* Expanded detail */}
                {expandedId === order.id && (
                  <div className="border-t border-gray-100 px-4 py-3 space-y-3">
                    {/* The Driver Note (D6) — what the driver sees at the top
                        of their run. Editable at any status; it used to be
                        settable only on the create form. */}
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-ios-tertiary block mb-0.5">
                        {t.po?.driverNote || 'Note for the driver'}
                      </label>
                      <textarea
                        defaultValue={order.Notes || ''}
                        rows={2}
                        placeholder={t.po?.driverNotePlaceholder || 'e.g. pay in cash, stall on the left'}
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
                        <label className="text-xs text-ios-tertiary shrink-0">{t.po?.plannedDate || 'Planned date'}</label>
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
                          className="field-input text-sm flex-1"
                        />
                      </div>
                    )}

                    {['Draft', 'Sent', 'Shopping'].includes(order.Status) ? (
                      /* ── Editable PO: Draft + Sent + Shopping ── */
                      <>
                        {expandedLines.map(line => (
                          <DraftLineEditor
                            key={line.id}
                            line={line}
                            stock={stock}
                            onUpdate={(lineId, fields) => updateDraftLine(order.id, lineId, fields)}
                            onRemove={(lineId) => removeDraftLine(order.id, lineId)}
                            onCancel={(lineId) => cancelLine(order.id, lineId)}
                            poStatus={order.Status}
                            targetMarkup={targetMarkup}
                            suppliers={SUPPLIERS}
                          />
                        ))}
                        {/* One add-line form on every editable status (D8).
                            Draft used to POST a blank row and let the owner
                            fill it in place — the only path that could leave an
                            identity-less line behind. */}
                        <AddLineInlineForm
                          orderId={order.id}
                          onAdd={addPersistedLine}
                          suppliers={SUPPLIERS}
                          stock={stock}
                          targetMarkup={targetMarkup}
                        />

                        {/* Cost total from the live expanded-lines state so it
                            tracks in-progress edits, not the stale snapshot on
                            order.lines from the list fetch. */}
                        {(() => {
                          const liveTotal = expandedLines.reduce(
                            (s, l) => s + (Number(l['Quantity Needed']) || 0) * (Number(l['Cost Price']) || 0), 0
                          );
                          return liveTotal > 0 ? (
                            <div className="text-sm px-1 pt-1">
                              <span className="text-ios-tertiary">{t.po?.costTotal || 'Cost total'}: </span>
                              <span className="font-semibold text-ios-label">{liveTotal.toFixed(0)} zł</span>
                            </div>
                          ) : null;
                        })()}

                        <div className="flex items-center gap-2 pt-2">
                          <select
                            value={editDrivers[order.id] || order['Assigned Driver'] || 'Nikita'}
                            onChange={e => setEditDrivers(prev => ({ ...prev, [order.id]: e.target.value }))}
                            className="field-input flex-1 text-sm">
                            {allDrivers.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                          <button onClick={() => sendToDriver(order.id)}
                            className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold active-scale">
                            {order.Status === 'Draft' ? (t.po?.sendToDriver || 'Send') : (t.po?.reassignDriver || t.po?.sendToDriver || 'Reassign')}
                          </button>
                          <button onClick={() => terminatePO(order.id, order.Status)}
                            className="px-3 py-2.5 rounded-xl bg-ios-red/10 text-ios-red text-sm font-medium active-scale">
                            {order.Status === 'Shopping'
                              ? (t.po?.cancelPO || 'Cancel')
                              : (t.po?.deletePO || 'Delete')}
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
                                {/* Line was on the PO but never received */}
                                {(!line['Driver Status'] || line['Driver Status'] === 'Pending') &&
                                  !(Number(line['Quantity Found']) > 0) &&
                                  !(Number(line['Alt Quantity Found']) > 0) && (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-medium shrink-0 bg-gray-200 text-gray-600">
                                    {t.shopping?.notReceived || 'Not received'}
                                  </span>
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
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

// ── Draft line editor ─────────────────────────────────────────────────────
// Wraps the shared PoLineForm around a persisted line. Edits live in local
// state and flush as ONE diffed PATCH when focus leaves the whole editor —
// the previous version fired a PATCH per field on every blur, which is how a
// half-typed "h" once overwrote "Hydrangea".
function DraftLineEditor({ line, stock, onUpdate, onRemove, onCancel, poStatus, targetMarkup, suppliers }) {
  const [draft, setDraft] = useState(() => apiLineToCanonical(line));
  const savedRef = useRef(draft);

  // Re-seed when the server sends a different version of this line (a refetch
  // after an add/remove elsewhere in the PO).
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

  // A line with no Stock Item, no name and no Type cannot be sent — /send
  // refuses the PO until it has identity, so surface it on the line itself.
  const isBlank = !draft.flowerName.trim() && !draft.stockItemId && !draft.type.trim();

  // Cancelled mid-shopping (ADR-0015) — kept visible, struck through, not
  // editable. It still counts as a record of what was asked for.
  if (line['Cancelled At']) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-3 flex items-center gap-2 opacity-70">
        <span className="text-sm line-through text-ios-secondary flex-1">{line['Flower Name']}</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">
          {t.po?.lineCancelled || 'cancelled'}
        </span>
      </div>
    );
  }

  // Before shopping a line is deleted outright; from Shopping onward it is
  // cancelled, so the driver sees "skip this" rather than a row vanishing.
  const cancelling = poStatus === 'Shopping';

  return (
    <div
      // Fires only when focus leaves the editor entirely, not when it moves
      // between fields inside it — one PATCH per edit session.
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) flush(); }}
      className={`rounded-2xl border shadow-sm px-3.5 py-3 space-y-2 ${
        isBlank ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-100'
      }`}
    >
      <div className="flex items-center justify-end">
        <button
          onClick={() => (cancelling ? onCancel?.(line.id) : onRemove(line.id))}
          title={cancelling ? (t.po?.cancelLine || 'Cancel this line') : (t.po?.removeLine || 'Remove')}
          className="w-7 h-7 rounded-full bg-red-50 text-red-400 active:bg-red-100 active:text-red-600 text-sm flex items-center justify-center"
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
          {t.po?.blankLineHint || 'Pick a flower or type a name before sending the PO.'}
        </p>
      )}
    </div>
  );
}

// ── Inline add-line form ──────────────────────────────────────────────────
// Used on every status now (plan D8): fill the form, then Save. The Draft
// one-tap "add a blank row and fill it in place" shortcut is gone — it was the
// only surface that could leave an identity-less line behind, and having Draft
// behave differently from Sent was the complaint that started this work.
function AddLineInlineForm({ orderId, onAdd, suppliers = [], stock, targetMarkup }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyCanonicalLine);

  function reset() {
    setForm(emptyCanonicalLine());
    setOpen(false);
  }

  // Identity mirrors the backend gate on POST /:id/lines (pitfall #6): a Stock
  // Item link, a typed Flower Name, or a new-Variety Type all count.
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
        className="w-full py-2 text-sm text-brand-600 font-medium bg-brand-50 rounded-xl active:bg-brand-100 active-scale"
      >
        + {t.po?.addLine || 'Add line'}
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
      {!ready && <p className="text-[11px] text-amber-600">{t.shopping?.fillAllFields}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={!ready || submitting}
          className="flex-1 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold disabled:opacity-40 active-scale"
        >
          {submitting ? '...' : (t.save || 'Save')}
        </button>
        <button
          onClick={reset}
          disabled={submitting}
          className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300 text-sm font-medium active-scale"
        >
          {t.cancel || 'Cancel'}
        </button>
      </div>
    </div>
  );
}

// PoLineForm's canonical shape, blank. Shared by the add-line form here and the
// new-Stock-Order form's `emptyLine`.
function emptyCanonicalLine() {
  return {
    stockItemId: '', flowerName: '', qty: '', lotSize: '',
    supplier: '', costPerStem: '', sellPerStem: '',
    farmer: '', notes: '',
    type: '', colour: '', size: '', cultivar: '',
  };
}
