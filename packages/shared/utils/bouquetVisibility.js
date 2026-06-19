// Single source of truth for whether an order's bouquet-composition section
// should render — shared by every order-detail surface (florist OrderCard /
// OrderDetailPage / BouquetEditor, dashboard OrderDetailPanel) so the four
// parallel sites can never drift.
//
// Show the section when the order still has lines, OR when the bouquet is
// editable (status not terminal, or the viewer is the owner). The editable
// case is what lets an *emptied* order keep its "Edit bouquet" entry point —
// without it, removing every flower stranded the order with no way to add any
// back (root CLAUDE.md Known Pitfall #4: a feature gate excluding a valid use
// case). The dashboard is owner-only and edits orders in every status, so it
// passes isOwner: true and the section always renders there.
export function shouldShowBouquetSection({ hasLines, isTerminal, isOwner } = {}) {
  return Boolean(hasLines) || !isTerminal || Boolean(isOwner);
}
