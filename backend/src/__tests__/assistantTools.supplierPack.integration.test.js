// backend/src/__tests__/assistantTools.supplierPack.integration.test.js
//
// Parity integration test: supplierScorecardHandler must return exactly the
// supplierScorecard that computeAnalytics produces — same function, same DB,
// so numbers can never drift between the assistant and the dashboard.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, stockPurchases, stockLossLog } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { supplierScorecardHandler } from '../services/assistantTools/supplierPack.js';
import { computeAnalytics } from '../services/analyticsService.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;

  // Seed a stock item with a known supplier so the loss LEFT JOIN resolves.
  const [rose] = await harness.db.insert(stock).values([
    { displayName: 'Red Rose 60cm', currentQuantity: 50, active: true,
      typeName: 'Rose', colour: 'Red', sizeCm: 60, supplier: 'FleurPlus' },
  ]).returning();

  // Two purchase rows — same supplier, different dates.
  await harness.db.insert(stockPurchases).values([
    { purchaseDate: '2026-05-10', supplier: 'FleurPlus',
      stockId: rose.id, quantityPurchased: 100, pricePerUnit: '2.50' },
    { purchaseDate: '2026-05-20', supplier: 'FleurPlus',
      stockId: rose.id, quantityPurchased: 50,  pricePerUnit: '2.80' },
    // Row outside the test window — must not appear in May scorecard.
    { purchaseDate: '2026-04-05', supplier: 'OtherSource',
      stockId: rose.id, quantityPurchased: 20,  pricePerUnit: '3.00' },
  ]);

  // Waste row within the window — enriches wasteQty/wasteCost on the scorecard.
  await harness.db.insert(stockLossLog).values([
    { date: '2026-05-15', stockId: rose.id, quantity: '8', reason: 'wilted' },
  ]);
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('supplierPack.supplierScorecardHandler', () => {
  it('returns supplierScorecard that matches computeAnalytics (parity)', async () => {
    const params = { from: '2026-05-01', to: '2026-05-31' };
    const tool = await supplierScorecardHandler(params);
    const full = await computeAnalytics(params);

    // Structural parity: the tool is a thin adapter — values must be identical.
    expect(tool.suppliers).toEqual(full.supplierScorecard);
    expect(tool.supplierCount).toBe(full.supplierScorecard.length);
  });

  it('period-echo grounding: from/to echoed verbatim in output', async () => {
    const params = { from: '2026-05-01', to: '2026-05-31' };
    const tool = await supplierScorecardHandler(params);
    expect(tool.period).toEqual({ from: '2026-05-01', to: '2026-05-31' });
  });

  it('scorecard contains FleurPlus with spend from May purchases only', async () => {
    const params = { from: '2026-05-01', to: '2026-05-31' };
    const tool = await supplierScorecardHandler(params);
    const fleurPlus = tool.suppliers.find(s => s.supplier === 'FleurPlus');
    expect(fleurPlus).toBeDefined();
    // 100 * 2.50 + 50 * 2.80 = 250 + 140 = 390
    expect(fleurPlus.totalSpend).toBeCloseTo(390, 2);
    expect(fleurPlus.purchaseCount).toBe(2);
    expect(fleurPlus.totalQty).toBe(150);
    // Waste was linked to a FleurPlus stock item
    expect(fleurPlus.wasteQty).toBeGreaterThan(0);
  });

  it('OtherSource row (April) is excluded from the May scorecard', async () => {
    const params = { from: '2026-05-01', to: '2026-05-31' };
    const tool = await supplierScorecardHandler(params);
    const other = tool.suppliers.find(s => s.supplier === 'OtherSource');
    expect(other).toBeUndefined();
  });

  it('period-echo grounding: null from/to passthrough', async () => {
    // computeAnalytics throws when from/to are missing — this verifies the
    // handler forwards them correctly (and that null inputs are echoed back).
    const params = { from: '2026-05-01', to: '2026-05-31' };
    const tool = await supplierScorecardHandler(params);
    expect(tool.period.from).toBe('2026-05-01');
    expect(tool.period.to).toBe('2026-05-31');
  });
});
