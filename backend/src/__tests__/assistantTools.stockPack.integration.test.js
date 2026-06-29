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
  const [rose] = await harness.db.insert(stock).values([
    { displayName: 'Red Rose 50cm', currentQuantity: 120, active: true, typeName: 'Rose', colour: 'Red', sizeCm: 50 },
    { displayName: 'White Peony',    currentQuantity: -8,  active: true, typeName: 'Peony', colour: 'White' }, // shortfall
    { displayName: 'Eucalyptus',     currentQuantity: 0,   active: true, typeName: 'Eucalyptus' },
  ]).returning();
  await harness.db.insert(stockLossLog).values([
    { date: '2026-05-04', stockId: rose.id, quantity: '5',  reason: 'wilted' },
    { date: '2026-05-18', stockId: rose.id, quantity: '3',  reason: 'wilted' },
    { date: '2026-05-20', stockId: rose.id, quantity: '10', reason: 'damaged' },
    { date: '2026-04-30', stockId: rose.id, quantity: '99', reason: 'wilted' }, // outside May
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
});

describe('stockPack.stockWriteoffsHandler', () => {
  it('totals + groups May write-offs by reason (excludes April)', async () => {
    const r = await stockWriteoffsHandler({ from: '2026-05-01', to: '2026-05-31' });
    expect(r.entryCount).toBe(3);
    expect(r.totalQuantity).toBe(18);
    expect(r.byReason).toEqual({ wilted: 8, damaged: 10 });
  });
});
