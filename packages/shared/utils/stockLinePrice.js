// Decide cost/sell per unit when a flower is added to a bouquet line.
//
// A flower with no physical stock on hand (Current Quantity <= 0) that is
// arriving via a pending Stock Order must price off that PO's sell — NOT the
// Stock Item's Current Sell Price. The card price reflects the LAST RECEIVED
// order and stays stale until the new PO is evaluated, so the owner who just
// priced the flower at 60 in a fresh PO would otherwise see the previous 65 in
// the bouquet (#377). Once physical stems are on hand, the card price wins —
// that's the price those real stems were received at.
//
// pendingEntry is one value from the /stock/pending-po map:
//   { ordered, plannedDate, pos: [...], sell, cost, flowerName }
export function resolveStockLinePrice(stockItem, pendingEntry) {
  const cardCost = Number(stockItem?.['Current Cost Price']) || 0;
  const cardSell = Number(stockItem?.['Current Sell Price']) || 0;
  const physQty  = Number(stockItem?.['Current Quantity']) || 0;
  const poSell   = Number(pendingEntry?.sell) || 0;
  const poCost   = Number(pendingEntry?.cost) || 0;

  if (physQty <= 0 && poSell > 0) {
    return {
      costPricePerUnit: poCost > 0 ? poCost : cardCost,
      sellPricePerUnit: poSell,
    };
  }
  return { costPricePerUnit: cardCost, sellPricePerUnit: cardSell };
}
