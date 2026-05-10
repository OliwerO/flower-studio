// lab/scenarios/stockBackfill.js
//
// Fixture for the #292 Variety Attribute Backfill UI.
// Extends baseline with:
//   - 40 stock items where type_name IS NULL (pending backfill)
//   - 20 stock items already backfilled (type_name IS NOT NULL)
//
// The mix lets the Playwright test verify:
//   - Status banner shows "40 of 60 still need backfill"
//   - "Show backfilled" toggle reveals the 20 completed rows
//   - Bulk-apply changes the remaining count

import { faker } from '@faker-js/faker';
import { buildBaseline } from './baseline.js';
import { makeStockItem } from '../factories/index.js';

const TYPES     = ['Peony', 'Rose', 'Tulip', 'Lisianthus', 'Anemone'];
const COLOURS   = ['Pink', 'White', 'Red', 'Yellow', 'Purple'];
const CULTIVARS = ['Sarah Bernhardt', "White O'Hara", 'Coral Charm', null];

export function buildStockBackfill() {
  faker.seed(42);
  const base = buildBaseline();

  // Pending rows — type_name IS NULL
  const pending = Array.from({ length: 40 }, () =>
    makeStockItem({ type_name: null, colour: null, size_cm: null, cultivar: null })
  );

  // Already-backfilled rows — type_name IS NOT NULL
  const backfilled = Array.from({ length: 20 }, () => {
    const typeName = faker.helpers.arrayElement(TYPES);
    return makeStockItem({
      type_name: typeName,
      colour:    faker.helpers.arrayElement(COLOURS),
      size_cm:   faker.helpers.arrayElement([40, 50, 60, null]),
      cultivar:  faker.helpers.arrayElement(CULTIVARS),
    });
  });

  return {
    customers:  base.customers,
    stockItems: [...base.stockItems, ...pending, ...backfilled],
    orders:     base.orders,
    orderLines: base.orderLines,
    deliveries: base.deliveries,
  };
}
