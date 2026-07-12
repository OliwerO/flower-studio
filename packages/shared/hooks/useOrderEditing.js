// useOrderEditing — shared hook for bouquet editing, stock decisions, and save logic.
// Pure state + business logic, no UI rendering. Used by both florist OrderCard
// and dashboard OrderDetailPanel so they stay in sync.
//
// Dependencies are injected so the hook stays decoupled from app-specific
// modules (API client, toast, translations).

import { useState } from 'react';
import { varietyDisplayName } from '../utils/varietyKey.js';
import { resolveStockLinePrice } from '../utils/stockLinePrice.js';
import { createBouquetDemand } from '../utils/createBouquetDemand.js';
import { findAllMatchingVariety } from '../utils/varietyLookup.js';

const _DATE_BATCH_RE = /\(\d{1,2}\.\w{3,4}\.?\)$/;

// Re-exported for back-compat — callers historically imported this from the
// hook module (index.js still does). Lives in utils/varietyLookup.js so
// createBouquetDemand (a plain util) can depend on it without a hook↔util
// circular import.
export { findAllMatchingVariety };

// Returns false for depleted dated-Batch Stock Items that have no pending PO demand.
// Exported so both the hook internals and BouquetEditor can share the same rule.
export function isStockItemVisible(stockItem, pendingPO = {}) {
  const qty = Number(stockItem['Current Quantity']) || 0;
  const name = stockItem['Display Name'] || '';
  if (qty <= 0 && _DATE_BATCH_RE.test(name) && !(pendingPO[stockItem.id]?.ordered > 0)) {
    return false;
  }
  return true;
}

// Case-insensitive Display Name lookup against a stock list. Exported so
// duplicate-name checks can be unit-tested without React.
export function findDuplicateStockItem(stockItems, name) {
  const needle = (name || '').trim().toLowerCase();
  if (!needle) return null;
  return stockItems.find(s =>
    (s['Display Name'] || '').trim().toLowerCase() === needle
  ) || null;
}

/**
 * @param {Object} deps
 * @param {string} deps.orderId
 * @param {import('axios').AxiosInstance} deps.apiClient
 * @param {(msg: string, type?: string) => void} deps.showToast
 * @param {{ updateError?: string, bouquetUpdated?: string }} deps.t — only the keys the hook needs
 */
export default function useOrderEditing({ orderId, apiClient, showToast, t }) {
  const [saving, setSaving]                   = useState(false);
  const [editingBouquet, setEditingBouquet]   = useState(false);
  const [editLines, setEditLines]             = useState([]);
  const [removedLines, setRemovedLines]       = useState([]);
  const [removeDialogIdx, setRemoveDialogIdx] = useState(null);
  const [stockAction, setStockAction]         = useState(null);
  const [addingFlower, setAddingFlower]       = useState(false);
  const [flowerSearch, setFlowerSearch]       = useState('');
  const [stockItems, setStockItems]           = useState([]);
  const [newFlowerForm, setNewFlowerForm]     = useState(null);
  const [pendingPO, setPendingPO]             = useState({});
  // Premade reservations per stock item — used to warn the owner when a
  // new order wants stems that are locked into a premade. Shape:
  // { stockId: { qty, bouquets: [{ bouquetId, name, qty }] } }
  const [premadeMap, setPremadeMap]           = useState({});

  // ── Start editing ──────────────────────────────────────────────
  function startEditing(orderLines) {
    setEditLines(orderLines.map(l => ({
      id: l.id,
      stockItemId: l['Stock Item']?.[0] || null,
      flowerName: l['Flower Name'],
      quantity: l.Quantity,
      _originalQty: l.Quantity,
      costPricePerUnit: l['Cost Price Per Unit'] || 0,
      sellPricePerUnit: l['Sell Price Per Unit'] || 0,
    })));
    setRemovedLines([]);
    setAddingFlower(false);
    setFlowerSearch('');
    setNewFlowerForm(null);
    setEditingBouquet(true);
    // Fetch stock and pending-po in parallel. Re-fetch stock after pending-po in case
    // it auto-created new Stock Items for unlinked PO lines.
    Promise.all([
      apiClient.get('/stock?includeEmpty=true&includeInactive=true'),
      apiClient.get('/stock/pending-po'),
    ]).then(([stockRes, poRes]) => {
      setStockItems(stockRes.data);
      setPendingPO(poRes.data);
      const knownIds = new Set(stockRes.data.map(s => s.id));
      const hasNewItems = Object.keys(poRes.data).some(id => !knownIds.has(id));
      if (hasNewItems) {
        return apiClient.get('/stock?includeEmpty=true&includeInactive=true');
      }
      return null;
    }).then(r => { if (r) setStockItems(r.data); })
    .catch(() => {});
    apiClient.get('/stock/premade-committed').then(r => setPremadeMap(r.data || {})).catch(() => setPremadeMap({}));
  }

  // ── Line quantity manipulation ─────────────────────────────────
  // Cap for a line drawing from a Batch (positive current_quantity Stock Item):
  // current_quantity minus premade reservations. Demand Entries (negative qty
  // Stock Items) and unlinked lines have no cap — demand grows freely.
  function getLineCap(line) {
    if (!line?.stockItemId) return Infinity;
    const si = stockItems.find(s => s.id === line.stockItemId);
    if (!si) return Infinity;
    const qty = Number(si['Current Quantity']) || 0;
    if (qty <= 0) return Infinity;
    const reserved = Number(premadeMap?.[si.id]?.qty) || 0;
    return Math.max(0, qty - reserved);
  }

  function updateLineQty(idx, rawValue) {
    setEditLines(prev => prev.map((l, i) =>
      i === idx ? { ...l, quantity: rawValue === '' ? '' : (Number(rawValue) || 0) } : l
    ));
  }

  function commitLineQty(idx) {
    setEditLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      const cap = getLineCap(l);
      const n = Number(l.quantity);
      if (!l.quantity || n < 1) return { ...l, quantity: 1 };
      if (n > cap) {
        showToast?.(
          (t?.batchCapReached ?? 'Batch only has {n} available').replace('{n}', String(cap)),
          'error',
        );
        return { ...l, quantity: cap };
      }
      return l;
    }));
  }

  function incrementQty(idx, by = 1) {
    const step = Math.max(1, Number(by) || 1);
    setEditLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      const cap = getLineCap(l);
      const next = (Number(l.quantity) || 0) + step;
      if (next > cap) {
        showToast?.(
          (t?.batchCapReached ?? 'Batch only has {n} available').replace('{n}', String(cap)),
          'error',
        );
        return l;
      }
      return { ...l, quantity: next };
    }));
  }

  // ── Sell-tier switch ───────────────────────────────────────────
  // For a bouquet line bound to a stock item, list the other sibling sell
  // tiers from the same Variety (4-tuple) that the owner / florist could
  // switch to. A tier = one or more stock items with the same Sell Price.
  // Empty array means there's only one tier (or none) — no switching needed.
  function getLineTiers(line) {
    if (!line?.stockItemId) return [];
    const si = stockItems.find(s => s.id === line.stockItemId);
    if (!si) return [];
    const sameVariety = stockItems.filter(s =>
      (s['Type'] ?? s.type_name) === (si['Type'] ?? si.type_name) &&
      (s['Colour'] ?? s.colour) === (si['Colour'] ?? si.colour) &&
      (s['Size Cm'] ?? s.size_cm) === (si['Size Cm'] ?? si.size_cm) &&
      (s['Cultivar'] ?? s.cultivar) === (si['Cultivar'] ?? si.cultivar) &&
      (Number(s['Current Quantity']) || 0) > 0
    );
    const tiers = new Map();
    for (const s of sameVariety) {
      const sell = Number(s['Current Sell Price']);
      if (!isFinite(sell)) continue;
      const key = sell.toFixed(2);
      let m = tiers.get(key);
      if (!m) {
        m = { key, sell, stockIds: [], totalQty: 0 };
        tiers.set(key, m);
      }
      m.stockIds.push({ id: s.id, qty: Number(s['Current Quantity']) || 0, date: s.date || s['Date'] || null });
      m.totalQty += Number(s['Current Quantity']) || 0;
    }
    for (const m of tiers.values()) {
      m.stockIds.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return String(a.date).localeCompare(String(b.date));
      });
    }
    return [...tiers.values()].sort((a, b) => a.sell - b.sell);
  }

  // Switch a bouquet line to a different sell tier. `newStockId` should be
  // the FEFO-oldest underlying stock_id of the target tier (callers pass
  // tier.stockIds[0].id). The line's sell price + name update from the new
  // stock item; quantity is preserved.
  function switchLineTier(idx, newStockId) {
    const target = stockItems.find(s => s.id === newStockId);
    if (!target) return;
    setEditLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      return {
        ...l,
        stockItemId: target.id,
        flowerName: target['Display Name'] ?? target.display_name ?? l.flowerName,
        sellPricePerUnit: Number(target['Current Sell Price']) || 0,
        costPricePerUnit: Number(target['Current Cost Price']) || 0,
      };
    }));
  }

  function decrementQty(idx) {
    setEditLines(prev => prev.map((l, i) =>
      i === idx ? { ...l, quantity: Math.max(1, (Number(l.quantity) || 1) - 1) } : l
    ));
  }

  // ── Remove line ────────────────────────────────────────────────
  function confirmRemoveLine(action) {
    if (removeDialogIdx == null) return;
    const line = editLines[removeDialogIdx];
    setRemovedLines(prev => [...prev, {
      lineId: line.id,
      stockItemId: line.stockItemId,
      quantity: line._originalQty,
      action,
      reason: action === 'writeoff' ? 'Bouquet edit' : undefined,
    }]);
    setEditLines(prev => prev.filter((_, i) => i !== removeDialogIdx));
    setRemoveDialogIdx(null);
  }

  // ── Add flower from existing stock ─────────────────────────────
  function addFlowerFromStock(stockItem, amount = 1) {
    // Price a not-yet-arrived flower off its pending PO, not the stale card sell (#377).
    const { costPricePerUnit, sellPricePerUnit } = resolveStockLinePrice(stockItem, pendingPO[stockItem.id]);
    setEditLines(prev => [...prev, {
      id: null,
      stockItemId: stockItem.id,
      flowerName: stockItem['Display Name'],
      quantity: Math.max(1, Number(amount) || 1),
      _originalQty: 0,
      costPricePerUnit,
      sellPricePerUnit,
    }]);
    setFlowerSearch('');
    setAddingFlower(false);
  }

  // ── New flower (full form — owner/dashboard) ───────────────────
  function openNewFlowerForm(name) {
    // Y-model: seed the Variety 4-tuple so a brand-new flower carries its attrs
    // (Type NOT NULL on prod, drives grouping — root pitfall #9). typeName
    // defaults to the searched name so it is never blank; the owner refines it.
    setNewFlowerForm({ name, typeName: name, colour: '', sizeCm: '', cultivar: '', costPrice: '', sellPrice: '', lotSize: '', supplier: '' });
    setAddingFlower(false);
  }

  async function addNewFlower() {
    if (!newFlowerForm) return;
    // If this flower already exists as a Variety (in stock OR currently out of
    // stock), reuse its record: create/deepen its Demand Entry at the entered
    // price instead of POSTing a duplicate Stock Item. This is the owner's
    // "new demand for an existing, out-of-stock flower" path — the sell/cost
    // price she types here flows onto the demand and into the bouquet total.
    // Prices are applied only when > 0; a blank leaves the record's price as-is.
    const existingVariety = findAllMatchingVariety(stockItems, newFlowerForm.name);
    if (existingVariety.length > 0) {
      const opts = {};
      const sell = Number(newFlowerForm.sellPrice);
      const cost = Number(newFlowerForm.costPrice);
      if (sell > 0) opts.sellPrice = sell;
      if (cost > 0) opts.costPrice = cost;
      await createDemandEntry(newFlowerForm.name, 1, opts);
      setNewFlowerForm(null);
      return;
    }
    try {
      // Y-model Variety attrs (root pitfall #9): a new flower must carry its
      // 4-tuple. typeName falls back to the display name so it is never blank
      // (NOT NULL on prod); blank optional attrs are sent as null. Delegates
      // to the shared util — single source of truth for create/deepen-a-demand.
      const sizeRaw = newFlowerForm.sizeCm;
      const { stockItem, line } = await createBouquetDemand({
        apiClient, stockItems,
        displayName: newFlowerForm.name,
        variety: {
          type_name: (newFlowerForm.typeName ?? '').trim() || newFlowerForm.name,
          colour: (newFlowerForm.colour ?? '').trim() || null,
          size_cm: sizeRaw !== '' && sizeRaw != null ? Number(sizeRaw) : null,
          cultivar: (newFlowerForm.cultivar ?? '').trim() || null,
        },
        costPrice: Number(newFlowerForm.costPrice) || 0,
        sellPrice: Number(newFlowerForm.sellPrice) || 0,
        supplier: newFlowerForm.supplier,
        lotSize: newFlowerForm.lotSize,
      });
      setStockItems(prev => [...prev, stockItem]);
      setEditLines(prev => [...prev, line]);
    } catch {
      showToast(t.updateError || 'Error creating stock item', 'error');
      return;
    }
    setNewFlowerForm(null);
    setFlowerSearch('');
  }

  // ── New flower (quick add — florist, just name) ────────────────
  async function addNewFlowerQuick(name) {
    const dup = findDuplicateStockItem(stockItems, name);
    if (dup) {
      showToast(t.flowerAlreadyExists || 'Flower already in stock — pick from the list', 'error');
      addFlowerFromStock(dup);
      return;
    }
    try {
      // Y-model (pitfall #9): quick add has no attr form — carry a non-null Type
      // (= the name) so the row stays classifiable in the grouped Stock view.
      const res = await apiClient.post('/stock', { displayName: name.trim(), typeName: name.trim(), quantity: 0 });
      setEditLines(prev => [...prev, {
        id: null, stockItemId: res.data.id, flowerName: res.data['Display Name'],
        quantity: 1, _originalQty: 0,
        costPricePerUnit: 0, sellPricePerUnit: 0,
      }]);
    } catch {
      showToast(t.updateError || 'Error creating stock item', 'error');
      return;
    }
    setFlowerSearch('');
    setAddingFlower(false);
  }

  // ── New Variety (Owner-only "+ Create new Variety" path) ─────────
  // Creates a new Stock Item with full 4-tuple Variety attrs and qty=0.
  // Returns the new row so callers (e.g. VarietyAllocationPicker) can
  // pass it back through onSelectStock to add a line.
  async function addNewVariety(draft) {
    const displayName = (draft.baseName || varietyDisplayName(draft) || '').trim();
    if (!displayName) {
      showToast(t.updateError || 'Error creating Variety', 'error');
      return null;
    }
    try {
      const res = await apiClient.post('/stock', {
        displayName,
        typeName: draft.type_name ?? null,
        colour: draft.colour ?? null,
        sizeCm: draft.size_cm ?? null,
        cultivar: draft.cultivar ?? null,
        quantity: 0,
      });
      setStockItems(prev => [...prev, res.data]);
      return res.data;
    } catch {
      showToast(t.updateError || 'Error creating Variety', 'error');
      return null;
    }
  }

  // ── Demand Entry path ──────────────────────────────────────────────
  // Creates or deepens the single undated Demand Entry for a variety.
  // If one already exists, uses it (deepens aggregate negative qty).
  // If not, creates one inheriting price from the most recent Batch.
  // Delegates to the shared createBouquetDemand util (single source of
  // truth) via its `varietyDraft` calling convention, which mirrors this
  // function's own pre-consolidation signature exactly — see the util's
  // header comment for the string-vs-object distinction.
  //
  // varietyDraft: string (back-compat) OR
  //   { baseName?, type_name?, colour?, size_cm?, cultivar? }
  // When an object is provided the POST body includes the 4-tuple Variety
  // attrs (typeName/colour/sizeCm/cultivar) so the backend can persist them.
  // displayName is taken from baseName if given, otherwise auto-computed via
  // varietyDisplayName.
  async function createDemandEntry(varietyDraft, amount = 1, opts = {}) {
    const add = Math.max(1, Number(amount) || 1);
    try {
      const { stockItem, line } = await createBouquetDemand({
        apiClient, stockItems, varietyDraft,
        costPrice: opts.costPrice ?? 0,
        sellPrice: opts.sellPrice ?? 0,
        quantity: add,
      });
      setStockItems(prev => {
        const i = prev.findIndex(s => s.id === stockItem.id);
        return i >= 0 ? prev.map(s => (s.id === stockItem.id ? stockItem : s)) : [...prev, stockItem];
      });
      setEditLines(prev => [...prev, line]);
      setFlowerSearch('');
    } catch {
      showToast(t.updateError || 'Error creating demand entry', 'error');
    }
  }

  // Dissolve-premade workflow state. When the save would push stock below
  // zero for a line whose stockItemId is locked in one or more premades, we
  // pause the save, surface the options here, and let the UI render a
  // confirmation modal. Shape:
  //   { shortfalls: [{ stockId, name, shortage, available, need, bouquets: [...] }],
  //     pendingAction: 'return' | 'writeoff' | null }
  const [dissolveCandidates, setDissolveCandidates] = useState(null);

  // Look at the net stock deduction each save would cause and, for any line
  // that would go negative, report which premade bouquets hold stems of that
  // stock item so the owner can dissolve them to cover the shortfall.
  function computeShortfalls(lines, finalRemoved) {
    const netDeduction = {};
    for (const line of lines) {
      if (!line.stockItemId) continue;
      const delta = line.id
        ? (Number(line.quantity) || 0) - (Number(line._originalQty) || 0)
        : (Number(line.quantity) || 0);
      if (delta <= 0) continue;
      netDeduction[line.stockItemId] = (netDeduction[line.stockItemId] || 0) + delta;
    }
    // A "return" removal adds stock back, reducing the net deduction for
    // that stock item. "writeoff" does not return to stock.
    for (const rem of finalRemoved) {
      if (rem.action !== 'return' || !rem.stockItemId) continue;
      netDeduction[rem.stockItemId] = (netDeduction[rem.stockItemId] || 0) - (Number(rem.quantity) || 0);
    }
    const shortfalls = [];
    for (const [stockId, deduction] of Object.entries(netDeduction)) {
      if (deduction <= 0) continue;
      const stockItem = stockItems.find(s => s.id === stockId);
      const currentQty = Number(stockItem?.['Current Quantity']) || 0;
      const remaining = currentQty - deduction;
      if (remaining >= 0) continue;
      const premades = premadeMap[stockId]?.bouquets || [];
      if (premades.length === 0) continue;
      shortfalls.push({
        stockId,
        name: stockItem?.['Display Name'] || '?',
        shortage: -remaining,
        available: currentQty,
        need: deduction,
        bouquets: premades,
      });
    }
    return shortfalls;
  }

  // ── Save bouquet ───────────────────────────────────────────────
  // Returns the refreshed order data on success, null on failure.
  async function doSave(action, { skipShortfallCheck = false } = {}) {
    setSaving(true);
    try {
      const finalRemoved = [...removedLines];
      if (action) {
        for (const line of editLines) {
          if (line._originalQty > 0 && line.quantity < line._originalQty) {
            finalRemoved.push({
              lineId: null, stockItemId: line.stockItemId,
              quantity: line._originalQty - line.quantity,
              action, reason: action === 'writeoff' ? 'Bouquet edit' : undefined,
            });
          }
        }
        for (const rem of finalRemoved) { if (!rem.action) rem.action = action; }
      }

      // Before hitting the backend, see if this save would eat into premade-
      // reserved stems. If so, pause and let the UI render a confirm dialog.
      if (!skipShortfallCheck) {
        const shortfalls = computeShortfalls(editLines, finalRemoved);
        if (shortfalls.length > 0) {
          setDissolveCandidates({ shortfalls, pendingAction: action });
          setSaving(false);
          return null;
        }
      }

      await apiClient.put(`/orders/${orderId}/lines`, { lines: editLines, removedLines: finalRemoved });
      setEditingBouquet(false);
      setStockAction(null);
      const res = await apiClient.get(`/orders/${orderId}`);
      showToast(t.bouquetUpdated || 'Bouquet updated', 'success');
      setSaving(false);
      return res.data;
    } catch (err) {
      showToast(err.response?.data?.error || t.updateError || 'Error', 'error');
      setSaving(false);
      return null;
    }
  }

  // Called by the dialog when the owner confirms which premades to dissolve.
  // Dissolves each (returns remaining stems to stock + deletes the bouquet),
  // refreshes stockItems, then re-runs the save with shortfall check bypassed.
  async function confirmDissolveAndSave(bouquetIds) {
    const action = dissolveCandidates?.pendingAction ?? null;
    setDissolveCandidates(null);
    setSaving(true);
    for (const id of bouquetIds) {
      try {
        await apiClient.post(`/premade-bouquets/${id}/dissolve`);
      } catch (err) {
        showToast(err.response?.data?.error || t.updateError || 'Dissolve failed', 'error');
      }
    }
    // Refresh stockItems + premadeMap so the next shortfall check (if any)
    // sees the post-dissolve reality.
    try {
      const [stockRes, premadeRes] = await Promise.all([
        apiClient.get('/stock?includeEmpty=true&includeInactive=true'),
        apiClient.get('/stock/premade-committed').catch(() => ({ data: {} })),
      ]);
      setStockItems(stockRes.data);
      setPremadeMap(premadeRes.data || {});
    } catch {}
    return doSave(action, { skipShortfallCheck: true });
  }

  function cancelDissolve() {
    setDissolveCandidates(null);
  }

  // Called when the user clicks Save. Only asks about spare flowers when a line
  // quantity was reduced inline (e.g. 10 → 7) — those stems need a return/writeoff
  // decision. Fully-removed lines already carry their own action from the per-line
  // remove dialog, so re-asking would be a redundant second confirmation.
  function handleSaveClick() {
    const hasReductions = editLines.some(l => l._originalQty > 0 && l.quantity < l._originalQty);
    if (hasReductions && stockAction !== 'pending') {
      setStockAction('pending');
      return Promise.resolve(null); // dialog will appear, user picks action, then doSave runs
    }
    return doSave(null);
  }

  function cancelEditing() {
    setEditingBouquet(false);
    setRemoveDialogIdx(null);
    setStockAction(null);
    setNewFlowerForm(null);
  }

  // ── Filtered stock for picker ──────────────────────────────────
  function getFilteredStock(query) {
    return stockItems.filter(s => {
      if (!isStockItemVisible(s, pendingPO)) return false;
      if (editLines.some(l => l.stockItemId === s.id)) return false;
      if (query) return (s['Display Name'] || '').toLowerCase().includes(query.toLowerCase());
      return true;
    });
  }

  // ── Computed ──────────────────────────────────────────────────
  // The line's own price is the primary source: it's what the picker/editor
  // displays for that row AND what gets PUT to /orders/:id/lines on save, so
  // the total the owner sees must match it. The live stock record's price is
  // only a fallback for lines that don't carry a price of their own.
  //
  // This used to prefer the live stock record first, which reads right after
  // switchLineTier (line price is copied from the target record) and after a
  // successful createDemandEntry re-price (ditto) — but it silently
  // contradicted the line's own price in two real cases: (1) createDemandEntry
  // deliberately keeps a line at the entered price when its price-persist PATCH
  // fails ("still add the line at the entered price so the bouquet total is
  // right" — see that comment), and (2) addFlowerFromStock prices a not-yet-
  // arrived flower off its pending PO (resolveStockLinePrice, #377), which can
  // differ from the stock record's stale last-received card price. Falling
  // back to the record only when the line has no price of its own fixes both
  // without touching the switchLineTier / successful-re-price paths, where line
  // and record already agree.
  const editCostTotal = editLines.reduce((s, l) => {
    const si = l.stockItemId ? stockItems.find(x => x.id === l.stockItemId) : null;
    return s + Number(l.costPricePerUnit ?? si?.['Current Cost Price'] ?? 0) * Number(l.quantity || 0);
  }, 0);
  const editSellTotal = editLines.reduce((s, l) => {
    const si = l.stockItemId ? stockItems.find(x => x.id === l.stockItemId) : null;
    return s + Number(l.sellPricePerUnit ?? si?.['Current Sell Price'] ?? 0) * Number(l.quantity || 0);
  }, 0);
  const editMargin = editSellTotal > 0
    ? Math.round(((editSellTotal - editCostTotal) / editSellTotal) * 100) : 0;

  const hasReductions = editLines.some(l => l._originalQty > 0 && l.quantity < l._originalQty);

  // Remove dialog helpers
  const removeDialogLine = removeDialogIdx != null ? editLines[removeDialogIdx] : null;
  const removeDialogStockItem = removeDialogLine
    ? stockItems.find(s => s.id === removeDialogLine.stockItemId) : null;
  const removeDialogIsNegativeStock = removeDialogStockItem
    ? (Number(removeDialogStockItem['Current Quantity'] ?? 0)) < 0 : false;

  return {
    // State
    saving, setSaving,
    editingBouquet,
    editLines,
    removedLines,
    removeDialogIdx, removeDialogLine, removeDialogIsNegativeStock,
    stockAction,
    addingFlower,
    flowerSearch,
    stockItems,
    newFlowerForm, setNewFlowerForm,
    pendingPO,
    premadeMap,
    dissolveCandidates,

    // Computed
    editCostTotal, editSellTotal, editMargin,
    hasReductions,

    // Actions
    startEditing,
    getLineCap,
    getLineTiers,
    switchLineTier,
    updateLineQty,
    commitLineQty,
    incrementQty,
    decrementQty,
    setRemoveDialogIdx,
    confirmRemoveLine,
    setAddingFlower,
    setFlowerSearch,
    addFlowerFromStock,
    openNewFlowerForm,
    addNewFlower,
    addNewFlowerQuick,
    addNewVariety,
    getFilteredStock,
    doSave,
    handleSaveClick,
    cancelEditing,
    setStockAction,
    confirmDissolveAndSave,
    cancelDissolve,
    createDemandEntry,
  };
}
