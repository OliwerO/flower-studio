import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as orderRepo from '../repos/orderRepo.js';
import * as stockRepo from '../repos/stockRepo.js';
import * as stockLossRepo from '../repos/stockLossRepo.js';
import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';
import * as customerRepo from '../repos/customerRepo.js';
import { db as pgDb } from '../db/index.js';
import { orders as ordersTable } from '../db/schema.js';
import { inArray, isNull, and as pgAnd, lt } from 'drizzle-orm';
import { getConfig } from '../services/configService.js';
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

    const fromDate = new Date(from);
    const toDate = new Date(to);
    const periodLengthMs = toDate.getTime() - fromDate.getTime();
    const prevToDate = new Date(fromDate.getTime() - 1);
    const prevFromDate = new Date(prevToDate.getTime() - periodLengthMs);
    const prevFromStr = prevFromDate.toISOString().split('T')[0];
    const prevToStr   = prevToDate.toISOString().split('T')[0];

    // ── Fetch all data in parallel ──
    const [orders, stock, prevOrders, cancelledOrders, stockPurchases, stockLosses] = await Promise.all([
      orderRepo.list({ pg: { dateFrom: from, dateTo: to, excludeStatuses: [ORDER_STATUS.CANCELLED] } }),
      stockRepo.list({ pg: { active: true } }),
      orderRepo.list({ pg: { dateFrom: prevFromStr, dateTo: prevToStr, excludeStatuses: [ORDER_STATUS.CANCELLED] } }),
      orderRepo.list({ pg: { dateFrom: from, dateTo: to, statuses: [ORDER_STATUS.CANCELLED] } }),
      stockPurchasesRepo.list({ from, to }).catch(() => []),
      stockLossRepo.list({ from, to }).catch(() => []),
    ]);

    // orderRepo.list() embeds _lines and _delivery — no separate batch fetch needed.
    const allLines  = orders.flatMap(o => o._lines || []);
    const prevLines = prevOrders.flatMap(o => o._lines || []);

    // ── Build lookup maps ──
    const orderSellTotals    = {};
    const orderCostTotals    = {};
    const deliveryFeeByOrder = {};

    for (const order of orders) {
      for (const line of (order._lines || [])) {
        const qty = line.Quantity || 0;
        orderSellTotals[order.id] = (orderSellTotals[order.id] || 0) + (line['Sell Price Per Unit'] || 0) * qty;
        orderCostTotals[order.id] = (orderCostTotals[order.id] || 0) + (line['Cost Price Per Unit'] || 0) * qty;
      }
      if (order._delivery?.['Delivery Fee']) {
        deliveryFeeByOrder[order.id] = order._delivery['Delivery Fee'];
      }
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
    // supplier and flowerName via LEFT JOIN, so no extra fetch needed.
    const lossStockItems = stockLosses
      .filter(l => l['Stock Item']?.[0])
      .map(l => ({ id: l['Stock Item'][0], Supplier: l.supplier || '', 'Display Name': l.flowerName || '' }));
    const supplierScorecard = buildSupplierScorecard(stockPurchases, stockLosses, lossStockItems);

    // ── Source breakdown ──
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
      // Fetch all customers, index by both PG uuid and Airtable recXXX
      const allCusts = await customerRepo.list({ withAggregates: false });
      const custById = new Map(allCusts.map(c => [c.id, c]));
      for (const c of allCusts) {
        if (c.airtableId) custById.set(c.airtableId, c);
      }
      const custRecords = customerIds.map(id => custById.get(id)).filter(Boolean);

      // Customers with any order before this period are "returning"
      const priorRows = await pgDb.select({ customerId: ordersTable.customerId })
        .from(ordersTable)
        .where(pgAnd(
          inArray(ordersTable.customerId, customerIds),
          lt(ordersTable.orderDate, from),
          isNull(ordersTable.deletedAt),
        ));
      const returningCustIds = new Set(priorRows.map(r => r.customerId));

      for (const c of custRecords) {
        if (returningCustIds.has(c.id) || returningCustIds.has(c.airtableId)) {
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

      const spendByCustomer = {};
      for (const o of paidOrders) {
        const cid = o.Customer?.[0];
        if (cid) spendByCustomer[cid] = (spendByCustomer[cid] || 0) + (o['Effective Price'] || 0);
      }

      customers.topSpenders = custRecords
        .map(c => ({
          id: c.id,
          name: c.Name || c.Nickname || '—',
          spend: spendByCustomer[c.id] || spendByCustomer[c.airtableId] || 0,
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
