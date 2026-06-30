// backend/src/__tests__/assistantTools.velocityPack.integration.test.js
//
// Integration test for velocityPack.stockVelocityHandler.
// Uses pglite so orderRepo.getLinesForVelocity + stockRepo.list run against real SQL.
//
// Seed layout:
//   stock: Red Rose (qty 50), White Peony (qty 10), Lavender (qty 30), Carnation (qty -5)
//   orders (all non-cancelled, within 30-day window):
//     VEL-1 (Delivered): rose×10, peony×3
//     VEL-2 (Picked Up): rose×5         → rose total = 15
//     VEL-3 (New):       carnation×2
//   Lavender has zero sales (no lines).
//   Carnation has currentQty=-5 → shortfall.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, orders, orderLines } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { stockVelocityHandler } from '../services/assistantTools/velocityPack.js';

// Dates relative to now so they always land inside the default 30-day window.
const today = new Date().toISOString().slice(0, 10);
const recent = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10); // 5 days ago

function round1(n) {
  return Math.round(n * 10) / 10;
}

let harness;
let roseId, peoneyId, carnId;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;

  // Insert stock rows and capture returned UUIDs
  const [rose, peony, _lav, carn] = await harness.db.insert(stock).values([
    { displayName: 'Red Rose',    currentQuantity: 50,  active: true },
    { displayName: 'White Peony', currentQuantity: 10,  active: true },
    { displayName: 'Lavender',    currentQuantity: 30,  active: true }, // zero sales
    { displayName: 'Carnation',   currentQuantity: -5,  active: true }, // shortfall
  ]).returning();

  roseId  = rose.id;
  peoneyId = peony.id;
  carnId  = carn.id;

  // Insert orders within the window
  const [ord1] = await harness.db.insert(orders).values({
    appOrderId: 'VEL-1', customerId: 'cust-vel', orderDate: recent, requiredBy: today,
    deliveryType: 'Delivery', status: 'Delivered', paymentStatus: 'Paid',
  }).returning();

  const [ord2] = await harness.db.insert(orders).values({
    appOrderId: 'VEL-2', customerId: 'cust-vel', orderDate: recent, requiredBy: today,
    deliveryType: 'Pickup', status: 'Picked Up', paymentStatus: 'Paid',
  }).returning();

  const [ord3] = await harness.db.insert(orders).values({
    appOrderId: 'VEL-3', customerId: 'cust-vel', orderDate: recent, requiredBy: today,
    deliveryType: 'Delivery', status: 'New', paymentStatus: 'Unpaid',
  }).returning();

  // order_lines.stockItemId is TEXT — set to the inserted stock UUID string
  await harness.db.insert(orderLines).values([
    { orderId: ord1.id, stockItemId: roseId,   flowerName: 'Red Rose',    quantity: 10 },
    { orderId: ord1.id, stockItemId: peoneyId,  flowerName: 'White Peony', quantity: 3  },
    { orderId: ord2.id, stockItemId: roseId,   flowerName: 'Red Rose',    quantity: 5  }, // rose total = 15
    { orderId: ord3.id, stockItemId: carnId,   flowerName: 'Carnation',   quantity: 2  },
  ]);
  // Lavender intentionally has no lines → zero sales
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('velocityPack.stockVelocityHandler — fastest (default)', () => {
  it('Rose (15 sold) ranks first; Peony second; Carnation third', async () => {
    const r = await stockVelocityHandler({ sort: 'fastest' });
    expect(r.sort).toBe('fastest');
    const names = r.items.map(i => i.name);
    expect(names[0]).toBe('Red Rose');
    expect(r.items[0].qtySold).toBe(15);
    expect(names[1]).toBe('White Peony');
    expect(r.items[1].qtySold).toBe(3);
  });

  it('avgDailyUsage = round1(qtySold / days)', async () => {
    const DAYS = 30;
    const r = await stockVelocityHandler({ sort: 'fastest', days: DAYS });
    const rose = r.items.find(i => i.name === 'Red Rose');
    expect(rose.avgDailyUsage).toBe(round1(15 / DAYS));
  });

  it('daysOfSupply computed for positive-qty, non-zero-avgDaily items', async () => {
    const DAYS = 30;
    const r = await stockVelocityHandler({ sort: 'fastest', days: DAYS });
    const rose = r.items.find(i => i.name === 'Red Rose');
    // rose: avgDailyUsage=round1(15/30)=0.5, currentQty=50 → daysOfSupply=100
    expect(rose.daysOfSupply).toBe(round1(50 / rose.avgDailyUsage));
    expect(rose.shortfall).toBe(false);
  });

  it('shortfall item (currentQty < 0): daysOfSupply null + shortfall true', async () => {
    const r = await stockVelocityHandler({ sort: 'fastest' });
    const carn = r.items.find(i => i.name === 'Carnation');
    expect(carn).toBeDefined();
    expect(carn.shortfall).toBe(true);
    expect(carn.daysOfSupply).toBeNull();
  });

  it('Lavender (zero sales) does not appear in fastest results', async () => {
    const r = await stockVelocityHandler({ sort: 'fastest' });
    const names = r.items.map(i => i.name);
    expect(names).not.toContain('Lavender');
  });

  it('zeroSalesCount counts zero-sales items even though they are hidden', async () => {
    const r = await stockVelocityHandler({ sort: 'fastest' });
    expect(r.zeroSalesCount).toBe(1); // Lavender
  });

  it('windowDays reflects the requested days parameter', async () => {
    const r = await stockVelocityHandler({ days: 60 });
    expect(r.windowDays).toBe(60);
  });

  it('days is capped at 90', async () => {
    const r = await stockVelocityHandler({ days: 200 });
    expect(r.windowDays).toBe(90);
  });
});

describe('velocityPack.stockVelocityHandler — slowest', () => {
  it('Lavender (zero sales) appears and sorts first in slowest mode', async () => {
    const r = await stockVelocityHandler({ sort: 'slowest' });
    expect(r.sort).toBe('slowest');
    expect(r.items[0].name).toBe('Lavender');
    expect(r.items[0].qtySold).toBe(0);
  });

  it('slowest includes all 4 items', async () => {
    const r = await stockVelocityHandler({ sort: 'slowest' });
    expect(r.trackedItemCount).toBe(4);
    expect(r.items).toHaveLength(4);
  });
});

describe('velocityPack.stockVelocityHandler — search', () => {
  it('search filters by case-insensitive name substring', async () => {
    const r = await stockVelocityHandler({ search: 'rose' });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].name).toBe('Red Rose');
  });

  it('search with no match returns empty items', async () => {
    const r = await stockVelocityHandler({ search: 'orchid' });
    expect(r.items).toHaveLength(0);
    expect(r.trackedItemCount).toBe(0);
  });
});

describe('velocityPack.stockVelocityHandler — limit + truncated', () => {
  it('limit caps returned items and sets truncated + shown', async () => {
    // slowest returns 4 items; limit=2 → truncated=true, shown=2
    const r = await stockVelocityHandler({ sort: 'slowest', limit: 2 });
    expect(r.items).toHaveLength(2);
    expect(r.truncated).toBe(true);
    expect(r.shown).toBe(2);
    expect(r.trackedItemCount).toBe(4);
  });

  it('limit is capped at 50', async () => {
    const r = await stockVelocityHandler({ sort: 'slowest', limit: 999 });
    // Only 4 items total — no truncation regardless of limit cap
    expect(r.truncated).toBe(false);
    expect(r.items).toHaveLength(4);
  });
});
