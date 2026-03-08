import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

const router = Router();
router.use(authorize('orders'));

// GET /api/orders?status=New&dateFrom=2025-01-01&dateTo=2025-01-31&source=Instagram
router.get('/', async (req, res, next) => {
  try {
    const { status, dateFrom, dateTo, source, deliveryType, paymentStatus, excludeCancelled } = req.query;
    const filters = [];

    if (status)           filters.push(`{Status} = '${status}'`);
    // "Other" in analytics means Source is blank/empty — match records with no Source set.
    if (source === 'Other') filters.push(`OR({Source} = 'Other', {Source} = BLANK())`);
    else if (source)        filters.push(`{Source} = '${source}'`);
    if (deliveryType)     filters.push(`{Delivery Type} = '${deliveryType}'`);
    if (paymentStatus)    filters.push(`{Payment Status} = '${paymentStatus}'`);
    if (excludeCancelled) filters.push(`{Status} != 'Cancelled'`);
    if (dateFrom)         filters.push(`NOT(IS_BEFORE({Order Date}, '${dateFrom}'))`);
    if (dateTo)           filters.push(`NOT(IS_AFTER({Order Date}, '${dateTo}'))`);

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
            fields: ['Order', 'Sell Price Per Unit', 'Quantity'],
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

    // Sum order line totals by order ID
    const totalByOrder = {};
    for (const line of allLines) {
      const oid = line.Order?.[0];
      if (oid) {
        totalByOrder[oid] = (totalByOrder[oid] || 0)
          + Number(line['Sell Price Per Unit'] || 0) * Number(line['Quantity'] || 0);
      }
    }

    // Enrich orders — zero additional API calls
    for (const order of orders) {
      const custId = order.Customer?.[0];
      order['Customer Name'] = customerMap[custId]?.Name || customerMap[custId]?.Nickname || '';

      if (!order['Price Override'] && totalByOrder[order.id] != null) {
        order['Sell Total'] = totalByOrder[order.id];
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
    } = req.body;

    // 1. Create the parent order record
    const order = await db.create(TABLES.ORDERS, {
      Customer:         [customer],
      'Customer Request': customerRequest,
      Source:           source,
      'Delivery Type':  deliveryType,
      'Order Date':     new Date().toISOString().split('T')[0],
      'Required By':    requiredBy || null,
      'Notes Original':     notes || '',
      'Greeting Card Text': delivery?.cardText || '',
      'Payment Status':     paymentStatus || 'Unpaid',
      'Payment Method':     paymentMethod || null,
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

      // 3. Decrement stock quantity for each flower used
      if (line.stockItemId) {
        const stockItem = await db.getById(TABLES.STOCK, line.stockItemId);
        const newQty = (stockItem['Current Quantity'] || 0) - line.quantity;
        await db.update(TABLES.STOCK, line.stockItemId, {
          'Current Quantity': newQty,
        });
      }
    }

    // 4. Create delivery record if delivery type
    let createdDelivery = null;
    if (deliveryType === 'Delivery' && delivery) {
      createdDelivery = await db.create(TABLES.DELIVERIES, {
        'Linked Order':      [order.id],
        'Delivery Address':  delivery.address || '',
        'Recipient Name':    delivery.recipientName || '',
        'Recipient Phone':   delivery.recipientPhone || '',
        'Delivery Date':   delivery.date || null,
        'Delivery Time':   delivery.time || '',
        'Assigned Driver': delivery.driver || null,
        'Delivery Fee':      delivery.fee || 35,
        Status:              'Pending',
      });

    }

    res.status(201).json({
      order,
      orderLines: createdLines,
      delivery: createdDelivery,
    });
  } catch (err) {
    next(err);
  }
});

// Allowed status transitions — like a production routing sheet.
// Simplified: removed "In Progress" as a required step — unnecessary click
// without value added. Orders flow: New → Ready → Delivered/Picked Up.
// "In Progress" kept as legacy exit only (for orders already in that state).
const ALLOWED_TRANSITIONS = {
  'New':         ['Ready', 'Cancelled'],
  'In Progress': ['Ready', 'Cancelled'],   // legacy — still allow exit
  'Ready':       ['Delivered', 'Picked Up', 'Cancelled'],
  'Delivered':   [],          // terminal — no changes
  'Picked Up':   [],          // terminal — no changes
  'Cancelled':   ['New'],     // allow un-cancel (reopen) back to New
};

// PATCH /api/orders/:id — update status, prices, assignment, etc.
router.patch('/:id', async (req, res, next) => {
  try {
    const { Status: newStatus, ...otherFields } = req.body;

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

      // Stock rollback on cancellation — return flowers to inventory
      if (newStatus === 'Cancelled' && currentStatus !== 'Cancelled') {
        const lineIds = current['Order Lines'] || [];
        for (const lineId of lineIds) {
          try {
            const line = await db.getById(TABLES.ORDER_LINES, lineId);
            const stockItemIds = line['Stock Item'];
            if (stockItemIds?.length && line.Quantity) {
              const stockItem = await db.getById(TABLES.STOCK, stockItemIds[0]);
              await db.update(TABLES.STOCK, stockItemIds[0], {
                'Current Quantity': (stockItem['Current Quantity'] || 0) + line.Quantity,
              });
            }
          } catch { /* line or stock item may have been deleted — skip */ }
        }
      }
    }

    const order = await db.update(TABLES.ORDERS, req.params.id, {
      ...otherFields,
      ...(newStatus ? { Status: newStatus } : {}),
    });
    res.json(order);
  } catch (err) {
    next(err);
  }
});

export default router;
