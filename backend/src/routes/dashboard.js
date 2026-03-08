import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

const router = Router();
router.use(authorize('dashboard'));

// GET /api/dashboard — day-to-day operational summary for today
router.get('/', async (req, res, next) => {
  try {
    // Accept optional ?date= param, default to today
    const today = req.query.date || new Date().toISOString().split('T')[0];

    const [orders, deliveries, lowStock] = await Promise.all([
      // Today's orders
      db.list(TABLES.ORDERS, {
        filterByFormula: `DATESTR({Order Date}) = '${today}'`,
        sort: [{ field: 'Order Date', direction: 'desc' }],
      }),
      // Today's pending deliveries
      db.list(TABLES.DELIVERIES, {
        filterByFormula: `AND(DATESTR({Delivery Date}) = '${today}', {Status} != 'Delivered')`,
      }),
      // Stock items below reorder threshold
      db.list(TABLES.STOCK, {
        filterByFormula: `AND({Active} = TRUE(), {Current Quantity} < {Reorder Threshold})`,
        sort: [{ field: 'Current Quantity', direction: 'asc' }],
      }),
    ]);

    // Enrich orders with customer names + computed prices
    // (same bulk-fetch pattern as orders route)
    const uniqueCustomerIds = [...new Set(orders.flatMap(o => o.Customer || []))];
    const allLineIds = orders.flatMap(o => o['Order Lines'] || []);

    const [allCustomers, allLines] = await Promise.all([
      uniqueCustomerIds.length > 0
        ? db.list(TABLES.CUSTOMERS, {
            filterByFormula: `OR(${uniqueCustomerIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Name', 'Nickname'],
          })
        : [],
      allLineIds.length > 0
        ? db.list(TABLES.ORDER_LINES, {
            filterByFormula: `OR(${allLineIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Order', 'Sell Price Per Unit', 'Quantity'],
            maxRecords: 1000,
          })
        : [],
    ]);

    const customerMap = {};
    for (const c of allCustomers) customerMap[c.id] = c;

    // Sum order line sell totals by order ID
    const totalByOrder = {};
    for (const line of allLines) {
      const oid = line.Order?.[0];
      if (oid) {
        totalByOrder[oid] = (totalByOrder[oid] || 0)
          + Number(line['Sell Price Per Unit'] || 0) * Number(line['Quantity'] || 0);
      }
    }

    for (const order of orders) {
      const custId = order.Customer?.[0];
      order['Customer Name'] = customerMap[custId]?.Name || customerMap[custId]?.Nickname || '';

      // Compute effective price (Final Price is an Airtable formula that may not return)
      if (!order['Price Override'] && totalByOrder[order.id] != null) {
        order['Sell Total'] = totalByOrder[order.id];
      }
      order['Effective Price'] = order['Final Price'] || order['Price Override'] || order['Sell Total'] || 0;
    }

    // Order count by status
    const statusCounts = orders.reduce((acc, o) => {
      acc[o.Status] = (acc[o.Status] || 0) + 1;
      return acc;
    }, {});

    // Today's revenue from paid orders (using computed effective price)
    const todayRevenue = orders
      .filter((o) => o['Payment Status'] === 'Paid')
      .reduce((sum, o) => sum + (o['Effective Price'] || 0), 0);

    // Enrich pending deliveries with customer name (who ordered)
    // by following the chain: Delivery → Order → Customer.
    // We already have orders loaded, so we only need the link hop.
    const orderIdSet = new Set(orders.map(o => o.id));
    const orderMapForDeliveries = {};
    for (const o of orders) orderMapForDeliveries[o.id] = o;

    // Some pending deliveries may link to orders from other dates — fetch those too
    const missingOrderIds = deliveries
      .flatMap(d => d['Linked Order'] || [])
      .filter(id => !orderIdSet.has(id));

    if (missingOrderIds.length > 0) {
      const extraOrders = await db.list(TABLES.ORDERS, {
        filterByFormula: `OR(${missingOrderIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
        fields: ['Customer'],
      });
      const extraCustIds = [...new Set(extraOrders.flatMap(o => o.Customer || []))];
      const extraCusts = extraCustIds.length > 0
        ? await db.list(TABLES.CUSTOMERS, {
            filterByFormula: `OR(${extraCustIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Name', 'Nickname'],
          })
        : [];
      for (const c of extraCusts) customerMap[c.id] = c;
      for (const o of extraOrders) orderMapForDeliveries[o.id] = o;
    }

    for (const d of deliveries) {
      const orderId = d['Linked Order']?.[0];
      const order = orderMapForDeliveries[orderId];
      const custId = order?.Customer?.[0];
      const cust = customerMap[custId];
      if (cust) {
        d['Customer Name'] = cust.Name || cust.Nickname || '';
      }
    }

    res.json({
      date: today,
      orderCount: orders.length,
      statusCounts,
      todayRevenue,
      pendingDeliveries: deliveries,
      lowStockAlerts: lowStock,
      recentOrders: orders.slice(0, 10),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
