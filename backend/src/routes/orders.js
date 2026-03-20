import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { broadcast } from '../services/notifications.js';
import { notifyNewOrder } from '../services/telegram.js';
import { getDriverOfDay, getConfig, generateOrderId } from './settings.js';
import { pickAllowed } from '../utils/fields.js';
import { listByIds } from '../utils/batchQuery.js';

const router = Router();
router.use(authorize('orders'));

// Source validation removed — sources are now dynamic from Settings tab.
const VALID_PAYMENT_STATUSES = ['Paid', 'Unpaid', 'Partial'];

const ORDERS_PATCH_ALLOWED = [
  'Status', 'Payment Status', 'Payment Method', 'Price Override',
  'Notes Original', 'Greeting Card Text', 'Customer Request',
  'Delivery Type', 'Required By', 'Source', 'Delivery Fee', 'Delivery Time',
  'Payment 1 Amount', 'Payment 1 Method', 'Payment 2 Amount', 'Payment 2 Method',
];

// GET /api/orders?status=New&dateFrom=2025-01-01&dateTo=2025-01-31&source=Instagram&forDate=2025-01-15
// forDate: unified date filter — returns orders placed on OR due on that date (OR logic).
// dateFrom/dateTo: legacy Order Date range filter (AND logic).
// activeOnly: returns all non-terminal orders (excludes Delivered, Picked Up, Cancelled), sorted by Required By asc.
router.get('/', async (req, res, next) => {
  try {
    const { status, dateFrom, dateTo, forDate, source, deliveryType, paymentStatus, paymentMethod, excludeCancelled, upcoming, activeOnly, completedOnly } = req.query;
    const filters = [];

    if (status)           filters.push(`{Status} = '${sanitizeFormulaValue(status)}'`);
    // "Other" in analytics means Source is blank/empty — match records with no source set.
    if (source === 'Other') filters.push(`OR({Source} = 'Other', {Source} = BLANK())`);
    else if (source)        filters.push(`{Source} = '${sanitizeFormulaValue(source)}'`);
    if (deliveryType)     filters.push(`{Delivery Type} = '${sanitizeFormulaValue(deliveryType)}'`);
    if (paymentStatus)    filters.push(`{Payment Status} = '${sanitizeFormulaValue(paymentStatus)}'`);
    // "Not recorded" means orders where Payment Method is blank/empty
    if (paymentMethod === 'Not recorded') filters.push(`OR({Payment Method} = BLANK(), {Payment Method} = '')`);
    else if (paymentMethod) filters.push(`{Payment Method} = '${sanitizeFormulaValue(paymentMethod)}'`);
    if (excludeCancelled) filters.push(`{Status} != 'Cancelled'`);

    // "activeOnly" mode: all non-terminal orders — florist's default view.
    // Excludes Delivered, Picked Up, Cancelled. No date restriction.
    if (activeOnly) {
      filters.push(`AND({Status} != 'Delivered', {Status} != 'Picked Up', {Status} != 'Cancelled')`);
    } else if (completedOnly) {
      // Terminal orders only. If no date filter, show last 30 days.
      filters.push(`OR({Status} = 'Delivered', {Status} = 'Picked Up', {Status} = 'Cancelled')`);
      if (!forDate && !dateFrom) {
        const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        filters.push(`NOT(IS_BEFORE({Required By}, '${cutoff}'))`);
      }
    } else if (upcoming) {
      // "upcoming" mode: today + future by delivery/pickup date.
      // Fetch broadly (Order Date >= 90 days ago) — post-enrichment filter
      // narrows to orders with delivery date >= today or no delivery date.
      const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
      filters.push(`NOT(IS_BEFORE({Order Date}, '${cutoff}'))`);
    } else if (forDate) {
      // forDate: unified date filter — Order Date = date OR Required By = date.
      const d = sanitizeFormulaValue(forDate);
      filters.push(`OR(DATESTR({Order Date}) = '${d}', DATESTR({Required By}) = '${d}')`);
    } else {
      // Legacy date range filters on Order Date
      if (dateFrom && dateTo && dateFrom === dateTo) {
        filters.push(`DATESTR({Order Date}) = '${sanitizeFormulaValue(dateFrom)}'`);
      } else {
        if (dateFrom) filters.push(`NOT(IS_BEFORE({Order Date}, '${sanitizeFormulaValue(dateFrom)}'))`);
        if (dateTo)   filters.push(`NOT(IS_AFTER({Order Date}, '${sanitizeFormulaValue(dateTo)}'))`);
      }
    }

    const filterByFormula = filters.length
      ? `AND(${filters.join(', ')})`
      : '';

    // activeOnly mode: sort by Required By ascending (earliest needed first)
    const sortFields = activeOnly
      ? [{ field: 'Required By', direction: 'asc' }]
      : completedOnly
        ? [{ field: 'Required By', direction: 'desc' }]
        : [{ field: 'Order Date', direction: 'desc' }];

    const orders = await db.list(TABLES.ORDERS, {
      filterByFormula,
      sort: sortFields,
      maxRecords: 200,
    });

    // Bulk-fetch order lines + customers + deliveries in parallel.
    // Like loading a truck once with all parts instead of sending a separate van per item.
    const allLineIds = orders.flatMap(o => o['Order Lines'] || []);
    const uniqueCustomerIds = [...new Set(orders.flatMap(o => o.Customer || []))];
    const allDeliveryIds = orders.flatMap(o => o['Deliveries'] || []);

    const [allLines, allCustomers, allDeliveries] = await Promise.all([
      listByIds(TABLES.ORDER_LINES, allLineIds, {
        fields: ['Order', 'Sell Price Per Unit', 'Cost Price Per Unit', 'Quantity', 'Flower Name'],
        maxRecords: 1000,
      }),
      listByIds(TABLES.CUSTOMERS, uniqueCustomerIds, {
        fields: ['Name', 'Nickname'],
      }),
      listByIds(TABLES.DELIVERIES, allDeliveryIds, {
        fields: ['Delivery Date', 'Delivery Time', 'Delivery Fee', 'Delivery Address', 'Assigned Driver', 'Delivery Method', 'Status'],
      }),
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

      // Attach delivery fields for display in order list / kanban
      const delivId = order['Deliveries']?.[0];
      if (delivId && deliveryMap[delivId]) {
        const d = deliveryMap[delivId];
        order['Delivery Date'] = d['Delivery Date'] || null;
        order['Delivery Time'] = d['Delivery Time'] || null;
        order['Delivery Address'] = d['Delivery Address'] || '';
        order['Assigned Driver'] = d['Assigned Driver'] || '';
        order['Delivery Method'] = d['Delivery Method'] || 'Driver';
        order['Delivery Fee'] = Number(d['Delivery Fee'] || 0);
      }

      // Compute Final Price = Price Override || (Sell Total + Delivery Fee)
      const sellTotal = order['Sell Total'] || totalByOrder[order.id] || 0;
      const delivFee = Number(order['Delivery Fee'] || 0);
      order['Final Price'] = order['Price Override'] || (sellTotal + delivFee) || 0;
    }

    // Post-enrichment filter for "upcoming": keep orders with delivery/pickup
    // date >= today, OR orders with no delivery date at all (unscheduled).
    if (upcoming) {
      const today = new Date().toISOString().split('T')[0];
      const result = orders.filter(o => {
        const dd = o['Delivery Date'] || o['Required By'];
        if (!dd) return true;                      // no date → show it
        return dd >= today;                        // today or future
      });
      return res.json(result);
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
      listByIds(TABLES.ORDER_LINES, lineIds),
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
      communicationMethod,  // how the customer contacted us (Instagram, WhatsApp, etc.)
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
    // Source validation is no longer hardcoded — dynamic from Settings.
    if (paymentStatus && !VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
      return res.status(400).json({ error: `paymentStatus must be one of: ${VALID_PAYMENT_STATUSES.join(', ')}` });
    }

    // --- Rollback tracking ---
    let order = null;
    const createdLineIds = [];
    const stockAdjustments = []; // track deductions for rollback: [{ stockId, delta }]
    let createdDelivery = null;

    try {
      // 0. Generate sequential Order ID (YYYYMM-NNN)
      const appOrderId = await generateOrderId();

      // 1. Create the parent order record
      // For pickups, store the time slot directly on the order (no delivery record exists).
      // For deliveries, time goes to both the order and the delivery record.
      order = await db.create(TABLES.ORDERS, {
        Customer:         [customer],
        'Customer Request': customerRequest,
        'Source':   source || null,
        'Delivery Type':  deliveryType,
        'Order Date':     new Date().toISOString().split('T')[0],
        'Required By':    requiredBy || delivery?.date || null,
        'Notes Original':     notes || '',
        'Greeting Card Text': cardText || delivery?.cardText || '',
        'Delivery Time':      deliveryTime || delivery?.time || '',
        'Payment Status':     paymentStatus || 'Unpaid',
        'Payment Method':     paymentMethod || null,
        'Delivery Fee':       deliveryType === 'Delivery' ? (delivery?.fee ?? getConfig('defaultDeliveryFee')) : 0,
        'Price Override':     priceOverride || null,
        'App Order ID':       appOrderId,
        Status:               'New',
        'Created By':         req.role === 'owner' ? 'Owner' : 'Florist',
      });

      // 2a. Auto-match lines without stockItemId to existing stock by name.
      // Handles text imports and other flows that may not resolve stock links.
      const unmatchedLines = orderLines.filter(l => !l.stockItemId && l.flowerName);
      if (unmatchedLines.length > 0) {
        const allStock = await db.list(TABLES.STOCK, {
          filterByFormula: '{Active} = TRUE()',
          fields: ['Display Name'],
        });
        const byName = new Map(allStock.map(s => [(s['Display Name'] || '').toLowerCase(), s]));
        for (const line of unmatchedLines) {
          const match = byName.get((line.flowerName || '').toLowerCase());
          if (match) {
            line.stockItemId = match.id;
            console.log(`[ORDER] Auto-matched "${line.flowerName}" to stock ${match.id}`);
          }
        }
      }

      // 2b. Create order line records (one per flower) — prices are snapshotted here
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
          'Delivery Method': 'Driver',
          'Driver Payout':   getConfig('driverCostPerDelivery') || 0,
          Status:              'Pending',
        });
      }

      // 5. Update customer record with communication method + order source (non-blocking)
      const customerPatch = {};
      if (communicationMethod) customerPatch['Communication method'] = communicationMethod;
      if (source) customerPatch['Order Source'] = source;
      if (Object.keys(customerPatch).length > 0) {
        db.update(TABLES.CUSTOMERS, customer, customerPatch)
          .catch(err => console.error('[ORDER] Failed to update customer fields:', err.message));
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

    // Track which stock items already had explicit stock actions in removedLines
    // (qty reduction entries sent by frontend with lineId=null).
    // Skip auto-adjustment for these to avoid double-counting.
    const explicitStockIds = new Set(
      removedLines.filter(r => !r.lineId && r.stockItemId).map(r => r.stockItemId)
    );

    // 2a. Auto-match new lines without stockItemId to existing stock by name.
    const newUnmatched = lines.filter(l => !l.id && !l.stockItemId && l.flowerName);
    if (newUnmatched.length > 0) {
      const allStock = await db.list(TABLES.STOCK, {
        filterByFormula: '{Active} = TRUE()',
        fields: ['Display Name'],
      });
      const byName = new Map(allStock.map(s => [(s['Display Name'] || '').toLowerCase(), s]));
      for (const line of newUnmatched) {
        const match = byName.get((line.flowerName || '').toLowerCase());
        if (match) {
          line.stockItemId = match.id;
          console.log(`[BOUQUET-EDIT] Auto-matched "${line.flowerName}" to stock ${match.id}`);
        }
      }
    }

    // 2b. Handle new/updated lines
    const createdLines = [];
    for (const line of lines) {
      if (line.id) {
        // Existing line — update quantity
        if (line._originalQty != null && line.quantity !== line._originalQty) {
          // Only auto-adjust stock if the frontend didn't already send an explicit action
          const delta = line._originalQty - line.quantity;
          if (line.stockItemId && !line.stockDeferred && delta !== 0 && !explicitStockIds.has(line.stockItemId)) {
            const adj = await db.atomicStockAdjust(line.stockItemId, delta);
            console.log(`[BOUQUET-EDIT] Stock adjusted: ${line.flowerName} delta ${delta} (${adj.previousQty} → ${adj.newQty})`);
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
          const adj = await db.atomicStockAdjust(line.stockItemId, -line.quantity);
          console.log(`[BOUQUET-EDIT] Stock deducted: ${line.flowerName} qty -${line.quantity} (${adj.previousQty} → ${adj.newQty})`);
        } else {
          console.log(`[BOUQUET-EDIT] Stock NOT deducted for ${line.flowerName}: stockItemId=${line.stockItemId}, stockDeferred=${line.stockDeferred}`);
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

    // Cascade Order → Delivery status sync.
    // Mirrors the Delivery → Order cascade in deliveries.js.
    // Without this, marking "Delivered" from dashboard leaves the delivery record stale.
    if (newStatus && ['Out for Delivery', 'Delivered'].includes(newStatus)) {
      const deliveryId = order['Deliveries']?.[0];
      if (deliveryId) {
        const deliveryPatch = { Status: newStatus };
        if (newStatus === 'Delivered') {
          deliveryPatch['Delivered At'] = new Date().toISOString();
        }
        await db.update(TABLES.DELIVERIES, deliveryId, deliveryPatch).catch(() => {});
      }
    }

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
      const lines = await listByIds(TABLES.ORDER_LINES, lineIds);

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


// POST /api/orders/:id/convert-to-delivery — creates a delivery record when switching from Pickup to Delivery.
// Like adding a shipping label to a package that was originally set for counter pickup.
router.post('/:id/convert-to-delivery', async (req, res, next) => {
  try {
    const order = await db.getById(TABLES.ORDERS, req.params.id);

    // Check if delivery record already exists
    if (order['Deliveries']?.length > 0) {
      return res.status(400).json({ error: 'Delivery record already exists for this order.' });
    }

    const { address, recipientName, recipientPhone, date, time, fee, driver } = req.body;

    const delivery = await db.create(TABLES.DELIVERIES, {
      'Linked Order':     [req.params.id],
      'Delivery Address': address || '',
      'Recipient Name':   recipientName || '',
      'Recipient Phone':  recipientPhone || '',
      'Delivery Date':    date || order['Required By'] || null,
      'Delivery Time':    time || order['Delivery Time'] || '',
      'Assigned Driver':  driver || getDriverOfDay() || null,
      'Delivery Fee':     fee ?? getConfig('defaultDeliveryFee'),
      'Delivery Method': 'Driver',
      'Driver Payout':   getConfig('driverCostPerDelivery') || 0,
      Status:             'Pending',
    });

    // Update order to Delivery type + set delivery fee
    await db.update(TABLES.ORDERS, req.params.id, {
      'Delivery Type': 'Delivery',
      'Delivery Fee':  fee ?? getConfig('defaultDeliveryFee'),
    });

    res.status(201).json(delivery);
  } catch (err) {
    next(err);
  }
});

export default router;
