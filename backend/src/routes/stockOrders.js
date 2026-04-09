// Stock Orders (Purchase Orders) — procurement lifecycle management.
// Like a kanban board for the purchasing process:
// Draft → Sent → Shopping → Evaluating → Complete
//
// Each PO has lines grouped by supplier. The driver shops, the florist evaluates quality,
// and stock levels are adjusted when flowers pass inspection.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { broadcast } from '../services/notifications.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { PO_STATUS, VALID_PO_STATUSES, PO_LINE_STATUS, LOSS_REASON } from '../constants/statuses.js';
import { getConfig } from './settings.js';

const VALID_STATUSES = VALID_PO_STATUSES;

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
    const stock = await db.list(TABLES.STOCK, {
      filterByFormula: '{Active}',
      fields: ['Display Name', 'Supplier', 'Current Cost Price'],
    });
    const flowers = stock.map(s => ({
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
    const filters = [];
    if (status) {
      if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status value' });
      filters.push(`{Status} = '${sanitizeFormulaValue(status)}'`);
    }
    // Driver scope: only POs where Assigned Driver matches this driver's badge.
    // This is what was missing — without it every driver saw every PO.
    if (req.role === 'driver' && req.driverName) {
      filters.push(`{Assigned Driver} = '${sanitizeFormulaValue(req.driverName)}'`);
    }
    const formula = filters.length > 0 ? `AND(${filters.join(', ')})` : '';

    const orders = await db.list(TABLES.STOCK_ORDERS, {
      filterByFormula: formula || undefined,
      sort: [{ field: 'Created Date', direction: 'desc' }],
    });

    // Optionally include lines in a single batch fetch instead of N+1 calls
    if (include === 'lines' && orders.length > 0) {
      const allLineIds = orders.flatMap(o => o['Order Lines'] || []);
      const allLines = [];
      if (allLineIds.length > 0) {
        // Airtable formula limit: batch into chunks of 100 IDs
        const CHUNK = 100;
        for (let i = 0; i < allLineIds.length; i += CHUNK) {
          const chunk = allLineIds.slice(i, i + CHUNK);
          const chunkLines = await db.list(TABLES.STOCK_ORDER_LINES, {
            filterByFormula: `OR(${chunk.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
          });
          allLines.push(...chunkLines);
        }
      }
      // Index lines by ID for fast lookup
      const lineMap = new Map(allLines.map(l => [l.id, l]));
      const result = orders.map(o => ({
        ...o,
        lines: (o['Order Lines'] || []).map(id => lineMap.get(id)).filter(Boolean),
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
    const order = await db.getById(TABLES.STOCK_ORDERS, req.params.id);
    // Same scope rule as the list endpoint: drivers can only fetch their own PO.
    if (req.role === 'driver' && req.driverName && order['Assigned Driver'] !== req.driverName) {
      return res.status(404).json({ error: 'PO not found.' });
    }
    const lineIds = order['Order Lines'] || [];
    let lines = [];
    if (lineIds.length > 0) {
      lines = await db.list(TABLES.STOCK_ORDER_LINES, {
        filterByFormula: `OR(${lineIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
      });
    }
    res.json({ ...order, lines });
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

    // Generate PO number: PO-YYYYMMDD-N (date prefix + sequence)
    const existingPOs = await db.list(TABLES.STOCK_ORDERS, {
      filterByFormula: `DATESTR({Created Date}) = '${today}'`,
      fields: ['Created Date'],
    });
    const seq = existingPOs.length + 1;
    const poNumber = `PO-${today.replace(/-/g, '')}-${seq}`;

    // Create the PO header
    const orderFields = {
      Status: PO_STATUS.DRAFT,
      'Created Date': today,
      'Stock Order ID': poNumber,
      Notes: notes || '',
    };
    if (driver) orderFields['Assigned Driver'] = driver;
    if (plannedDate) orderFields['Planned Date'] = plannedDate;

    const order = await db.create(TABLES.STOCK_ORDERS, orderFields);

    // Create lines — use lot size from the PO form (owner can set/override),
    // falling back to the stock item's configured lot size, then 1.
    const createdLines = [];
    for (const line of (lines || [])) {
      let lotSize = Number(line.lotSize) || 0;
      if (!lotSize && line.stockItemId) {
        try {
          const stockItem = await db.getById(TABLES.STOCK, line.stockItemId);
          lotSize = Number(stockItem['Lot Size']) || 0;
        } catch { /* stock item may have been deleted */ }
      }
      const lineFields = {
        'Stock Orders': [order.id],
        ...(line.stockItemId ? { 'Stock Item': [line.stockItemId] } : {}),
        'Flower Name': line.flowerName || '',
        'Quantity Needed': Number(line.quantity) || 0,
        ...(lotSize > 0 ? { 'Lot Size': lotSize } : {}),
        'Driver Status': PO_LINE_STATUS.PENDING,
        Supplier: line.supplier || '',
        'Cost Price': Number(line.costPrice) || 0,
        'Sell Price': Number(line.sellPrice) || 0,
      };
      if (line.farmer) lineFields.Farmer = line.farmer;
      if (line.notes) lineFields.Notes = line.notes;

      const lineRec = await db.create(TABLES.STOCK_ORDER_LINES, lineFields);
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
      return res.json(await db.getById(TABLES.STOCK_ORDERS, req.params.id));
    }

    if (fields.Status) {
      const current = await db.getById(TABLES.STOCK_ORDERS, req.params.id);
      const valid = ALLOWED_TRANSITIONS[current.Status];
      if (!valid || !valid.includes(fields.Status)) {
        return res.status(400).json({
          error: `Cannot transition from "${current.Status}" to "${fields.Status}".`,
        });
      }
    }

    const updated = await db.update(TABLES.STOCK_ORDERS, req.params.id, fields);

    // SSE: driver app needs to refetch on ANY header change while the PO is live,
    // and owner needs a re-notify if the driver reassignment moved the PO to someone else.
    if ('Assigned Driver' in fields) {
      broadcast({
        type: 'stock_pickup_assigned',
        stockOrderId: req.params.id,
        driverName: fields['Assigned Driver'] || '',
      });
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
    // Edit-window guard
    const po = await db.getById(TABLES.STOCK_ORDERS, req.params.id);
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
    ];
    const fields = {};
    for (const key of allowed) {
      if (key in req.body) fields[key] = req.body[key];
    }
    if (Object.keys(fields).length === 0) {
      return res.json(await db.getById(TABLES.STOCK_ORDER_LINES, req.params.lineId));
    }
    const updated = await db.update(TABLES.STOCK_ORDER_LINES, req.params.lineId, fields);

    if ('Driver Status' in fields) {
      const po = await db.getById(TABLES.STOCK_ORDERS, req.params.id);
      if (po.Status === PO_STATUS.SENT) {
        await db.update(TABLES.STOCK_ORDERS, req.params.id, { Status: PO_STATUS.SHOPPING });
      }
    }

    // SSE broadcast: notify owner and driver of line changes in real time
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
    const po = await db.getById(TABLES.STOCK_ORDERS, req.params.id);
    if (!EDITABLE_PO_STATUSES.includes(po.Status)) {
      return res.status(400).json({ error: `Cannot add lines to a "${po.Status}" PO.` });
    }
    const { stockItemId, flowerName, quantity, supplier, costPrice, sellPrice, lotSize } = req.body;
    const line = await db.create(TABLES.STOCK_ORDER_LINES, {
      'Stock Orders': [req.params.id],
      'Stock Item': stockItemId ? [stockItemId] : undefined,
      'Flower Name': flowerName || '',
      'Quantity Needed': Number(quantity) || 1,
      Supplier: supplier || '',
      'Cost Price': Number(costPrice) || 0,
      'Sell Price': Number(sellPrice) || 0,
      'Lot Size': Number(lotSize) || 0,
      'Driver Status': PO_LINE_STATUS.PENDING,
    });
    broadcast({ type: 'stock_order_line_updated', stockOrderId: req.params.id, lineId: line.id });
    res.json(line);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/stock-orders/:id/lines/:lineId — remove a line from an editable PO
router.delete('/:id/lines/:lineId', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const po = await db.getById(TABLES.STOCK_ORDERS, req.params.id);
    if (!EDITABLE_PO_STATUSES.includes(po.Status)) {
      return res.status(400).json({ error: `Cannot remove lines from a "${po.Status}" PO.` });
    }
    await db.deleteRecord(TABLES.STOCK_ORDER_LINES, req.params.lineId);
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
    const updated = await db.update(TABLES.STOCK_ORDERS, req.params.id, {
      Status: PO_STATUS.SENT,
      'Assigned Driver': driverName || 'Nikita',
    });

    // SSE notification to driver
    broadcast({ type: 'stock_pickup_assigned', stockOrderId: req.params.id, driverName: driverName || 'Nikita' });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/stock-orders/:id/driver-complete — driver marks shopping done
// Goes to Reviewing first (owner can adjust), then owner or auto → Evaluating
router.post('/:id/driver-complete', authorize('stock-orders'), async (req, res, next) => {
  try {
    const po = await db.getById(TABLES.STOCK_ORDERS, req.params.id);
    if (![PO_STATUS.SENT, PO_STATUS.SHOPPING].includes(po.Status)) {
      return res.status(400).json({ error: `PO is "${po.Status}", cannot complete shopping.` });
    }
    const updated = await db.update(TABLES.STOCK_ORDERS, req.params.id, {
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
    const po = await db.getById(TABLES.STOCK_ORDERS, req.params.id);
    if (po.Status !== PO_STATUS.REVIEWING) {
      return res.status(400).json({ error: `PO is "${po.Status}", not "${PO_STATUS.REVIEWING}".` });
    }
    const updated = await db.update(TABLES.STOCK_ORDERS, req.params.id, { Status: PO_STATUS.EVALUATING });
    broadcast({ type: 'stock_evaluation_ready', stockOrderId: req.params.id });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Idempotency helper — returns true if a STOCK_PURCHASES row already exists
// for this PO + line + variant (primary/alt). Used on retry after a partial
// failure, so a second receiveIntoStock does NOT double-credit the batch.
//
// We identify each receive step by a stable marker embedded in the Notes field.
// That avoids adding a new Airtable schema column and works with the existing
// purchase history.
async function purchaseAlreadyRecorded(poId, lineId, variant) {
  if (!TABLES.STOCK_PURCHASES) return false;
  const marker = `PO #${poId} L#${lineId} ${variant}`;
  // Airtable FIND() returns 0 when not found, which is falsy.
  const formula = `FIND("${marker}", {Notes} & "") > 0`;
  try {
    const rows = await db.list(TABLES.STOCK_PURCHASES, { filterByFormula: formula, maxRecords: 1 });
    return rows.length > 0;
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
async function findOrCreateSubstituteStock(altFlowerName, altSupplier, costPerStem, originalStockItem, today) {
  const trimmedName = (altFlowerName || '').trim();
  if (!trimmedName) {
    throw new Error('Cannot receive substitute with empty flower name');
  }

  // Try to find an existing Stock record with the exact same display name.
  // Sanitize quotes to avoid breaking the Airtable filter formula.
  const safe = sanitizeFormulaValue(trimmedName);
  const existing = await db.list(TABLES.STOCK, {
    filterByFormula: `{Display Name} = '${safe}'`,
    maxRecords: 1,
  });
  if (existing.length > 0) {
    return existing[0].id;
  }

  // Not found → create a brand-new stock card for the substitute.
  // Copy category/unit/threshold from the original item so the substitute
  // inherits sensible defaults. Cost = actual per-stem paid, sell = cost * markup.
  const markup = Number(getConfig('targetMarkup')) || 1;
  const sellPerStem = Math.round(costPerStem * markup * 100) / 100;

  const created = await db.create(TABLES.STOCK, {
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
  });
  console.log(`[STOCK-ORDER] Created substitute stock card "${trimmedName}" (${created.id}) — cost ${costPerStem} zł, sell ${sellPerStem} zł`);
  return created.id;
}

// Receive accepted flowers into stock using batch logic:
// - If existing qty > 0 → create a new batch record (separate FIFO lot)
// - If existing qty <= 0 → reuse the empty record (replenish it)
// Returns the final stock item ID (original or new batch).
async function receiveIntoStock(stockItemId, qty, costPrice, sellPrice, supplier, today) {
  const stockItem = await db.getById(TABLES.STOCK, stockItemId);
  const existingQty = stockItem['Current Quantity'] || 0;

  if (existingQty > 0) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const d = new Date(today);
    const batchLabel = `${d.getDate()}.${months[d.getMonth()]}.`;
    const newBatch = await db.create(TABLES.STOCK, {
      'Display Name':       `${stockItem['Display Name']} (${batchLabel})`,
      'Purchase Name':      stockItem['Purchase Name'] || stockItem['Display Name'],
      Category:             stockItem.Category || 'Other',
      'Current Quantity':   qty,
      'Current Cost Price': costPrice || stockItem['Current Cost Price'] || 0,
      'Current Sell Price': sellPrice || stockItem['Current Sell Price'] || 0,
      Supplier:             supplier || stockItem.Supplier || '',
      Unit:                 stockItem.Unit || 'Stems',
      'Reorder Threshold':  stockItem['Reorder Threshold'] || 0,
      Active:               true,
      'Last Restocked':     today,
    });
    return newBatch.id;
  } else {
    await db.atomicStockAdjust(stockItemId, qty);
    await db.update(TABLES.STOCK, stockItemId, {
      'Current Cost Price': costPrice || stockItem['Current Cost Price'],
      'Current Sell Price': sellPrice || stockItem['Current Sell Price'],
      'Last Restocked': today,
    });
    return stockItemId;
  }
}

// POST /api/stock-orders/:id/evaluate — florist submits quality evaluation
// Body: { lines: [{ lineId, quantityAccepted, writeOffQty, writeOffReason, altQuantityAccepted, altWriteOffQty, altWriteOffReason }] }
// For each accepted line: adjust stock, create purchase record, log write-offs
router.post('/:id/evaluate', authorize('stock-orders', ['owner', 'florist']), async (req, res, next) => {
  try {
    // H1: Guard against double-evaluate — allow Evaluating (first attempt) or Eval Error (retry)
    const po = await db.getById(TABLES.STOCK_ORDERS, req.params.id);
    if (po.Status !== PO_STATUS.EVALUATING && po.Status !== PO_STATUS.EVAL_ERROR) {
      return res.status(409).json({ error: `PO is "${po.Status}", not "${PO_STATUS.EVALUATING}". Already processed?` });
    }

    const { lines } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const lineResults = []; // track per-line outcome for partial failure recovery

    for (const evalLine of (lines || [])) {
      try {
        const line = await db.getById(TABLES.STOCK_ORDER_LINES, evalLine.lineId);

        // Skip lines already processed on a previous attempt (idempotency guard)
        if (line['Eval Status'] === PO_LINE_STATUS.PROCESSED) {
          lineResults.push({ lineId: evalLine.lineId, status: 'skipped' });
          continue;
        }

        const stockItemId = line['Stock Item']?.[0];
        const costPrice = Number(line['Cost Price']) || 0;
        const sellPrice = Number(line['Sell Price']) || 0;
        const supplier = line.Supplier || '';

        const accepted = Number(evalLine.quantityAccepted) || 0;
        const writeOff = Number(evalLine.writeOffQty) || 0;
        const altAcceptedPre = Number(evalLine.altQuantityAccepted) || 0;
        const altWriteOffPre = Number(evalLine.altWriteOffQty) || 0;

        // Hard fail: a PO line with PRIMARY received qty but no Stock Item link
        // cannot be received into inventory. Substitute (alt) quantities are OK
        // without a Stock Item — findOrCreateSubstituteStock will create one
        // from the Alt Flower Name alone, using sensible defaults.
        if (!stockItemId && (accepted > 0 || writeOff > 0)) {
          throw new Error(
            `Line "${line['Flower Name'] || evalLine.lineId}" has no linked Stock Item — ` +
            `link it on the PO and retry. Stock cannot be received without a Stock Item.`
          );
        }
        // Alt quantities without a stock item require at least an Alt Flower Name
        // so we know what substitute stock card to create.
        if (!stockItemId && (altAcceptedPre > 0 || altWriteOffPre > 0) && !line['Alt Flower Name']) {
          throw new Error(
            `Line "${line['Flower Name'] || evalLine.lineId}" has no linked Stock Item and no Alt Flower Name — ` +
            `link a Stock Item or add substitute details, then retry.`
          );
        }

        // Primary supplier: receive into stock with batch logic.
        // Idempotency: on retry after a partial failure, skip if the
        // STOCK_PURCHASES row for this (PO, line, primary) already exists.
        // Otherwise receiveIntoStock would credit the batch a second time.
        if (stockItemId && accepted > 0) {
          const already = await purchaseAlreadyRecorded(req.params.id, evalLine.lineId, 'primary');
          if (!already) {
            const finalItemId = await receiveIntoStock(stockItemId, accepted, costPrice, sellPrice, supplier, today);

            // Audit trail — marker must match purchaseAlreadyRecorded() exactly.
            await db.create(TABLES.STOCK_PURCHASES, {
              'Purchase Date': today,
              Supplier: supplier,
              Flower: [finalItemId],
              'Quantity Purchased': accepted,
              'Price Per Unit': costPrice,
              Notes: `PO #${req.params.id} L#${evalLine.lineId} primary`,
            });
          } else {
            console.log(`[STOCK-ORDER] Skipping primary receive for line ${evalLine.lineId} — already recorded`);
          }
        }

        // Alt supplier: substitute becomes its own stock card (Phase A substitution policy).
        // Find-or-create a Stock record by exact Alt Flower Name, receive the
        // accepted qty there at the REAL per-stem cost the driver paid (not
        // the original planned cost). Sell price derives from targetMarkup.
        // Skip entirely if florist accepted 0 of the substitute (edge case 6).
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
          const alreadyAlt = await purchaseAlreadyRecorded(req.params.id, evalLine.lineId, 'alt');
          if (!alreadyAlt) {
            // Fetch the originally-ordered stock item once so the helper can
            // copy Category/Unit/Reorder Threshold as defaults.
            // If the PO line has no Stock Item link (e.g. new flower not yet
            // in stock), pass null — the helper uses sensible defaults.
            const originalStockItem = stockItemId
              ? await db.getById(TABLES.STOCK, stockItemId)
              : null;
            substituteStockId = await findOrCreateSubstituteStock(
              altFlowerName, altSupplier, altCostPerStem, originalStockItem, today
            );
            const markup = Number(getConfig('targetMarkup')) || 1;
            const altSellPerStem = Math.round(altCostPerStem * markup * 100) / 100;
            const altFinalId = await receiveIntoStock(
              substituteStockId, altAccepted, altCostPerStem, altSellPerStem, altSupplier, today
            );
            substituteStockId = altFinalId; // may be a new batch id

            await db.create(TABLES.STOCK_PURCHASES, {
              'Purchase Date': today,
              Supplier: altSupplier,
              Flower: [altFinalId],
              'Quantity Purchased': altAccepted,
              'Price Per Unit': altCostPerStem,
              Notes: `PO #${req.params.id} L#${evalLine.lineId} substitute for "${line['Flower Name'] || ''}"`,
            });
          } else {
            console.log(`[STOCK-ORDER] Skipping alt receive for line ${evalLine.lineId} — already recorded`);
          }
        }

        // Log write-offs per source (primary vs substitute).
        // Primary write-offs land on the original stock item. Substitute
        // write-offs land on the substitute card (or on the original if
        // we never created a substitute because accepted = 0).
        if (stockItemId && writeOff > 0 && TABLES.STOCK_LOSS_LOG) {
          const reason = evalLine.writeOffReason || LOSS_REASON.DAMAGED;
          db.create(TABLES.STOCK_LOSS_LOG, {
            Date: today,
            'Stock Item': [stockItemId],
            Quantity: writeOff,
            Reason: reason === LOSS_REASON.WILTED || reason === LOSS_REASON.DAMAGED || reason === LOSS_REASON.ARRIVED_BROKEN ? reason : LOSS_REASON.OTHER,
            Notes: `PO evaluation write-off (primary)`,
          }).catch(err => console.error('[STOCK-ORDER] Failed to log primary write-off:', err.message));
        }
        if (altWriteOff > 0 && TABLES.STOCK_LOSS_LOG) {
          const altReason = evalLine.altWriteOffReason || LOSS_REASON.DAMAGED;
          // Prefer substitute card if one was created this session; otherwise
          // fall back to the original (rare — means altAccepted was 0 but
          // altWriteOff > 0, which only happens if the florist rejected everything).
          const writeOffTarget = substituteStockId || stockItemId;
          if (writeOffTarget) {
            db.create(TABLES.STOCK_LOSS_LOG, {
              Date: today,
              'Stock Item': [writeOffTarget],
              Quantity: altWriteOff,
              Reason: altReason === LOSS_REASON.WILTED || altReason === LOSS_REASON.DAMAGED || altReason === LOSS_REASON.ARRIVED_BROKEN ? altReason : LOSS_REASON.OTHER,
              Notes: `PO evaluation write-off (substitute)`,
            }).catch(err => console.error('[STOCK-ORDER] Failed to log alt write-off:', err.message));
          }
        }

        // Mark line as fully processed + save acceptance data (single write)
        await db.update(TABLES.STOCK_ORDER_LINES, evalLine.lineId, {
          'Quantity Accepted': accepted,
          'Write Off Qty': writeOff,
          'Eval Status': PO_LINE_STATUS.PROCESSED,
        });

        lineResults.push({ lineId: evalLine.lineId, status: 'ok' });
      } catch (lineErr) {
        console.error(`[STOCK-ORDER] Evaluate line ${evalLine.lineId} failed:`, lineErr.message);
        lineResults.push({ lineId: evalLine.lineId, status: 'error', error: lineErr.message });
      }
    }

    const failed = lineResults.filter(r => r.status === 'error');
    if (failed.length > 0) {
      // Partial failure: mark PO with error state so owner can see and retry
      await db.update(TABLES.STOCK_ORDERS, req.params.id, { Status: PO_STATUS.EVAL_ERROR });
      return res.status(207).json({
        success: false,
        message: `${failed.length} of ${lineResults.length} lines failed. PO marked as "Eval Error" — retry will skip already-processed lines.`,
        lineResults,
      });
    }

    // All lines processed — mark PO as complete
    await db.update(TABLES.STOCK_ORDERS, req.params.id, { Status: PO_STATUS.COMPLETE });

    res.json({ success: true, lineResults });
  } catch (err) {
    next(err);
  }
});

export default router;
