// backend/src/__tests__/assistantTools.ordersPack.integration.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { orders } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { queryOrdersHandler, breakdownOrdersHandler } from '../services/assistantTools/ordersPack.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  // Seed: 3 May orders (2 Delivery, 1 Pickup), 1 April order, 1 Cancelled May order.
  // NOTE: consult backend/src/db/schema.js (orders, ~lines 145-185) and add any
  // additional NOT NULL columns the insert needs.
  await harness.db.insert(orders).values([
    { appOrderId: 'BLO-1', customerId: 'cust-test', orderDate: '2026-05-03', requiredBy: '2026-05-04', deliveryType: 'Delivery', status: 'Delivered', paymentStatus: 'Paid', source: 'Instagram' },
    { appOrderId: 'BLO-2', customerId: 'cust-test', orderDate: '2026-05-10', requiredBy: '2026-05-11', deliveryType: 'Delivery', status: 'New', paymentStatus: 'Unpaid', source: 'Wix' },
    { appOrderId: 'BLO-3', customerId: 'cust-test', orderDate: '2026-05-20', requiredBy: '2026-05-20', deliveryType: 'Pickup', status: 'Picked Up', paymentStatus: 'Paid', source: 'In-store' },
    { appOrderId: 'BLO-4', customerId: 'cust-test', orderDate: '2026-04-15', requiredBy: '2026-04-16', deliveryType: 'Delivery', status: 'Delivered', paymentStatus: 'Paid', source: 'Wix' },
    { appOrderId: 'BLO-5', customerId: 'cust-test', orderDate: '2026-05-25', requiredBy: '2026-05-26', deliveryType: 'Delivery', status: 'Cancelled', paymentStatus: 'Unpaid', source: 'Wix' },
  ]);
});
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('ordersPack.queryOrdersHandler', () => {
  it('counts May orders by order date, excluding cancelled', async () => {
    const r = await queryOrdersHandler({ dateField: 'order', from: '2026-05-01', to: '2026-05-31' });
    expect(r.matchedCount).toBe(3); // BLO-1,2,3 (BLO-5 cancelled excluded, BLO-4 is April)
    expect(r.truncated).toBe(false);
    expect(r.orders.map(o => o.id).sort()).toEqual(['BLO-1', 'BLO-2', 'BLO-3']);
  });
  it('includes the requested status even when Cancelled', async () => {
    const r = await queryOrdersHandler({ dateField: 'order', from: '2026-05-01', to: '2026-05-31', status: 'Cancelled' });
    expect(r.matchedCount).toBe(1);
    expect(r.orders[0].id).toBe('BLO-5');
  });
});

describe('ordersPack.breakdownOrdersHandler', () => {
  it('breaks May orders down by deliveryType', async () => {
    const r = await breakdownOrdersHandler({ dimension: 'deliveryType', from: '2026-05-01', to: '2026-05-31' });
    expect(r.total).toBe(3);
    expect(r.breakdown).toEqual({ Delivery: 2, Pickup: 1 });
  });
});
