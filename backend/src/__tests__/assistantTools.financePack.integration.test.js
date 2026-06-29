// backend/src/__tests__/assistantTools.financePack.integration.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { orders } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { financialSummaryHandler } from '../services/assistantTools/financePack.js';
import { computeAnalytics } from '../services/analyticsService.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  await harness.db.insert(orders).values([
    { appOrderId: 'BLO-1', customerId: 'cust-test', orderDate: '2026-05-03', requiredBy: '2026-05-04', deliveryType: 'Delivery', status: 'Delivered', paymentStatus: 'Paid', source: 'Instagram', priceOverride: '120.00' },
    { appOrderId: 'BLO-2', customerId: 'cust-test', orderDate: '2026-05-10', requiredBy: '2026-05-11', deliveryType: 'Pickup', status: 'Picked Up', paymentStatus: 'Paid', source: 'Wix', priceOverride: '80.00' },
  ]);
});
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('financePack.financialSummaryHandler', () => {
  it('returns a finance subset that matches computeAnalytics (parity)', async () => {
    const params = { from: '2026-05-01', to: '2026-05-31' };
    const tool = await financialSummaryHandler(params);
    const full = await computeAnalytics(params);
    // Parity: the tool's figures are literally computeAnalytics's figures.
    expect(tool.revenue).toEqual(full.revenue);
    expect(tool.delivery).toEqual(full.delivery);
    expect(tool.revenueBySource).toEqual(full.orders.revenueBySource);
    expect(tool.flowerMarginPercent).toEqual(full.costs.flowerMarginPercent);
    expect(tool.period).toEqual(full.period);
  });
});
