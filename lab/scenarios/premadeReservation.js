// lab/scenarios/premadeReservation.js
//
// Stock Y-model premade reservation lifecycle scenario.
// Provides Variety-shaped Stock Items (type_name set) so flag-on branches
// in createPremadeBouquet have data to operate on.
//
// Premade bouquets and their lines are intentionally empty — they are created
// and dissolved/sold at runtime by lab tests and rehearsal scripts.

import { faker } from '@faker-js/faker';
import { makeStockItem } from '../factories/stockItem.js';

export function buildPremadeReservation() {
  faker.seed(285);
  const stockItems = [
    makeStockItem({
      display_name: 'Pink Rose 60cm (10.May.)',
      type_name: 'Rose',
      colour: 'Pink',
      size_cm: 60,
      current_quantity: 20,
    }),
    makeStockItem({
      display_name: 'White Peony 50cm (10.May.)',
      type_name: 'Peony',
      colour: 'White',
      size_cm: 50,
      current_quantity: 12,
    }),
  ];
  return { stockItems, premadeBouquets: [], premadeBouquetLines: [] };
}
