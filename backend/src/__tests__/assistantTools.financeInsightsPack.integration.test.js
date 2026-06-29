// backend/src/__tests__/assistantTools.financeInsightsPack.integration.test.js
//
// Parity integration tests — pglite + computeAnalytics.
// Each handler must return data that is literally derived from computeAnalytics,
// so numbers can never drift from /api/analytics.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { orders, orderLines } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import {
  topProductsHandler,
  channelEfficiencyHandler,
  comparePeriodsHandler,
} from '../services/assistantTools/financeInsightsPack.js';
import { computeAnalytics } from '../services/analyticsService.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;

  // Seed two paid orders in May 2026 with order lines so topProducts/sourceEfficiency
  // have meaningful data to aggregate.
  const [orderA] = await harness.db.insert(orders).values({
    appOrderId:    'FIP-1',
    customerId:    'cust-a',
    orderDate:     '2026-05-05',
    requiredBy:    '2026-05-06',
    deliveryType:  'Pickup',
    status:        'Picked Up',
    paymentStatus: 'Paid',
    source:        'Instagram',
    priceOverride: '150.00',
  }).returning();

  const [orderB] = await harness.db.insert(orders).values({
    appOrderId:    'FIP-2',
    customerId:    'cust-b',
    orderDate:     '2026-05-12',
    requiredBy:    '2026-05-13',
    deliveryType:  'Pickup',
    status:        'Picked Up',
    paymentStatus: 'Paid',
    source:        'Wix',
    priceOverride: '90.00',
  }).returning();

  // Lines for orderA: Rose x5 + Tulip x3
  await harness.db.insert(orderLines).values([
    {
      orderId:          orderA.id,
      flowerName:       'Rose',
      quantity:         5,
      costPricePerUnit: '10.00',
      sellPricePerUnit: '25.00',
    },
    {
      orderId:          orderA.id,
      flowerName:       'Tulip',
      quantity:         3,
      costPricePerUnit: '5.00',
      sellPricePerUnit: '12.00',
    },
  ]);

  // Lines for orderB: Rose x2 (same product, different order)
  await harness.db.insert(orderLines).values([
    {
      orderId:          orderB.id,
      flowerName:       'Rose',
      quantity:         2,
      costPricePerUnit: '10.00',
      sellPricePerUnit: '25.00',
    },
  ]);

  // Seed an order in April 2026 (period2 for comparePeriodsHandler)
  await harness.db.insert(orders).values({
    appOrderId:    'FIP-3',
    customerId:    'cust-c',
    orderDate:     '2026-04-10',
    requiredBy:    '2026-04-11',
    deliveryType:  'Pickup',
    status:        'Picked Up',
    paymentStatus: 'Paid',
    source:        'Instagram',
    priceOverride: '200.00',
  });
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

// ── topProductsHandler ────────────────────────────────────────────────────────

describe('financeInsightsPack.topProductsHandler', () => {
  it('products match computeAnalytics topProducts (parity)', async () => {
    const params = { from: '2026-05-01', to: '2026-05-31' };
    const tool = await topProductsHandler(params);
    const full = await computeAnalytics(params);

    // total = same count as full topProducts array
    expect(tool.total).toBe(full.orders.topProducts.length);
    // shown = min(total, 10)
    expect(tool.shown).toBe(Math.min(tool.total, 10));

    // Each tool product should map to the matching full product by name
    tool.products.forEach((tp, i) => {
      const fp = full.orders.topProducts[i];
      expect(tp.name).toBe(fp.name);
      expect(tp.totalQty).toBe(fp.totalQty);
      expect(tp.revenue).toBe(fp.revenue);
      expect(tp.cost).toBe(fp.cost);
      expect(tp.trend).toBe(fp.trend);
    });

    // Period echo
    expect(tool.period).toEqual({ from: '2026-05-01', to: '2026-05-31' });
  });

  it('respects the limit parameter', async () => {
    const params = { from: '2026-05-01', to: '2026-05-31', limit: 1 };
    const tool = await topProductsHandler(params);
    expect(tool.shown).toBe(1);
    expect(tool.products).toHaveLength(1);
    // total reflects the real count, not the limit
    const full = await computeAnalytics({ from: '2026-05-01', to: '2026-05-31' });
    expect(tool.total).toBe(full.orders.topProducts.length);
  });

  it('topProducts is non-empty (data assertion)', async () => {
    const tool = await topProductsHandler({ from: '2026-05-01', to: '2026-05-31' });
    expect(tool.total).toBeGreaterThan(0);
    expect(tool.products.length).toBeGreaterThan(0);
  });
});

// ── channelEfficiencyHandler ──────────────────────────────────────────────────

describe('financeInsightsPack.channelEfficiencyHandler', () => {
  it('channels toEqual computeAnalytics sourceEfficiency (parity)', async () => {
    const params = { from: '2026-05-01', to: '2026-05-31' };
    const tool = await channelEfficiencyHandler(params);
    const full = await computeAnalytics(params);

    expect(tool.channels).toEqual(full.orders.sourceEfficiency);
    expect(tool.period).toEqual({ from: '2026-05-01', to: '2026-05-31' });
  });

  it('channels is non-empty (data assertion)', async () => {
    const tool = await channelEfficiencyHandler({ from: '2026-05-01', to: '2026-05-31' });
    expect(tool.channels.length).toBeGreaterThan(0);
  });
});

// ── comparePeriodsHandler ─────────────────────────────────────────────────────

describe('financeInsightsPack.comparePeriodsHandler', () => {
  it('p1/p2 revenue match each computeAnalytics call', async () => {
    const p1 = { from: '2026-04-01', to: '2026-04-30' };
    const p2 = { from: '2026-05-01', to: '2026-05-31' };

    const tool = await comparePeriodsHandler({
      from1: p1.from, to1: p1.to,
      from2: p2.from, to2: p2.to,
      label1: 'April', label2: 'May',
    });
    const [full1, full2] = await Promise.all([
      computeAnalytics(p1),
      computeAnalytics(p2),
    ]);

    // Period echo
    expect(tool.period1).toEqual({ from: '2026-04-01', to: '2026-04-30', label: 'April' });
    expect(tool.period2).toEqual({ from: '2026-05-01', to: '2026-05-31', label: 'May' });

    // Revenue p1/p2 match the two reports
    expect(tool.metrics.revenue.p1).toBeCloseTo(full1.revenue.total, 2);
    expect(tool.metrics.revenue.p2).toBeCloseTo(full2.revenue.total, 2);

    // Delta math is correct
    const expectedDelta = Math.round((full2.revenue.total - full1.revenue.total) * 100) / 100;
    expect(tool.metrics.revenue.delta).toBeCloseTo(expectedDelta, 2);

    // pctChange guards divide-by-zero: if p1=0 then pctChange=null
    if (full1.revenue.total === 0) {
      expect(tool.metrics.revenue.pctChange).toBeNull();
    } else {
      const expectedPct = Math.round(((full2.revenue.total - full1.revenue.total) / full1.revenue.total) * 1000) / 10;
      expect(tool.metrics.revenue.pctChange).toBeCloseTo(expectedPct, 1);
    }

    // orderCount follows same pattern
    expect(tool.metrics.orderCount.p1).toBe(full1.revenue.orderCount);
    expect(tool.metrics.orderCount.p2).toBe(full2.revenue.orderCount);
    expect(tool.metrics.orderCount.delta).toBe(full2.revenue.orderCount - full1.revenue.orderCount);
  });

  it('uses null labels when omitted', async () => {
    const tool = await comparePeriodsHandler({
      from1: '2026-04-01', to1: '2026-04-30',
      from2: '2026-05-01', to2: '2026-05-31',
    });
    expect(tool.period1.label).toBeNull();
    expect(tool.period2.label).toBeNull();
  });
});
