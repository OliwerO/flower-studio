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
 * Aggregates per-row stock data into the four Variety-level buckets defined by
 * ADR-0005 (Stock Y-model) and PRD #283.
 *
 * Bucket definitions (ADR-0005):
 *   onHand            — sum of positive current_quantity rows (Batches: physical stems on shelf)
 *   planned           — absolute sum of negative current_quantity rows (Demand Entries: shortage to fill)
 *   reservedForPremades — stems committed to premade bouquets (read from premade_bouquet_lines at
 *                         query time, passed in as a Map<rowId, count>)
 *   net               — onHand − planned − reservedForPremades (effective availability)
 *   reclaimable       — min(reservedForPremades, max(0, planned − onHand))
 *                       "how many premade stems could be dissolved to cover the shortfall"
 *
 * Pitfall #8 history (two prior failure modes encoded as regression tests):
 *   v1 (pre-2026-04-22): `qty - committed` double-counted demand already baked into qty.
 *       Fix: ignore `committed` entirely — it is an informational breakdown, not a subtraction.
 *       This helper only reads `current_quantity`; any `committed` field on a row is silently ignored.
 *   v2 (2026-04-22 interim): `qty < 0 ? qty : qty - committed` hid cumulative shortfall.
 *       Fix: the positive/negative split here uses raw `current_quantity` with no committed involvement.
 *
 * Per-row `getEffectiveStock(qty)` is unchanged — it always returns qty directly. This helper
 * is the ONLY site that subtracts reservedForPremades, and it does so exactly once at the
 * Variety-summary level (not per-row), so there is no double-count.
 *
 * References: PRD #283, ADR-0005 (dated Demand Entries), ADR-0006 (Variety identity), pitfall #8.
 *
 * @param {Array<{id: string, current_quantity: number}>} rows
 *   All stock rows for a single Variety (Batches with positive qty + Demand Entries with negative qty).
 * @param {Map<string, number>} [reservations=new Map()]
 *   Map from row id → reserved stem count for premade bouquets (from premade_bouquet_lines JOIN).
 * @returns {{ onHand: number, planned: number, reservedForPremades: number, net: number, reclaimable: number }}
 */
export function getVarietyTotals(rows, reservations = new Map()) {
  let onHand = 0;
  let planned = 0;
  let reservedForPremades = 0;

  for (const row of rows) {
    const qty = Number(row.current_quantity) || 0;
    if (qty >= 0) {
      onHand += qty;
    } else {
      planned += -qty; // store as positive magnitude
    }
    reservedForPremades += Number(reservations.get(row.id)) || 0;
  }

  const net = onHand - planned - reservedForPremades;
  // reclaimable: how many premade-reserved stems could be freed without leaving orders short.
  // When onHand already covers planned demand (no shortfall), ALL reserved stems are reclaimable.
  // When there is a shortfall (planned > onHand), dissolving premades helps up to the shortfall amount,
  // so reclaimable = min(reserved, planned − onHand).
  const onHandShortfall = Math.max(0, planned - onHand);
  const reclaimable = onHandShortfall === 0
    ? reservedForPremades
    : Math.min(reservedForPremades, onHandShortfall);

  return { onHand, planned, reservedForPremades, net, reclaimable };
}

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
