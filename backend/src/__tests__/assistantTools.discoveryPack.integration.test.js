// backend/src/__tests__/assistantTools.discoveryPack.integration.test.js
//
// pglite integration tests for discoveryPack.listValuesHandler:
//   - suppliers (stock_purchases.supplier), paymentMethods + sources (orders),
//     lossReasons (stock_loss_log.reason), drivers (deliveries.assigned_driver)
//   - counts sum correctly and are numbers (not strings), sorted count desc
//   - nulls / blanks / soft-deleted rows excluded
//   - unknown field returns { error }

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { orders, deliveries, stockPurchases, stockLossLog } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

// Import after the mock is set up
import { listValuesHandler } from '../services/assistantTools/discoveryPack.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('discoveryPack.listValuesHandler — suppliers', () => {
  it('returns distinct suppliers with counts, sorted desc, blank/null excluded', async () => {
    await harness.db.insert(stockPurchases).values([
      { purchaseDate: '2026-06-01', supplier: 'Van Der Berg', quantityPurchased: 10 },
      { purchaseDate: '2026-06-02', supplier: 'Van Der Berg', quantityPurchased: 5 },
      { purchaseDate: '2026-06-03', supplier: 'Krakow Flowers', quantityPurchased: 20 },
      { purchaseDate: '2026-06-04', supplier: '', quantityPurchased: 1 },
    ]);

    const r = await listValuesHandler({ field: 'suppliers' });

    expect(r.error).toBeUndefined();
    expect(r.field).toBe('suppliers');
    expect(r.values).toEqual([
      { value: 'Van Der Berg', count: 2 },
      { value: 'Krakow Flowers', count: 1 },
    ]);
    expect(typeof r.values[0].count).toBe('number');
  });
});

describe('discoveryPack.listValuesHandler — paymentMethods + sources', () => {
  beforeEach(async () => {
    await harness.db.insert(orders).values([
      { appOrderId: 'BLO-1', customerId: 'cust-1', deliveryType: 'Delivery', source: 'Instagram', paymentMethod: 'Cash' },
      { appOrderId: 'BLO-2', customerId: 'cust-1', deliveryType: 'Delivery', source: 'Instagram', paymentMethod: 'Cash' },
      { appOrderId: 'BLO-3', customerId: 'cust-1', deliveryType: 'Pickup',   source: 'Wix',       paymentMethod: 'Card' },
      { appOrderId: 'BLO-4', customerId: 'cust-1', deliveryType: 'Pickup',   source: null,        paymentMethod: null },
    ]);
  });

  it('paymentMethods: counts distinct values, nulls excluded', async () => {
    const r = await listValuesHandler({ field: 'paymentMethods' });
    expect(r.error).toBeUndefined();
    expect(r.field).toBe('paymentMethods');
    expect(r.values).toEqual([
      { value: 'Cash', count: 2 },
      { value: 'Card', count: 1 },
    ]);
  });

  it('sources: counts distinct values, nulls excluded', async () => {
    const r = await listValuesHandler({ field: 'sources' });
    expect(r.error).toBeUndefined();
    expect(r.field).toBe('sources');
    expect(r.values).toEqual([
      { value: 'Instagram', count: 2 },
      { value: 'Wix', count: 1 },
    ]);
  });

  it('excludes soft-deleted orders', async () => {
    await harness.db.insert(orders).values({
      appOrderId: 'BLO-5', customerId: 'cust-1', deliveryType: 'Delivery',
      source: 'Telegram', paymentMethod: 'Transfer', deletedAt: new Date(),
    });

    const r = await listValuesHandler({ field: 'sources' });
    expect(r.values.find(v => v.value === 'Telegram')).toBeUndefined();
  });
});

describe('discoveryPack.listValuesHandler — lossReasons', () => {
  it('returns distinct reasons with counts, soft-deleted excluded', async () => {
    await harness.db.insert(stockLossLog).values([
      { date: '2026-06-01', quantity: '5', reason: 'Wilted' },
      { date: '2026-06-02', quantity: '2', reason: 'Wilted' },
      { date: '2026-06-03', quantity: '1', reason: 'Damaged', deletedAt: new Date() },
      { date: '2026-06-04', quantity: '3', reason: 'Broken stem' },
    ]);

    const r = await listValuesHandler({ field: 'lossReasons' });

    expect(r.error).toBeUndefined();
    expect(r.field).toBe('lossReasons');
    expect(r.values).toEqual([
      { value: 'Wilted', count: 2 },
      { value: 'Broken stem', count: 1 },
    ]);
  });
});

describe('discoveryPack.listValuesHandler — drivers', () => {
  it('returns distinct assigned drivers with counts, null/soft-deleted excluded', async () => {
    const [o1] = await harness.db.insert(orders).values({
      appOrderId: 'BLO-D1', customerId: 'cust-1', deliveryType: 'Delivery',
    }).returning();
    const [o2] = await harness.db.insert(orders).values({
      appOrderId: 'BLO-D2', customerId: 'cust-1', deliveryType: 'Delivery',
    }).returning();
    const [o3] = await harness.db.insert(orders).values({
      appOrderId: 'BLO-D3', customerId: 'cust-1', deliveryType: 'Delivery',
    }).returning();
    const [o4] = await harness.db.insert(orders).values({
      appOrderId: 'BLO-D4', customerId: 'cust-1', deliveryType: 'Delivery',
    }).returning();

    await harness.db.insert(deliveries).values([
      { orderId: o1.id, assignedDriver: 'Nikita' },
      { orderId: o2.id, assignedDriver: 'Nikita' },
      { orderId: o3.id, assignedDriver: 'Timur' },
      { orderId: o4.id, assignedDriver: null, deletedAt: new Date() },
    ]);

    const r = await listValuesHandler({ field: 'drivers' });

    expect(r.error).toBeUndefined();
    expect(r.field).toBe('drivers');
    expect(r.values).toEqual([
      { value: 'Nikita', count: 2 },
      { value: 'Timur', count: 1 },
    ]);
  });
});

describe('discoveryPack.listValuesHandler — unknown field', () => {
  it('returns an error, never throws', async () => {
    const r = await listValuesHandler({ field: 'customerNames' });
    expect(r.error).toMatch(/Unknown field/);
  });

  it('returns an error when field is omitted', async () => {
    const r = await listValuesHandler({});
    expect(r.error).toMatch(/Unknown field/);
  });
});
