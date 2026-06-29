// backend/src/services/assistantTools/trendsPack.js
//
// Trends tool — thin adapter over computeAnalytics.
// Surfaces seasonality (monthly), day-of-week rhythm, order completion funnel,
// and payment/debt breakdown.  Never recomputes anything.
import { computeAnalytics } from '../analyticsService.js';

// JS getDay() semantics: 0=Sunday, 1=Monday, ..., 6=Saturday.
// computeAnalytics returns weeklyRhythm in [Mon..Sun] display order but the
// dayIndex values themselves are still the raw getDay() values — so this map
// must follow the same JS convention.
const DAY_NAME = [
  'Sunday',    // 0
  'Monday',    // 1
  'Tuesday',   // 2
  'Wednesday', // 3
  'Thursday',  // 4
  'Friday',    // 5
  'Saturday',  // 6
];

/**
 * Return seasonality + day-of-week rhythm + completion funnel + payment breakdown.
 * Parity with /api/analytics is structural: we call the same computeAnalytics().
 *
 * @param {{ from: string, to: string }} input  YYYY-MM-DD date strings
 * @returns {Promise<object>}
 */
export async function salesTrendsHandler(input) {
  const { from, to } = input;
  const r = await computeAnalytics({ from, to });

  return {
    period: { from: from ?? null, to: to ?? null },
    // Monthly seasonality — gross flowerRevenue/deliveryRevenue/flowerCost and the
    // gross-based flowerMarginPercent are intentionally dropped here: they don't
    // reconcile with the NET top-level revenue.flowers / costs.flowerMarginPercent,
    // so surfacing them next to net figures would mislead. Keep only net revenue +
    // counts for the trend line; use financial_summary for margin.
    monthly: r.monthly.map(m => ({
      month: m.month,
      revenue: m.revenue,
      orderCount: m.orderCount,
      paidOrderCount: m.paidOrderCount,
    })),
    // Day-of-week rhythm with human-readable day name.
    weeklyRhythm: r.weeklyRhythm.map(d => ({
      day: DAY_NAME[d.dayIndex],
      dayIndex: d.dayIndex,
      orderCount: d.orderCount,
      avgRevenue: d.avgRevenue,
    })),
    // Order completion funnel (created / completed / cancelled / rates).
    funnel: r.orders.funnel,
    // Payment method breakdown (method / count / paidCount / revenue / unpaidCount / unpaidAmount).
    paymentAnalysis: r.paymentAnalysis,
  };
}
