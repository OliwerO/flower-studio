import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

const router = Router();
router.use(authorize('analytics'));

// GET /api/analytics?from=2025-01-01&to=2025-01-31
// Returns financial KPIs for the given period — mirrors the Blossom Audit spreadsheet.
router.get('/', async (req, res, next) => {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to date params are required.' });
    }

    const [orders, stockPurchases, stock] = await Promise.all([
      db.list(TABLES.ORDERS, {
        filterByFormula: `AND(
          IS_AFTER({Order Date}, '${from}'),
          IS_BEFORE({Order Date}, '${to}'),
          {Status} != 'Cancelled'
        )`,
      }),
      db.list(TABLES.STOCK_PURCHASES, {
        filterByFormula: `AND(
          IS_AFTER({Purchase Date}, '${from}'),
          IS_BEFORE({Purchase Date}, '${to}')
        )`,
      }),
      db.list(TABLES.STOCK, {
        filterByFormula: '{Active} = TRUE()',
        fields: ['Display Name', 'Dead/Unsold Stems', 'Current Cost Price'],
      }),
    ]);

    // Revenue metrics
    const paidOrders = orders.filter((o) => o['Payment Status'] !== 'Unpaid');
    const totalRevenue = paidOrders.reduce((sum, o) => sum + (o['Final Price'] || 0), 0);
    const deliveryRevenue = paidOrders.reduce((sum, o) => sum + (o['Delivery Fee'] || 0), 0);
    const flowerRevenue = totalRevenue - deliveryRevenue;
    const avgOrderValue = paidOrders.length ? totalRevenue / paidOrders.length : 0;

    // Cost metrics
    const totalFlowerCost = stockPurchases.reduce(
      (sum, p) => sum + (p['Total Cost'] || 0), 0
    );
    const estimatedRevenue = totalFlowerCost * 2.2; // standard markup from existing spreadsheet
    const grossMargin = totalRevenue
      ? ((totalRevenue - totalFlowerCost) / totalRevenue) * 100
      : 0;

    // Waste metrics
    const totalDeadStems = stock.reduce((sum, s) => sum + (s['Dead/Unsold Stems'] || 0), 0);
    const unrealisedRevenue = stock.reduce(
      (sum, s) => sum + (s['Dead/Unsold Stems'] || 0) * (s['Current Cost Price'] || 0),
      0
    );
    const wastePercent = totalFlowerCost
      ? (unrealisedRevenue / totalFlowerCost) * 100
      : 0;

    // Delivery metrics
    const deliveryOrders = orders.filter((o) => o['Delivery Type'] === 'Delivery');
    const pickupOrders = orders.filter((o) => o['Delivery Type'] === 'Pickup');

    // Source breakdown
    const bySource = orders.reduce((acc, o) => {
      const src = o.Source || 'Other';
      acc[src] = (acc[src] || 0) + 1;
      return acc;
    }, {});

    res.json({
      period: { from, to },
      revenue: {
        total: totalRevenue,
        flowers: flowerRevenue,
        delivery: deliveryRevenue,
        avgOrderValue,
        orderCount: orders.length,
        paidOrderCount: paidOrders.length,
      },
      costs: {
        totalFlowerCost,
        estimatedRevenueAt2_2x: estimatedRevenue,
        revenueGap: totalRevenue - estimatedRevenue,
        grossMarginPercent: grossMargin,
      },
      waste: {
        totalDeadStems,
        unrealisedRevenuePLN: unrealisedRevenue,
        wastePercent,
      },
      delivery: {
        deliveryCount: deliveryOrders.length,
        pickupCount: pickupOrders.length,
        deliveryRevenue,
      },
      orders: {
        bySource,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
