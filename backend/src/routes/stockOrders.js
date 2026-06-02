// Stock Orders (Purchase Orders) — procurement lifecycle management.
// Like a kanban board for the purchasing process:
// Draft → Sent → Shopping → Evaluating → Complete
//
// Each PO has lines grouped by supplier. The driver shops, the florist evaluates quality,
// and stock levels are adjusted when flowers pass inspection.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as stockRepo from '../repos/stockRepo.js';
import * as stockLossRepo from '../repos/stockLossRepo.js';
import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';
import * as stockOrderRepo from '../repos/stockOrderRepo.js';
import * as orderService from '../services/orderService.js';
import { broadcast } from '../services/notifications.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { PO_STATUS, VALID_PO_STATUSES, PO_LINE_STATUS, LOSS_REASON } from '../constants/statuses.js';
import { getConfig, getDriverOfDay } from '../services/configService.js';
import { notifyPoAssigned } from '../services/driverNotifyService.js';

const VALID_STATUSES = VALID_PO_STATUSES;

// Resolve a flower name to an Airtable-safe stock item ID.
// Uses stockRepo (Postgres) not Airtable — the stock table is frozen in AT.
// Returns the Airtable recXXX if the item was backfilled, or null for
// PG-only items (no recXXX means passing the UUID to AT's linked field
// would auto-create a ghost record with the UUID as Display Name).
// Auto-creates a Postgres stock card if none found, so the item appears
// in the bouquet picker immediately after the PO is saved.
async function resolveOrCreateStockItem(flowerName, { costPrice = 0, sellPrice = 0, supplier = '' } = {}) {
  const name = flowerName.trim();
  const matches = await stockRepo.list({
    maxRecords: 1,
    pg: { displayName: name, active: true, includeEmpty: true },
  });
  if (matches.length > 0) {
    return matches[0].id.startsWith('rec') ? matches[0].id : matches[0]._pgId || matches[0].id;
  }
  const newItem = await stockRepo.create({
    'Display Name':       name,
    'Purchase Name':      name,
    'Current Quantity':   0,
    'Current Cost Price': Number(costPrice) || 0,
    'Current Sell Price': Number(sellPrice) || 0,
    Supplier:             supplier || '',
    Category:             'Other',
    Active:               true,
  });
  console.log(`[STOCK-ORDER] Auto-created stock item "${name}" (${newItem.id}) from PO line`);
  return newItem.id.startsWith('rec') ? newItem.id : newItem._pgId || newItem.id;
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
        'Flower Name':     line.flowerName || '',
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
      'Flower Name':     flowerName || '',
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
        return !hasStockItem && !hasFlowerName;
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

// Idempotency helper — returns true if a STOCK_PURCHASES row with this exact
// notes marker already exists. Caller constructs the marker (see ADR-0003 for
// format). Used on retry after a partial failure to skip double-credit.
async function purchaseAlreadyRecorded(marker) {
  try {
    return await stockPurchasesRepo.noteMarkerExists(marker);
  } catch (e) {
    console.error('[STOCK-ORDER] Idempotency check failed:', e.message);
    return false; // fail-open — better to risk a warning than block a retry
  }
}

// Find an existing Stock record by exact Display Name, or create a new one
// for a substitute flower that doesn't exist in the catalog yet.
//
// Used by the PO evaluation flow when the driver brought a substitute that
// needs to be received into inventory as its own stock item (not merged into
// the original that was ordered). Category, unit, and reorder threshold are
// copied from the originally-ordered stock item so the substitute has
// sensible defaults without requiring the florist to fill a form.
//
// Sell price uses the global targetMarkup setting: sellPrice = costPerStem * markup.
async function findOrCreateSubstituteStock(altFlowerName, altSupplier, costPerStem, originalStockItem, originalStockId, today) {
  const trimmedName = (altFlowerName || '').trim();
  if (!trimmedName) {
    throw new Error('Cannot receive substitute with empty flower name');
  }

  // Try to find an existing Stock record with the exact same display name.
  // Sanitize quotes to avoid breaking the Airtable filter formula.
  const safe = sanitizeFormulaValue(trimmedName);
  const existing = await stockRepo.list({
    filterByFormula: `{Display Name} = '${safe}'`,
    pg: { displayName: trimmedName, includeInactive: true, includeEmpty: true },
    maxRecords: 1,
  });
  if (existing.length > 0) {
    const found = existing[0];
    // Phase B: stack multiple originals onto one substitute card. If this
    // substitute was previously created for a different original flower,
    // append the current originalStockId so the reconciliation query can
    // find all affected originals from the substitute side.
    if (originalStockId) {
      const currentLinks = Array.isArray(found['Substitute For']) ? found['Substitute For'] : [];
      if (!currentLinks.includes(originalStockId)) {
        await stockRepo.update(found.id, {
          'Substitute For': [...currentLinks, originalStockId],
        });
      }
    }
    return found.id;
  }

  // Not found → create a brand-new stock card for the substitute.
  // Copy category/unit/threshold from the original item so the substitute
  // inherits sensible defaults. Cost = actual per-stem paid, sell = cost * markup.
  const markup = Number(getConfig('targetMarkup')) || 1;
  const sellPerStem = Math.round(costPerStem * markup * 100) / 100;

  const created = await stockRepo.create({
    'Display Name':       trimmedName,
    'Purchase Name':      trimmedName,
    Category:             originalStockItem?.Category || 'Other',
    'Current Quantity':   0, // receiveIntoStock will adjust upward
    'Current Cost Price': costPerStem,
    'Current Sell Price': sellPerStem,
    Supplier:             altSupplier || '',
    Unit:                 originalStockItem?.Unit || 'Stems',
    'Reorder Threshold':  originalStockItem?.['Reorder Threshold'] || 0,
    Active:               true,
    'Last Restocked':     today,
    ...(originalStockId ? { 'Substitute For': [originalStockId] } : {}),
  });
  console.log(`[STOCK-ORDER] Created substitute stock card "${trimmedName}" (${created.id}) — cost ${costPerStem} zł, sell ${sellPerStem} zł`);
  return created.id;
}

// Receive accepted flowers into stock as a SEPARATE dated batch.
// Always creates a new Stock record with a date suffix (e.g. "Hydrangea (15.Apr.)")
// so the florist can track when each lot arrived and manage FIFO.
//
// If the original stock record has negative qty (pre-sold demand), the deficit
// is absorbed into the new batch (received - deficit) and the original is
// zeroed out. This way order-line links stay valid and the florist doesn't see
// a confusing negative number next to fresh flowers.
//
// Variety attrs (Type/Colour/Size/Cultivar) flow from the PO line context
// onto the new dated Batch, and backfill the orig Stock Item when it has
// no Variety identity yet (PRD #324 line 150 — issue #327). Without this,
// the new Batch is invisible in /stock?grouped=true (Y-model) and FEFO
// routing cannot compute its Variety key.
//
// Returns the new batch's stock item ID.
const DATE_BATCH_RE = /^(.+?)\s*\(\d{1,2}\.\w{3,4}\.?\)$/;
async function receiveIntoStock(stockItemId, qty, costPrice, sellPrice, supplier, today, varietyAttrs = null) {
  const stockItem = await stockRepo.getById(stockItemId);
  const existingQty = Number(stockItem['Current Quantity']) || 0;

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date(today);
  const batchLabel = `${d.getDate()}.${months[d.getMonth()]}.`;

  // Strip any existing date suffix to avoid "Rose (14.Apr.) (15.Apr.)" names
  const rawName = stockItem['Display Name'] || '';
  const baseName = (rawName.match(DATE_BATCH_RE)?.[1] || rawName).trim();

  // Effective Variety attrs: prefer values passed from the PO line, fall back
  // to whatever the orig Stock Item already carries. The new Batch needs them
  // so Y-model grouping + FEFO routing work; the orig Demand Entry needs them
  // backfilled so it stays visible as the absorption audit marker (ADR-0002).
  const effectiveAttrs = {
    Type:     varietyAttrs?.Type     ?? stockItem['Type']     ?? null,
    Colour:   varietyAttrs?.Colour   ?? stockItem['Colour']   ?? null,
    Size:     varietyAttrs?.Size     ?? stockItem['Size']     ?? null,
    Cultivar: varietyAttrs?.Cultivar ?? stockItem['Cultivar'] ?? null,
  };

  // When the original record has negative qty (pre-sold stems), absorb
  // the deficit into this new batch and zero out the original.
  let batchQty = qty;
  if (existingQty < 0) {
    batchQty = qty + existingQty; // e.g. 25 + (-5) = 20
    if (batchQty < 0) batchQty = 0; // edge: received less than deficit
    await stockRepo.adjustQuantity(stockItemId, -existingQty); // zero it out
  }

  const newBatch = await stockRepo.create({
    'Display Name':       `${baseName} (${batchLabel})`,
    'Purchase Name':      stockItem['Purchase Name'] || baseName,
    Category:             stockItem.Category || 'Other',
    'Current Quantity':   batchQty,
    'Current Cost Price': costPrice || stockItem['Current Cost Price'] || 0,
    'Current Sell Price': sellPrice || stockItem['Current Sell Price'] || 0,
    Supplier:             supplier || stockItem.Supplier || '',
    Unit:                 stockItem.Unit || 'Stems',
    'Reorder Threshold':  stockItem['Reorder Threshold'] || 0,
    Active:               true,
    'Last Restocked':     today,
    Type:                 effectiveAttrs.Type,
    Colour:               effectiveAttrs.Colour,
    Size:                 effectiveAttrs.Size,
    Cultivar:             effectiveAttrs.Cultivar,
  });

  // Update prices on the original record too so the "template" stays current.
  // Backfill Variety attrs onto orig when it currently has none and the PO
  // line supplied them — restores the orig DE as a visible audit marker.
  const templateUpdate = {
    'Current Cost Price': costPrice || stockItem['Current Cost Price'],
    'Current Sell Price': sellPrice || stockItem['Current Sell Price'],
    'Last Restocked':     today,
  };
  const origHasNoVarietyAttrs =
    stockItem['Type']     == null &&
    stockItem['Colour']   == null &&
    stockItem['Size']     == null &&
    stockItem['Cultivar'] == null;
  const lineCarriesAttrs =
    varietyAttrs &&
    (varietyAttrs.Type != null || varietyAttrs.Colour != null ||
     varietyAttrs.Size != null || varietyAttrs.Cultivar != null);
  if (origHasNoVarietyAttrs && lineCarriesAttrs) {
    templateUpdate.Type     = effectiveAttrs.Type;
    templateUpdate.Colour   = effectiveAttrs.Colour;
    templateUpdate.Size     = effectiveAttrs.Size;
    templateUpdate.Cultivar = effectiveAttrs.Cultivar;
    console.log(`[STOCK-ORDER] Backfilled Variety attrs on orig "${stockItem['Display Name']}" (${stockItemId})`);
  }
  await stockRepo.update(stockItemId, templateUpdate);

  return newBatch.id;
}

// POST /api/stock-orders/:id/evaluate — florist submits quality evaluation
// Body: { lines: [{ lineId, quantityAccepted, writeOffQty, writeOffReason, altQuantityAccepted, altWriteOffQty, altWriteOffReason }] }
// For each accepted line: adjust stock, create purchase record, log write-offs
router.post('/:id/evaluate', authorize('stock-orders', ['owner', 'florist']), async (req, res, next) => {
  try {
    // H1: Guard against double-evaluate — allow Evaluating (first attempt) or Eval Error (retry)
    const po = await stockOrderRepo.getById(req.params.id);
    if (po.Status !== PO_STATUS.EVALUATING && po.Status !== PO_STATUS.EVAL_ERROR) {
      return res.status(409).json({
        error: `PO is "${po.Status}", not "${PO_STATUS.EVALUATING}". Already processed?`,
      });
    }

    // poDisplayId is the human-readable PO number (PO-YYYYMMDD-N) — embedded
    // in the stock_purchases.notes idempotency marker per ADR-0003.
    const poDisplayId = po['Stock Order ID'] || po.id;
    const { lines } = req.body;

    // On first attempt use today's date. On Eval Error retry, reuse the date
    // from lines already processed in the first attempt so all stock entries
    // for this PO share the same receive date (the day flowers actually arrived).
    let evalDate = new Date().toISOString().split('T')[0];
    if (po.Status === PO_STATUS.EVAL_ERROR) {
      try {
        const prevDate = await stockPurchasesRepo.findDateByPoMarker(poDisplayId);
        if (prevDate) evalDate = prevDate;
      } catch { /* fall back to today */ }
    }
    const lineResults = []; // track per-line outcome for partial failure recovery

    for (const evalLine of (lines || [])) {
      try {
        const line = await stockOrderRepo.getLineById(evalLine.lineId);

        // Skip lines already processed on a previous attempt (idempotency guard)
        if (line['Eval Status'] === PO_LINE_STATUS.PROCESSED) {
          lineResults.push({ lineId: evalLine.lineId, status: 'skipped' });
          continue;
        }

        let stockItemId = line['Stock Item']?.[0];
        const costPrice = Number(line['Cost Price']) || 0;
        const sellPrice = Number(line['Sell Price']) || 0;
        const supplier = line.Supplier || '';

        const accepted = Number(evalLine.quantityAccepted) || 0;
        const writeOff = Number(evalLine.writeOffQty) || 0;
        const altAcceptedPre = Number(evalLine.altQuantityAccepted) || 0;
        const altWriteOffPre = Number(evalLine.altWriteOffQty) || 0;

        // If the line carries a stale Airtable rec ID that was never backfilled
        // to PG, treat it as unlinked so auto-resolve can pick it up by name.
        if (stockItemId) {
          const exists = await stockRepo.getById(stockItemId).catch(() => null);
          if (!exists) {
            console.log(`[STOCK-ORDER] Stock item ${stockItemId} not found in PG — falling back to name resolution for "${line['Flower Name']}"`);
            stockItemId = null;
          }
        }

        // Variety attrs (4-tuple, ADR-0006) extracted once at the line scope —
        // used by the auto-resolve block AND threaded into receiveIntoStock so
        // the new dated Batch carries Variety identity (#327 / PRD #324 line 150).
        const flowerName   = String(line['Flower Name'] || '').trim();
        const lineType     = line['Type']    ? String(line['Type']).trim()    : null;
        const lineColour   = line['Colour']  ? String(line['Colour']).trim()  : null;
        const lineSizeCm   = line['Size'] != null && Number.isFinite(Number(line['Size'])) ? Number(line['Size']) : null;
        const lineCultivar = line['Cultivar'] ? String(line['Cultivar']).trim() : null;
        const lineVarietyAttrs = { Type: lineType, Colour: lineColour, Size: lineSizeCm, Cultivar: lineCultivar };

        // Auto-resolve: if PO line has no Stock Item, find or create one.
        // Y-model lines carry Variety attrs — use the 4-tuple for exact matching
        // before falling back to name.
        if (!stockItemId && (accepted > 0 || writeOff > 0)) {
          if (!flowerName && !lineType) {
            throw new Error(
              `Line "${evalLine.lineId}" has no Stock Item, no Flower Name, and no Variety attrs — cannot resolve.`,
            );
          }

          const markup = Number(getConfig('targetMarkup')) || 1;
          const autoSell = sellPrice || Math.round(costPrice * markup * 100) / 100;

          if (lineType) {
            // Y-model path: resolve by exact Variety 4-tuple.
            const matches = await stockRepo.list({
              pg: { typeName: lineType, colour: lineColour, sizeCm: lineSizeCm, cultivar: lineCultivar, includeEmpty: true },
              maxRecords: 1,
            });
            if (matches.length > 0) {
              stockItemId = matches[0].id;
              await stockOrderRepo.updateLine(evalLine.lineId, { 'Stock Item': [stockItemId] });
              console.log(`[STOCK-ORDER] Auto-linked Y-model variety "${lineType}" → stock item ${stockItemId}`);
            } else {
              const parts = [lineType];
              if (lineColour)  parts.push(lineColour);
              if (lineSizeCm != null) parts.push(`${lineSizeCm}cm`);
              if (lineCultivar) parts.push(lineCultivar);
              const displayName = flowerName || parts.join(' ');
              const created = await stockRepo.create({
                'Display Name':       displayName,
                'Purchase Name':      displayName,
                Type:                 lineType,
                Colour:               lineColour,
                Size:                 lineSizeCm,
                Cultivar:             lineCultivar,
                Category:             'Other',
                'Current Quantity':   0,
                'Current Cost Price': costPrice,
                'Current Sell Price': autoSell,
                Supplier:             supplier,
                Unit:                 'Stems',
                Active:               true,
              });
              stockItemId = created.id;
              await stockOrderRepo.updateLine(evalLine.lineId, { 'Stock Item': [stockItemId] });
              console.log(`[STOCK-ORDER] Created Y-model stock item for variety "${lineType}" (${stockItemId})`);
            }
          } else {
            // Legacy path: resolve by Flower Name.
            const matches = await stockRepo.list({
              pg: { displayName: flowerName, includeEmpty: true },
              maxRecords: 1,
            });
            if (matches.length > 0) {
              stockItemId = matches[0].id;
              await stockOrderRepo.updateLine(evalLine.lineId, { 'Stock Item': [stockItemId] });
              console.log(`[STOCK-ORDER] Auto-linked "${flowerName}" → stock item ${stockItemId}`);
            } else {
              const created = await stockRepo.create({
                'Display Name':       flowerName,
                'Purchase Name':      flowerName,
                Category:             'Other',
                'Current Quantity':   0,
                'Current Cost Price': costPrice,
                'Current Sell Price': autoSell,
                Supplier:             supplier,
                Unit:                 'Stems',
                Active:               true,
              });
              stockItemId = created.id;
              await stockOrderRepo.updateLine(evalLine.lineId, { 'Stock Item': [stockItemId] });
              console.log(`[STOCK-ORDER] Created & linked stock item for "${flowerName}" (${stockItemId})`);
            }
          }
        }

        // Substitute quantities without a stock item require at least an Alt
        // Flower Name so we know what substitute stock card to create.
        if (!stockItemId && (altAcceptedPre > 0 || altWriteOffPre > 0) && !line['Alt Flower Name']) {
          throw new Error(
            `Line "${line['Flower Name'] || evalLine.lineId}" has no linked Stock Item and no Alt Flower Name — ` +
            `link a Stock Item or add substitute details, then retry.`,
          );
        }

        // Primary receive — idempotency marker uses the human-readable PO
        // number per ADR-0003. line._pgId is the canonical UUID; fall back to
        // evalLine.lineId (recXXX or uuid) when _pgId isn't surfaced.
        if (stockItemId && accepted > 0) {
          const primaryMarker = `PO #${poDisplayId} L#${line._pgId || evalLine.lineId} primary`;
          const already = await purchaseAlreadyRecorded(primaryMarker);
          if (!already) {
            const finalItemId = await receiveIntoStock(stockItemId, accepted, costPrice, sellPrice, supplier, evalDate, lineVarietyAttrs);
            const batchItem = await stockRepo.getById(finalItemId).catch(() => null);
            await stockPurchasesRepo.create({
              purchaseDate:      evalDate,
              supplier,
              stockId:           batchItem?._pgId || null,
              stockAirtableId:   typeof finalItemId === 'string' && finalItemId.startsWith('rec') ? finalItemId : null,
              quantityPurchased: accepted,
              pricePerUnit:      costPrice,
              notes:             primaryMarker,
            });
          } else {
            console.log(`[STOCK-ORDER] Skipping primary receive for line ${evalLine.lineId} — already recorded`);
          }
        }

        // Substitute supplier: Substitute becomes its own stock card (Phase A
        // substitution policy). Find-or-create a Stock record by exact Alt
        // Flower Name, receive the accepted qty there at the REAL per-stem
        // cost the driver paid (not the original planned cost). Sell price
        // derives from targetMarkup. Skip entirely if florist accepted 0 of
        // the Substitute (edge case 6).
        const altAccepted = Number(evalLine.altQuantityAccepted) || 0;
        const altWriteOff = Number(evalLine.altWriteOffQty) || 0;
        const altSupplier = line['Alt Supplier'] || '';
        const altFlowerName = line['Alt Flower Name'] || '';
        const altQtyFound = Number(line['Alt Quantity Found']) || 0;
        const altCostTotal = Number(line['Alt Cost']) || 0;
        // Per-stem cost = total paid / total delivered (not / accepted —
        // the sunk cost covers all stems whether we keep them or write off).
        const altCostPerStem = altQtyFound > 0 ? (altCostTotal / altQtyFound) : 0;

        let substituteStockId = null;
        if (altAccepted > 0 && altFlowerName) {
          const altMarker = `PO #${poDisplayId} L#${line._pgId || evalLine.lineId} alt`;
          const alreadyAlt = await purchaseAlreadyRecorded(altMarker);
          if (!alreadyAlt) {
            // Fetch the originally-ordered stock item once so the helper can
            // copy Category/Unit/Reorder Threshold as defaults. If the PO
            // line has no Stock Item link (e.g. new flower not yet in stock),
            // pass null — the helper uses sensible defaults.
            const originalStockItem = stockItemId
              ? await stockRepo.getById(stockItemId).catch(() => null)
              : null;
            substituteStockId = await findOrCreateSubstituteStock(
              altFlowerName, altSupplier, altCostPerStem, originalStockItem, stockItemId, evalDate,
            );
            const markup = Number(getConfig('targetMarkup')) || 1;
            const altSellPerStem = Math.round(altCostPerStem * markup * 100) / 100;
            const altFinalId = await receiveIntoStock(
              substituteStockId, altAccepted, altCostPerStem, altSellPerStem, altSupplier, evalDate,
            );
            substituteStockId = altFinalId; // may be a new batch id

            const altBatchItem = await stockRepo.getById(altFinalId).catch(() => null);
            await stockPurchasesRepo.create({
              purchaseDate:      evalDate,
              supplier:          altSupplier,
              stockId:           altBatchItem?._pgId || null,
              stockAirtableId:   typeof altFinalId === 'string' && altFinalId.startsWith('rec') ? altFinalId : null,
              quantityPurchased: altAccepted,
              pricePerUnit:      altCostPerStem,
              notes:             `${altMarker} - substitute for "${line['Flower Name'] || ''}"`,
            });
          } else {
            console.log(`[STOCK-ORDER] Skipping alt receive for line ${evalLine.lineId} — already recorded`);
          }
        }

        // Log write-offs per source (primary vs Substitute) via Postgres repo.
        // Primary write-offs land on the original stock item. Substitute
        // write-offs land on the substitute card (or on the original if we
        // never created a substitute because accepted = 0).
        if (stockItemId && writeOff > 0) {
          const reason = evalLine.writeOffReason || LOSS_REASON.DAMAGED;
          stockRepo.getById(stockItemId)
            .then(item => stockLossRepo.create({
              date:     evalDate,
              stockId:  item._pgId || null,
              quantity: writeOff,
              reason:   [LOSS_REASON.WILTED, LOSS_REASON.DAMAGED, LOSS_REASON.ARRIVED_BROKEN].includes(reason) ? reason : LOSS_REASON.OTHER,
              notes:    'PO evaluation write-off (primary)',
            }))
            .catch(err => console.error('[STOCK-ORDER] Failed to log primary write-off:', err.message));
        }
        if (altWriteOff > 0) {
          const altReason = evalLine.altWriteOffReason || LOSS_REASON.DAMAGED;
          // Prefer substitute card if one was created this session; otherwise
          // fall back to the original (rare — means altAccepted was 0 but
          // altWriteOff > 0, which only happens if the florist rejected everything).
          const writeOffTarget = substituteStockId || stockItemId;
          if (writeOffTarget) {
            stockRepo.getById(writeOffTarget)
              .then(item => stockLossRepo.create({
                date:     evalDate,
                stockId:  item._pgId || null,
                quantity: altWriteOff,
                reason:   [LOSS_REASON.WILTED, LOSS_REASON.DAMAGED, LOSS_REASON.ARRIVED_BROKEN].includes(altReason) ? altReason : LOSS_REASON.OTHER,
                notes:    'PO evaluation write-off (substitute)',
              }))
              .catch(err => console.error('[STOCK-ORDER] Failed to log alt write-off:', err.message));
          }
        }

        // Mark line as fully processed + save acceptance data (single write)
        await stockOrderRepo.updateLine(evalLine.lineId, {
          'Quantity Accepted': accepted,
          'Write Off Qty':     writeOff,
          'Eval Status':       PO_LINE_STATUS.PROCESSED,
        });

        lineResults.push({
          lineId:             evalLine.lineId,
          status:             'ok',
          substituteStockId:  substituteStockId || null,
          originalStockId:    stockItemId || null,
          originalFlowerName: line['Flower Name'] || '',
          receivedQty:        altAccepted || 0,
        });
      } catch (lineErr) {
        console.error(`[STOCK-ORDER] Evaluate line ${evalLine.lineId} failed:`, lineErr.message);
        lineResults.push({ lineId: evalLine.lineId, status: 'error', error: lineErr.message });
      }
    }

    const failed = lineResults.filter(r => r.status === 'error');
    if (failed.length > 0) {
      // Partial failure: mark PO with error state so owner can see and retry
      await stockOrderRepo.update(req.params.id, { Status: PO_STATUS.EVAL_ERROR });
      return res.status(207).json({
        success: false,
        message: `${failed.length} of ${lineResults.length} lines failed. PO marked as "Eval Error" — retry will skip already-processed lines.`,
        lineResults,
      });
    }

    // All lines processed — mark PO as complete
    await stockOrderRepo.update(req.params.id, { Status: PO_STATUS.COMPLETE });

    // Phase B: detect orders needing reconciliation after Substitution.
    // Delegated to orderService.findOrdersNeedingSubstitution (extracted in T5;
    // queries Postgres via orderRepo + customerRepo). Non-blocking — a failure
    // here must not affect the evaluate response.
    const substitutionsMade = lineResults
      .filter(r => r.status === 'ok' && r.substituteStockId && r.originalStockId)
      .map(r => ({
        originalStockId:    r.originalStockId,
        originalFlowerName: r.originalFlowerName,
        substituteStockId:  r.substituteStockId,
        receivedQty:        r.receivedQty,
      }));

    if (substitutionsMade.length > 0) {
      try {
        const enriched = await orderService.findOrdersNeedingSubstitution(substitutionsMade);
        for (const sub of enriched) {
          if (sub.affectedOrders.length > 0) {
            broadcast({
              type:               'substitute_reconciliation_needed',
              originalStockId:    sub.originalStockId,
              originalFlowerName: sub.originalFlowerName,
              substituteStockId:  sub.substituteStockId,
              affectedOrders:     sub.affectedOrders,
              substituteQty:      sub.receivedQty,
            });
          }
        }
      } catch (reconErr) {
        console.error('[STOCK-ORDER] Reconciliation detection failed (non-blocking):', reconErr.message);
      }
    }

    res.json({ success: true, lineResults });
  } catch (err) {
    next(err);
  }
});

export default router;

// Exported for integration tests only. The receiveIntoStock helper is the
// seam where #327 (PRD #324 line 150) Variety attrs propagation is enforced.
// Direct callers in the route exercise it via POST /stock-orders/:id/evaluate;
// tests assert its behaviour by calling this seam directly against pglite.
export const __testing = { receiveIntoStock };
