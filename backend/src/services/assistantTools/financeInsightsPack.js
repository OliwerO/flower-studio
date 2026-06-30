// backend/src/services/assistantTools/financeInsightsPack.js
//
// Finance-insights tool pack — thin adapters over computeAnalytics.
// Never recomputes anything; the full report is always the source of truth.
// Parity with /api/analytics is structural: same function, same numbers.
import { computeAnalytics } from '../analyticsService.js';

/**
 * Return the top-selling products for a period.
 * Delegates entirely to computeAnalytics → orders.topProducts.
 *
 * @param {{ from: string, to: string, limit?: number }} input
 * @returns {Promise<object>}
 */
export async function topProductsHandler({ from, to, limit }) {
  const r = await computeAnalytics({ from, to });
  const cap = limit || 10;
  const sliced = r.orders.topProducts.slice(0, cap).map(p => ({
    name:      p.name,
    totalQty:  p.totalQty,
    revenue:   p.revenue,
    cost:      p.cost,
    trend:     p.trend,
  }));
  return {
    period:  { from: from ?? null, to: to ?? null },
    products: sliced,
    shown:   sliced.length,
    total:   r.orders.topProducts.length,
  };
}

/**
 * Return order-source efficiency metrics for a period.
 * Pure pass-through of computeAnalytics → orders.sourceEfficiency.
 *
 * @param {{ from: string, to: string }} input
 * @returns {Promise<object>}
 */
export async function channelEfficiencyHandler({ from, to }) {
  const r = await computeAnalytics({ from, to });
  return {
    period:   { from: from ?? null, to: to ?? null },
    channels: r.orders.sourceEfficiency,
  };
}

/**
 * Compare two date periods side-by-side.
 * Calls computeAnalytics twice — once per period — and returns delta metrics.
 *
 * @param {{ from1: string, to1: string, from2: string, to2: string, label1?: string, label2?: string }} input
 * @returns {Promise<object>}
 */
export async function comparePeriodsHandler({ from1, to1, from2, to2, label1, label2 }) {
  const [report1, report2] = await Promise.all([
    computeAnalytics({ from: from1, to: to1 }),
    computeAnalytics({ from: from2, to: to2 }),
  ]);

  function deltaMoney(p1, p2) {
    const d = Math.round((p2 - p1) * 100) / 100;
    const pct = p1 !== 0 ? Math.round(((p2 - p1) / p1) * 1000) / 10 : null;
    return { p1: Math.round(p1 * 100) / 100, p2: Math.round(p2 * 100) / 100, delta: d, pctChange: pct };
  }

  function deltaNum(p1, p2) {
    const d = p2 - p1;
    const pct = p1 !== 0 ? Math.round(((p2 - p1) / p1) * 1000) / 10 : null;
    return { p1, p2, delta: d, pctChange: pct };
  }

  return {
    period1: { from: from1, to: to1, label: label1 || null },
    period2: { from: from2, to: to2, label: label2 || null },
    metrics: {
      revenue:            deltaMoney(report1.revenue.total,          report2.revenue.total),
      orderCount:         deltaNum(  report1.revenue.orderCount,     report2.revenue.orderCount),
      avgOrderValue:      deltaMoney(report1.revenue.avgOrderValue,   report2.revenue.avgOrderValue),
      flowerMarginPercent: deltaNum( report1.costs.flowerMarginPercent, report2.costs.flowerMarginPercent),
    },
  };
}
