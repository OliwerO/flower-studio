/**
 * Canonical Y-model stock-row grid (CR-05).
 *
 * BatchArrivalList ("Flat table"), ShortfallSummary and PendingArrivalsPanel all
 * render their dashboard rows on THIS exact template (same column tracks + same
 * px-4 row inset) so Type, Variety and the stem-amount sit in one vertical column
 * across all three sections. The amount lands in column 3 ("Available").
 *
 * MUST stay byte-identical to BatchArrivalList's GRID_COLS tracks
 * (grid-cols-[6rem_minmax(9rem,13rem)_4.75rem_3rem_3rem_3rem_3.5rem_minmax(4rem,1fr)]).
 *
 *   Type(6rem) · Variety(≤13rem) · amount(4.75rem,right) · Cost · Sell · Markup · Arrived · Supplier
 *
 * CR-20: Variety is CAPPED at 13rem (was 1.5fr, which grew to shove the data
 * across the table) so the data columns sit close to the names; the cap is fixed
 * so every w-full row resolves it identically → columns stay vertically aligned
 * (max-content would size per-row and go ragged). Trailing Supplier (1fr) absorbs
 * the slack. CR-19: amount is 4.75rem so "· N in premade" fits one line.
 */
export const STOCK_GRID_FULL = '6rem minmax(9rem,13rem) 4.75rem 3rem 3rem 3rem 3.5rem minmax(4rem,1fr)';
