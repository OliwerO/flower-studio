// Stock Orders (Purchase Orders) — procurement lifecycle management.
// Like a kanban board for the purchasing process:
// Draft → Sent → Shopping → Evaluating → Complete
//
// Each PO has lines grouped by supplier. The driver shops, the florist evaluates quality,
// and stock levels are adjusted when flowers pass inspection.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import * as stockRepo from '../repos/stockRepo.js';
import { TABLES } from '../config/airtable.js';
import { broadcast } from '../services/notifications.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { PO_STATUS, VALID_PO_STATUSES, PO_LINE_STATUS, LOSS_REASON, ORDER_STATUS } from '../constants/statuses.js';
import { getConfig, getDriverOfDay } from './settings.js';
import { listByIds } from '../utils/batchQuery.js';

const VALID_STATUSES = VALID_PO_STATUSES;

// Airtable may return Flower Name as an array (lookup field) or a string
// (text field). Normalise to a plain string so downstream code (.trim(),
// template literals, formula values) never receives an array.
function normaliseFlowerName(raw) {
  if (Array.isArray(raw)) return String(raw[0] || '');
  return String(raw || '');
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
      // Normalise Flower Name on every line — Airtable may return arrays
      // from lookup fields, but frontends expect a plain string.
      for (const l of allLines) {
        if (l['Flower Name'] != null) l['Flower Name'] = normaliseFlowerName(l['Flower Name']);
        if (l['Alt Flower Name'] != null) l['Alt Flower Name'] = normaliseFlowerName(l['Alt Flower Name']);
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
      for (const l of lines) {
        if (l['Flower Name'] != null) l['Flower Name'] = normaliseFlowerName(l['Flower Name']);
        if (l['Alt Flower Name'] != null) l['Alt Flower Name'] = normaliseFlowerName(l['Alt Flower Name']);
      }
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
      // Auto-link or auto-create: if no stockItemId but flowerName is given,
      // find a matching stock item. If not found, create one with qty=0 so it
      // appears in the stock picker with an "on order" badge immediately.
      let resolvedStockItemId = line.stockItemId || null;
      if (!resolvedStockItemId && line.flowerName) {
        try {
          const safe = sanitizeFormulaValue(line.flowerName.trim());
          const matches = await db.list(TABLES.STOCK, {
            filterByFormula: `AND({Display Name} = '${safe}', {Active} = TRUE())`,
            maxRecords: 1,
          });
          if (matches.length > 0) {
            resolvedStockItemId = matches[0].id;
          } else {
            // Create a new stock item so the flower appears in the stock picker
            const newItem = await stockRepo.create({
              'Display Name': line.flowerName.trim(),
              'Purchase Name': line.flowerName.trim(),
              'Current Quantity': 0,
              'Current Cost Price': Number(line.costPrice) || 0,
              'Current Sell Price': Number(line.sellPrice) || 0,
              Supplier: line.supplier || '',
              Category: 'Other',
              Active: true,
            });
            resolvedStockItemId = newItem.id;
            console.log(`[STOCK-ORDER] Auto-created stock item "${line.flowerName}" (${newItem.id}) from PO line`);
          }
        } catch (err) {
          console.error(`[STOCK-ORDER] Auto-link/create failed for "${line.flowerName}":`, err.message);
        }
      }
      let lotSize = Number(line.lotSize) || 0;
      if (!lotSize && resolvedStockItemId) {
        try {
          const stockItem = await db.getById(TABLES.STOCK, resolvedStockItemId);
          lotSize = Number(stockItem['Lot Size']) || 0;
        } catch { /* stock item may have been deleted */ }
      }
      const lineFields = {
        'Stock Orders': [order.id],
        ...(resolvedStockItemId ? { 'Stock Item': [resolvedStockItemId] } : {}),
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

    // Guard: if the PATCH tries to shorten Flower Name to fewer than 2 chars
    // while the line has a linked Stock Item, reject it — this is almost
    // certainly a race from the keystroke-by-keystroke search input, not an
    // intentional rename. The full name will arrive in a subsequent PATCH.
    if ('Flower Name' in fields && typeof fields['Flower Name'] === 'string' && fields['Flower Name'].length < 2) {
      const existing = await db.getById(TABLES.STOCK_ORDER_LINES, req.params.lineId);
      const hasStockItem = !!existing['Stock Item']?.[0];
      const currentName = existing['Flower Name'] || '';
      if (hasStockItem && currentName.length >= 2) {
        delete fields['Flower Name'];
        if (Object.keys(fields).length === 0) return res.json(existing);
      }
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

    // Normalise Flower Name in response
    if (updated['Flower Name'] != null) updated['Flower Name'] = normaliseFlowerName(updated['Flower Name']);
    if (updated['Alt Flower Name'] != null) updated['Alt Flower Name'] = normaliseFlowerName(updated['Alt Flower Name']);
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
    const { stockItemId: rawStockItemId, flowerName, quantity, supplier, costPrice, sellPrice, lotSize } = req.body;
    // Identity rule (root CLAUDE.md known-pitfall #6): every PO line must have
    // either a Stock Item link or a Flower Name *by the time the PO is sent*.
    // For Draft, allow a blank line so the owner can tap "+ Add line" and edit
    // the row inline (matches the wizard flow). The /send endpoint enforces
    // the rule on Draft→Sent so blank rows can never reach the driver.
    if (!rawStockItemId && !flowerName?.trim() && po.Status !== PO_STATUS.DRAFT) {
      return res.status(400).json({ error: 'PO line must have a stock item or flower name.' });
    }
    // Auto-link or auto-create stock item
    let resolvedStockItemId = rawStockItemId || null;
    if (!resolvedStockItemId && flowerName) {
      try {
        const safe = sanitizeFormulaValue(flowerName.trim());
        const matches = await db.list(TABLES.STOCK, {
          filterByFormula: `AND({Display Name} = '${safe}', {Active} = TRUE())`,
          maxRecords: 1,
        });
        if (matches.length > 0) {
          resolvedStockItemId = matches[0].id;
        } else {
          const newItem = await stockRepo.create({
            'Display Name': flowerName.trim(),
            'Purchase Name': flowerName.trim(),
            'Current Quantity': 0,
            'Current Cost Price': Number(costPrice) || 0,
            'Current Sell Price': Number(sellPrice) || 0,
            Supplier: supplier || '',
            Category: 'Other',
            Active: true,
          });
          resolvedStockItemId = newItem.id;
        }
      } catch { /* best effort */ }
    }
    const line = await db.create(TABLES.STOCK_ORDER_LINES, {
      'Stock Orders': [req.params.id],
      'Stock Item': resolvedStockItemId ? [resolvedStockItemId] : undefined,
      'Flower Name': flowerName || '',
      'Quantity Needed': Number(quantity) || 1,
      Supplier: supplier || '',
      'Cost Price': Number(costPrice) || 0,
      'Sell Price': Number(sellPrice) || 0,
      'Lot Size': Number(lotSize) || 0,
      'Driver Status': PO_LINE_STATUS.PENDING,
    });
    broadcast({ type: 'stock_order_line_updated', stockOrderId: req.params.id, lineId: line.id });
    if (line['Flower Name'] != null) line['Flower Name'] = normaliseFlowerName(line['Flower Name']);
    res.json(line);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/stock-orders/:id — delete an entire Draft PO (owner only).
// Removes all its lines first, then the PO header.
router.delete('/:id', authorize('stock-orders', ['owner']), async (req, res, next) => {
  try {
    const po = await db.getById(TABLES.STOCK_ORDERS, req.params.id);
    if (po.Status !== PO_STATUS.DRAFT) {
      return res.status(400).json({ error: `Only Draft POs can be deleted. This PO is "${po.Status}".` });
    }
    // Delete all lines first
    const lineIds = po['Order Lines'] || [];
    for (const lineId of lineIds) {
      await db.deleteRecord(TABLES.STOCK_ORDER_LINES, lineId).catch(err =>
        console.error(`[PO] Failed to delete line ${lineId} during PO delete:`, err.message)
      );
    }
    await db.deleteRecord(TABLES.STOCK_ORDERS, req.params.id);
    broadcast({ type: 'stock_order_deleted', stockOrderId: req.params.id });
    res.json({ deleted: true });
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
    const resolvedDriver = driverName || getDriverOfDay();
    // Enforce the line-identity rule on Draft→Sent. Sent→Sent re-sends (driver
    // reassignment) skip the check because their lines were already validated
    // on the previous send. Without this gate, blank Draft lines would reach
    // the driver as "what am I buying?" rows.
    const po = await db.getById(TABLES.STOCK_ORDERS, req.params.id);
    if (po.Status === PO_STATUS.DRAFT) {
      const lineIds = po['Order Lines'] || [];
      if (lineIds.length === 0) {
        return res.status(400).json({ error: 'Cannot send an empty PO. Add at least one line first.' });
      }
      const lines = await listByIds(TABLES.STOCK_ORDER_LINES, lineIds);
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
    const updated = await db.update(TABLES.STOCK_ORDERS, req.params.id, {
      Status: PO_STATUS.SENT,
      'Assigned Driver': resolvedDriver,
    });

    // SSE notification to driver
    broadcast({ type: 'stock_pickup_assigned', stockOrderId: req.params.id, driverName: resolvedDriver });

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
// Returns the new batch's stock item ID.
const DATE_BATCH_RE = /^(.+?)\s*\(\d{1,2}\.\w{3,4}\.?\)$/;
async function receiveIntoStock(stockItemId, qty, costPrice, sellPrice, supplier, today) {
  const stockItem = await stockRepo.getById(stockItemId);
  const existingQty = Number(stockItem['Current Quantity']) || 0;

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date(today);
  const batchLabel = `${d.getDate()}.${months[d.getMonth()]}.`;

  // Strip any existing date suffix to avoid "Rose (14.Apr.) (15.Apr.)" names
  const rawName = stockItem['Display Name'] || '';
  const baseName = (rawName.match(DATE_BATCH_RE)?.[1] || rawName).trim();

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
  });

  // Update prices on the original record too so the "template" stays current
  await stockRepo.update(stockItemId, {
    'Current Cost Price': costPrice || stockItem['Current Cost Price'],
    'Current Sell Price': sellPrice || stockItem['Current Sell Price'],
    'Last Restocked': today,
  });

  return newBatch.id;
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
    // On first attempt use today's date. On Eval Error retry, reuse the date
    // from lines already processed in the first attempt so all stock entries
    // for this PO share the same receive date (the day flowers actually arrived).
    let evalDate = new Date().toISOString().split('T')[0];
    if (po.Status === PO_STATUS.EVAL_ERROR && TABLES.STOCK_PURCHASES) {
      const marker = `PO #${req.params.id}`;
      try {
        const prev = await db.list(TABLES.STOCK_PURCHASES, {
          filterByFormula: `FIND("${marker}", {Notes} & "") > 0`,
          maxRecords: 1,
        });
        if (prev.length > 0 && prev[0]['Purchase Date']) {
          evalDate = prev[0]['Purchase Date'];
        }
      } catch { /* fall back to today */ }
    }
    const lineResults = []; // track per-line outcome for partial failure recovery

    for (const evalLine of (lines || [])) {
      try {
        const line = await db.getById(TABLES.STOCK_ORDER_LINES, evalLine.lineId);

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

        // Auto-resolve: if PO line has no Stock Item but has Flower Name,
        // find a matching stock record and link it. This handles lines created
        // from freetext input (no stock item selected in the PO form).
        if (!stockItemId && (accepted > 0 || writeOff > 0)) {
          const flowerName = normaliseFlowerName(line['Flower Name']).trim();
          if (!flowerName) {
            throw new Error(
              `Line "${evalLine.lineId}" has no Stock Item and no Flower Name — cannot resolve.`
            );
          }
          const safe = sanitizeFormulaValue(flowerName);
          const matches = await db.list(TABLES.STOCK, {
            filterByFormula: `AND({Display Name} = '${safe}', {Active} = TRUE())`,
            maxRecords: 1,
          });
          if (matches.length > 0) {
            stockItemId = matches[0].id;
            await db.update(TABLES.STOCK_ORDER_LINES, evalLine.lineId, { 'Stock Item': [stockItemId] });
            console.log(`[STOCK-ORDER] Auto-linked "${flowerName}" → stock item ${stockItemId}`);
          } else {
            // Create a new stock item so the line can be received
            const markup = Number(getConfig('targetMarkup')) || 1;
            const autoSell = sellPrice || Math.round(costPrice * markup * 100) / 100;
            const created = await stockRepo.create({
              'Display Name': flowerName,
              'Purchase Name': flowerName,
              Category: 'Other',
              'Current Quantity': 0,
              'Current Cost Price': costPrice,
              'Current Sell Price': autoSell,
              Supplier: supplier,
              Unit: 'Stems',
              Active: true,
            });
            stockItemId = created.id;
            await db.update(TABLES.STOCK_ORDER_LINES, evalLine.lineId, { 'Stock Item': [stockItemId] });
            console.log(`[STOCK-ORDER] Created & linked stock item for "${flowerName}" (${stockItemId})`);
          }
        }
        // Alt quantities without a stock item require at least an Alt Flower Name
        // so we know what substitute stock card to create.
        if (!stockItemId && (altAcceptedPre > 0 || altWriteOffPre > 0) && !line['Alt Flower Name']) {
          throw new Error(
            `Line "${normaliseFlowerName(line['Flower Name']) || evalLine.lineId}" has no linked Stock Item and no Alt Flower Name — ` +
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
            const finalItemId = await receiveIntoStock(stockItemId, accepted, costPrice, sellPrice, supplier, evalDate);

            // Audit trail — marker must match purchaseAlreadyRecorded() exactly.
            // Flower link is skipped when finalItemId is a PG UUID (STOCK_PURCHASES
            // is still Airtable-only until Phase 6, which rejects non-recXXX linked values).
            await db.create(TABLES.STOCK_PURCHASES, {
              'Purchase Date': evalDate,
              Supplier: supplier,
              ...(finalItemId.startsWith('rec') ? { Flower: [finalItemId] } : {}),
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
              ? await stockRepo.getById(stockItemId).catch(() => null)
              : null;
            substituteStockId = await findOrCreateSubstituteStock(
              altFlowerName, altSupplier, altCostPerStem, originalStockItem, stockItemId, evalDate
            );
            const markup = Number(getConfig('targetMarkup')) || 1;
            const altSellPerStem = Math.round(altCostPerStem * markup * 100) / 100;
            const altFinalId = await receiveIntoStock(
              substituteStockId, altAccepted, altCostPerStem, altSellPerStem, altSupplier, evalDate
            );
            substituteStockId = altFinalId; // may be a new batch id

            await db.create(TABLES.STOCK_PURCHASES, {
              'Purchase Date': evalDate,
              Supplier: altSupplier,
              ...(altFinalId.startsWith('rec') ? { Flower: [altFinalId] } : {}),
              'Quantity Purchased': altAccepted,
              'Price Per Unit': altCostPerStem,
              Notes: `PO #${req.params.id} L#${evalLine.lineId} alt - substitute for "${normaliseFlowerName(line['Flower Name'])}"`,
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
            Date: evalDate,
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
              Date: evalDate,
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

        lineResults.push({
          lineId: evalLine.lineId,
          status: 'ok',
          substituteStockId: substituteStockId || null,
          originalStockId: stockItemId || null,
          originalFlowerName: normaliseFlowerName(line['Flower Name']),
          receivedQty: altAccepted || 0,
        });
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

    // Phase B: detect orders needing reconciliation after substitution.
    // For each substitute received, check if open orders are waiting for the original.
    const substitutionsMade = lineResults.filter(
      r => r.status === 'ok' && r.substituteStockId && r.originalStockId
    );
    if (substitutionsMade.length > 0) {
      try {
        const today = new Date().toISOString().split('T')[0];
        // Fetch non-terminal future orders (same logic as GET /stock/committed)
        const openOrders = await db.list(TABLES.ORDERS, {
          filterByFormula: `AND({Status} != '${ORDER_STATUS.DELIVERED}', {Status} != '${ORDER_STATUS.PICKED_UP}', {Status} != '${ORDER_STATUS.CANCELLED}', IS_AFTER({Required By}, '${today}'))`,
          fields: ['Order Lines', 'Customer', 'Required By', 'App Order ID', 'Status'],
          maxRecords: 500,
        });
        const allSubLineIds = openOrders.flatMap(o => o['Order Lines'] || []);
        const allSubLines = allSubLineIds.length > 0
          ? await listByIds(TABLES.ORDER_LINES, allSubLineIds, {
              fields: ['Order', 'Stock Item', 'Quantity', 'Flower Name'],
            })
          : [];
        const custIds = [...new Set(openOrders.flatMap(o => o.Customer || []))];
        const custs = custIds.length > 0
          ? await listByIds(TABLES.CUSTOMERS, custIds, { fields: ['Name', 'Nickname'] })
          : [];
        const custMap = {};
        for (const c of custs) custMap[c.id] = c;
        const orderInfoMap = {};
        for (const o of openOrders) {
          const cid = o.Customer?.[0];
          orderInfoMap[o.id] = {
            appOrderId: o['App Order ID'] || '',
            customerName: custMap[cid]?.Name || custMap[cid]?.Nickname || '',
            requiredBy: o['Required By'] || null,
          };
        }

        for (const sub of substitutionsMade) {
          const affectedOrders = [];
          for (const line of allSubLines) {
            if (line['Stock Item']?.[0] !== sub.originalStockId) continue;
            const oid = line.Order?.[0];
            const oi = oid ? orderInfoMap[oid] : null;
            if (oi) {
              affectedOrders.push({
                orderId: oid,
                appOrderId: oi.appOrderId,
                customerName: oi.customerName,
                requiredBy: oi.requiredBy,
                qty: Number(line.Quantity || 0),
              });
            }
          }
          if (affectedOrders.length > 0) {
            broadcast({
              type: 'substitute_reconciliation_needed',
              originalStockId: sub.originalStockId,
              originalFlowerName: sub.originalFlowerName,
              substituteStockId: sub.substituteStockId,
              affectedOrders,
              substituteQty: sub.receivedQty,
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
