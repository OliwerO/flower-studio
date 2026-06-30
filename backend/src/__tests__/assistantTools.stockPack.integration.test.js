import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, stockLossLog } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { stockStatusHandler, stockWriteoffsHandler } from '../services/assistantTools/stockPack.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  const [rose, peony] = await harness.db.insert(stock).values([
    { displayName: 'Red Rose 50cm', currentQuantity: 120, active: true, typeName: 'Rose', colour: 'Red', sizeCm: 50, currentCostPrice: '4.00' },
    { displayName: 'White Peony',    currentQuantity: -8,  active: true, typeName: 'Peony', colour: 'White', currentCostPrice: '6.00' }, // shortfall
    { displayName: 'Eucalyptus',     currentQuantity: 0,   active: true, typeName: 'Eucalyptus' },
  ]).returning();
  await harness.db.insert(stockLossLog).values([
    { date: '2026-05-04', stockId: rose.id,  quantity: '5',  reason: 'wilted' },
    { date: '2026-05-18', stockId: rose.id,  quantity: '3',  reason: 'wilted' },
    { date: '2026-05-20', stockId: rose.id,  quantity: '10', reason: 'damaged' },
    { date: '2026-05-22', stockId: peony.id, quantity: '7',  reason: 'wilted' },
    { date: '2026-04-30', stockId: rose.id,  quantity: '99', reason: 'wilted' }, // outside May
  ]);
});
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('stockPack.stockStatusHandler', () => {
  it('lists stock with shortfall flag', async () => {
    const r = await stockStatusHandler({});
    expect(r.matchedCount).toBe(3);
    expect(r.shortfallCount).toBe(1);
    const peony = r.items.find(i => i.name === 'White Peony');
    expect(peony.quantity).toBe(-8);
    expect(peony.shortfall).toBe(true);
  });
  it('shortfallOnly returns only negative-quantity items', async () => {
    const r = await stockStatusHandler({ shortfallOnly: true });
    expect(r.matchedCount).toBe(1);
    expect(r.items.map(i => i.name)).toEqual(['White Peony']);
  });
  it('search does a case-insensitive substring match on item name', async () => {
    const r = await stockStatusHandler({ search: 'rose' });
    expect(r.matchedCount).toBe(1);
    expect(r.items[0].name).toBe('Red Rose 50cm');
  });
});

describe('stockPack.stockWriteoffsHandler', () => {
  it('totals + groups May write-offs by reason (excludes April)', async () => {
    const r = await stockWriteoffsHandler({ from: '2026-05-01', to: '2026-05-31' });
    expect(r.entryCount).toBe(4);
    expect(r.totalQuantity).toBe(25);
    expect(r.byReason).toEqual({ wilted: 15, damaged: 10 });
  });

  it('groups by flower, most-wasted first, with money lost per flower', async () => {
    const r = await stockWriteoffsHandler({ from: '2026-05-01', to: '2026-05-31' });
    expect(r.flowerCount).toBe(2);
    expect(r.byFlower).toEqual([
      { flower: 'Red Rose 50cm', quantity: 18, entryCount: 3, lostValue: 72 },  // 18 × 4.00
      { flower: 'White Peony',   quantity: 7,  entryCount: 1, lostValue: 42 },  // 7 × 6.00
    ]);
    expect(r.truncated).toBe(false);
  });

  it('totals the monetary value lost across all flowers (zł)', async () => {
    const r = await stockWriteoffsHandler({ from: '2026-05-01', to: '2026-05-31' });
    expect(r.totalLostValue).toBe(114); // 72 + 42
    expect(r.unvaluedQuantity).toBe(0);
    expect(r.currency).toBe('zł');
    // self-consistency: sum(byFlower.lostValue) === totalLostValue
    const sum = r.byFlower.reduce((a, f) => a + f.lostValue, 0);
    expect(sum).toBe(r.totalLostValue);
  });

  it('counts stems with no linked stock/cost as unvalued (excluded from money totals)', async () => {
    await harness.db.insert(stockLossLog).values([
      { date: '2026-05-25', quantity: '20', reason: 'wilted' }, // no stockId → no cost
    ]);
    const r = await stockWriteoffsHandler({ from: '2026-05-01', to: '2026-05-31' });
    expect(r.totalQuantity).toBe(45);       // 25 valued + 20 unvalued
    expect(r.unvaluedQuantity).toBe(20);
    expect(r.totalLostValue).toBe(114);     // unchanged — unvalued stems contribute 0 zł
    const dash = r.byFlower.find((f) => f.flower === '—');
    expect(dash).toEqual({ flower: '—', quantity: 20, entryCount: 1, lostValue: 0 });
  });

  it('filters by reason (case-insensitive) across reason + flower + money breakdowns', async () => {
    const r = await stockWriteoffsHandler({ from: '2026-05-01', to: '2026-05-31', reason: 'WILTED' });
    expect(r.reason).toBe('WILTED');
    expect(r.entryCount).toBe(3); // 2 rose wilted + 1 peony wilted
    expect(r.totalQuantity).toBe(15);
    expect(r.totalLostValue).toBe(74); // rose 8×4 + peony 7×6
    expect(r.byReason).toEqual({ wilted: 15 });
    expect(r.byFlower).toEqual([
      { flower: 'Red Rose 50cm', quantity: 8, entryCount: 2, lostValue: 32 },
      { flower: 'White Peony',   quantity: 7, entryCount: 1, lostValue: 42 },
    ]);
  });
});
