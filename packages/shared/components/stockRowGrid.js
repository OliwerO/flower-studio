/**
 * Shared stock-row column grid (CR-05).
 *
 * The two summary cards (ShortfallSummary, PendingArrivalsPanel) accept an
 * optional `gridCols` prop so the dashboard can align their Type / Variety /
 * amount columns with the BatchArrivalList "Flat table".
 *
 * The first three non-marker tokens MUST stay in lock-step with BatchArrivalList's
 * GRID_COLS prefix (6rem | minmax(9rem,1.5fr) | 3.5rem), so amounts land in the
 * same vertical column across all three sections.
 *
 * Dashboard shape — 5 tokens:
 *   1.25rem  marker  (ShortfallSummary's ▸ chevron; PendingArrivalsPanel leaves blank)
 *   6rem     Type    (dedicated column — matches BatchArrivalList col 1)
 *   minmax(9rem,1.5fr)  Variety / rest-of-identity (matches col 2)
 *   3.5rem   amount  (right-aligned — matches col 3 "Available")
 *   1fr      filler  (where BatchArrivalList's Cost/Sell/Markup/… live — empty in cards)
 *
 * Mobile shape — 3 tokens:
 *   1.25rem  marker    (aligns the two mobile cards' Type-edge)
 *   1fr      identity  (Type + Colour + Size + Cultivar in one cell)
 *   auto     amount    (right-edge)
 */
export const STOCK_CARD_GRID_DASHBOARD = '1.25rem 6rem minmax(9rem,1.5fr) 3.5rem 1fr';
export const STOCK_CARD_GRID_MOBILE    = '1.25rem 1fr auto';
