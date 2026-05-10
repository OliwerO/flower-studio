import { buildBaseline } from './baseline.js';
import { buildStockOverhaul } from './stockOverhaul.js';
import { buildPremadeReservation } from './premadeReservation.js';

export const scenarios = {
  baseline: buildBaseline,
  'stock-overhaul': buildStockOverhaul,
  'premade-reservation': buildPremadeReservation,
};
