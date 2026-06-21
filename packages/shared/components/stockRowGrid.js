/**
 * Canonical Y-model stock-row grid (CR-05).
 *
 * BatchArrivalList ("Flat table"), ShortfallSummary and PendingArrivalsPanel all
 * render their dashboard rows on THIS exact template (same column tracks + same
 * px-4 row inset) so Type, Variety and the stem-amount sit in one vertical column
 * across all three sections. The amount lands in column 3 ("Available").
 *
 * MUST stay byte-identical to BatchArrivalList's GRID_COLS tracks
 * (grid-cols-[6rem_minmax(9rem,1.5fr)_3.5rem_3rem_3rem_3rem_3.5rem_minmax(4rem,1fr)]).
 *
 *   Type(6rem) · Variety(flex) · amount(3.5rem,right) · Cost · Sell · Markup · Arrived · Supplier
 */
export const STOCK_GRID_FULL = '6rem minmax(9rem,1.5fr) 3.5rem 3rem 3rem 3rem 3.5rem minmax(4rem,1fr)';
