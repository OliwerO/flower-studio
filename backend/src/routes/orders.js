import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { broadcast } from '../services/notifications.js';
import { notifyNewOrder } from '../services/telegram.js';
import { getDriverOfDay, getConfig } from './settings.js';

const router = Router();
router.use(authorize('orders'));

// --- Helpers ---

// Filters an object to only include keys present in the allowedFields array.
// Like an incoming goods inspection gate — only approved parts get through.
function pickAllowed(body, allowedFields) {
  const filtered = {};
  for (const key of allowedFields) {
    if (key in body) filtered[key] = body[key];
  }
  return filtered;
}

const VALID_SOURCES = ['Instagram', 'WhatsApp', 'Telegram', 'Wix', 'Flowwow', 'In-store', 'Other'];
const VALID_PAYMENT_STATUSES = ['Paid', 'Unpaid', 'Partial'];

const ORDERS_PATCH_ALLOWED = [
  'Status', 'Payment Status', 'Payment Method', 'Price Override',
  'Notes Original', 'Greeting Card Text', 'Customer Request',
  'Delivery Type', 'Required By', 'Source', 'Delivery Fee',
];

// GET /api/orders?status=New&dateFrom=2025-01-01&dateTo=2025-01-31&source=Instagram
router.get('/', async (req, res, next) => {
  try {
    const { status, dateFrom, dateTo, source, deliveryType, paymentStatus, paymentMethod, excludeCancelled } = req.query;
    const filters = [];

    if (status)           filters.push(`{Status} = '${sanitizeFormulaValue(status)}'`);
    // "Other" in analytics means Source is blank/empty — match records with no Source set.
    if (source === 'Other') filters.push(`OR({Source} = 'Other', {Source} = BLANK())`);
    else if (source)        filters.push(`{Source} = '${sanitizeFormulaValue(source)}'`);
    if (deliveryType)     filters.push(`{Delivery Type} = '${sanitizeFormulaValue(deliveryType)}'`);
    if (paymentStatus)    filters.push(`{Payment Status} = '${sanitizeFormulaValue(paymentStatus)}'`);
    // "Not recorded" means orders where Payment Method is blank/empty
    if (paymentMethod === 'Not recorded') filters.push(`OR({Payment Method} = BLANK(), {Payment Method} = '')`);
    else if (paymentMethod) filters.push(`{Payment Method} = '${sanitizeFormulaValue(paymentMethod)}'`);
    if (excludeCancelled) filters.push(`{Status} != 'Cancelled'`);
    if (dateFrom)         filters.push(`NOT(IS_BEFORE({Order Date}, '${sanitizeFormulaValue(dateFrom)}'))`);
    if (dateTo)           filters.push(`NOT(IS_AFTER({Order Date}, '${sanitizeFormulaValue(dateTo)}'))`);

    const filterByFormula = filters.length
      ? `AND(${filters.join(', ')})`
      : '';

    const orders = await db.list(TABLES.ORDERS, {
      filterByFormula,
      sort: [{ field: 'Order Date', direction: 'desc' }],
      maxRecords: 200,
    });

    // Bulk-fetch order lines + customers + deliveries in parallel.
    // Like loading a truck once with all parts instead of sending a separate van per item.
    const allLineIds = orders.flatMap(o => o['Order Lines'] || []);
    const uniqueCustomerIds = [...new Set(orders.flatMap(o => o.Customer || []))];
    const allDeliveryIds = orders.flatMap(o => o['Deliveries'] || []);

    const [allLines, allCustomers, allDeliveries] = await Promise.all([
      allLineIds.length > 0
        ? db.list(TABLES.ORDER_LINES, {
            filterByFormula: `OR(${allLineIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Order', 'Sell Price Per Unit', 'Cost Price Per Unit', 'Quantity', 'Flower Name'],
            maxRecords: 1000,
          })
        : [],
      uniqueCustomerIds.length > 0
        ? db.list(TABLES.CUSTOMERS, {
            filterByFormula: `OR(${uniqueCustomerIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Name', 'Nickname'],
          })
        : [],
      allDeliveryIds.length > 0
        ? db.list(TABLES.DELIVERIES, {
            filterByFormula: `OR(${allDeliveryIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Delivery Date', 'Delivery Time'],
          })
        : [],
    ]);

    // Index customers and deliveries by ID
    const customerMap = {};
    for (const c of allCustomers) customerMap[c.id] = c;

    const deliveryMap = {};
    for (const d of allDeliveries) deliveryMap[d.id] = d;

    // Sum order line totals + build bouquet summary per order
    const totalByOrder = {};
    const costByOrder = {};
    const linesByOrder = {};   // orderId → [{ name, qty }]
    for (const line of allLines) {
      const oid = line.Order?.[0];
      if (oid) {
        totalByOrder[oid] = (totalByOrder[oid] || 0)
          + Number(line['Sell Price Per Unit'] || 0) * Number(line['Quantity'] || 0);
        costByOrder[oid] = (costByOrder[oid] || 0)
          + Number(line['Cost Price Per Unit'] || 0) * Number(line['Quantity'] || 0);
        if (!linesByOrder[oid]) linesByOrder[oid] = [];
        linesByOrder[oid].push({
          name: line['Flower Name'] || '?',
          qty:  Number(line['Quantity'] || 0),
        });
      }
    }

    // Enrich orders — zero additional API calls
    for (const order of orders) {
      const custId = order.Customer?.[0];
      order['Customer Name'] = customerMap[custId]?.Name || customerMap[custId]?.Nickname || '';

      if (!order['Price Override'] && totalByOrder[order.id] != null) {
        order['Sell Total'] = totalByOrder[order.id];
      }
      // Attach flower cost total for margin dot indicator
      if (costByOrder[order.id] != null) {
        order['Flowers Cost Total'] = costByOrder[order.id];
      }
      // Bouquet summary — e.g. "5× Roses, 3× Tulips" for quick visual ID
      const lines = linesByOrder[order.id];
      if (lines?.length) {
        order['Bouquet Summary'] = lines.map(l => `${l.qty}× ${l.name}`).join(', ');
      }

      // Attach delivery date/time for display in the order list row
      const delivId = order['Deliveries']?.[0];
      if (delivId && deliveryMap[delivId]) {
        order['Delivery Date'] = deliveryMap[delivId]['Delivery Date'] || null;
        order['Delivery Time'] = deliveryMap[delivId]['Delivery Time'] || null;
      }
    }

    res.json(orders);
  } catch (err) {
    next(err);
  }
});

// GET /api/orders/:id — includes linked order lines
router.get('/:id', async (req, res, next) => {
  try {
    // 1. Fetch the order record (1 API call)
    const order = await db.getById(TABLES.ORDERS, req.params.id);

    // 2. Bulk-fetch order lines + customer + delivery in parallel (2-3 API calls, not N+2)
    //    Same pattern as the list endpoint — one truck for all packages.
    const lineIds = order['Order Lines'] || [];
    const custId = order.Customer?.[0];
    const deliveryId = order['Deliveries']?.[0];

    const [orderLines, customer, delivery] = await Promise.all([
      // Bulk-fetch all order lines with OR formula (1 call instead of N)
      lineIds.length > 0
        ? db.list(TABLES.ORDER_LINES, {
            filterByFormula: `OR(${lineIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
          })
        : Promise.resolve([]),
      // Fetch customer (1 call)
      custId
        ? db.getById(TABLES.CUSTOMERS, custId).catch(() => null)
        : Promise.resolve(null),
      // Fetch delivery if exists (1 call)
      deliveryId
        ? db.getById(TABLES.DELIVERIES, deliveryId)
        : Promise.resolve(undefined),
    ]);

    order['Customer Name'] = customer?.Name || customer?.Nickname || '';
    order['Customer Phone'] = customer?.Phone || '';
    order['Customer Nickname'] = customer?.Nickname || '';
    order.orderLines = orderLines;
    if (delivery) order.delivery = delivery;

    res.json(order);
  } catch (err) {
    next(err);
  }
});

// POST /api/orders — creates order + order lines + delivery atomically (sequential)
// Body: { customer, customerRequest, source, deliveryType, orderLines[], delivery?, notes, paymentStatus, paymentMethod, priceOverride }
router.post('/', async (req, res, next) => {
  try {
    const {
      customer,         // Airtable customer record ID
      customerRequest,
      source,
      deliveryType,
      orderLines = [],  // [{ stockItemId, flowerName, quantity, costPricePerUnit, sellPricePerUnit }]
      delivery,         // { address, recipientName, recipientPhone, date, time, cardText, driverId, fee }
      notes,
      paymentStatus,
      paymentMethod,
      priceOverride,
      requiredBy,
      cardText,         // top-level card text (works for both delivery and pickup)
      deliveryTime,     // top-level time slot (used for pickup timing)
    } = req.body;

    // --- Fix 1: Input validation (defect detection gate) ---
    if (!customer || typeof customer !== 'string') {
      return res.status(400).json({ error: 'customer (Airtable record ID) is required and must be a non-empty string.' });
    }
    if (orderLines && !Array.isArray(orderLines)) {
      return res.status(400).json({ error: 'orderLines must be an array.' });
    }
    for (let i = 0; i < orderLines.length; i++) {
      const line = orderLines[i];
      if (typeof line.quantity !== 'number' || line.quantity <= 0) {
        return res.status(400).json({ error: `orderLines[${i}].quantity must be a positive number.` });
      }
      if (line.costPricePerUnit !== undefined && (typeof line.costPricePerUnit !== 'number' || line.costPricePerUnit < 0)) {
        return res.status(400).json({ error: `orderLines[${i}].costPricePerUnit must be >= 0 if provided.` });
      }
      if (line.sellPricePerUnit !== undefined && (typeof line.sellPricePerUnit !== 'number' || line.sellPricePerUnit < 0)) {
        return res.status(400).json({ error: `orderLines[${i}].sellPricePerUnit must be >= 0 if provided.` });
      }
    }
    if (deliveryType === 'Delivery' && (!delivery || !delivery.address || typeof delivery.address !== 'string' || !delivery.address.trim())) {
      return res.status(400).json({ error: 'delivery.address is required and must be non-empty when deliveryType is "Delivery".' });
    }
    if (priceOverride !== undefined && priceOverride !== null && (typeof priceOverride !== 'number' || priceOverride < 0)) {
      return res.status(400).json({ error: 'priceOverride must be a number >= 0 if provided.' });
    }
    if (source && !VALID_SOURCES.includes(source)) {
      return res.status(400).json({ error: `source must be one of: ${VALID_SOURCES.join(', ')}` });
    }
    if (paymentStatus && !VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
      return res.status(400).json({ error: `paymentStatus must be one of: ${VALID_PAYMENT_STATUSES.join(', ')}` });
    }

    // --- Rollback tracking ---
    let order = null;
    const createdLineIds = [];
    const stockAdjustments = []; // track deductions for rollback: [{ stockId, delta }]
    let createdDelivery = null;

    try {
      // 1. Create the parent order record
      order = await db.create(TABLES.ORDERS, {
        Customer:         [customer],
        'Customer Request': customerRequest,
        Source:           source,
        'Delivery Type':  deliveryType,
        'Order Date':     new Date().toISOString().split('T')[0],
        'Required By':    requiredBy || delivery?.date || null,
        'Notes Original':     notes || '',
        'Greeting Card Text': cardText || delivery?.cardText || '',
        'Payment Status':     paymentStatus || 'Unpaid',
        'Payment Method':     paymentMethod || null,
        'Delivery Fee':       deliveryType === 'Delivery' ? (delivery?.fee ?? getConfig('defaultDeliveryFee')) : 0,
        'Price Override':     priceOverride || null,
        Status:               'New',
        'Created By':         req.role === 'owner' ? 'Owner' : 'Florist',
      });

      // 2. Create order line records (one per flower) — prices are snapshotted here
      const createdLines = [];
      for (const line of orderLines) {
        const created = await db.create(TABLES.ORDER_LINES, {
          Order:                  [order.id],
          ...(line.stockItemId ? { 'Stock Item': [line.stockItemId] } : {}),
          'Flower Name':          line.flowerName,
          Quantity:               line.quantity,
          'Cost Price Per Unit':  line.costPricePerUnit || 0,
          'Sell Price Per Unit':  line.sellPricePerUnit || 0,
        });
        createdLines.push(created);
        createdLineIds.push(created.id);
      }

      // 3. Deduct stock atomically — serialized through stockQueue (no race conditions)
      // Skip deduction for deferred lines — they signal demand without pulling from inventory.
      for (const line of orderLines) {
        if (line.stockItemId && !line.stockDeferred) {
          await db.atomicStockAdjust(line.stockItemId, -line.quantity);
          stockAdjustments.push({ stockId: line.stockItemId, delta: -line.quantity });
        }
      }

      // 4. Create delivery record if delivery type
      if (deliveryType === 'Delivery' && delivery) {
        createdDelivery = await db.create(TABLES.DELIVERIES, {
          'Linked Order':      [order.id],
          'Delivery Address':  delivery.address || '',
          'Recipient Name':    delivery.recipientName || '',
          'Recipient Phone':   delivery.recipientPhone || '',
          'Delivery Date':   delivery.date || null,
          'Delivery Time':   delivery.time || '',
          'Assigned Driver': delivery.driver || getDriverOfDay() || null,
          'Delivery Fee':      delivery.fee ?? getConfig('defaultDeliveryFee'),
          Status:              'Pending',
        });
      }

      // Broadcast new order to all connected SSE clients (florist + delivery + dashboard)
      broadcast({
        type: 'new_order',
        orderId: order.id,
        customerName: '',
        source: source || 'In-store',
        request: customerRequest || '',
      });

      // Telegram notification to owner + florists (non-blocking)
      notifyNewOrder({
        source: source || 'In-store',
        customerName: '',
        request: customerRequest,
        deliveryType,
        price: priceOverride || null,
      }).catch(err => console.error('[TELEGRAM] Notification error:', err.message));


      res.status(201).json({
        order,
        orderLines: createdLines,
        delivery: createdDelivery,
      });
    } catch (creationErr) {
      // Rollback — reverse stock deductions, delete created records.
      // Like scrapping a half-assembled unit and returning parts to the bins.
      console.error('Order creation failed mid-sequence, rolling back:', creationErr.message);
      const rollbackErrors = [];

      // Reverse stock deductions (add back what was deducted)
      for (const adj of stockAdjustments) {
        try { await db.atomicStockAdjust(adj.stockId, -adj.delta); }
        catch (e) { rollbackErrors.push(`Failed to reverse stock ${adj.stockId}: ${e.message}`); }
      }

      for (const lineId of createdLineIds) {
        try { await db.deleteRecord(TABLES.ORDER_LINES, lineId); }
        catch (e) { rollbackErrors.push(`Failed to delete order line ${lineId}: ${e.message}`); }
      }
      if (order) {
        try { await db.deleteRecord(TABLES.ORDERS, order.id); }
        catch (e) { rollbackErrors.push(`Failed to delete order ${order.id}: ${e.message}`); }
      }

      if (rollbackErrors.length > 0) {
        console.error('Rollback encountered errors:', rollbackErrors);
      }

      return res.status(500).json({
        error: 'Order creation failed. Partial records have been cleaned up.',
        detail: creationErr.message,
      });
    }
  } catch (err) {
    next(err);
  }
});

// PUT /api/orders/:id/lines — edit bouquet composition after order creation.
// Handles add/remove/update lines with stock adjustments.
// Body: { lines: [...], removedLines: [{ lineId, stockItemId, quantity, action: 'return'|'writeoff', reason? }] }
// Editable at statuses: New, Accepted, In Preparation, Ready.
// If owner edits while Ready → auto-revert to In Preparation.
router.put('/:id/lines', async (req, res, next) => {
  try {
    const order = await db.getById(TABLES.ORDERS, req.params.id);
    const editableStatuses = ['New', 'Accepted', 'In Preparation', 'Ready'];
    if (!editableStatuses.includes(order.Status)) {
      return res.status(400).json({ error: `Cannot edit bouquet in "${order.Status}" status.` });
    }

    const { lines = [], removedLines = [] } = req.body;
    const isOwner = req.role === 'owner';

    // 1. Handle removed lines: return to stock or write off
    for (const rem of removedLines) {
      if (rem.stockItemId && rem.quantity > 0) {
        if (rem.action === 'return') {
          await db.atomicStockAdjust(rem.stockItemId, rem.quantity);
        } else if (rem.action === 'writeoff') {
          // Log as stock loss but don't return to stock
          await db.create(TABLES.STOCK_LOSS_LOG, {
            'Stock Item': [rem.stockItemId],
            Quantity: rem.quantity,
            Reason: rem.reason || 'Bouquet edit',
            Date: new Date().toISOString().split('T')[0],
          }).catch(e => console.error('[STOCK-LOSS] Write-off log error:', e.message));
        }
      }
      if (rem.lineId) {
        await db.deleteRecord(TABLES.ORDER_LINES, rem.lineId).catch(() => {});
      }
    }

    // 2. Handle new/updated lines
    const createdLines = [];
    for (const line of lines) {
      if (line.id) {
        // Existing line — update quantity (compute stock delta)
        if (line._originalQty != null && line.quantity !== line._originalQty) {
          const delta = line._originalQty - line.quantity;
          if (line.stockItemId && !line.stockDeferred && delta !== 0) {
            await db.atomicStockAdjust(line.stockItemId, delta);
          }
          await db.update(TABLES.ORDER_LINES, line.id, { Quantity: line.quantity });
        }
      } else {
        // New line — create record + deduct stock
        const created = await db.create(TABLES.ORDER_LINES, {
          Order: [req.params.id],
          ...(line.stockItemId ? { 'Stock Item': [line.stockItemId] } : {}),
          'Flower Name': line.flowerName,
          Quantity: line.quantity,
          'Cost Price Per Unit': line.costPricePerUnit || 0,
          'Sell Price Per Unit': line.sellPricePerUnit || 0,
        });
        createdLines.push(created);
        if (line.stockItemId && !line.stockDeferred) {
          await db.atomicStockAdjust(line.stockItemId, -line.quantity);
        }
      }
    }

    // 3. Auto-revert status if owner edits while Ready
    if (isOwner && order.Status === 'Ready') {
      await db.update(TABLES.ORDERS, req.params.id, { Status: 'In Preparation' });
    }

    res.json({ updated: true, createdLines });
  } catch (err) {
    next(err);
  }
});

// Allowed status transitions — like a production routing sheet.
// Simplified: removed "In Progress" as a required step — unnecessary click
// without value added. Orders flow: New → Ready → Delivered/Picked Up.
// "In Progress" kept as legacy exit only (for orders already in that state).
const ALLOWED_TRANSITIONS = {
  'New':              ['Accepted', 'Ready', 'Cancelled'],
  'Accepted':         ['Ready', 'Cancelled'],
  'In Progress':      ['Ready', 'Cancelled'],          // legacy — still allow exit
  'Ready':            ['Out for Delivery', 'Delivered', 'Picked Up', 'Cancelled'],
  'Out for Delivery': ['Delivered', 'Cancelled'],       // driver is en route
  'Delivered':        [],          // terminal — no changes
  'Picked Up':        [],          // terminal — no changes
  'Cancelled':        ['New'],     // allow un-cancel (reopen) back to New
};

// PATCH /api/orders/:id — update status, prices, assignment, etc.
router.patch('/:id', async (req, res, next) => {
  try {
    // Fix 2: Field whitelisting — only approved fields pass through
    const safeFields = pickAllowed(req.body, ORDERS_PATCH_ALLOWED);
    const { Status: newStatus, ...otherFields } = safeFields;

    // If status is being changed, validate the transition
    if (newStatus) {
      const current = await db.getById(TABLES.ORDERS, req.params.id);
      const currentStatus = current.Status || 'New';
      const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];

      if (newStatus !== currentStatus && !allowed.includes(newStatus)) {
        return res.status(400).json({
          error: `Cannot move from "${currentStatus}" to "${newStatus}". Allowed: ${allowed.join(', ') || 'none (terminal)'}`,
        });
      }

      // Stock not auto-returned on cancel per business rules —
      // florist must manually re-add via Stock Panel.
      // Flowers may have already been used or discarded.
    }

    // Record prep timestamps for cycle-time analysis.
    // "Accepted" = work starts (like punching in at a workstation).
    // "Ready" = work complete (like scanning finished goods).
    const timestamps = {};
    if (newStatus === 'Accepted') timestamps['Prep Started At'] = new Date().toISOString();
    if (newStatus === 'Ready') timestamps['Prep Ready At'] = new Date().toISOString();

    const order = await db.update(TABLES.ORDERS, req.params.id, {
      ...otherFields,
      ...(newStatus ? { Status: newStatus } : {}),
      ...timestamps,
    });

    // Broadcast status changes that other apps care about
    if (newStatus === 'Ready') {
      broadcast({
        type: 'order_ready',
        orderId: order.id,
        customerRequest: order['Customer Request'] || '',
      });
    }

    res.json(order);
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/:id/cancel-with-return — cancel order AND return stock quantities.
// Unlike plain cancel (which leaves stock as-is because flowers may be used/discarded),
// this explicitly adds quantities back. Like a full return-to-shelf after a cancelled production run.
router.post('/:id/cancel-with-return', async (req, res, next) => {
  try {
    const order = await db.getById(TABLES.ORDERS, req.params.id);
    const currentStatus = order.Status || 'New';

    // Only allow cancel-with-return from non-terminal states
    if (currentStatus === 'Delivered' || currentStatus === 'Picked Up') {
      return res.status(400).json({
        error: `Cannot cancel a ${currentStatus} order — it has already been fulfilled.`,
      });
    }
    if (currentStatus === 'Cancelled') {
      return res.status(400).json({ error: 'Order is already cancelled.' });
    }

    // Fetch order lines to know what stock to return
    const lineIds = order['Order Lines'] || [];
    let returnedItems = [];

    if (lineIds.length > 0) {
      const lines = await db.list(TABLES.ORDER_LINES, {
        filterByFormula: `OR(${lineIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
      });

      // Return stock for each line that has a linked stock item
      for (const line of lines) {
        const stockId = line['Stock Item']?.[0];
        const qty = Number(line.Quantity || 0);
        if (stockId && qty > 0) {
          const { newQty } = await db.atomicStockAdjust(stockId, qty);
          returnedItems.push({
            stockId,
            flowerName: line['Flower Name'] || '?',
            quantityReturned: qty,
            newStockQty: newQty,
          });
        }
      }
    }

    // Cancel the order
    await db.update(TABLES.ORDERS, req.params.id, { Status: 'Cancelled' });

    res.json({
      message: 'Order cancelled and stock returned.',
      returnedItems,
    });
  } catch (err) {
    next(err);
  }
});


export default router;
