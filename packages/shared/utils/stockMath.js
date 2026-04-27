// Stock math — single source of truth for "how many stems are available/short".
//
// The model (locked 2026-04-22 after a long diagnosis):
//   - `Current Quantity` on a Stock record is decremented IMMEDIATELY when an
//     order is created (orderService.js → atomicStockAdjust). Every pending
//     order's demand is therefore ALREADY reflected in `Current Quantity`.
//   - `GET /api/stock/committed` returns the LIST of orders that consume each
//     stock item — purely for traceability (tap-to-expand detail). The number
//     it reports is the same demand already baked into Current Quantity.
//   - Therefore `effective = qty - committed` DOUBLE-COUNTS. Always.
//
// Previous code (pre-2026-04-22) computed `qty - committed`, which made
// Hydrangea Pink show "Effective: -4" when qty was -2 and committed was 2
// — the same order, subtracted twice. A 2026-04-16 patch tried to fix this
// with a `qty < 0 ? qty : qty - committed` branch, but that destroyed the
// legitimate cumulative-shortfall case (qty=-5, committed=3 should show -8,
// not -5). Both variants are wrong for the same reason: committed is
// redundant with qty.
//
// The correct answer is `effective = qty`. Period. `committed` is an
// informational breakdown, never a subtraction.
//
// If qty ever drifts from the true physical count, that is a data integrity
// problem (missing receipt event, silent premade deduction, manual Airtable
// edit) to be detected via reconciliation — NOT papered over by formula
// tweaks here.

/**
 * Effective stems available for new orders.
 *
 * Always returns `qty`. The `committed` parameter is accepted for backward
 * compatibility with existing call sites and is intentionally ignored — see
 * the file header for the full explanation.
 *
 * @param {number} qty        Current Quantity from the Stock record
 * @param {number} [_committed] Ignored. Kept in signature so old callers do
 *                              not silently break; do not rely on it.
 * @returns {number} effective stock (equals qty; may be negative)
 */
// eslint-disable-next-line no-unused-vars
export function getEffectiveStock(qty, _committed) {
  return Number(qty) || 0;
}

/**
 * True when the stock row is in genuine shortfall — `qty < 0`.
 * A negative Current Quantity means orders have been composed against stems
 * we don't physically have; the owner needs to buy more.
 *
 * @param {number} qty        Current Quantity from the Stock record
 * @param {number} [_committed] Ignored — see file header.
 */
// eslint-disable-next-line no-unused-vars
export function hasStockShortfall(qty, _committed) {
  return (Number(qty) || 0) < 0;
}
