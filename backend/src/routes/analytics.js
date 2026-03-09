import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';

const router = Router();
router.use(authorize('analytics'));

// GET /api/analytics?from=2025-01-01&to=2025-01-31
// Financial KPIs for the given period.
//
// Revenue formula per order:
//   Effective Price = Final Price || Price Override || (orderLineSellTotal + deliveryFee)
//   - Final Price is the Airtable formula field (usually 0 in practice)
//   - Price Override is the florist's manual total (includes delivery)
//   - Otherwise: flower sell total from order lines + delivery fee from Delivery record
//
// This ensures delivery fees are included in total revenue for non-override orders.
router.get('/', async (req, res, next) => {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to date params are required.' });
    }

    // ── Fetch orders + stock in parallel ──
    // Inclusive date boundaries: NOT(IS_BEFORE) = >=, NOT(IS_AFTER) = <=
    const safeFrom = sanitizeFormulaValue(from);
    const safeTo = sanitizeFormulaValue(to);
    const dateFilter = `AND(
      NOT(IS_BEFORE({Order Date}, '${safeFrom}')),
      NOT(IS_AFTER({Order Date}, '${safeTo}')),
      {Status} != 'Cancelled'
    )`;

    // Calculate previous period of the same length for product trend comparison
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const periodLengthMs = toDate.getTime() - fromDate.getTime();
    const prevToDate = new Date(fromDate.getTime() - 1); // day before current period starts
    const prevFromDate = new Date(prevToDate.getTime() - periodLengthMs);
    const safePrevFrom = sanitizeFormulaValue(prevFromDate.toISOString().split('T')[0]);
    const safePrevTo = sanitizeFormulaValue(prevToDate.toISOString().split('T')[0]);
    const prevDateFilter = `AND(
      NOT(IS_BEFORE({Order Date}, '${safePrevFrom}')),
      NOT(IS_AFTER({Order Date}, '${safePrevTo}')),
      {Status} != 'Cancelled'
    )`;

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
          {Status} = 'Cancelled'
        )`,
        fields: ['Order Date'],
      }).catch(() => []),
      // Stock purchases in period — for supplier scorecard
      TABLES.STOCK_PURCHASES ? db.list(TABLES.STOCK_PURCHASES, {
        filterByFormula: `AND(
          NOT(IS_BEFORE({Purchase Date}, '${safeFrom}')),
          NOT(IS_AFTER({Purchase Date}, '${safeTo}'))
        )`,
      }).catch(() => []) : Promise.resolve([]),
      // Stock losses in period — for waste breakdown
      TABLES.STOCK_LOSS_LOG ? db.list(TABLES.STOCK_LOSS_LOG, {
        filterByFormula: `AND(
          NOT(IS_BEFORE({Date}, '${safeFrom}')),
          NOT(IS_AFTER({Date}, '${safeTo}'))
        )`,
      }).catch(() => []) : Promise.resolve([]),
    ]);

    // ── Bulk-fetch order lines + deliveries in parallel ──
    // Like running two production lines simultaneously instead of sequentially.
    const allLineIds = orders.flatMap(o => o['Order Lines'] || []);
    const deliveryIds = orders.flatMap(o => o['Deliveries'] || []);
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

    // Also fetch previous period order lines for product trend comparison
    const allPrevLineIds = prevOrders.flatMap(o => o['Order Lines'] || []);

    const [allLines, deliveryRecords, prevLines] = await Promise.all([
      batchFetch(allLineIds, TABLES.ORDER_LINES, ['Order', 'Flower Name', 'Quantity', 'Sell Price Per Unit', 'Cost Price Per Unit']),
      batchFetch(deliveryIds, TABLES.DELIVERIES, ['Linked Order', 'Delivery Fee']),
      batchFetch(allPrevLineIds, TABLES.ORDER_LINES, ['Order', 'Flower Name', 'Quantity']),
    ]);

    // Per-order sell/cost totals from order lines
    const orderSellTotals = {};
    const orderCostTotals = {};
    for (const line of allLines) {
      const orderId = line.Order?.[0];
      if (!orderId) continue;
      const qty = line.Quantity || 0;
      const sell = (line['Sell Price Per Unit'] || 0) * qty;
      const cost = (line['Cost Price Per Unit'] || 0) * qty;
      orderSellTotals[orderId] = (orderSellTotals[orderId] || 0) + sell;
      orderCostTotals[orderId] = (orderCostTotals[orderId] || 0) + cost;
    }

    // Delivery fee lookup by order ID
    const deliveryFeeByOrder = {};
    for (const d of deliveryRecords) {
      const orderId = d['Linked Order']?.[0];
      if (orderId) deliveryFeeByOrder[orderId] = d['Delivery Fee'] || 0;
    }

    // ── Compute Effective Price per order ──
    // Final Price || Price Override || (flower sell total + delivery fee)
    for (const o of orders) {
      const flowerSell = orderSellTotals[o.id] || 0;
      const delFee = deliveryFeeByOrder[o.id] || 0;
      o._flowerSell = flowerSell;
      o._deliveryFee = delFee;
      o._cost = orderCostTotals[o.id] || 0;
      o['Effective Price'] = o['Final Price'] ?? o['Price Override'] ?? (flowerSell + delFee);
    }

    // ── Revenue metrics (paid orders only) ──
    const paidOrders = orders.filter(o => o['Payment Status'] !== 'Unpaid');

    const totalRevenue = paidOrders.reduce((sum, o) => sum + (o['Effective Price'] || 0), 0);

    // Flower revenue = sum of order line sell prices for paid orders
    const flowerRevenue = paidOrders.reduce((sum, o) => sum + o._flowerSell, 0);

    // Delivery revenue = sum of delivery fees for paid orders
    const deliveryRevenue = paidOrders.reduce((sum, o) => sum + o._deliveryFee, 0);

    const avgOrderValue = paidOrders.length ? totalRevenue / paidOrders.length : 0;

    // ── Cost metrics (paid orders only — match costs to the revenue they generated) ──
    const paidFlowerCost = paidOrders.reduce((sum, o) => sum + o._cost, 0);
    const allFlowerCost = orders.reduce((sum, o) => sum + o._cost, 0);
    // Use paid-order flower cost for estimated revenue — it's compared against
    // totalRevenue which only counts paid orders, so denominators must match.
    const estimatedRevenue = paidFlowerCost * 2.2;
    const flowerMargin = flowerRevenue > 0
      ? ((flowerRevenue - paidFlowerCost) / flowerRevenue) * 100
      : 0;

    // ── Waste metrics (from stock, period-independent snapshot) ──
    const totalDeadStems = stock.reduce((sum, s) => sum + (s['Dead/Unsold Stems'] || 0), 0);
    const unrealisedRevenue = stock.reduce(
      (sum, s) => sum + (s['Dead/Unsold Stems'] || 0) * (s['Current Cost Price'] || 0),
      0
    );
    const wastePercent = allFlowerCost > 0
      ? (unrealisedRevenue / allFlowerCost) * 100
      : 0;

    // ── Delivery metrics (all delivery orders for volume stats, paid for revenue) ──
    const deliveryOrders = orders.filter(o => o['Delivery Type'] === 'Delivery');
    const pickupOrders = orders.filter(o => o['Delivery Type'] === 'Pickup');
    const paidDeliveryOrders = paidOrders.filter(o => o['Delivery Type'] === 'Delivery');
    const avgDeliveryFee = paidDeliveryOrders.length
      ? paidDeliveryOrders.reduce((s, o) => s + o._deliveryFee, 0) / paidDeliveryOrders.length
      : 0;

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

    // ── Top products (paid orders only — consistent with revenue metrics) ──
    const paidOrderIds = new Set(paidOrders.map(o => o.id));
    const productMap = {};
    for (const line of allLines) {
      const orderId = line.Order?.[0];
      if (!orderId || !paidOrderIds.has(orderId)) continue;
      const name = line['Flower Name'] || 'Unknown';
      if (!productMap[name]) productMap[name] = { name, count: 0, totalQty: 0, revenue: 0, cost: 0 };
      productMap[name].count++;
      productMap[name].totalQty += line.Quantity || 0;
      productMap[name].revenue += (line['Sell Price Per Unit'] || 0) * (line.Quantity || 0);
      productMap[name].cost += (line['Cost Price Per Unit'] || 0) * (line.Quantity || 0);
    }

    // Build previous-period qty map for trend calculation
    // Only count prev-period paid order lines (match same filter as current period)
    const prevPaidOrderIds = new Set(
      prevOrders.filter(o => o['Payment Status'] !== 'Unpaid').map(o => o.id)
    );
    const prevProductQty = {};
    for (const line of prevLines) {
      const orderId = line.Order?.[0];
      if (!orderId || !prevPaidOrderIds.has(orderId)) continue;
      const name = line['Flower Name'] || 'Unknown';
      prevProductQty[name] = (prevProductQty[name] || 0) + (line.Quantity || 0);
    }

    const topProducts = Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20)
      .map(p => {
        const prevQty = prevProductQty[p.name] || 0;
        let trend = 'stable';
        if (prevQty === 0 && p.totalQty > 0) {
          trend = 'up'; // new product this period
        } else if (prevQty > 0) {
          if (p.totalQty > prevQty * 1.1) trend = 'up';
          else if (p.totalQty < prevQty * 0.9) trend = 'down';
        }
        return { ...p, prevQty, trend };
      });

    // ── Flower pairing analysis — which flowers are ordered together most often ──
    // Group lines by order, then count every pair of distinct flower names.
    const orderFlowers = {};
    for (const line of allLines) {
      const orderId = line.Order?.[0];
      if (!orderId || !paidOrderIds.has(orderId)) continue;
      const name = line['Flower Name'] || 'Unknown';
      if (!orderFlowers[orderId]) orderFlowers[orderId] = new Set();
      orderFlowers[orderId].add(name);
    }
    const pairCounts = {};
    for (const flowers of Object.values(orderFlowers)) {
      const arr = [...flowers].sort();
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const key = `${arr[i]}|||${arr[j]}`;
          pairCounts[key] = (pairCounts[key] || 0) + 1;
        }
      }
    }
    const topPairings = Object.entries(pairCounts)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => {
        const [flower1, flower2] = key.split('|||');
        return { flower1, flower2, count };
      });

    // ── Weekly rhythm — order count and avg revenue by day of week ──
    // Send dayIndex only — frontend maps to localized day names via translations.js
    const dayMap = {};
    for (let i = 0; i < 7; i++) {
      dayMap[i] = { dayIndex: i, orderCount: 0, paidOrderCount: 0, paidRevenue: 0 };
    }
    for (const o of orders) {
      if (!o['Order Date']) continue;
      const dow = new Date(o['Order Date']).getDay();
      dayMap[dow].orderCount++;
    }
    for (const o of paidOrders) {
      if (!o['Order Date']) continue;
      const dow = new Date(o['Order Date']).getDay();
      dayMap[dow].paidOrderCount++;
      dayMap[dow].paidRevenue += o['Effective Price'] || 0;
    }
    // Monday-first order for display: Mon=1, Tue=2, ..., Sat=6, Sun=0
    const weeklyRhythm = [1, 2, 3, 4, 5, 6, 0].map(i => ({
      dayIndex: i,
      orderCount: dayMap[i].orderCount,
      avgRevenue: dayMap[i].paidOrderCount > 0
        ? Math.round(dayMap[i].paidRevenue / dayMap[i].paidOrderCount)
        : 0,
    }));

    // ── Monthly breakdown for trend charts ──
    const monthlyMap = {};
    for (const o of orders) {
      const month = (o['Order Date'] || '').slice(0, 7);
      if (!month) continue;
      if (!monthlyMap[month]) monthlyMap[month] = { month, orders: [], paidOrders: [] };
      monthlyMap[month].orders.push(o);
      if (o['Payment Status'] !== 'Unpaid') monthlyMap[month].paidOrders.push(o);
    }

    const monthly = Object.values(monthlyMap)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => {
        const rev = m.paidOrders.reduce((s, o) => s + (o['Effective Price'] || 0), 0);
        const flowerRev = m.paidOrders.reduce((s, o) => s + o._flowerSell, 0);
        const delRev = m.paidOrders.reduce((s, o) => s + o._deliveryFee, 0);
        const mCost = m.paidOrders.reduce((s, o) => s + o._cost, 0);
        const margin = flowerRev > 0 ? ((flowerRev - mCost) / flowerRev) * 100 : 0;
        return {
          month: m.month,
          revenue: rev,
          flowerRevenue: flowerRev,
          deliveryRevenue: delRev,
          orderCount: m.orders.length,
          paidOrderCount: m.paidOrders.length,
          flowerCost: mCost,
          flowerMarginPercent: margin,
        };
      });

    // ── Customer metrics ──
    const customerIds = [...new Set(orders.map(o => o.Customer?.[0]).filter(Boolean))];
    let customers = { newCount: 0, returningCount: 0, segments: {}, topSpenders: [] };

    if (customerIds.length > 0) {
      const custRecords = [];
      const batchSize = 100;
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
        if (!cid) continue;
        spendByCustomer[cid] = (spendByCustomer[cid] || 0) + (o['Effective Price'] || 0);
      }

      const periodOrderIds = new Set(orders.map(o => o.id));
      for (const c of custRecords) {
        const allCustOrders = c['App Orders'] || [];
        const hasOlderOrders = allCustOrders.some(oid => !periodOrderIds.has(oid));
        if (hasOlderOrders) {
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

    // ── Source Efficiency ──
    const sourceEfficiency = {};
    for (const o of orders) {
      const src = o.Source || 'Other';
      if (!sourceEfficiency[src]) sourceEfficiency[src] = { source: src, orderCount: 0, revenue: 0, flowerCost: 0 };
      sourceEfficiency[src].orderCount++;
    }
    for (const o of paidOrders) {
      const src = o.Source || 'Other';
      if (!sourceEfficiency[src]) sourceEfficiency[src] = { source: src, orderCount: 0, revenue: 0, flowerCost: 0 };
      sourceEfficiency[src].revenue += o['Effective Price'] || 0;
      sourceEfficiency[src].flowerCost += o._cost || 0;
    }
    const sourceEffArr = Object.values(sourceEfficiency).map(s => ({
      ...s,
      avgOrderValue: s.orderCount > 0 ? Math.round(s.revenue / s.orderCount) : 0,
      marginPercent: s.revenue > 0 ? Math.round(((s.revenue - s.flowerCost) / s.revenue) * 100) : 0,
    })).sort((a, b) => b.revenue - a.revenue);

    // ── Payment Method Analysis ──
    const paymentMap = {};
    for (const o of orders) {
      const method = o['Payment Method'] || 'Not recorded';
      if (!paymentMap[method]) paymentMap[method] = { method, count: 0, paidCount: 0, revenue: 0, unpaidCount: 0, unpaidAmount: 0 };
      paymentMap[method].count++;
      if (o['Payment Status'] !== 'Unpaid') {
        paymentMap[method].paidCount++;
        paymentMap[method].revenue += o['Effective Price'] || 0;
      } else {
        paymentMap[method].unpaidCount++;
        paymentMap[method].unpaidAmount += o['Effective Price'] || 0;
      }
    }
    const paymentAnalysis = Object.values(paymentMap).sort((a, b) => b.count - a.count);

    // ── Completion Funnel ──
    const totalCreated = orders.length + cancelledOrders.length;
    const completedOrders = orders.filter(o => o.Status === 'Delivered' || o.Status === 'Picked Up').length;
    const funnel = {
      totalCreated,
      completed: completedOrders,
      cancelled: cancelledOrders.length,
      completionRate: totalCreated > 0 ? Math.round((completedOrders / totalCreated) * 100) : 0,
      cancellationRate: totalCreated > 0 ? Math.round((cancelledOrders.length / totalCreated) * 100) : 0,
    };

    // ── Inventory Turnover ──
    const currentStockValue = stock.reduce(
      (sum, s) => sum + (Math.max(0, s['Current Quantity'] || 0) * (s['Current Cost Price'] || 0)), 0
    );
    const periodDays = Math.max(1, (toDate.getTime() - fromDate.getTime()) / 86400000);
    const annualizedCost = allFlowerCost * (365 / periodDays);
    const inventoryTurnoverRatio = currentStockValue > 0 ? annualizedCost / currentStockValue : 0;

    // ── Prep time analysis — how long from Accepted to Ready ──
    // Only orders that have both timestamps (i.e., went through the full prep workflow).
    const prepTimes = orders
      .filter(o => o['Prep Started At'] && o['Prep Ready At'])
      .map(o => {
        const started = new Date(o['Prep Started At']).getTime();
        const ready = new Date(o['Prep Ready At']).getTime();
        const minutes = Math.round((ready - started) / 60000);
        return minutes > 0 && minutes < 1440 ? minutes : null; // ignore outliers >24h
      })
      .filter(Boolean);

    const prepTimeStats = prepTimes.length > 0 ? {
      count: prepTimes.length,
      avgMinutes: Math.round(prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length),
      medianMinutes: prepTimes.sort((a, b) => a - b)[Math.floor(prepTimes.length / 2)],
      minMinutes: Math.min(...prepTimes),
      maxMinutes: Math.max(...prepTimes),
    } : null;

    // ── Supplier scorecard — aggregate stock purchases by supplier ──
    const supplierMap = {};
    for (const p of stockPurchases) {
      const name = p.Supplier || 'Unknown';
      if (!supplierMap[name]) supplierMap[name] = { supplier: name, totalSpend: 0, purchaseCount: 0, totalQty: 0 };
      supplierMap[name].totalSpend += (p['Price Per Unit'] || 0) * (p['Quantity Purchased'] || 0);
      supplierMap[name].purchaseCount++;
      supplierMap[name].totalQty += p['Quantity Purchased'] || 0;
    }
    const supplierScorecard = Object.values(supplierMap)
      .map(s => ({
        ...s,
        avgPricePerUnit: s.totalQty > 0 ? Math.round((s.totalSpend / s.totalQty) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);

    // ── Stock loss breakdown by reason ──
    const lossReasonMap = {};
    let totalLossQty = 0;
    for (const l of stockLosses) {
      const reason = l.Reason || 'Other';
      lossReasonMap[reason] = (lossReasonMap[reason] || 0) + (l.Quantity || 0);
      totalLossQty += l.Quantity || 0;
    }
    const stockLossBreakdown = Object.entries(lossReasonMap)
      .map(([reason, qty]) => ({ reason, qty, percent: totalLossQty > 0 ? Math.round((qty / totalLossQty) * 100) : 0 }))
      .sort((a, b) => b.qty - a.qty);

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
        totalFlowerCost: paidFlowerCost,
        allFlowerCost,
        estimatedRevenueAt2_2x: estimatedRevenue,
        revenueGap: totalRevenue - estimatedRevenue,
        flowerMarginPercent: flowerMargin,
        marginLabel: 'Flower Margin',
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
        avgDeliveryFee,
      },
      orders: {
        bySource,
        revenueBySource,
        topProducts,
        topPairings,
        sourceEfficiency: sourceEffArr,
        funnel,
      },
      monthly,
      weeklyRhythm,
      customers,
      paymentAnalysis,
      inventoryTurnover: {
        turnsPerYear: Math.round(inventoryTurnoverRatio * 10) / 10,
        currentStockValue: Math.round(currentStockValue),
        annualizedCost: Math.round(annualizedCost),
      },
      prepTime: prepTimeStats,
      supplierScorecard,
      stockLossBreakdown: { byReason: stockLossBreakdown, totalQty: totalLossQty },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
