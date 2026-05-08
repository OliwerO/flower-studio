import { buildBaseline } from './baseline.js';
import { buildStockOverhaul } from './stockOverhaul.js';

export const scenarios = {
  baseline: buildBaseline,
  'stock-overhaul': buildStockOverhaul,
};
