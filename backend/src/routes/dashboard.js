import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

const router = Router();
router.use(authorize('dashboard'));

// GET /api/dashboard — day-to-day operational summary for today
router.get('/', async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [orders, deliveries, lowStock] = await Promise.all([
      // Today's orders
      db.list(TABLES.ORDERS, {
        filterByFormula: `{Order Date} = '${today}'`,
        sort: [{ field: 'Order Date', direction: 'desc' }],
      }),
      // Today's pending deliveries
      db.list(TABLES.DELIVERIES, {
        filterByFormula: `AND({Delivery Date} = '${today}', {Status} != 'Delivered')`,
      }),
      // Stock items below reorder threshold
      db.list(TABLES.STOCK, {
        filterByFormula: `AND({Active} = TRUE(), {Current Quantity} < {Reorder Threshold})`,
        sort: [{ field: 'Current Quantity', direction: 'asc' }],
      }),
    ]);

    // Order count by status
    const statusCounts = orders.reduce((acc, o) => {
      acc[o.Status] = (acc[o.Status] || 0) + 1;
      return acc;
    }, {});

    // Today's revenue from paid orders
    const todayRevenue = orders
      .filter((o) => o['Payment Status'] === 'Paid')
      .reduce((sum, o) => sum + (o['Final Price'] || 0), 0);

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
