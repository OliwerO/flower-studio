// useOrderEditing — shared hook for bouquet editing, stock decisions, and save logic.
// Pure state + business logic, no UI rendering. Used by both florist OrderCard
// and dashboard OrderDetailPanel so they stay in sync.
//
// Dependencies are injected so the hook stays decoupled from app-specific
// modules (API client, toast, translations).

import { useState } from 'react';

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
    if (stockItems.length === 0) {
      apiClient.get('/stock?includeEmpty=true').then(r => setStockItems(r.data)).catch(() => {});
    }
    apiClient.get('/stock/pending-po').then(r => setPendingPO(r.data)).catch(() => {});
  }

  // ── Line quantity manipulation ─────────────────────────────────
  function updateLineQty(idx, rawValue) {
    setEditLines(prev => prev.map((l, i) =>
      i === idx ? { ...l, quantity: rawValue === '' ? '' : (Number(rawValue) || 0) } : l
    ));
  }

  function commitLineQty(idx) {
    setEditLines(prev => prev.map((l, i) =>
      i === idx && (!l.quantity || Number(l.quantity) < 1) ? { ...l, quantity: 1 } : l
    ));
  }

  function incrementQty(idx) {
    setEditLines(prev => prev.map((l, i) =>
      i === idx ? { ...l, quantity: (Number(l.quantity) || 0) + 1 } : l
    ));
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
  function addFlowerFromStock(stockItem) {
    setEditLines(prev => [...prev, {
      id: null,
      stockItemId: stockItem.id,
      flowerName: stockItem['Display Name'],
      quantity: 1,
      _originalQty: 0,
      costPricePerUnit: Number(stockItem['Current Cost Price']) || 0,
      sellPricePerUnit: Number(stockItem['Current Sell Price']) || 0,
    }]);
    setFlowerSearch('');
    setAddingFlower(false);
  }

  // ── New flower (full form — owner/dashboard) ───────────────────
  function openNewFlowerForm(name) {
    setNewFlowerForm({ name, costPrice: '', sellPrice: '', lotSize: '', supplier: '' });
    setAddingFlower(false);
  }

  async function addNewFlower() {
    if (!newFlowerForm) return;
    try {
      const res = await apiClient.post('/stock', {
        displayName: newFlowerForm.name,
        costPrice: Number(newFlowerForm.costPrice) || 0,
        sellPrice: Number(newFlowerForm.sellPrice) || 0,
        lotSize: Number(newFlowerForm.lotSize) || 1,
        supplier: newFlowerForm.supplier || '',
        quantity: 0,
      });
      setEditLines(prev => [...prev, {
        id: null, stockItemId: res.data.id, flowerName: res.data['Display Name'],
        quantity: 1, _originalQty: 0,
        costPricePerUnit: Number(newFlowerForm.costPrice) || 0,
        sellPricePerUnit: Number(newFlowerForm.sellPrice) || 0,
      }]);
    } catch {
      showToast(t.updateError || 'Error creating stock item', 'error');
      return;
    }
    setNewFlowerForm(null);
    setFlowerSearch('');
  }

  // ── New flower (quick add — florist, just name) ────────────────
  async function addNewFlowerQuick(name) {
    try {
      const res = await apiClient.post('/stock', { displayName: name.trim(), quantity: 0 });
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

  // ── Save bouquet ───────────────────────────────────────────────
  // Returns the refreshed order data on success, null on failure.
  async function doSave(action) {
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

  // Called when the user clicks Save. If quantities were reduced, shows stock
  // action dialog first. Otherwise saves directly.
  // Returns a promise that resolves to the refreshed data or null.
  function handleSaveClick() {
    const hasReductions = editLines.some(l => l._originalQty > 0 && l.quantity < l._originalQty);
    const hasRemovals = removedLines.length > 0;
    if ((hasReductions || hasRemovals) && stockAction !== 'pending') {
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
      const name = (s['Display Name'] || '').toLowerCase();
      const qty = Number(s['Current Quantity']) || 0;
      if (qty <= 0 && /\(\d{1,2}\.\w{3,4}\.?\)$/.test(s['Display Name'] || '')) return false;
      if (editLines.some(l => l.stockItemId === s.id)) return false;
      if (query) return name.includes(query.toLowerCase());
      return true;
    });
  }

  // ── Computed (use live stock prices when available) ─────────────
  const editCostTotal = editLines.reduce((s, l) => {
    const si = l.stockItemId ? stockItems.find(x => x.id === l.stockItemId) : null;
    return s + Number(si?.['Current Cost Price'] ?? l.costPricePerUnit ?? 0) * Number(l.quantity || 0);
  }, 0);
  const editSellTotal = editLines.reduce((s, l) => {
    const si = l.stockItemId ? stockItems.find(x => x.id === l.stockItemId) : null;
    return s + Number(si?.['Current Sell Price'] ?? l.sellPricePerUnit ?? 0) * Number(l.quantity || 0);
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

    // Computed
    editCostTotal, editSellTotal, editMargin,
    hasReductions,

    // Actions
    startEditing,
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
    getFilteredStock,
    doSave,
    handleSaveClick,
    cancelEditing,
    setStockAction,
  };
}
