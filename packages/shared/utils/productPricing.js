// packages/shared/utils/productPricing.js

// Suggested storefront price for a mono (single-flower) bouquet variant:
// min stems × the key flower's current sell price. Returns null when the
// suggestion can't be computed (mix product, no min stems, or no resolvable
// key-flower stock item). Shared by the dashboard Products tab and the
// florist BouquetsPage so the math can't drift.
export function suggestedMonoPrice(variant, stockMap, productType) {
  if (productType !== 'mono') return null;
  const minStems = Number(variant['Min Stems'] || 0);
  if (minStems <= 0) return null;
  const kf = variant['Key Flower'];
  const stockId = Array.isArray(kf) ? kf[0] : kf;
  const stockItem = stockId ? stockMap[stockId] : null;
  if (!stockItem) return null;
  const sellPerStem = Number(stockItem['Current Sell Price'] || 0);
  return minStems * sellPerStem;
}
