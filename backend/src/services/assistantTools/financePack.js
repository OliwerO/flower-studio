// backend/src/services/assistantTools/financePack.js
//
// Finance tool — thin adapter over computeAnalytics.
// Never recomputes anything; the full report is always the source of truth.
import { computeAnalytics } from '../analyticsService.js';

/**
 * Return a focused finance subset from the full analytics report.
 * Parity with /api/analytics is structural: we call the same function.
 *
 * @param {{ from: string, to: string }} input  YYYY-MM-DD date strings
 * @returns {Promise<object>}
 */
export async function financialSummaryHandler(input) {
  const { from, to } = input;
  const report = await computeAnalytics({ from, to });
  // Thin adapter: surface a focused subset; never recompute.
  return {
    period: report.period,
    revenue: report.revenue,                          // { total, flowers, delivery, avgOrderValue, orderCount, paidOrderCount }
    delivery: report.delivery,                        // { deliveryCount, pickupCount, deliveryRevenue, avgDeliveryFee }
    revenueBySource: report.orders.revenueBySource,
    flowerMarginPercent: report.costs.flowerMarginPercent,
  };
}
