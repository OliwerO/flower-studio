// A delivery-type order can't be marked Ready with no Delivery Fee set
// (issue #618 / ADR-0019, story 29: "I want to see that a delivery fee
// has been set before marking an Order ready").
//
// Follows the established pglite-integration pattern (see
// orderRepo.deliveryPricingCreate.integration.test.js, Task 6): mock
// '../db/index.js' with a mutable dbHolder so the harness's per-test
// pglite instance is what orderRepo actually talks to, and mock
// '../services/configService.js' since orderRepo never imports it
// directly — createOrder receives `config` as an explicit param instead.
//
// createOrder's Delivery-insert step (Task 6) already defaults
// deliveryFee to getConfig('defaultDeliveryFee') when no fee is supplied,
// so to exercise the guard directly (regardless of that default-fee
// fallback) the first test force-nulls the fee via updateDelivery before
// attempting the transition.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

vi.mock('../services/configService.js', () => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  generateOrderId: vi.fn(),
  getDriverOfDay: vi.fn(),
  isPastCutoff: vi.fn(),
  getActiveSeasonalCategory: vi.fn(),
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

import * as orderRepo from '../repos/orderRepo.js';

let harness;
let orderIdCounter = 0;
const config = {
  getConfig: (k) => ({ defaultDeliveryFee: 25, driverCostPerDelivery: 30 }[k] ?? 0),
  getDriverOfDay: () => 'Timur',
  generateOrderId: async () => `BLO-RRF-${++orderIdCounter}`,
};

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  orderIdCounter = 0;
  vi.clearAllMocks();
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('Ready requires a Delivery Fee on delivery-type orders', () => {
  it('rejects New -> Ready when the Delivery Fee is unset', async () => {
    const { order, delivery } = await orderRepo.createOrder({
      customer: 'recCust1',
      deliveryType: 'Delivery',
      orderLines: [],
      delivery: { address: 'ul. Kwiatowa 1' }, // no fee supplied
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // Force the fee to null even though createOrder defaults it, to exercise
    // the guard directly regardless of the default-fee fallback.
    await orderRepo.updateDelivery(delivery.id, { 'Delivery Fee': null }, { actor: { actorRole: 'owner' } });

    await expect(
      orderRepo.transitionStatus(order.id, 'Ready', {}, { actor: { actorRole: 'florist' } }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('allows New -> Ready once the Delivery Fee is set', async () => {
    const { order } = await orderRepo.createOrder({
      customer: 'recCust2',
      deliveryType: 'Delivery',
      orderLines: [],
      delivery: { address: 'ul. Kwiatowa 1', fee: 50 },
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    const result = await orderRepo.transitionStatus(order.id, 'Ready', {}, { actor: { actorRole: 'florist' } });
    expect(result.Status).toBe('Ready');
  });

  it('does not gate Pickup orders on a Delivery Fee at all', async () => {
    const { order } = await orderRepo.createOrder({
      customer: 'recCust3',
      deliveryType: 'Pickup',
      orderLines: [],
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    const result = await orderRepo.transitionStatus(order.id, 'Ready', {}, { actor: { actorRole: 'florist' } });
    expect(result.Status).toBe('Ready');
  });
});
