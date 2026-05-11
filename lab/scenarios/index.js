import { buildBaseline } from './baseline.js';
import { buildStockOverhaul } from './stockOverhaul.js';
import { buildStockBackfill } from './stockBackfill.js';
import { buildPremadeReservation } from './premadeReservation.js';
import { buildStockYMigration } from './stockYMigration.js';
import { buildYModelDemo } from './yModelDemo.js';

export const scenarios = {
  baseline: buildBaseline,
  'stock-overhaul': buildStockOverhaul,
  stockBackfill: buildStockBackfill,
  'premade-reservation': buildPremadeReservation,
  'stock-y-migration': buildStockYMigration,
  'y-model-demo': buildYModelDemo,
};
