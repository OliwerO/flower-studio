import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

const router = Router();
router.use(authorize('orders'));

// GET /api/orders?status=New&dateFrom=2025-01-01&dateTo=2025-01-31&source=Instagram
router.get('/', async (req, res, next) => {
  try {
    const { status, dateFrom, dateTo, source, deliveryType, paymentStatus } = req.query;
    const filters = [];

    if (status)        filters.push(`{Status} = '${status}'`);
    if (source)        filters.push(`{Source} = '${source}'`);
    if (deliveryType)  filters.push(`{Delivery Type} = '${deliveryType}'`);
    if (paymentStatus) filters.push(`{Payment Status} = '${paymentStatus}'`);
    if (dateFrom)      filters.push(`IS_AFTER({Order Date}, '${dateFrom}')`);
    if (dateTo)        filters.push(`IS_BEFORE({Order Date}, '${dateTo}')`);

    const filterByFormula = filters.length
      ? `AND(${filters.join(', ')})`
      : '';

    const orders = await db.list(TABLES.ORDERS, {
      filterByFormula,
      sort: [{ field: 'Order Date', direction: 'desc' }],
      maxRecords: 200,
    });

    res.json(orders);
  } catch (err) {
    next(err);
  }
});

// GET /api/orders/:id — includes linked order lines
router.get('/:id', async (req, res, next) => {
  try {
    const order = await db.getById(TABLES.ORDERS, req.params.id);

    // Fetch linked order lines if any exist
    if (order['Order Lines']?.length) {
      const lineIds = order['Order Lines'];
      const lines = await Promise.all(
        lineIds.map((id) => db.getById(TABLES.ORDER_LINES, id))
      );
      order.orderLines = lines;
    } else {
      order.orderLines = [];
    }

    // Fetch linked delivery if exists
    if (order['Assigned Delivery']?.length) {
      order.delivery = await db.getById(
        TABLES.DELIVERIES,
        order['Assigned Delivery'][0]
      );
    }

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
      'Notes Original': notes || '',
      'Payment Status': paymentStatus || 'Unpaid',
      'Payment Method': paymentMethod || null,
      'Price Override': priceOverride || null,
      Status:           'New',
      'Created By':     req.role === 'owner' ? 'Owner' : 'Florist',
    });

    // 2. Create order line records (one per flower) — prices are snapshotted here
    const createdLines = [];
    for (const line of orderLines) {
      const created = await db.create(TABLES.ORDER_LINES, {
        Order:                  [order.id],
        'Stock Item':           line.stockItemId ? [line.stockItemId] : [],
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
        'Delivery Date':     delivery.date || null,
        'Delivery Time':     delivery.time || '',
        'Greeting Card Text': delivery.cardText || '',
        'Assigned Driver':   delivery.driver || null,
        'Delivery Fee':      delivery.fee || 35,
        Status:              'Pending',
      });

      // Link delivery back to order
      await db.update(TABLES.ORDERS, order.id, {
        'Assigned Delivery': [createdDelivery.id],
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

// PATCH /api/orders/:id — update status, prices, assignment, etc.
router.patch('/:id', async (req, res, next) => {
  try {
    const order = await db.update(TABLES.ORDERS, req.params.id, req.body);
    res.json(order);
  } catch (err) {
    next(err);
  }
});

export default router;
