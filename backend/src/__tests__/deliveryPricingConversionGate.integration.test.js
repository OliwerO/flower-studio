// Regression test for issue #618 / ADR-0019 — the conversion gate keeps
// working now that Delivery Cost is a REAL, distance-derived number.
//
// CLAUDE.md pitfall `cancelled-delivery-leak`: a Delivery -> Pickup
// conversion (`orderRepo.updateOrder`'s cascade, ~line 1409) only sets the
// linked `deliveries` row's Status to Cancelled. It does NOT soft-delete the
// row, and does NOT blank its fee/payout fields (blanking was implemented and
// reverted on code review 2026-07-25 — an accidental mis-tap must not destroy
// recoverable data). Every reader therefore STILL finds that row and must
// gate on the ORDER's CURRENT Delivery Type
// (`backend/src/utils/deliveryGate.js`'s `isDeliveryOrder`), not merely on
// "a delivery record exists".
//
// `analyticsService.computeAnalytics` already carries this gate (fixed for
// the #554 follow-up, regression-locked by
// `deliveryFeeTypeGate.integration.test.js`) — but until this feature,
// Driver Payout (the reused column that is now ALSO "Delivery Cost", see
// schema.js's driverPayout comment) was always ~= the flat
// `driverCostPerDelivery` constant, the SAME rough magnitude as Delivery Fee.
// A stale post-conversion read of the cancelled delivery's payout was
// therefore numerically hard to distinguish from a correctly-gated zero in
// a coarse assertion. Task 6 wired a real distance-derived cost into order
// creation (`orderRepo.createOrder`'s delivery insert step), so fee and cost
// are now genuinely different, non-coincidental numbers — a gate failure
// here would visibly move the analytics totals, not just wobble them.
//
// This test is deliberately end-to-end through the REAL functions (not
// hand-seeded rows like deliveryFeeTypeGate's fixture): a real
// `orderRepo.createOrder` with a distance-derived cost from the actual
// `deliveryPricingService` module, a real `orderRepo.updateOrder`
// Delivery -> Pickup cascade, then a real `computeAnalytics` read — proving
// the whole pipeline stays gated together, not just the analytics half.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { PAYMENT_STATUS } from '../constants/statuses.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import * as orderRepo from '../repos/orderRepo.js';
import { computeAnalytics } from '../services/analyticsService.js';
import { bandForDistanceKm, computeDeliveryCost, toBandSnapshot } from '../services/deliveryPricingService.js';

// An owner-configured Distance Band table (ADR-0019 shape) — used to derive
// a genuine, non-round Delivery Cost from a distance via the REAL production
// pricing module, so it is not coincidentally equal to the Delivery Fee.
const DISTANCE_BANDS = [
  { id: 1, upToKm: 5,    price: 25 },
  { id: 2, upToKm: 10,   price: 42 },
  { id: 3, upToKm: null, price: 60 },
];

const seedConfig = {
  getConfig: (k) => ({ defaultDeliveryFee: 25, driverCostPerDelivery: 30 }[k] ?? 0),
  getDriverOfDay: () => 'Timur',
  generateOrderId: async () => 'BLO-GATE-TEST',
};

let harness;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('Delivery -> Pickup conversion excludes real Delivery Cost/Fee from analytics (#618)', () => {
  it('a converted order stops contributing its real fee and payout to today\'s report', async () => {
    const today = new Date().toISOString().slice(0, 10);

    const distanceKm = 8;
    const band = bandForDistanceKm(distanceKm, DISTANCE_BANDS);
    const cost = computeDeliveryCost(distanceKm, DISTANCE_BANDS); // 42 — real, distance-derived
    const fee = 65; // owner-set client fee — deliberately distinct from cost

    expect(cost).not.toBe(fee); // sanity: the two numbers must genuinely differ

    const { order } = await orderRepo.createOrder({
      customer: 'recGateTestCustomer',
      customerRequest: 'Conversion gate regression test',
      deliveryType: 'Delivery',
      orderLines: [],
      paymentStatus: PAYMENT_STATUS.PAID,
      createdBy: 'florist',
      delivery: {
        address: 'ul. Kwiatowa 1',
        fee,
        distanceKm,
        distanceBand: toBandSnapshot(band),
        cost,
      },
    }, seedConfig, { actor: { actorRole: 'florist' } });

    // Sanity check: while still a Delivery, the order DOES contribute its
    // real fee/payout — proves the numbers actually flow through before we
    // assert they are excluded post-conversion.
    const beforeReport = await computeAnalytics({ from: today, to: today });
    expect(beforeReport.delivery.deliveryRevenue).toBe(fee);
    expect(beforeReport.delivery.deliveryPayoutTotal).toBe(cost);

    // Convert Delivery -> Pickup via the REAL cascade (#317 / orderRepo.js
    // ~line 1409): cancels the linked delivery, does NOT delete it — the row
    // still carries its real Delivery Fee / Driver Payout values.
    await orderRepo.updateOrder(
      order.id,
      { 'Delivery Type': 'Pickup' },
      { actor: { actorRole: 'owner' } },
    );

    const afterReport = await computeAnalytics({ from: today, to: today });

    // Load-bearing assertions: the now-Pickup order's real fee/payout must be
    // completely excluded from today's totals — not merely reduced — and the
    // delivery P&L must not go negative from an ungated payout.
    expect(afterReport.delivery.deliveryRevenue).toBe(0);
    expect(afterReport.delivery.deliveryPayoutTotal).toBe(0);
    expect(afterReport.delivery.deliveryProfit).toBe(0);
    expect(afterReport.revenue.delivery).toBe(0);
  });
});
