// lab/scenarios/stockYDemand.js
//
// Fixture for Stock Y-model dated Demand Entry rehearsal (issue #286).
//
// Seed: multiple orders sharing Variety + date, crossing dates.
//   - 2 orders: same (Peony Pink 60cm Sarah Bernhardt, 2026-05-15) → share one DE
//   - 2 orders: same Peony Pink 60cm Sarah Bernhardt, different dates → two DEs
//   - 1 order: Peony Pink 60cm, null cultivar → separate DE (strict Variety identity)
//   - 1 order: Peony Pink 60cm, 'Sarah Bernhardt' cultivar → another distinct DE
//
// All orders use Pickup delivery type to keep the fixture simple.

import { faker } from '@faker-js/faker';
import { buildBaseline } from './baseline.js';
import { makeStockItem, makeOrder, makeOrderLine } from '../factories/index.js';

const DATE_A = '2026-05-15';
const DATE_B = '2026-05-20';

export function buildStockYDemand() {
  faker.seed(7);
  const base = buildBaseline();

  // ── Dated Demand Entry stock rows ──
  // These represent Y-model DE rows (type_name set, qty < 0).

  // DE 1: Peony Pink 60cm Sarah Bernhardt — shared between two orders on DATE_A
  const de_shared = makeStockItem({
    type:      'dated-demand',
    type_name: 'Peony',
    colour:    'Pink',
    size_cm:   60,
    cultivar:  'Sarah Bernhardt',
    date:      DATE_A,
  });

  // DE 2: Same Variety, DATE_B (different date → different DE)
  const de_dateB = makeStockItem({
    type:      'dated-demand',
    type_name: 'Peony',
    colour:    'Pink',
    size_cm:   60,
    cultivar:  'Sarah Bernhardt',
    date:      DATE_B,
  });

  // DE 3: Peony Pink 60cm, no cultivar (null cultivar → different Variety per ADR-0006)
  const de_null_cultivar = makeStockItem({
    type:      'dated-demand',
    type_name: 'Peony',
    colour:    'Pink',
    size_cm:   60,
    cultivar:  null,
    date:      DATE_A,
  });

  const newStock = [de_shared, de_dateB, de_null_cultivar];

  // ── Orders ──
  const customer = base.customers[0];
  const newOrders = [];
  const newOrderLines = [];

  // Orders A1 + A2: share de_shared (same Variety + DATE_A)
  const orderA1 = makeOrder({
    customerId:    customer.id,
    status:        'New',
    delivery_type: 'Pickup',
    required_by:   DATE_A,
  });
  newOrders.push(orderA1);
  newOrderLines.push(makeOrderLine({
    orderId:     orderA1.id,
    stockItemId: de_shared.id,
    flower_name: 'Peony Pink 60cm Sarah Bernhardt',
    quantity:    5,
  }));

  const orderA2 = makeOrder({
    customerId:    customer.id,
    status:        'New',
    delivery_type: 'Pickup',
    required_by:   DATE_A,
  });
  newOrders.push(orderA2);
  newOrderLines.push(makeOrderLine({
    orderId:     orderA2.id,
    stockItemId: de_shared.id,
    flower_name: 'Peony Pink 60cm Sarah Bernhardt',
    quantity:    3,
  }));

  // Order B: same Variety, DATE_B → de_dateB
  const orderB = makeOrder({
    customerId:    customer.id,
    status:        'New',
    delivery_type: 'Pickup',
    required_by:   DATE_B,
  });
  newOrders.push(orderB);
  newOrderLines.push(makeOrderLine({
    orderId:     orderB.id,
    stockItemId: de_dateB.id,
    flower_name: 'Peony Pink 60cm Sarah Bernhardt',
    quantity:    4,
  }));

  // Order C: null cultivar → de_null_cultivar (strict Variety identity)
  const orderC = makeOrder({
    customerId:    customer.id,
    status:        'New',
    delivery_type: 'Pickup',
    required_by:   DATE_A,
  });
  newOrders.push(orderC);
  newOrderLines.push(makeOrderLine({
    orderId:     orderC.id,
    stockItemId: de_null_cultivar.id,
    flower_name: 'Peony Pink 60cm',
    quantity:    6,
  }));

  return {
    customers:  base.customers,
    stockItems: [...base.stockItems, ...newStock],
    orders:     [...base.orders, ...newOrders],
    orderLines: [...base.orderLines, ...newOrderLines],
    deliveries: base.deliveries,
  };
}
