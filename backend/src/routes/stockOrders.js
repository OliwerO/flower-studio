// Stock Orders (Purchase Orders) — procurement lifecycle management.
// Like a kanban board for the purchasing process:
// Draft → Sent → Shopping → Evaluating → Complete
//
// Each PO has lines grouped by supplier. The driver shops, the florist evaluates quality,
// and stock levels are adjusted when flowers pass inspection.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as stockRepo from '../repos/stockRepo.js';
import * as stockOrderRepo from '../repos/stockOrderRepo.js';
import { broadcast } from '../services/notifications.js';
import { PO_STATUS, VALID_PO_STATUSES, PO_LINE_STATUS } from '../constants/statuses.js';
import { getConfig, getDriverOfDay } from '../services/configService.js';
import { notifyPoAssigned } from '../services/driverNotifyService.js';
import { resolveOrCreateStockItem, evaluatePurchaseOrder } from '../services/stockOrderService.js';

const VALID_STATUSES = VALID_PO_STATUSES;

// Compose a driver-readable Flower Name from Y-model Variety attrs (#304) when
// a line carries a new-Variety Type but no explicit Flower Name. Mirrors the
// frontend createPO compose so every Variety line has a name. Without it, a
// Type-only line (the inline DraftLineEditor patches Type on its own) persisted
// with an empty Flower Name and the /send identity check rejected it as blank
// — the "cannot send PO to driver" bug.
function composeFlowerName({ flowerName, type, colour, size, cultivar } = {}) {
  const explicit = String(flowerName ?? '').trim();
  if (explicit) return explicit;
  return [type, colour, size != null && size !== '' ? `${size}cm` : null, cultivar]
    .map(v => (v == null ? '' : String(v).trim()))
    .filter(Boolean)
    .join(' ');
}

const ALLOWED_TRANSITIONS = {
  [PO_STATUS.DRAFT]:      [PO_STATUS.SENT],
  [PO_STATUS.SENT]:       [PO_STATUS.SHOPPING, PO_STATUS.REVIEWING, PO_STATUS.DRAFT],
  [PO_STATUS.SHOPPING]:   [PO_STATUS.REVIEWING],
  [PO_STATUS.REVIEWING]:  [PO_STATUS.EVALUATING],
  [PO_STATUS.EVALUATING]: [PO_STATUS.EVAL_ERROR, PO_STATUS.COMPLETE],
  [PO_STATUS.EVAL_ERROR]: [PO_STATUS.EVALUATING],
};

const router = Router();

// GET /api/stock-orders/meta/lookups — flowers + suppliers list for the
// driver/owner alt-flower dropdowns. Drivers don't have access to /stock or
// /settings, so this exposes only the minimal fields they need.
router.get('/meta/lookups', authorize('stock-orders'), async (req, res, next) => {
  try {
    const items = await stockRepo.list({
      pg: { active: true, includeEmpty: true },
    });
    const flowers = items.map(s => ({
      id:       s.id,
      name:     s['Display Name'] || '',
      supplier: s.Supplier || '',
      cost:     Number(s['Current Cost Price']) || 0,
    })).filter(f => f.name);
    const suppliers = getConfig('suppliers') || [];
    res.json({ flowers, suppliers });
  } catch (err) {
    next(err);
  }
});

// GET /api/stock-orders?status=Draft&include=lines
// Drivers only see POs assigned to them. Owner/florist see everything.
router.get('/', authorize('stock-orders'), async (req, res, next) => {
  try {
    const { status, include } = req.query;
    if (status && !VALID_PO_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    const orders = await stockOrderRepo.list({
      status: status || undefined,
      role:   req.role,
      driverName: req.driverName,
    });

    if (include === 'lines' && orders.length > 0) {
      const poIds = orders.map(o => o._pgId).filter(Boolean);
      const linesByPo = await stockOrderRepo.getLinesForPos(poIds);
      const result = orders.map(o => ({
        ...o,
        lines: linesByPo.get(o._pgId) || [],
        'Order Lines': (linesByPo.get(o._pgId) || []).map(l => l.id),
      }));
      return res.json(result);
    }

    res.json(orders);
  } catch (err) {
    next(err);
  }
});

// GET /api/stock-orders/:id — single PO with its lines
router.get('/:id', authorize('stock-orders'), async (req, res, next) => {
  try {
    const order = await stockOrderRepo.getById(req.params.id);
    if (req.role === 'driver' && req.driverName && order['Assigned Driver'] !== req.driverName) {
      return res.status(404).json({ error: 'PO not found.' });
    }
    const lines = await stockOrderRepo.getLinesByPoId(order._pgId);
    res.json({ ...order, lines, 'Order Lines': lines.map(l => l.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/stock-orders — create PO with lines (owner only)
// Body: { notes, lines: [{ stockItemId, flowerName, quantity, supplier, costPrice, sellPrice }] }
router.post('/', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const { notes, lines, driver, plannedDate } = req.body;

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'PO must include at least one line.' });
    }
    if (lines.every(l => (Number(l.quantity) || 0) <= 0)) {
      return res.status(400).json({ error: 'At least one line must have quantity > 0.' });
    }

    const today = new Date().toISOString().split('T')[0];
    const seq = await stockOrderRepo.nextPoSequence(today);
    const poNumber = `PO-${today.replace(/-/g, '')}-${seq}`;

    const order = await stockOrderRepo.create({
      Status:           PO_STATUS.DRAFT,
      'Created Date':   today,
      'Stock Order ID': poNumber,
      Notes:            notes || '',
      ...(driver       ? { 'Assigned Driver': driver } : {}),
      ...(plannedDate  ? { 'Planned Date': plannedDate } : {}),
    });

    const createdLines = [];
    for (const line of lines || []) {
      // Y-model new-Variety intent (#304): when the line carries Type+attrs we
      // skip the legacy auto-resolve so we don't pre-create a Stock Item with
      // a free-text display name. Evaluation later creates the Variety properly.
      const hasNewVarietyIntent = !!(line.type && String(line.type).trim());
      let resolvedStockItemId = line.stockItemId || null;
      if (!resolvedStockItemId && line.flowerName && !hasNewVarietyIntent) {
        try {
          resolvedStockItemId = await resolveOrCreateStockItem(line.flowerName, {
            costPrice: line.costPrice, sellPrice: line.sellPrice, supplier: line.supplier,
          });
        } catch (err) {
          console.error(`[STOCK-ORDER] Auto-link/create failed for "${line.flowerName}":`, err.message);
        }
      }
      let lotSize = Number(line.lotSize) || 0;
      if (!lotSize && resolvedStockItemId) {
        try {
          const stockItem = await stockRepo.getById(resolvedStockItemId);
          lotSize = Number(stockItem['Lot Size']) || 0;
        } catch { /* stock item may have been deleted */ }
      }
      const lineFields = {
        'Stock Orders':    [order._pgId],
        ...(resolvedStockItemId ? { 'Stock Item': [resolvedStockItemId] } : {}),
        'Flower Name':     composeFlowerName({
          flowerName: line.flowerName, type: line.type,
          colour: line.colour, size: line.size, cultivar: line.cultivar,
        }),
        'Quantity Needed': Number(line.quantity) || 0,
        ...(lotSize > 0 ? { 'Lot Size': lotSize } : {}),
        'Driver Status':   PO_LINE_STATUS.PENDING,
        Supplier:          line.supplier || '',
        'Cost Price':      Number(line.costPrice) || 0,
        'Sell Price':      Number(line.sellPrice) || 0,
        ...(hasNewVarietyIntent ? {
          Type:     line.type,
          Colour:   line.colour ?? null,
          Size:     line.size ?? null,
          Cultivar: line.cultivar ?? null,
        } : {}),
      };
      if (line.farmer) lineFields.Farmer = line.farmer;
      if (line.notes)  lineFields.Notes = line.notes;

      const lineRec = await stockOrderRepo.createLine(lineFields);
      createdLines.push(lineRec);
    }

    res.status(201).json({ ...order, lines: createdLines });
  } catch (err) {
    console.error('[STOCK-ORDER] PO creation failed:', err.message, err.statusCode);
    next(err);
  }
});

// PATCH /api/stock-orders/:id — update PO header
// Owner can update all fields; driver can only update Supplier Payments
router.patch('/:id', authorize('stock-orders'), async (req, res, next) => {
  try {
    const isOwner = req.role === 'owner';
    const allowed = isOwner
      ? ['Status', 'Notes', 'Assigned Driver', 'Supplier Payments', 'Driver Payment', 'Planned Date']
      : ['Supplier Payments'];
    const fields = {};
    for (const key of allowed) {
      if (key in req.body) fields[key] = req.body[key];
    }

    if (Object.keys(fields).length === 0) {
      return res.json(await stockOrderRepo.getById(req.params.id));
    }

    if (fields.Status) {
      const current = await stockOrderRepo.getById(req.params.id);
      const valid = ALLOWED_TRANSITIONS[current.Status];
      if (!valid || !valid.includes(fields.Status)) {
        return res.status(400).json({
          error: `Cannot transition from "${current.Status}" to "${fields.Status}".`,
        });
      }
    }

    // Capture the prior driver so we only notify on a genuine assignment change
    // (mirrors deliveries.js — re-saving a PO with the same driver must not re-ping).
    const priorDriver = ('Assigned Driver' in fields)
      ? ((await stockOrderRepo.getById(req.params.id).catch(() => null))?.['Assigned Driver'] || '')
      : '';

    const updated = await stockOrderRepo.update(req.params.id, fields);

    if ('Assigned Driver' in fields) {
      const newDriver = fields['Assigned Driver'] || '';
      broadcast({
        type: 'stock_pickup_assigned',
        stockOrderId: req.params.id,
        driverName: newDriver,
      });
      if (newDriver && newDriver !== priorDriver) {
        notifyPoAssigned({ stockOrderId: req.params.id, driverName: newDriver })
          .catch(err => console.error('[DRIVER_NOTIFY] po patch hook failed:', err.message));
      }
    }
    broadcast({ type: 'stock_order_line_updated', stockOrderId: req.params.id });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/stock-orders/:id/lines/:lineId — update a single line
// Used by driver (status, qty found, alt supplier) and owner (corrections)
//
// Edit-window rules (prevents retroactive tampering with closed POs):
//   DRAFT/SENT/SHOPPING → driver + owner can edit anything
//   REVIEWING/EVALUATING/EVAL_ERROR → owner only (corrections during/after review)
//   COMPLETE → nobody (closed books — create an adjustment instead)
const PO_OWNER_ONLY_STATUSES = [PO_STATUS.REVIEWING, PO_STATUS.EVALUATING, PO_STATUS.EVAL_ERROR];

router.patch('/:id/lines/:lineId', authorize('stock-orders'), async (req, res, next) => {
  try {
    const po = await stockOrderRepo.getById(req.params.id);
    if (po.Status === PO_STATUS.COMPLETE) {
      return res.status(409).json({
        error: `PO is "${PO_STATUS.COMPLETE}" — closed books. Create an adjustment instead.`,
      });
    }
    if (PO_OWNER_ONLY_STATUSES.includes(po.Status) && req.role !== 'owner') {
      return res.status(403).json({
        error: `PO is "${po.Status}" — only the owner can edit lines at this stage.`,
      });
    }

    const allowed = [
      'Driver Status', 'Quantity Found', 'Alt Supplier', 'Alt Quantity Found',
      'Alt Flower Name', 'Cost Price', 'Sell Price', 'Alt Cost',
      'Quantity Accepted', 'Write Off Qty', 'Notes', 'Quantity Needed',
      'Flower Name', 'Supplier', 'Lot Size', 'Farmer',
      // Y-model Variety identity for new-Variety lines (issue #304)
      'Type', 'Colour', 'Size', 'Cultivar',
      // Substitute Variety identity classified at shopping entry (#2)
      'Alt Type', 'Alt Colour', 'Alt Size', 'Alt Cultivar',
    ];
    const fields = {};
    for (const key of allowed) {
      if (key in req.body) fields[key] = req.body[key];
    }
    if (Object.keys(fields).length === 0) {
      return res.json(await stockOrderRepo.getLineById(req.params.lineId));
    }

    if ('Flower Name' in fields && typeof fields['Flower Name'] === 'string' && fields['Flower Name'].length < 2) {
      const existing = await stockOrderRepo.getLineById(req.params.lineId);
      const hasStockItem = !!existing['Stock Item']?.[0];
      const currentName = existing['Flower Name'] || '';
      if (hasStockItem && currentName.length >= 2) {
        delete fields['Flower Name'];
        if (Object.keys(fields).length === 0) return res.json(existing);
      }
    }

    // When a Draft line gets a new-Variety Type/Colour/Size/Cultivar but no
    // explicit Flower Name (the inline DraftLineEditor patches Type on its own),
    // compose a name from the merged attrs so the row stays sendable and the
    // driver sees what to buy. Without this the line is invisible to /send.
    if (['Type', 'Colour', 'Size', 'Cultivar'].some(k => k in fields)) {
      const existing = await stockOrderRepo.getLineById(req.params.lineId);
      const merged = (k) => (k in fields ? fields[k] : existing[k]);
      const mergedName = String(merged('Flower Name') ?? '').trim();
      const mergedType = String(merged('Type') ?? '').trim();
      if (!mergedName && mergedType) {
        fields['Flower Name'] = composeFlowerName({
          type:     merged('Type'),
          colour:   merged('Colour'),
          size:     merged('Size'),
          cultivar: merged('Cultivar'),
        });
      }
    }

    const updated = await stockOrderRepo.updateLine(req.params.lineId, fields);

    if ('Driver Status' in fields && po.Status === PO_STATUS.SENT) {
      await stockOrderRepo.update(req.params.id, { Status: PO_STATUS.SHOPPING });
    }

    broadcast({
      type: 'stock_order_line_updated',
      stockOrderId: req.params.id,
      lineId: req.params.lineId,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/stock-orders/:id/lines — add a line to an editable PO
// Owner can still tweak the shopping list while the PO is Draft/Sent/Shopping.
// Reviewing/Evaluating/Complete are "closed books" — don't mutate past records.
const EDITABLE_PO_STATUSES = [PO_STATUS.DRAFT, PO_STATUS.SENT, PO_STATUS.SHOPPING];

router.post('/:id/lines', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const po = await stockOrderRepo.getById(req.params.id);
    if (!EDITABLE_PO_STATUSES.includes(po.Status)) {
      return res.status(400).json({ error: `Cannot add lines to a "${po.Status}" PO.` });
    }
    const {
      stockItemId: rawStockItemId, flowerName, quantity, supplier,
      costPrice, sellPrice, lotSize,
      type, colour, size, cultivar,
    } = req.body;
    // Identity rule (root CLAUDE.md known-pitfall #6): every PO line must have
    // either a Stock Item link or a Flower Name *by the time the PO is sent*.
    // For Draft, allow a blank line so the owner can tap "+ Add line" and edit
    // the row inline (matches the wizard flow). The /send endpoint enforces
    // the rule on Draft→Sent so blank rows can never reach the driver.
    if (!rawStockItemId && !flowerName?.trim() && !type?.trim() && po.Status !== PO_STATUS.DRAFT) {
      return res.status(400).json({ error: 'PO line must have a stock item or flower name.' });
    }
    // Y-model new-Variety lines (issue #304) skip the legacy auto-resolve so
    // we don't pre-create a Stock Item with a free-text display name and no
    // Variety attrs. The line carries Type/Colour/Size/Cultivar; evaluation
    // resolves to a Stock Item with full Y-model identity at receive time.
    const hasNewVarietyIntent = !!(type && type.trim());
    let resolvedStockItemId = rawStockItemId || null;
    if (!resolvedStockItemId && flowerName && !hasNewVarietyIntent) {
      try {
        resolvedStockItemId = await resolveOrCreateStockItem(flowerName, { costPrice, sellPrice, supplier });
      } catch (err) {
        console.error(`[STOCK-ORDER] Auto-link/create failed for "${flowerName}":`, err.message);
      }
    }
    const line = await stockOrderRepo.createLine({
      'Stock Orders':    [po._pgId],
      ...(resolvedStockItemId ? { 'Stock Item': [resolvedStockItemId] } : {}),
      'Flower Name':     composeFlowerName({ flowerName, type, colour, size, cultivar }),
      'Quantity Needed': Number(quantity) || 1,
      Supplier:          supplier || '',
      'Cost Price':      Number(costPrice) || 0,
      'Sell Price':      Number(sellPrice) || 0,
      'Lot Size':        Number(lotSize) || 0,
      'Driver Status':   PO_LINE_STATUS.PENDING,
      ...(hasNewVarietyIntent ? {
        Type:     type,
        Colour:   colour ?? null,
        Size:     size ?? null,
        Cultivar: cultivar ?? null,
      } : {}),
    });
    broadcast({ type: 'stock_order_line_updated', stockOrderId: req.params.id, lineId: line.id });
    res.json(line);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/stock-orders/:id — delete an entire Draft PO (owner only).
// Removes all its lines first, then the PO header.
router.delete('/:id', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const po = await stockOrderRepo.getById(req.params.id);
    if (po.Status !== PO_STATUS.DRAFT) {
      return res.status(400).json({ error: `Only Draft POs can be deleted. This PO is "${po.Status}".` });
    }
    await stockOrderRepo.deleteById(req.params.id);  // CASCADE handles lines
    broadcast({ type: 'stock_order_deleted', stockOrderId: req.params.id });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/stock-orders/:id/lines/:lineId — remove a line from an editable PO
router.delete('/:id/lines/:lineId', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const po = await stockOrderRepo.getById(req.params.id);
    if (!EDITABLE_PO_STATUSES.includes(po.Status)) {
      return res.status(400).json({ error: `Cannot remove lines from a "${po.Status}" PO.` });
    }
    await stockOrderRepo.deleteLineById(req.params.lineId);
    broadcast({ type: 'stock_order_line_updated', stockOrderId: req.params.id, lineId: req.params.lineId });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/stock-orders/:id/send — assign driver and send PO (owner only)
// Body: { driverName }
router.post('/:id/send', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const { driverName } = req.body;
    const resolvedDriver = driverName || getDriverOfDay();
    // Enforce the line-identity rule on Draft→Sent. Sent→Sent re-sends (driver
    // reassignment) skip the check because their lines were already validated
    // on the previous send. Without this gate, blank Draft lines would reach
    // the driver as "what am I buying?" rows.
    const po = await stockOrderRepo.getById(req.params.id);
    if (po.Status === PO_STATUS.DRAFT) {
      const lines = await stockOrderRepo.getLinesByPoId(po._pgId);
      if (lines.length === 0) {
        return res.status(400).json({ error: 'Cannot send an empty PO. Add at least one line first.' });
      }
      const blankCount = lines.filter(l => {
        const hasStockItem = Array.isArray(l['Stock Item']) && l['Stock Item'].length > 0;
        const hasFlowerName = String(l['Flower Name'] || '').trim() !== '';
        // A new-Variety line (Type set) is valid identity too — matches the
        // line-add rule (hasNewVarietyIntent) so a line accepted on creation
        // can't be rejected on send. Persistence composes its Flower Name.
        const hasVariety = String(l['Type'] || '').trim() !== '';
        return !hasStockItem && !hasFlowerName && !hasVariety;
      }).length;
      if (blankCount > 0) {
        return res.status(400).json({
          error: `Fill flower name on ${blankCount} blank line(s) before sending.`,
        });
      }
    }
    const updated = await stockOrderRepo.update(req.params.id, {
      Status: PO_STATUS.SENT,
      'Assigned Driver': resolvedDriver,
    });

    // SSE notification to driver
    broadcast({ type: 'stock_pickup_assigned', stockOrderId: req.params.id, driverName: resolvedDriver });

    if (resolvedDriver) {
      notifyPoAssigned({ stockOrderId: req.params.id, driverName: resolvedDriver })
        .catch(err => console.error('[DRIVER_NOTIFY] po send hook failed:', err.message));
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/stock-orders/:id/driver-complete — driver marks shopping done
// Goes to Reviewing first (owner can adjust), then owner or auto → Evaluating
router.post('/:id/driver-complete', authorize('stock-orders'), async (req, res, next) => {
  try {
    const po = await stockOrderRepo.getById(req.params.id);
    if (![PO_STATUS.SENT, PO_STATUS.SHOPPING].includes(po.Status)) {
      return res.status(400).json({ error: `PO is "${po.Status}", cannot complete shopping.` });
    }
    const updated = await stockOrderRepo.update(req.params.id, {
      Status: PO_STATUS.REVIEWING,
    });

    // SSE notification to owner + florists: shopping complete, review ready
    broadcast({ type: 'stock_review_ready', stockOrderId: req.params.id });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/stock-orders/:id/approve-review — owner approves, moves to Evaluating
router.post('/:id/approve-review', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const po = await stockOrderRepo.getById(req.params.id);
    if (po.Status !== PO_STATUS.REVIEWING) {
      return res.status(400).json({ error: `PO is "${po.Status}", not "${PO_STATUS.REVIEWING}".` });
    }
    const updated = await stockOrderRepo.update(req.params.id, { Status: PO_STATUS.EVALUATING });
    broadcast({ type: 'stock_evaluation_ready', stockOrderId: req.params.id });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/stock-orders/:id/evaluate — florist submits quality evaluation
// Body: { lines: [{ lineId, quantityAccepted, writeOffQty, writeOffReason, altQuantityAccepted, altWriteOffQty, altWriteOffReason }] }
// Thin controller — all business logic lives in stockOrderService.evaluatePurchaseOrder.
router.post('/:id/evaluate', authorize('stock-orders', ['owner', 'florist']), async (req, res, next) => {
  try {
    const { lines } = req.body;
    const result = await evaluatePurchaseOrder(req.params.id, lines);

    if (result.outcome === 'conflict') {
      return res.status(409).json({
        error: `PO is "${result.status}", not "${PO_STATUS.EVALUATING}". Already processed?`,
      });
    }
    if (result.outcome === 'partial') {
      return res.status(207).json({
        success: false,
        message: result.message,
        lineResults: result.lineResults,
      });
    }

    res.json({ success: true, lineResults: result.lineResults });
  } catch (err) {
    next(err);
  }
});

export default router;
