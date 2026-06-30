// backend/src/services/assistantTools/supplierPack.js
//
// Supplier tool — thin adapter over computeAnalytics.
// Never recomputes anything; supplierScorecard is always sourced from the
// same function the dashboard analytics route calls (structural parity).
import { computeAnalytics } from '../analyticsService.js';

/**
 * Return supplier spend + waste scorecard for the given period.
 * Parity with /api/analytics is structural: we call the same function.
 *
 * @param {{ from: string, to: string }} input  YYYY-MM-DD date strings
 * @returns {Promise<object>}
 */
export async function supplierScorecardHandler(input) {
  const { from, to } = input;
  const r = await computeAnalytics({ from, to });
  return {
    period:        { from: from ?? null, to: to ?? null },
    suppliers:     r.supplierScorecard,
    supplierCount: r.supplierScorecard.length,
  };
}
