// Single source of truth for the "+ Add new (create demand)" gate in every
// bouquet flower picker (florist OrderCard / OrderDetailPage / BouquetEditor /
// steps/Step2Bouquet, dashboard OrderDetailPanel / order/BouquetSection /
// steps/Step2Bouquet). Typing a flower name shows the "create demand with
// price" affordance UNLESS an exact-name Stock Item is already available —
// either physically on the shelf (Current Quantity > 0) or arriving via a
// pending PO (on-order > 0). An available match should be quick-added at its
// existing card/PO price, not spawn a second, competing demand entry for the
// same variety.

// True when a single Stock Item is available to quick-add: physically in
// stock, or covered by a pending PO. Exported so single-item call sites
// (a pre-resolved match, or a grouped-Variety row's availability check) share
// the same rule as the list-scanning `hasAvailableStockMatch` below.
export function isStockItemAvailable(stockItem, pendingPO = {}) {
  if (!stockItem) return false;
  const qty = Number(stockItem['Current Quantity']) || 0;
  const onOrder = pendingPO?.[stockItem.id]?.ordered || 0;
  return qty > 0 || onOrder > 0;
}

// True when `stockItems` contains an exact case-insensitive Display Name
// match for `query` that is also available (see isStockItemAvailable).
export function hasAvailableStockMatch(stockItems, query, pendingPO = {}) {
  const needle = (query || '').toLowerCase();
  if (!needle) return false;
  return (stockItems || []).some(s =>
    (s['Display Name'] || '').toLowerCase() === needle && isStockItemAvailable(s, pendingPO)
  );
}
