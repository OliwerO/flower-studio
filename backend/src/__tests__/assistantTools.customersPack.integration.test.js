// backend/src/__tests__/assistantTools.customersPack.integration.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { customers, orders, keyPeople } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { customerInsightsHandler, customerLookupHandler } from '../services/assistantTools/customersPack.js';
import { computeAnalytics } from '../services/analyticsService.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  const [maria, john] = await harness.db.insert(customers).values([
    { name: 'Maria Kowalska', phone: '111', segment: 'VIP' },
    { name: 'John Maria Smith', phone: '222' },          // also contains "maria" (substring)
  ]).returning();
  await harness.db.insert(orders).values([
    { appOrderId: 'C-1', orderDate: '2026-05-05', requiredBy: '2026-05-06', deliveryType: 'Delivery', status: 'Delivered', paymentStatus: 'Paid', priceOverride: '150.00', customerId: maria.id },
    { appOrderId: 'C-2', orderDate: '2026-05-12', requiredBy: '2026-05-13', deliveryType: 'Pickup',   status: 'Picked Up', paymentStatus: 'Paid', priceOverride: '60.00',  customerId: john.id },
  ]);
  // Seed a key person for Maria so customer_lookup delivers real key-people data.
  await harness.db.insert(keyPeople).values({
    customerId: maria.id,
    name: 'Anna (mother)',
    importantDate: '2026-08-15',
    importantDateLabel: 'birthday',
  });
});
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('customersPack.customerInsightsHandler', () => {
  it('returns the customers subset that matches computeAnalytics (parity)', async () => {
    const params = { from: '2026-05-01', to: '2026-05-31' };
    const tool = await customerInsightsHandler(params);
    const full = await computeAnalytics(params);
    // Shape-complete parity: any new field added to computeAnalytics.customers will be caught here.
    const { period, ...customersSubset } = tool;
    expect(customersSubset).toEqual(full.customers);
    expect(period).toEqual(full.period);
  });
});

describe('customersPack.customerLookupHandler', () => {
  it('substring-matches by name and returns spend/order aggregates and key people', async () => {
    const r = await customerLookupHandler({ name: 'maria' });
    expect(r.matchedCount).toBe(2); // both "Maria Kowalska" and "John Maria Smith"
    const m = r.customers.find(c => c.name === 'Maria Kowalska');
    expect(m).toBeTruthy();
    expect(m.segment).toBe('VIP');
    expect(m.orderCount).toBe(1);
    expect(Number(m.totalSpend)).toBe(150);
    // Fix 1: key people must be delivered (enriched via getById, not stripped from list()).
    expect(m.keyPeople).toEqual([{ name: 'Anna (mother)', importantDate: '2026-08-15', label: 'birthday' }]);
  });
  it('returns empty for a blank name', async () => {
    const r = await customerLookupHandler({ name: '' });
    expect(r.matchedCount).toBe(0);
    expect(r.customers).toEqual([]);
  });
});
