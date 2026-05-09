// lab/scenarios/stockOverhaul.js
//
// Fixture for Stock-tab redesign rehearsal. Extends baseline with:
//   - 200 stock items spanning realistic varieties + age (0-14 days old)
//   - Mix of batches (positive qty), demand entries (negative qty),
//     and zeroed-out batches (sold through)
//   - Orders that consumed some of the stock so the demand-entry math
//     (per ADR 0002) is exercisable

import { faker } from '@faker-js/faker';
import { buildBaseline } from './baseline.js';
import { makeStockItem, makeOrder, makeOrderLine } from '../factories/index.js';

export function buildStockOverhaul() {
  faker.seed(2);
  const base = buildBaseline();

  const extraBatches = Array.from({ length: 140 }, () => {
    const days = faker.number.int({ min: 0, max: 14 });
    const arrival = new Date(Date.now() - days * 86400_000);
    return makeStockItem({ arrivalDate: arrival });
  });

  const extraDemands = Array.from({ length: 30 }, () => makeStockItem({ type: 'demand' }));

  const zeroBatches = Array.from({ length: 30 }, () =>
    makeStockItem({ current_quantity: 0 })
  );

  const newStock = [...extraBatches, ...extraDemands, ...zeroBatches];

  // Add 30 new orders that consume from the new stock so committed demand
  // is non-trivial. Reuse baseline customers to keep FK integrity.
  const extraOrders = [];
  const extraLines = [];
  for (let i = 0; i < 30; i++) {
    const customer = faker.helpers.arrayElement(base.customers);
    const o = makeOrder({ customerId: customer.id, status: 'New', delivery_type: 'Pickup' });
    extraOrders.push(o);
    const lineCount = faker.number.int({ min: 2, max: 5 });
    for (let j = 0; j < lineCount; j++) {
      const stock = faker.helpers.arrayElement([...extraBatches, ...extraDemands]);
      extraLines.push(makeOrderLine({
        orderId: o.id,
        stockItemId: stock.id,
        flower_name: stock.display_name,
        quantity: faker.number.int({ min: 1, max: 4 }),
        costSnapshot: stock.current_cost_price,
        sellSnapshot: stock.current_sell_price,
      }));
    }
  }

  return {
    customers: base.customers,
    stockItems: [...base.stockItems, ...newStock],
    orders: [...base.orders, ...extraOrders],
    orderLines: [...base.orderLines, ...extraLines],
    deliveries: base.deliveries,
  };
}
