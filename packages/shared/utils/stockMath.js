// Stock math — the single source of truth for how Current Quantity and
// Committed combine. Exists because the two numbers measure overlapping
// events and naive subtraction produces a double-count bug (see
// "Known Pitfalls" in root CLAUDE.md, entry #7).
//
// Background:
//   - Current Quantity on a Stock record is decremented IMMEDIATELY when an
//     order is created (in orderService.js via atomicStockAdjust). So if
//     stock was 0 and an order for 2 stems comes in, Current Quantity = -2.
//   - GET /api/stock/committed sums all non-terminal future-dated order
//     lines grouped by Stock Item — it does NOT care whether those lines
//     have already been deducted. It's a raw demand signal.
//   - These two are therefore in OVERLAPPING measurement frames. If you do
//     `qty - committed` when qty is already negative, you count the same
//     order twice (−2 − 2 = −4 when the true shortfall is just −2).
//
// Rule used below (matches the 2026-04-16 dashboard fix, commit 9e7b470):
//   - qty >= 0: `committed` represents real pending deductions; subtract.
//               Result is "what's still available after pending orders".
//   - qty <  0: the negative ALREADY reflects all current deductions; the
//               committed number is redundant for this flower. Return qty.
//
// If you ever need "future shortfall beyond current negatives", that is a
// different calculation and should NOT be derived via subtraction here.

/**
 * Compute effective stock after accounting for committed (pending) orders.
 * Do NOT inline `qty - committed` anywhere — always call this helper.
 *
 * @param {number} qty        Current Quantity from the Stock record
 * @param {number} committed  Sum of pending-order demand for this stock item
 * @returns {number} effective stock (may be negative if orders exceed supply)
 */
export function getEffectiveStock(qty, committed) {
  const q = Number(qty) || 0;
  const c = Math.max(0, Number(committed) || 0);
  if (q >= 0) return q - c;
  return q;
}

/**
 * True when there IS a shortfall the owner needs to act on.
 * - committed > 0 AND effective < 0 → someone's waiting on stems we don't have
 * - qty < 0                         → we're already short (negative = IOU)
 */
export function hasStockShortfall(qty, committed) {
  const q = Number(qty) || 0;
  const c = Math.max(0, Number(committed) || 0);
  if (q < 0) return true;
  return c > 0 && q - c < 0;
}
