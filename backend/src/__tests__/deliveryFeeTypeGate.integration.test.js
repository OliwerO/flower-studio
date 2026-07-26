// Regression test for the #554 follow-up — "a cancelled delivery is not a
// deleted delivery" (CLAUDE.md pitfall cancelled-delivery-leak).
//
// Converting an order Delivery → Pickup only CANCELS the linked `deliveries`
// row (`orderRepo.updateOrder`, ~line 1398). It does not soft-delete it, and
// (deliberately, reverted on code review 2026-07-25) it does not blank the
// row's fee/address/driver either. Every read path that joins an order to its
// delivery sub-record therefore STILL finds that row and must gate on the
// ORDER's current `Delivery Type` — not merely on "a delivery record exists".
//
// #554 fixed `routes/orders.js` (list + detail). Two ungated readers survived:
//   1. `analyticsService.computeAnalytics` — built `deliveryFeeByOrder` from
//      `order._delivery['Delivery Fee']` with no type check, so a converted
//      Pickup order kept contributing phantom deliveryRevenue/totalRevenue to
//      every historical Financial-tab report covering its date range.
//   2. `routes/dashboard.js` — `enrichOrder()` fell back to
//      `order._delivery['Delivery Fee']` (and the unpaid-aging block read the
//      order's own stale `Delivery Fee` column), inflating the Today tab's
//      revenue and unpaid-aging totals.
//
// The read-time gate self-heals every order converted BEFORE the fix shipped —
// no backfill needed. These tests seed the exact post-conversion DB shape
// (Pickup order + Cancelled delivery still carrying a fee) and assert the fee
// is excluded, while a genuine Delivery order's fee still counts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { orders, deliveries } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { DELIVERY_STATUS } from '../constants/statuses.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { computeAnalytics } from '../services/analyticsService.js';
import dashboardRouter from '../routes/dashboard.js';

const PERIOD = { from: '2026-05-01', to: '2026-05-31' };
const TODAY = '2026-05-10';

// Fee on the stale (cancelled) delivery row of the converted order.
const PHANTOM_FEE = 40;
// Fee on a genuine, still-Delivery order — the control.
const REAL_FEE = 25;
// Fee still sitting on the ORDER's own column of a legacy Pickup order —
// i.e. one converted BEFORE #554 taught updateOrder to clear that column.
// The read-time gate is what heals these retroactively, with no backfill.
const LEGACY_FEE = 30;

// orders.customer_id is TEXT but customerRepo.findMany matches it against the
// uuid `customers.id` column — non-uuid ids abort the dashboard query.
const CUST_A = '11111111-1111-4111-8111-111111111111';
const CUST_B = '22222222-2222-4222-8222-222222222222';
const CUST_C = '33333333-3333-4333-8333-333333333333';

function buildDashboardApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.role = 'owner'; next(); });
  app.use('/api/dashboard', dashboardRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

let harness;

// Seeds the exact shape a Delivery → Pickup conversion leaves behind:
//   - converted order: Delivery Type = Pickup, own delivery_fee cleared to NULL
//     (updateOrder does that part), linked delivery row Cancelled but its
//     delivery_fee untouched.
//   - control order: still a real Delivery, fee live on the delivery row.
//   - legacy order: converted before #554, so its own delivery_fee column is
//     ALSO still populated — the case the read-time gate heals retroactively.
async function seed() {
  const rows = await harness.db.insert(orders).values([
    {
      appOrderId: 'BLO-CONVERTED', customerId: CUST_A,
      orderDate: TODAY, requiredBy: TODAY,
      deliveryType: 'Pickup', status: 'Picked Up',
      paymentStatus: 'Paid', source: 'Instagram',
      priceOverride: '100.00',
      deliveryFee: null,   // cleared by updateOrder's conversion cascade
    },
    {
      appOrderId: 'BLO-REAL-DELIVERY', customerId: CUST_B,
      orderDate: TODAY, requiredBy: TODAY,
      deliveryType: 'Delivery', status: 'Delivered',
      paymentStatus: 'Paid', source: 'Instagram',
      priceOverride: '200.00',
      deliveryFee: String(REAL_FEE),
    },
    {
      appOrderId: 'BLO-LEGACY-PICKUP', customerId: CUST_C,
      orderDate: TODAY, requiredBy: TODAY,
      deliveryType: 'Pickup', status: 'Ready',
      paymentStatus: 'Unpaid', source: 'Instagram',
      priceOverride: '150.00',
      deliveryFee: String(LEGACY_FEE),   // pre-#554 residue, never cleared
    },
  ]).returning();

  const byId = id => rows.find(r => r.appOrderId === id);
  const converted    = byId('BLO-CONVERTED');
  const realDelivery = byId('BLO-REAL-DELIVERY');
  const legacyPickup = byId('BLO-LEGACY-PICKUP');

  await harness.db.insert(deliveries).values([
    {
      orderId: converted.id,
      deliveryDate: TODAY,
      deliveryAddress: 'ul. Stale 1',
      status: DELIVERY_STATUS.CANCELLED,   // cancelled, NOT deleted
      deliveryFee: String(PHANTOM_FEE),    // survives the cascade by design
    },
    {
      orderId: realDelivery.id,
      deliveryDate: TODAY,
      deliveryAddress: 'ul. Prawdziwa 2',
      status: DELIVERY_STATUS.PENDING,
      deliveryFee: String(REAL_FEE),
    },
    {
      orderId: legacyPickup.id,
      deliveryDate: TODAY,
      deliveryAddress: 'ul. Legacy 3',
      status: DELIVERY_STATUS.CANCELLED,
      deliveryFee: String(LEGACY_FEE),
    },
  ]);

  return { converted, realDelivery, legacyPickup };
}

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('computeAnalytics — delivery fee is gated on the order Delivery Type', () => {
  it('excludes a cancelled delivery fee from a converted Pickup order', async () => {
    await seed();

    const report = await computeAnalytics(PERIOD);

    // Only the genuine Delivery order contributes delivery revenue.
    expect(report.delivery.deliveryRevenue).toBe(REAL_FEE);
    expect(report.revenue.delivery).toBe(REAL_FEE);
    // total = 100 (pickup, no fee) + 200 + 25 = 325 — NOT 365.
    expect(report.revenue.total).toBe(325);
    // The reconciliation invariant still holds.
    expect(report.revenue.total).toBe(report.revenue.flowers + report.revenue.delivery);
    // avgDeliveryFee averages over real deliveries only.
    expect(report.delivery.avgDeliveryFee).toBe(REAL_FEE);
  });

  it('does not expense a converted order\'s stale courier payout', async () => {
    const { converted } = await seed();
    // The cancelled delivery row keeps whatever payout it was assigned.
    await harness.db.update(deliveries)
      .set({ driverPayout: '15.00' })
      .where(eq(deliveries.orderId, converted.id));

    const report = await computeAnalytics(PERIOD);

    // Gating the fee without gating the payout would drive deliveryProfit
    // negative — both sides of the delivery P&L must use the same gate.
    expect(report.delivery.deliveryPayoutTotal).toBe(0);
    expect(report.delivery.deliveryProfit).toBe(REAL_FEE);
  });
});

describe('GET /api/dashboard — delivery fee is gated on the order Delivery Type', () => {
  it('excludes a cancelled delivery fee from today\'s revenue', async () => {
    await seed();

    const res = await supertest(buildDashboardApp())
      .get(`/api/dashboard?date=${TODAY}`)
      .expect(200);

    // Paid orders only: 100 (converted pickup, no fee) + 200 + 25 = 325.
    expect(res.body.todayRevenue).toBe(325);

    const converted = res.body.recentOrders.find(o => o['App Order ID'] === 'BLO-CONVERTED');
    expect(converted['Effective Price']).toBe(100);
  });

  it('excludes a stale order-level fee from unpaid-order aging', async () => {
    await seed();

    const res = await supertest(buildDashboardApp())
      .get(`/api/dashboard?date=${TODAY}`)
      .expect(200);

    // Only the legacy Pickup order is unpaid: 150, NOT 150 + 30.
    expect(res.body.unpaidAging.grandTotal.count).toBe(1);
    expect(res.body.unpaidAging.grandTotal.total).toBe(150);
    expect(res.body.unpaidAging.today.total).toBe(150);
  });
});
