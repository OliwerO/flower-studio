import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { getDriverOfDay, getConfig, generateOrderId } from './settings.js';
import { pickAllowed } from '../utils/fields.js';
import { listByIds } from '../utils/batchQuery.js';
import { ORDER_STATUS, PAYMENT_STATUS, VALID_PAYMENT_STATUSES, DELIVERY_STATUS } from '../constants/statuses.js';
import {
  createOrder,
  transitionStatus,
  cancelWithStockReturn,
  editBouquetLines,
} from '../services/orderService.js';
import { broadcast } from '../services/notifications.js';

const router = Router();
router.use(authorize('orders'));

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
    if (excludeCancelled) filters.push(`{Status} != '${ORDER_STATUS.CANCELLED}'`);

    // "activeOnly" mode: all non-terminal orders — florist's default view.
    // Excludes Delivered, Picked Up, Cancelled. No date restriction.
    if (activeOnly) {
      filters.push(`AND({Status} != '${ORDER_STATUS.DELIVERED}', {Status} != '${ORDER_STATUS.PICKED_UP}', {Status} != '${ORDER_STATUS.CANCELLED}')`);
    } else if (completedOnly) {
      // Terminal orders only. If no date filter, show last 30 days.
      filters.push(`OR({Status} = '${ORDER_STATUS.DELIVERED}', {Status} = '${ORDER_STATUS.PICKED_UP}', {Status} = '${ORDER_STATUS.CANCELLED}')`);
      if (forDate) {
        // Apply date filter inside completedOnly mode (was previously ignored — bug fix)
        const d = sanitizeFormulaValue(forDate);
        filters.push(`OR(DATESTR({Order Date}) = '${d}', DATESTR({Required By}) = '${d}')`);
      } else if (!dateFrom) {
        // Legacy orders (imported or created before the requiredBy validation)
        // may have a blank Required By. Fall back to Order Date for the cutoff
        // so they don't silently disappear from Completed — Airtable's
        // IS_BEFORE returns empty on a blank field, and NOT(empty) is falsy,
        // which would otherwise drop every null-date row.
        const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        filters.push(
          `OR(` +
            `NOT(IS_BEFORE({Required By}, '${cutoff}')),` +
            `AND({Required By} = BLANK(), NOT(IS_BEFORE({Order Date}, '${cutoff}')))` +
          `)`
        );
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
    const linesByOrder = {};
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

      if (!order['Price Override'] && totalByOrder[order.id] !== undefined) {
        order['Sell Total'] = totalByOrder[order.id];
      }
      if (costByOrder[order.id] !== undefined) {
        order['Flowers Cost Total'] = costByOrder[order.id];
      }
      const lines = linesByOrder[order.id];
      if (lines?.length) {
        order['Bouquet Summary'] = lines.map(l => `${l.qty}× ${l.name}`).join(', ');
      }

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

      const sellTotal = order['Sell Total'] || totalByOrder[order.id] || 0;
      const delivFee = Number(order['Delivery Fee'] || 0);
      // Price Override replaces flower total only; delivery fee always added on top
      order['Final Price'] = (order['Price Override'] || sellTotal) + delivFee;
    }

    // Post-enrichment filter for "upcoming"
    if (upcoming) {
      const today = new Date().toISOString().split('T')[0];
      const result = orders.filter(o => {
        const dd = o['Delivery Date'] || o['Required By'];
        if (!dd) return true;
        return dd >= today;
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
    const order = await db.getById(TABLES.ORDERS, req.params.id);

    const lineIds = order['Order Lines'] || [];
    const custId = order.Customer?.[0];
    const deliveryId = order['Deliveries']?.[0];

    const [orderLines, customer, delivery] = await Promise.all([
      listByIds(TABLES.ORDER_LINES, lineIds),
      custId
        ? db.getById(TABLES.CUSTOMERS, custId).catch(() => null)
        : Promise.resolve(null),
      deliveryId
        ? db.getById(TABLES.DELIVERIES, deliveryId)
        : Promise.resolve(undefined),
    ]);

    order['Customer Name'] = customer?.Name || customer?.Nickname || '';
    order['Customer Phone'] = customer?.Phone || '';
    order['Customer Nickname'] = customer?.Nickname || '';
    order.orderLines = orderLines;
    if (delivery) order.delivery = delivery;

    // Compute Final Price (matches list endpoint logic) so frontend has authoritative total.
    // Price Override replaces flower total only; delivery fee always added on top.
    const lineTotal = orderLines.reduce((s, l) => s + (Number(l['Sell Price Per Unit']) || 0) * (Number(l.Quantity) || 0), 0);
    const sellTotal = order['Sell Total'] || lineTotal || 0;
    const delivFee  = order['Delivery Type'] === 'Delivery' ? Number(order['Delivery Fee'] || delivery?.['Delivery Fee'] || 0) : 0;
    order['Final Price'] = (order['Price Override'] || sellTotal) + delivFee;

    res.json(order);
  } catch (err) {
    next(err);
  }
});

// POST /api/orders — creates order + order lines + delivery atomically
router.post('/', async (req, res, next) => {
  try {
    const {
      customer, customerRequest, source, communicationMethod, deliveryType,
      orderLines = [], delivery, notes, paymentStatus, paymentMethod,
      priceOverride, requiredBy, cardText, deliveryTime,
      payment1Amount, payment1Method,
    } = req.body;

    // --- Input validation ---
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
    // Required By is mandatory — orders without a date silently disappear
    // from every default list view (sorted last in Orders, excluded from
    // Today/upcoming filters). Fail loudly here instead.
    const effectiveRequiredBy = requiredBy || delivery?.date;
    if (!effectiveRequiredBy || typeof effectiveRequiredBy !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveRequiredBy)) {
      return res.status(400).json({ error: 'requiredBy (delivery/pickup date, YYYY-MM-DD) is required.' });
    }
    if (priceOverride !== undefined && priceOverride !== null && (typeof priceOverride !== 'number' || priceOverride < 0)) {
      return res.status(400).json({ error: 'priceOverride must be a number >= 0 if provided.' });
    }
    if (paymentStatus && !VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
      return res.status(400).json({ error: `paymentStatus must be one of: ${VALID_PAYMENT_STATUSES.join(', ')}` });
    }

    // --- Delegate to service ---
    try {
      const result = await createOrder({
        customer, customerRequest, source, communicationMethod, deliveryType,
        orderLines, delivery, notes,
        paymentStatus: paymentStatus || PAYMENT_STATUS.UNPAID,
        paymentMethod, priceOverride, requiredBy, cardText, deliveryTime,
        payment1Amount, payment1Method,
        createdBy: req.role === 'owner' ? 'Owner' : 'Florist',
        isOwner: req.role === 'owner',
      }, { getConfig, getDriverOfDay, generateOrderId });

      res.status(201).json(result);
    } catch (creationErr) {
      // Validation errors (e.g. orphan lines) — surface message verbatim
      if (creationErr.statusCode === 400) {
        return res.status(400).json({ error: creationErr.message });
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
router.put('/:id/lines', async (req, res, next) => {
  try {
    const result = await editBouquetLines(
      req.params.id,
      req.body,
      req.role === 'owner',
    );
    res.json(result);
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// PATCH /api/orders/:id — update status, prices, assignment, etc.
router.patch('/:id', async (req, res, next) => {
  try {
    const safeFields = pickAllowed(req.body, ORDERS_PATCH_ALLOWED);
    const { Status: newStatus, ...otherFields } = safeFields;

    if (newStatus) {
      try {
        const order = await transitionStatus(req.params.id, newStatus, otherFields);
        return res.json(order);
      } catch (transErr) {
        if (transErr.statusCode === 400) {
          return res.status(400).json({ error: transErr.message });
        }
        throw transErr;
      }
    }

    // No status change — just update other fields
    const order = await db.update(TABLES.ORDERS, req.params.id, otherFields);

    // Cascade date/time changes to linked delivery record so both stay in sync
    const deliveryIds = order['Deliveries'] || [];
    if (deliveryIds.length > 0) {
      const deliveryCascade = {};
      if ('Required By' in otherFields) deliveryCascade['Delivery Date'] = otherFields['Required By'];
      if ('Delivery Time' in otherFields) deliveryCascade['Delivery Time'] = otherFields['Delivery Time'];
      if (Object.keys(deliveryCascade).length > 0) {
        await db.update(TABLES.DELIVERIES, deliveryIds[0], deliveryCascade);
      }
    }

    // Broadcast all other status changes so delivery app stays in sync
    if (newStatus && newStatus !== ORDER_STATUS.READY) {
      broadcast({
        type: 'order_status_changed',
        orderId: order.id,
        status: newStatus,
      });
    }

    // Cascade Order → Delivery status (mirrors the Delivery → Order cascade in deliveries.js)
    if (newStatus === ORDER_STATUS.OUT_FOR_DELIVERY || newStatus === ORDER_STATUS.DELIVERED || newStatus === ORDER_STATUS.CANCELLED) {
      const deliveryIds = order['Deliveries'] || [];
      if (deliveryIds.length > 0) {
        const deliveryFields = { Status: newStatus === ORDER_STATUS.CANCELLED ? DELIVERY_STATUS.CANCELLED : newStatus };
        if (newStatus === ORDER_STATUS.DELIVERED) deliveryFields['Delivered At'] = new Date().toISOString();
        await db.update(TABLES.DELIVERIES, deliveryIds[0], deliveryFields);
      }
    }

    res.json(order);
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/:id/cancel-with-return — cancel order AND return stock quantities.
router.post('/:id/cancel-with-return', async (req, res, next) => {
  try {
    const result = await cancelWithStockReturn(req.params.id);
    res.json(result);
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/orders/:id/convert-to-delivery — creates a delivery record when switching from Pickup to Delivery.
router.post('/:id/convert-to-delivery', async (req, res, next) => {
  try {
    const order = await db.getById(TABLES.ORDERS, req.params.id);

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
      Status:             DELIVERY_STATUS.PENDING,
    });

    await db.update(TABLES.ORDERS, req.params.id, {
      'Delivery Type': 'Delivery',
      'Delivery Fee':  fee ?? getConfig('defaultDeliveryFee'),
    });

    res.status(201).json(delivery);
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/:id/swap-bouquet-line — swap a bouquet line from one stock item to another.
// Used after PO evaluation when a substitute flower replaces an original.
// Adjusts stock on both sides: returns qty to original, deducts from substitute.
router.post('/:id/swap-bouquet-line', async (req, res, next) => {
  try {
    const { fromStockItemId, toStockItemId, lineId, newQty } = req.body;
    if (!fromStockItemId || !toStockItemId || !lineId) {
      return res.status(400).json({ error: 'fromStockItemId, toStockItemId, and lineId are required' });
    }

    const order = await db.getById(TABLES.ORDERS, req.params.id);
    if (![ORDER_STATUS.NEW, ORDER_STATUS.READY].includes(order.Status)) {
      return res.status(400).json({ error: `Cannot swap bouquet line in "${order.Status}" status` });
    }

    // Verify the line belongs to this order
    const line = await db.getById(TABLES.ORDER_LINES, lineId);
    const lineOrderId = line.Order?.[0];
    if (lineOrderId !== req.params.id) {
      return res.status(400).json({ error: 'Line does not belong to this order' });
    }

    const oldQty = Number(line.Quantity || 0);
    const qty = newQty != null ? Number(newQty) : oldQty;

    // Fetch substitute stock item for cost/sell/name
    const substituteStock = await db.getById(TABLES.STOCK, toStockItemId);

    // Return stock to original (undo the deduction)
    if (oldQty > 0) {
      await db.atomicStockAdjust(fromStockItemId, +oldQty);
    }
    // Deduct from substitute
    if (qty > 0) {
      await db.atomicStockAdjust(toStockItemId, -qty);
    }

    // Update the order line to point to the substitute
    const updated = await db.update(TABLES.ORDER_LINES, lineId, {
      'Stock Item': [toStockItemId],
      'Flower Name': substituteStock['Display Name'] || substituteStock['Purchase Name'] || '',
      'Cost Price Per Unit': substituteStock['Current Cost Price'] || 0,
      'Sell Price Per Unit': substituteStock['Current Sell Price'] || 0,
      Quantity: qty,
    });

    broadcast({ type: 'order_updated', orderId: req.params.id });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
