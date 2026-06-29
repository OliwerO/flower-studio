// backend/src/__tests__/assistantTools.trendsPack.integration.test.js
//
// Parity integration test: salesTrendsHandler must produce the same numbers
// as computeAnalytics (pglite in-process, real SQL migrations).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { orders } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { salesTrendsHandler } from '../services/assistantTools/trendsPack.js';
import { computeAnalytics } from '../services/analyticsService.js';

// Day names indexed by JS getDay() (0=Sunday, 1=Monday, ..., 6=Saturday).
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;

  // Seed orders across two calendar months so monthly has >=2 rows.
  // Required By dates deliberately hit different days of the week so that
  // at least some weeklyRhythm buckets have non-zero counts.
  //
  // May 2026 orders:
  //   BLO-T1  2026-05-06 (Wednesday, dayIndex 3) — Delivered, Paid, Cash
  //   BLO-T2  2026-05-14 (Thursday, dayIndex 4)  — Picked Up, Paid, Card
  //   BLO-T3  2026-05-20 (Wednesday, dayIndex 3) — Cancelled (funnel test)
  //
  // June 2026 orders:
  //   BLO-T4  2026-06-03 (Wednesday, dayIndex 3) — Delivered, Paid, Cash
  //   BLO-T5  2026-06-11 (Thursday, dayIndex 4)  — New, Unpaid, Cash
  await harness.db.insert(orders).values([
    {
      appOrderId:    'BLO-T1',
      customerId:    'cust-trends',
      orderDate:     '2026-05-05',
      requiredBy:    '2026-05-06',
      deliveryType:  'Delivery',
      status:        'Delivered',
      paymentStatus: 'Paid',
      paymentMethod: 'Cash',
      priceOverride: '150.00',
    },
    {
      appOrderId:    'BLO-T2',
      customerId:    'cust-trends',
      orderDate:     '2026-05-13',
      requiredBy:    '2026-05-14',
      deliveryType:  'Pickup',
      status:        'Picked Up',
      paymentStatus: 'Paid',
      paymentMethod: 'Card',
      priceOverride: '80.00',
    },
    {
      appOrderId:    'BLO-T3',
      customerId:    'cust-trends',
      orderDate:     '2026-05-19',
      requiredBy:    '2026-05-20',
      deliveryType:  'Pickup',
      status:        'Cancelled',
      paymentStatus: 'Unpaid',
      paymentMethod: null,
      priceOverride: '60.00',
    },
    {
      appOrderId:    'BLO-T4',
      customerId:    'cust-trends',
      orderDate:     '2026-06-02',
      requiredBy:    '2026-06-03',
      deliveryType:  'Delivery',
      status:        'Delivered',
      paymentStatus: 'Paid',
      paymentMethod: 'Cash',
      priceOverride: '120.00',
    },
    {
      appOrderId:    'BLO-T5',
      customerId:    'cust-trends',
      orderDate:     '2026-06-10',
      requiredBy:    '2026-06-11',
      deliveryType:  'Pickup',
      status:        'New',
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      priceOverride: '100.00',
    },
  ]);
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

const PARAMS = { from: '2026-05-01', to: '2026-06-30' };

describe('trendsPack.salesTrendsHandler', () => {
  it('returns period echo with the supplied from/to', async () => {
    const tool = await salesTrendsHandler(PARAMS);
    expect(tool.period).toEqual({ from: '2026-05-01', to: '2026-06-30' });
  });

  it('monthly rows match computeAnalytics (parity) and omit gross flowerRevenue/deliveryRevenue', async () => {
    const tool = await salesTrendsHandler(PARAMS);
    const full = await computeAnalytics(PARAMS);

    // Same number of months and same month keys.
    expect(tool.monthly.map(m => m.month).sort()).toEqual(
      full.monthly.map(m => m.month).sort(),
    );

    // For each month the tool must carry the four allowed fields and match computeAnalytics.
    for (const toolMonth of tool.monthly) {
      const canonical = full.monthly.find(m => m.month === toolMonth.month);
      expect(canonical).toBeDefined();
      expect(toolMonth.revenue).toBe(canonical.revenue);
      expect(toolMonth.orderCount).toBe(canonical.orderCount);
      expect(toolMonth.paidOrderCount).toBe(canonical.paidOrderCount);
      // Gross breakdown fields and the gross-based margin must NOT be exposed
      // (they don't reconcile with the net top-level figures).
      expect(toolMonth).not.toHaveProperty('flowerRevenue');
      expect(toolMonth).not.toHaveProperty('deliveryRevenue');
      expect(toolMonth).not.toHaveProperty('flowerMarginPercent');
    }

    // At least two months are represented (we seeded May + June).
    expect(tool.monthly.length).toBeGreaterThanOrEqual(2);
  });

  it('weeklyRhythm has exactly 7 elements with correct day labels', async () => {
    const tool = await salesTrendsHandler(PARAMS);
    const full = await computeAnalytics(PARAMS);

    expect(tool.weeklyRhythm).toHaveLength(7);

    // Every element must carry a day name that matches DAY_NAME[dayIndex].
    for (const entry of tool.weeklyRhythm) {
      expect(entry.day).toBe(DAY_NAME[entry.dayIndex]);
      expect(entry).toHaveProperty('orderCount');
      expect(entry).toHaveProperty('avgRevenue');
    }

    // The set of dayIndex values must cover all 7 days exactly once.
    const seenDayIndexes = tool.weeklyRhythm.map(e => e.dayIndex).sort((a, b) => a - b);
    expect(seenDayIndexes).toEqual([0, 1, 2, 3, 4, 5, 6]);

    // Counts must match computeAnalytics (parity check).
    for (const toolDay of tool.weeklyRhythm) {
      const canonical = full.weeklyRhythm.find(d => d.dayIndex === toolDay.dayIndex);
      expect(canonical).toBeDefined();
      expect(toolDay.orderCount).toBe(canonical.orderCount);
      expect(toolDay.avgRevenue).toBe(canonical.avgRevenue);
    }
  });

  it('funnel matches computeAnalytics.orders.funnel exactly', async () => {
    const tool = await salesTrendsHandler(PARAMS);
    const full = await computeAnalytics(PARAMS);

    expect(tool.funnel).toEqual(full.orders.funnel);

    // Sanity-check the funnel numbers with what we seeded:
    //   totalCreated = 5 (4 non-cancelled + 1 cancelled)
    //   completed    = 3 (Delivered x2 + Picked Up x1)
    //   cancelled    = 1
    expect(tool.funnel.totalCreated).toBe(5);
    expect(tool.funnel.completed).toBe(3);
    expect(tool.funnel.cancelled).toBe(1);
  });

  it('paymentAnalysis matches computeAnalytics.paymentAnalysis exactly', async () => {
    const tool = await salesTrendsHandler(PARAMS);
    const full = await computeAnalytics(PARAMS);

    expect(tool.paymentAnalysis).toEqual(full.paymentAnalysis);

    // We seeded Cash orders (BLO-T1, BLO-T4 paid; BLO-T5 unpaid) and one Card order (BLO-T2 paid).
    // BLO-T3 (cancelled) has no payment method → 'Not recorded'.
    const cashEntry = tool.paymentAnalysis.find(p => p.method === 'Cash');
    const cardEntry = tool.paymentAnalysis.find(p => p.method === 'Card');
    expect(cashEntry).toBeDefined();
    expect(cardEntry).toBeDefined();
    // 3 orders with method=Cash (T1 paid, T4 paid, T5 unpaid)
    expect(cashEntry.count).toBe(3);
    expect(cashEntry.paidCount).toBe(2);
    expect(cashEntry.unpaidCount).toBe(1);
    // 1 order with method=Card (T2 paid)
    expect(cardEntry.count).toBe(1);
    expect(cardEntry.paidCount).toBe(1);
    expect(cardEntry.unpaidCount).toBe(0);
  });
});
