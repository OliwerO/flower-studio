// Re-exports from the shared package so dashboard components don't have to
// update their imports — the canonical implementation lives in
// packages/shared/utils/productGroup.js (used by mobile too).
export {
  groupByProduct,
  parseCats,
  activeCount,
  allActive,
  anyActive,
  priceRange,
  groupCategories,
} from '@flower-studio/shared';
