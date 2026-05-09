// lab/scenarios/baseline.js
//
// Baseline fixture: minimal-but-realistic dataset every test starts from.
// Composition: 5 customers, 30 stock items (20 batches + 10 demand entries),
// 12 orders across statuses, ~25 order lines, 8 deliveries (one per
// delivery-type order).

import { faker } from '@faker-js/faker';
import { makeCustomer, makeStockItem, makeOrder, makeOrderLine, makeDelivery } from '../factories/index.js';

export function buildBaseline() {
  faker.seed(1);

  const customers = Array.from({ length: 5 }, () => makeCustomer());
  const batches  = Array.from({ length: 20 }, () => makeStockItem());
  const demands  = Array.from({ length: 10 }, () => makeStockItem({ type: 'demand' }));
  const stockItems = [...batches, ...demands];

  const orders = [];
  const orderLines = [];
  const deliveries = [];

  // delivery_type values are CAPITALIZED — 'Delivery' / 'Pickup'.
  const statusMix = ['New', 'New', 'New', 'Ready', 'Ready', 'Out for Delivery',
                     'Delivered', 'Delivered', 'Picked Up', 'Cancelled', 'New', 'Ready'];

  for (let i = 0; i < 12; i++) {
    const customer = faker.helpers.arrayElement(customers);
    const deliveryType = i % 3 === 0 ? 'Pickup' : 'Delivery';
    const o = makeOrder({
      customerId: customer.id,
      status: statusMix[i],
      delivery_type: deliveryType,
    });
    orders.push(o);

    const lineCount = faker.number.int({ min: 1, max: 3 });
    for (let j = 0; j < lineCount; j++) {
      const stock = faker.helpers.arrayElement(stockItems);
      // Use factory-only shaping keys (orderId, stockItemId, costSnapshot, sellSnapshot)
      // plus column-level override for flower_name and quantity.
      orderLines.push(makeOrderLine({
        orderId: o.id,
        stockItemId: stock.id,
        flower_name: stock.display_name,
        quantity: faker.number.int({ min: 1, max: 5 }),
        costSnapshot: stock.current_cost_price,
        sellSnapshot: stock.current_sell_price,
      }));
    }

    if (deliveryType === 'Delivery') {
      deliveries.push(makeDelivery({ orderId: o.id }));
    }
  }

  return { customers, stockItems, orders, orderLines, deliveries };
}
