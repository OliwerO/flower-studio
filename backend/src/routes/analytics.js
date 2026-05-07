import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import * as stockLossRepo from '../repos/stockLossRepo.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { getConfig } from './settings.js';
import { ORDER_STATUS, PAYMENT_STATUS } from '../constants/statuses.js';
import {
  enrichOrderPrices, calculateRevenueMetrics, calculateWasteMetrics,
  rankTopProducts, analyzeFlowerPairings, calculateWeeklyRhythm,
  calculateMonthlyBreakdown, calculateCompletionFunnel,
  analyzeSourceEfficiency, analyzePaymentMethods,
  calculatePrepTimeStats, calculateInventoryTurnover,
  buildSupplierScorecard, breakdownStockLosses,
} from '../services/analyticsService.js';

const router = Router();
router.use(authorize('analytics'));

// GET /api/analytics?from=2025-01-01&to=2025-01-31
// Financial KPIs for the given period.
router.get('/', async (req, res, next) => {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to date params are required.' });
    }

    // ── Build date filters ──
    const safeFrom = sanitizeFormulaValue(from);
    const safeTo = sanitizeFormulaValue(to);
    const dateFilter = `AND(
      NOT(IS_BEFORE({Order Date}, '${safeFrom}')),
      NOT(IS_AFTER({Order Date}, '${safeTo}')),
      {Status} != '${ORDER_STATUS.CANCELLED}'
    )`;

    const fromDate = new Date(from);
    const toDate = new Date(to);
    const periodLengthMs = toDate.getTime() - fromDate.getTime();
    const prevToDate = new Date(fromDate.getTime() - 1);
    const prevFromDate = new Date(prevToDate.getTime() - periodLengthMs);
    const safePrevFrom = sanitizeFormulaValue(prevFromDate.toISOString().split('T')[0]);
    const safePrevTo = sanitizeFormulaValue(prevToDate.toISOString().split('T')[0]);
    const prevDateFilter = `AND(
      NOT(IS_BEFORE({Order Date}, '${safePrevFrom}')),
      NOT(IS_AFTER({Order Date}, '${safePrevTo}')),
      {Status} != '${ORDER_STATUS.CANCELLED}'
    )`;

    // ── Fetch all data in parallel ──
    const [orders, stock, prevOrders, cancelledOrders, stockPurchases, stockLosses] = await Promise.all([
      db.list(TABLES.ORDERS, { filterByFormula: dateFilter }),
      db.list(TABLES.STOCK, {
        filterByFormula: '{Active} = TRUE()',
        fields: ['Display Name', 'Dead/Unsold Stems', 'Current Cost Price', 'Current Sell Price', 'Current Quantity'],
      }),
      db.list(TABLES.ORDERS, {
        filterByFormula: prevDateFilter,
        fields: ['Order Lines', 'Payment Status'],
      }),
      db.list(TABLES.ORDERS, {
        filterByFormula: `AND(
          NOT(IS_BEFORE({Order Date}, '${safeFrom}')),
          NOT(IS_AFTER({Order Date}, '${safeTo}')),
          {Status} = '${ORDER_STATUS.CANCELLED}'
        )`,
        fields: ['Order Date'],
      }).catch(() => []),
      TABLES.STOCK_PURCHASES ? db.list(TABLES.STOCK_PURCHASES, {
        filterByFormula: `AND(
          NOT(IS_BEFORE({Purchase Date}, '${safeFrom}')),
          NOT(IS_AFTER({Purchase Date}, '${safeTo}'))
        )`,
      }).catch(() => []) : Promise.resolve([]),
      stockLossRepo.list({ from, to }).catch(() => []),
    ]);

    // ── Batch-fetch order lines + deliveries ──
    const allLineIds = orders.flatMap(o => o['Order Lines'] || []);
    const deliveryIds = orders.flatMap(o => o['Deliveries'] || []);
    const allPrevLineIds = prevOrders.flatMap(o => o['Order Lines'] || []);
    const batchSize = 100;

    function batchFetch(ids, table, fields) {
      if (ids.length === 0) return Promise.resolve([]);
      const promises = [];
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        promises.push(
          db.list(table, {
            filterByFormula: `OR(${batch.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields,
            maxRecords: batchSize,
          })
        );
      }
      return Promise.all(promises).then(results => results.flat());
    }

    const [allLines, deliveryRecords, prevLines] = await Promise.all([
      batchFetch(allLineIds, TABLES.ORDER_LINES, ['Order', 'Flower Name', 'Quantity', 'Sell Price Per Unit', 'Cost Price Per Unit']),
      batchFetch(deliveryIds, TABLES.DELIVERIES, ['Linked Order', 'Delivery Fee']),
      batchFetch(allPrevLineIds, TABLES.ORDER_LINES, ['Order', 'Flower Name', 'Quantity']),
    ]);

    // ── Build lookup maps ──
    const orderSellTotals = {};
    const orderCostTotals = {};
    for (const line of allLines) {
      const orderId = line.Order?.[0];
      if (!orderId) continue;
      const qty = line.Quantity || 0;
      orderSellTotals[orderId] = (orderSellTotals[orderId] || 0) + (line['Sell Price Per Unit'] || 0) * qty;
      orderCostTotals[orderId] = (orderCostTotals[orderId] || 0) + (line['Cost Price Per Unit'] || 0) * qty;
    }
    const deliveryFeeByOrder = {};
    for (const d of deliveryRecords) {
      const orderId = d['Linked Order']?.[0];
      if (orderId) deliveryFeeByOrder[orderId] = d['Delivery Fee'] || 0;
    }

    // ── Compute all metrics via service functions ──
    enrichOrderPrices(orders, orderSellTotals, orderCostTotals, deliveryFeeByOrder);

    const paidOrders = orders.filter(o => o['Payment Status'] !== PAYMENT_STATUS.UNPAID);
    const paidOrderIds = new Set(paidOrders.map(o => o.id));
    const prevPaidOrderIds = new Set(
      prevOrders.filter(o => o['Payment Status'] !== PAYMENT_STATUS.UNPAID).map(o => o.id)
    );
    const periodDays = (toDate.getTime() - fromDate.getTime()) / 86400000;

    const revenue = calculateRevenueMetrics(orders, paidOrders, getConfig('targetMarkup'));
    const waste = calculateWasteMetrics(stock, revenue.allFlowerCost);
    const topProducts = rankTopProducts(allLines, paidOrderIds, prevLines, prevPaidOrderIds);
    const topPairings = analyzeFlowerPairings(allLines, paidOrderIds);
    const weeklyRhythm = calculateWeeklyRhythm(orders, paidOrders);
    const monthly = calculateMonthlyBreakdown(orders);
    const funnel = calculateCompletionFunnel(orders, cancelledOrders);
    const sourceEfficiency = analyzeSourceEfficiency(orders, paidOrders);
    const paymentAnalysis = analyzePaymentMethods(orders);
    const prepTime = calculatePrepTimeStats(orders);
    const inventoryTurnover = calculateInventoryTurnover(stock, revenue.allFlowerCost, periodDays);
    const stockLossBreakdown = breakdownStockLosses(stockLosses);

    // Supplier scorecard — stockLossRepo.list() already enriches each row with
    // supplier and flowerName via LEFT JOIN, so no extra Airtable fetch needed.
    // Build a synthetic lossStockItems list from the enriched loss records so
    // buildSupplierScorecard can still do its id → supplier lookup.
    const lossStockItems = stockLosses
      .filter(l => l['Stock Item']?.[0])
      .map(l => ({ id: l['Stock Item'][0], Supplier: l.supplier || '', 'Display Name': l.flowerName || '' }));
    const supplierScorecard = buildSupplierScorecard(stockPurchases, stockLosses, lossStockItems);

    // ── Source breakdown (simple aggregation, kept inline) ──
    const bySource = {};
    const revenueBySource = {};
    for (const o of orders) {
      const src = o.Source || 'Other';
      bySource[src] = (bySource[src] || 0) + 1;
    }
    for (const o of paidOrders) {
      const src = o.Source || 'Other';
      revenueBySource[src] = (revenueBySource[src] || 0) + (o['Effective Price'] || 0);
    }

    // ── Delivery metrics ──
    const deliveryOrders = orders.filter(o => o['Delivery Type'] === 'Delivery');
    const pickupOrders = orders.filter(o => o['Delivery Type'] === 'Pickup');
    const paidDeliveryOrders = paidOrders.filter(o => o['Delivery Type'] === 'Delivery');
    const avgDeliveryFee = paidDeliveryOrders.length
      ? paidDeliveryOrders.reduce((s, o) => s + o._deliveryFee, 0) / paidDeliveryOrders.length
      : 0;

    // ── Customer metrics ──
    const customerIds = [...new Set(orders.map(o => o.Customer?.[0]).filter(Boolean))];
    const customers = { newCount: 0, returningCount: 0, segments: {}, topSpenders: [] };

    if (customerIds.length > 0) {
      const custRecords = [];
      for (let i = 0; i < customerIds.length; i += batchSize) {
        const batch = customerIds.slice(i, i + batchSize);
        const recs = await db.list(TABLES.CUSTOMERS, {
          filterByFormula: `OR(${batch.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
          maxRecords: batchSize,
        });
        custRecords.push(...recs);
      }

      const spendByCustomer = {};
      for (const o of paidOrders) {
        const cid = o.Customer?.[0];
        if (cid) spendByCustomer[cid] = (spendByCustomer[cid] || 0) + (o['Effective Price'] || 0);
      }

      const periodOrderIds = new Set(orders.map(o => o.id));
      for (const c of custRecords) {
        const allCustOrders = c['App Orders'] || [];
        if (allCustOrders.some(oid => !periodOrderIds.has(oid))) {
          customers.returningCount++;
        } else {
          customers.newCount++;
        }
      }

      const segments = {};
      for (const c of custRecords) {
        const seg = c.Segment || 'Unassigned';
        segments[seg] = (segments[seg] || 0) + 1;
      }
      customers.segments = segments;

      customers.topSpenders = custRecords
        .map(c => ({
          id: c.id,
          name: c.Name || c.Nickname || '—',
          spend: spendByCustomer[c.id] || 0,
          segment: c.Segment || null,
        }))
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 10);
    }

    // ── Assemble response ──
    res.json({
      period: { from, to },
      revenue: {
        total: revenue.totalRevenue,
        flowers: revenue.flowerRevenue,
        delivery: revenue.deliveryRevenue,
        avgOrderValue: revenue.avgOrderValue,
        orderCount: orders.length,
        paidOrderCount: paidOrders.length,
      },
      costs: {
        totalFlowerCost: revenue.paidFlowerCost,
        allFlowerCost: revenue.allFlowerCost,
        estimatedRevenueAt2_2x: revenue.estimatedRevenue,
        revenueGap: revenue.totalRevenue - revenue.estimatedRevenue,
        flowerMarginPercent: revenue.flowerMargin,
        marginLabel: 'Flower Margin',
      },
      waste: {
        totalDeadStems: waste.totalDeadStems,
        unrealisedRevenuePLN: waste.unrealisedRevenue,
        wastePercent: waste.wastePercent,
      },
      delivery: {
        deliveryCount: deliveryOrders.length,
        pickupCount: pickupOrders.length,
        deliveryRevenue: revenue.deliveryRevenue,
        avgDeliveryFee,
      },
      orders: {
        bySource,
        revenueBySource,
        topProducts,
        topPairings,
        sourceEfficiency,
        funnel,
      },
      monthly,
      weeklyRhythm,
      customers,
      paymentAnalysis,
      inventoryTurnover,
      prepTime,
      supplierScorecard,
      stockLossBreakdown,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
