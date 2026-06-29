// Analytics computation functions — extracted from routes/analytics.js.
// Pure math helper functions below take pre-fetched data and return computed metrics.
// The `computeAnalytics` export is the DB-backed full-report function (loads data,
// then runs those helpers) — called by both the /api/analytics route and the
// assistant finance tool so their numbers always match.

import { ORDER_STATUS, PAYMENT_STATUS } from '../constants/statuses.js';
import * as orderRepo from '../repos/orderRepo.js';
import * as stockRepo from '../repos/stockRepo.js';
import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';
import * as stockLossRepo from '../repos/stockLossRepo.js';
import * as customerRepo from '../repos/customerRepo.js';
import { db as pgDb } from '../db/index.js';
import { orders as ordersTable } from '../db/schema.js';
import { inArray, isNull, and as pgAnd, lt } from 'drizzle-orm';
import { getConfig } from './configService.js';

/**
 * Compute the full analytics report for a date range.
 * This is the canonical implementation shared by the /api/analytics route
 * and the assistant financial_summary tool.
 *
 * @param {{ from: string, to: string }} params  YYYY-MM-DD date strings
 * @returns {Promise<object>} The full analytics payload
 */
export async function computeAnalytics({ from, to }) {
  if (!from || !to) throw new Error('computeAnalytics requires both from and to dates (YYYY-MM-DD)');
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

  // ── Assemble and return payload ──
  return {
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
  };
}

/**
 * Compute Effective Price and attach cost/revenue fields to each order.
 * Mutates orders in place.
 */
export function enrichOrderPrices(orders, orderSellTotals, orderCostTotals, deliveryFeeByOrder) {
  for (const o of orders) {
    const flowerSell = orderSellTotals[o.id] || 0;
    const delFee = deliveryFeeByOrder[o.id] || 0;
    o._flowerSell = flowerSell;
    o._deliveryFee = delFee;
    o._cost = orderCostTotals[o.id] || 0;
    // Price Override replaces flower total only; delivery fee always added on top
    o['Effective Price'] = o['Final Price'] ?? ((o['Price Override'] || flowerSell) + delFee);
  }
}

/**
 * Revenue, cost, and margin metrics from paid orders.
 */
export function calculateRevenueMetrics(orders, paidOrders, targetMarkup) {
  const totalRevenue = paidOrders.reduce((sum, o) => sum + (o['Effective Price'] || 0), 0);
  const flowerRevenue = paidOrders.reduce((sum, o) => sum + o._flowerSell, 0);
  const deliveryRevenue = paidOrders.reduce((sum, o) => sum + o._deliveryFee, 0);
  const avgOrderValue = paidOrders.length ? totalRevenue / paidOrders.length : 0;

  const paidFlowerCost = paidOrders.reduce((sum, o) => sum + o._cost, 0);
  const allFlowerCost = orders.reduce((sum, o) => sum + o._cost, 0);
  const estimatedRevenue = paidFlowerCost * targetMarkup;
  const flowerMargin = flowerRevenue > 0
    ? ((flowerRevenue - paidFlowerCost) / flowerRevenue) * 100
    : 0;

  return {
    totalRevenue, flowerRevenue, deliveryRevenue, avgOrderValue,
    paidFlowerCost, allFlowerCost, estimatedRevenue, flowerMargin,
  };
}

/**
 * Waste metrics from current stock snapshot.
 */
export function calculateWasteMetrics(stock, allFlowerCost) {
  const totalDeadStems = stock.reduce((sum, s) => sum + (s['Dead/Unsold Stems'] || 0), 0);
  const unrealisedRevenue = stock.reduce(
    (sum, s) => sum + (s['Dead/Unsold Stems'] || 0) * (s['Current Cost Price'] || 0), 0
  );
  const wastePercent = allFlowerCost > 0 ? (unrealisedRevenue / allFlowerCost) * 100 : 0;
  return { totalDeadStems, unrealisedRevenue, wastePercent };
}

/**
 * Top products ranked by revenue with trend vs. previous period.
 */
export function rankTopProducts(allLines, paidOrderIds, prevLines, prevPaidOrderIds) {
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

  const prevProductQty = {};
  for (const line of prevLines) {
    const orderId = line.Order?.[0];
    if (!orderId || !prevPaidOrderIds.has(orderId)) continue;
    const name = line['Flower Name'] || 'Unknown';
    prevProductQty[name] = (prevProductQty[name] || 0) + (line.Quantity || 0);
  }

  return Object.values(productMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 20)
    .map(p => {
      const prevQty = prevProductQty[p.name] || 0;
      let trend = 'stable';
      if (prevQty === 0 && p.totalQty > 0) trend = 'up';
      else if (prevQty > 0) {
        if (p.totalQty > prevQty * 1.1) trend = 'up';
        else if (p.totalQty < prevQty * 0.9) trend = 'down';
      }
      return { ...p, prevQty, trend };
    });
}

/**
 * Flower pairing analysis — co-occurrence counting.
 */
export function analyzeFlowerPairings(allLines, paidOrderIds) {
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

  return Object.entries(pairCounts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const [flower1, flower2] = key.split('|||');
      return { flower1, flower2, count };
    });
}

/**
 * Weekly rhythm — order count and avg revenue by day-of-week (Required By).
 */
export function calculateWeeklyRhythm(orders, paidOrders) {
  const dayMap = {};
  for (let i = 0; i < 7; i++) {
    dayMap[i] = { dayIndex: i, orderCount: 0, paidOrderCount: 0, paidRevenue: 0 };
  }
  for (const o of orders) {
    if (!o['Required By']) continue;
    dayMap[new Date(o['Required By']).getDay()].orderCount++;
  }
  for (const o of paidOrders) {
    if (!o['Required By']) continue;
    const dow = new Date(o['Required By']).getDay();
    dayMap[dow].paidOrderCount++;
    dayMap[dow].paidRevenue += o['Effective Price'] || 0;
  }
  return [1, 2, 3, 4, 5, 6, 0].map(i => ({
    dayIndex: i,
    orderCount: dayMap[i].orderCount,
    avgRevenue: dayMap[i].paidOrderCount > 0
      ? Math.round(dayMap[i].paidRevenue / dayMap[i].paidOrderCount)
      : 0,
  }));
}

/**
 * Monthly breakdown for trend charts.
 */
export function calculateMonthlyBreakdown(orders) {
  const monthlyMap = {};
  for (const o of orders) {
    const month = (o['Order Date'] || '').slice(0, 7);
    if (!month) continue;
    if (!monthlyMap[month]) monthlyMap[month] = { month, orders: [], paidOrders: [] };
    monthlyMap[month].orders.push(o);
    if (o['Payment Status'] !== PAYMENT_STATUS.UNPAID) monthlyMap[month].paidOrders.push(o);
  }

  return Object.values(monthlyMap)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(m => {
      const rev = m.paidOrders.reduce((s, o) => s + (o['Effective Price'] || 0), 0);
      const flowerRev = m.paidOrders.reduce((s, o) => s + o._flowerSell, 0);
      const delRev = m.paidOrders.reduce((s, o) => s + o._deliveryFee, 0);
      const mCost = m.paidOrders.reduce((s, o) => s + o._cost, 0);
      const margin = flowerRev > 0 ? ((flowerRev - mCost) / flowerRev) * 100 : 0;
      return {
        month: m.month,
        revenue: rev, flowerRevenue: flowerRev, deliveryRevenue: delRev,
        orderCount: m.orders.length, paidOrderCount: m.paidOrders.length,
        flowerCost: mCost, flowerMarginPercent: margin,
      };
    });
}

/**
 * Completion funnel — created vs completed vs cancelled.
 */
export function calculateCompletionFunnel(orders, cancelledOrders) {
  const totalCreated = orders.length + cancelledOrders.length;
  const completed = orders.filter(o =>
    o.Status === ORDER_STATUS.DELIVERED || o.Status === ORDER_STATUS.PICKED_UP
  ).length;
  return {
    totalCreated,
    completed,
    cancelled: cancelledOrders.length,
    completionRate: totalCreated > 0 ? Math.round((completed / totalCreated) * 100) : 0,
    cancellationRate: totalCreated > 0 ? Math.round((cancelledOrders.length / totalCreated) * 100) : 0,
  };
}

/**
 * Source efficiency — per-source order count, revenue, margin.
 */
export function analyzeSourceEfficiency(orders, paidOrders) {
  const map = {};
  for (const o of orders) {
    const src = o.Source || 'Other';
    if (!map[src]) map[src] = { source: src, orderCount: 0, revenue: 0, flowerCost: 0 };
    map[src].orderCount++;
  }
  for (const o of paidOrders) {
    const src = o.Source || 'Other';
    if (!map[src]) map[src] = { source: src, orderCount: 0, revenue: 0, flowerCost: 0 };
    map[src].revenue += o['Effective Price'] || 0;
    map[src].flowerCost += o._cost || 0;
  }
  return Object.values(map).map(s => ({
    ...s,
    avgOrderValue: s.orderCount > 0 ? Math.round(s.revenue / s.orderCount) : 0,
    marginPercent: s.revenue > 0 ? Math.round(((s.revenue - s.flowerCost) / s.revenue) * 100) : 0,
  })).sort((a, b) => b.revenue - a.revenue);
}

/**
 * Payment method analysis.
 */
export function analyzePaymentMethods(orders) {
  const map = {};
  for (const o of orders) {
    const method = o['Payment Method'] || 'Not recorded';
    if (!map[method]) map[method] = { method, count: 0, paidCount: 0, revenue: 0, unpaidCount: 0, unpaidAmount: 0 };
    map[method].count++;
    if (o['Payment Status'] !== PAYMENT_STATUS.UNPAID) {
      map[method].paidCount++;
      map[method].revenue += o['Effective Price'] || 0;
    } else {
      map[method].unpaidCount++;
      map[method].unpaidAmount += o['Effective Price'] || 0;
    }
  }
  return Object.values(map).sort((a, b) => b.count - a.count);
}

/**
 * Prep time statistics (Accepted → Ready duration).
 */
export function calculatePrepTimeStats(orders) {
  const prepTimes = orders
    .filter(o => o['Prep Started At'] && o['Prep Ready At'])
    .map(o => {
      const started = new Date(o['Prep Started At']).getTime();
      const ready = new Date(o['Prep Ready At']).getTime();
      const minutes = Math.round((ready - started) / 60000);
      return minutes > 0 && minutes < 1440 ? minutes : null;
    })
    .filter(Boolean);

  if (prepTimes.length === 0) return null;

  return {
    count: prepTimes.length,
    avgMinutes: Math.round(prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length),
    medianMinutes: prepTimes.sort((a, b) => a - b)[Math.floor(prepTimes.length / 2)],
    minMinutes: Math.min(...prepTimes),
    maxMinutes: Math.max(...prepTimes),
  };
}

/**
 * Inventory turnover ratio (annualized).
 */
export function calculateInventoryTurnover(stock, allFlowerCost, periodDays) {
  const currentStockValue = stock.reduce(
    (sum, s) => sum + (Math.max(0, s['Current Quantity'] || 0) * (s['Current Cost Price'] || 0)), 0
  );
  const annualizedCost = allFlowerCost * (365 / Math.max(1, periodDays));
  const turnsPerYear = currentStockValue > 0 ? annualizedCost / currentStockValue : 0;
  return {
    turnsPerYear: Math.round(turnsPerYear * 10) / 10,
    currentStockValue: Math.round(currentStockValue),
    annualizedCost: Math.round(annualizedCost),
  };
}

/**
 * Supplier scorecard from stock purchases, merged with waste data.
 */
export function buildSupplierScorecard(stockPurchases, stockLosses, lossStockItems) {
  const supplierMap = {};
  for (const p of stockPurchases) {
    const name = p.Supplier || 'Unknown';
    if (!supplierMap[name]) supplierMap[name] = { supplier: name, totalSpend: 0, purchaseCount: 0, totalQty: 0 };
    supplierMap[name].totalSpend += (p['Price Per Unit'] || 0) * (p['Quantity Purchased'] || 0);
    supplierMap[name].purchaseCount++;
    supplierMap[name].totalQty += p['Quantity Purchased'] || 0;
  }

  const scorecard = Object.values(supplierMap).map(s => ({
    ...s,
    avgPricePerUnit: s.totalQty > 0 ? Math.round((s.totalSpend / s.totalQty) * 100) / 100 : 0,
  })).sort((a, b) => b.totalSpend - a.totalSpend);

  // Build waste-by-supplier from loss records
  const lossStockMap = {};
  for (const s of lossStockItems) lossStockMap[s.id] = s;

  const wasteBySupplier = {};
  for (const l of stockLosses) {
    const stockId = l['Stock Item']?.[0];
    const supplier = lossStockMap[stockId]?.Supplier || 'Unknown';
    if (!wasteBySupplier[supplier]) wasteBySupplier[supplier] = { supplier, wasteQty: 0 };
    wasteBySupplier[supplier].wasteQty += l.Quantity || 0;
  }

  // Merge waste into scorecard
  for (const s of scorecard) {
    const waste = wasteBySupplier[s.supplier];
    s.wasteQty = waste?.wasteQty || 0;
    s.wasteCost = Math.round(s.wasteQty * s.avgPricePerUnit);
    s.wastePercent = s.totalQty > 0 ? Math.min(100, Math.round((s.wasteQty / s.totalQty) * 100)) : 0;
  }

  // Add suppliers only in waste
  for (const [sup, data] of Object.entries(wasteBySupplier)) {
    if (!scorecard.find(s => s.supplier === sup)) {
      scorecard.push({ supplier: sup, totalSpend: 0, purchaseCount: 0, totalQty: 0, avgPricePerUnit: 0, wasteCost: 0, wastePercent: 0, ...data });
    }
  }

  return scorecard;
}

/**
 * Stock loss breakdown by reason.
 */
export function breakdownStockLosses(stockLosses) {
  const reasonMap = {};
  let totalQty = 0;
  for (const l of stockLosses) {
    const reason = l.Reason || 'Other';
    reasonMap[reason] = (reasonMap[reason] || 0) + (l.Quantity || 0);
    totalQty += l.Quantity || 0;
  }
  const byReason = Object.entries(reasonMap)
    .map(([reason, qty]) => ({ reason, qty, percent: totalQty > 0 ? Math.round((qty / totalQty) * 100) : 0 }))
    .sort((a, b) => b.qty - a.qty);
  return { byReason, totalQty };
}
