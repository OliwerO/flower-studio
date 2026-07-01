// backend/src/__tests__/assistantTools.purchaseDetailPack.integration.test.js
//
// Integration test for purchaseDetailPack.purchaseDetailHandler.
// Uses pglite so stockPurchasesRepo.list + stockRepo.listByIds run against
// real SQL (dbHolder mock pattern shared with velocityPack/dataQueryPack).
//
// Seed layout:
//   stock: Red Rose, White Peony
//   stock_purchases (2026-06):
//     06-01  Stefan     Red Rose     qty 100  price 2.00  → 200
//     06-05  Stefan     White Peony  qty 50   price 3.00  → 150
//     06-10  Stefan     Red Rose     qty 20   price 2.50  →  50
//     06-03  Flora Hurt Red Rose     qty 30   price 4.00  → 120
//   Total across all suppliers = 520; Stefan-only = 400.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, stockPurchases } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { purchaseDetailHandler } from '../services/assistantTools/purchaseDetailPack.js';

let harness;
let roseId, peonyId;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;

  const [rose, peony] = await harness.db.insert(stock).values([
    { displayName: 'Red Rose', currentQuantity: 100, active: true },
    { displayName: 'White Peony', currentQuantity: 50, active: true },
  ]).returning();
  roseId = rose.id;
  peonyId = peony.id;

  await harness.db.insert(stockPurchases).values([
    { purchaseDate: '2026-06-01', supplier: 'Stefan', stockId: roseId, quantityPurchased: 100, pricePerUnit: '2.00' },
    { purchaseDate: '2026-06-05', supplier: 'Stefan', stockId: peonyId, quantityPurchased: 50, pricePerUnit: '3.00' },
    { purchaseDate: '2026-06-10', supplier: 'Stefan', stockId: roseId, quantityPurchased: 20, pricePerUnit: '2.50' },
    { purchaseDate: '2026-06-03', supplier: 'Flora Hurt', stockId: roseId, quantityPurchased: 30, pricePerUnit: '4.00' },
  ]);
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('purchaseDetailPack.purchase_detail', () => {
  it('with no filters, totals over all suppliers and resolves flower names', async () => {
    const r = await purchaseDetailHandler({ from: '2026-06-01', to: '2026-06-30' });
    expect(r.transactionCount).toBe(4);
    expect(r.totalSpend).toBe(520);
    expect(r.currency).toBe('zł');
    expect(r.period).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    // date-ascending
    expect(r.transactions.map((t) => t.date)).toEqual(['2026-06-01', '2026-06-03', '2026-06-05', '2026-06-10']);
    expect(r.transactions[0].flower).toBe('Red Rose');
    expect(r.transactions[1].supplier).toBe('Flora Hurt');
  });

  it('filters by supplier (case-insensitive contains)', async () => {
    const r = await purchaseDetailHandler({ supplier: 'stefan', from: '2026-06-01', to: '2026-06-30' });
    expect(r.transactionCount).toBe(3);
    expect(r.totalSpend).toBe(400);
    expect(r.transactions.every((t) => t.supplier === 'Stefan')).toBe(true);
    expect(r.transactions.map((t) => t.date)).toEqual(['2026-06-01', '2026-06-05', '2026-06-10']);
  });

  it('filters by flower name (case-insensitive contains)', async () => {
    const r = await purchaseDetailHandler({ flower: 'rose', from: '2026-06-01', to: '2026-06-30' });
    expect(r.transactionCount).toBe(3);
    expect(r.totalSpend).toBe(370); // 200 + 50 + 120
    expect(r.transactions.every((t) => t.flower === 'Red Rose')).toBe(true);
  });

  it('combines supplier + flower filters', async () => {
    const r = await purchaseDetailHandler({ supplier: 'Stefan', flower: 'peony', from: '2026-06-01', to: '2026-06-30' });
    expect(r.transactionCount).toBe(1);
    expect(r.totalSpend).toBe(150);
    expect(r.transactions[0].flower).toBe('White Peony');
  });

  it('byDate and byFlower subtotals sum to totalSpend', async () => {
    const r = await purchaseDetailHandler({ from: '2026-06-01', to: '2026-06-30' });
    const byDateSum = r.byDate.reduce((s, d) => s + d.amount, 0);
    const byFlowerSum = r.byFlower.reduce((s, f) => s + f.amount, 0);
    expect(Math.round(byDateSum * 100) / 100).toBe(r.totalSpend);
    expect(Math.round(byFlowerSum * 100) / 100).toBe(r.totalSpend);
    // byDate has one entry per distinct purchase date
    expect(r.byDate.length).toBe(4);
    // byFlower has one entry per distinct resolved flower name
    expect(r.byFlower.sort((a, b) => a.flower.localeCompare(b.flower))).toEqual([
      { flower: 'Red Rose', qty: 150, amount: 370 },
      { flower: 'White Peony', qty: 50, amount: 150 },
    ]);
  });

  it('totals/byDate/byFlower stay over the full match even when transactions are capped', async () => {
    const r = await purchaseDetailHandler({ from: '2026-06-01', to: '2026-06-30', limit: 1 });
    expect(r.transactions.length).toBe(1);
    expect(r.transactionCount).toBe(4);
    expect(r.totalSpend).toBe(520);
    expect(r.byFlower.reduce((s, f) => s + f.amount, 0)).toBe(520);
  });

  it('purchase with no stock link resolves flower to a placeholder', async () => {
    await harness.db.insert(stockPurchases).values([
      { purchaseDate: '2026-06-15', supplier: 'Unknown Supplier', quantityPurchased: 5, pricePerUnit: '1.00' },
    ]);
    const r = await purchaseDetailHandler({ from: '2026-06-01', to: '2026-06-30' });
    const unlinked = r.transactions.find((t) => t.date === '2026-06-15');
    expect(unlinked.flower).toBe('—');
    expect(r.transactionCount).toBe(5);
  });

  it('returns empty result set for a non-matching supplier without throwing', async () => {
    const r = await purchaseDetailHandler({ supplier: 'Nobody', from: '2026-06-01', to: '2026-06-30' });
    expect(r.transactionCount).toBe(0);
    expect(r.totalSpend).toBe(0);
    expect(r.transactions).toEqual([]);
    expect(r.byDate).toEqual([]);
    expect(r.byFlower).toEqual([]);
  });
});
