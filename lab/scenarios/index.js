import { buildBaseline } from './baseline.js';
import { buildStockOverhaul } from './stockOverhaul.js';
import { buildStockBackfill } from './stockBackfill.js';

export const scenarios = {
  baseline: buildBaseline,
  'stock-overhaul': buildStockOverhaul,
  stockBackfill: buildStockBackfill,
};
