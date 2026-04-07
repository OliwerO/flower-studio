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

// GET /api/stock-orders?status=Draft&include=lines
router.get('/', authorize('stock-orders'), async (req, res, next) => {
  try {
    const { status, include } = req.query;
    const filters = [];
    if (status) {
      if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status value' });
      filters.push(`{Status} = '${sanitizeFormulaValue(status)}'`);
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
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/stock-orders/:id/lines/:lineId — update a single line
// Used by driver (status, qty found, alt supplier) and owner (corrections)
router.patch('/:id/lines/:lineId', authorize('stock-orders'), async (req, res, next) => {
  try {
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

// POST /api/stock-orders/:id/lines — add a line to a Draft PO
router.post('/:id/lines', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const po = await db.getById(TABLES.STOCK_ORDERS, req.params.id);
    if (po.Status !== PO_STATUS.DRAFT) {
      return res.status(400).json({ error: 'Can only add lines to Draft POs.' });
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
    res.json(line);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/stock-orders/:id/lines/:lineId — remove a line from a Draft PO
router.delete('/:id/lines/:lineId', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const po = await db.getById(TABLES.STOCK_ORDERS, req.params.id);
    if (po.Status !== PO_STATUS.DRAFT) {
      return res.status(400).json({ error: 'Can only remove lines from Draft POs.' });
    }
    await db.deleteRecord(TABLES.STOCK_ORDER_LINES, req.params.lineId);
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

        // Hard fail: a PO line with received qty but no Stock Item link cannot
        // be received into inventory. Previously this was silently skipped,
        // marking the line PROCESSED while the flowers vanished from tracking.
        // The per-line catch below will record this and flip the PO to EVAL_ERROR
        // so the owner can fix the line (link a Stock Item, then retry evaluate).
        if (!stockItemId && (accepted > 0 || altAcceptedPre > 0 || writeOff > 0 || altWriteOffPre > 0)) {
          throw new Error(
            `Line "${line['Flower Name'] || evalLine.lineId}" has no linked Stock Item — ` +
            `link it on the PO and retry. Stock cannot be received without a Stock Item.`
          );
        }

        // Primary supplier: receive into stock with batch logic
        if (stockItemId && accepted > 0) {
          const finalItemId = await receiveIntoStock(stockItemId, accepted, costPrice, sellPrice, supplier, today);

          // Audit trail
          await db.create(TABLES.STOCK_PURCHASES, {
            'Purchase Date': today,
            Supplier: supplier,
            Flower: [finalItemId],
            'Quantity Purchased': accepted,
            'Price Per Unit': costPrice,
            Notes: `PO #${req.params.id}`,
          });
        }

        // Alt supplier: same batch logic, flag price for review
        const altAccepted = Number(evalLine.altQuantityAccepted) || 0;
        const altWriteOff = Number(evalLine.altWriteOffQty) || 0;
        const altSupplier = line['Alt Supplier'] || '';
        if (stockItemId && altAccepted > 0) {
          const altFinalId = await receiveIntoStock(stockItemId, altAccepted, costPrice, sellPrice, altSupplier, today);

          await db.create(TABLES.STOCK_PURCHASES, {
            'Purchase Date': today,
            Supplier: altSupplier,
            Flower: [altFinalId],
            'Quantity Purchased': altAccepted,
            'Price Per Unit': costPrice,
            Notes: `PO #${req.params.id} (alt supplier — price needs review)`,
          });

          // Flag for owner price review
          await db.update(TABLES.STOCK_ORDER_LINES, evalLine.lineId, {
            'Price Needs Review': true,
          });
        }

        // Log write-offs
        const totalWriteOff = writeOff + altWriteOff;
        if (stockItemId && totalWriteOff > 0 && TABLES.STOCK_LOSS_LOG) {
          const reason = evalLine.writeOffReason || LOSS_REASON.DAMAGED;
          db.create(TABLES.STOCK_LOSS_LOG, {
            Date: today,
            'Stock Item': [stockItemId],
            Quantity: totalWriteOff,
            Reason: reason === LOSS_REASON.WILTED || reason === LOSS_REASON.DAMAGED || reason === LOSS_REASON.ARRIVED_BROKEN ? reason : LOSS_REASON.OTHER,
            Notes: `PO evaluation write-off`,
          }).catch(err => console.error('[STOCK-ORDER] Failed to log write-off:', err.message));
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
