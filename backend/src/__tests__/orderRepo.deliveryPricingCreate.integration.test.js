// orderRepo.createOrder — delivery pricing wiring (issue #618 / ADR-0019).
//
// createOrder's delivery-insert step now accepts client-supplied
// distanceKm/distanceBand/cost (sourced from the quote endpoint or an Owner
// override) and persists them onto the new delivery row. A Florist Delivery
// Method always forces the cost to zero — that time is already paid via
// Florist Hours — regardless of any client-supplied cost, via the shared
// `zeroCostFieldsForMethod` helper (same rule enforced by deliveries.js's
// PATCH route).
//
// Follows the established pglite-integration pattern from
// orderRepo.fefo.integration.test.js / orderRepo.integration.test.js: mock
// '../db/index.js' with a mutable dbHolder so the harness's per-test pglite
// instance is what orderRepo (and everything it imports) actually talks to,
// and mock '../services/configService.js' since orderRepo never imports it
// directly — createOrder receives `config` as an explicit param instead.
// `orders.customer_id` is TEXT with no FK constraint, so a bare string
// customer id (no real customers row) is enough to satisfy NOT NULL.

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
  generateOrderId: async () => `BLO-DPC-${++orderIdCounter}`,
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

describe('orderRepo.createOrder — delivery pricing', () => {
  it('persists the client-supplied distance, band, and cost onto the new delivery', async () => {
    const { delivery } = await orderRepo.createOrder({
      customer: 'recCust1',
      deliveryType: 'Delivery',
      orderLines: [],
      delivery: {
        address: 'ul. Kwiatowa 1', fee: 50,
        distanceKm: 4.2, distanceBand: { upToKm: 5, price: 35 }, cost: 35,
      },
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    expect(delivery['Driver Payout']).toBe(35);
    expect(delivery['Distance (km)']).toBe(4.2);
    expect(delivery['Distance Band']).toEqual({ upToKm: 5, price: 35 });
  });

  it('falls back to the flat driverCostPerDelivery constant when no cost is supplied (unresolved address)', async () => {
    const { delivery } = await orderRepo.createOrder({
      customer: 'recCust2',
      deliveryType: 'Delivery',
      orderLines: [],
      delivery: { address: 'unresolvable address', fee: 40 },
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    expect(delivery['Driver Payout']).toBe(config.getConfig('driverCostPerDelivery') || 0);
    expect(delivery['Distance (km)']).toBeNull();
  });

  it('Delivery Method Florist always costs zero, even with a supplied cost', async () => {
    const { delivery } = await orderRepo.createOrder({
      customer: 'recCust3',
      deliveryType: 'Delivery',
      orderLines: [],
      delivery: { address: 'ul. Kwiatowa 1', fee: 50, method: 'Florist', cost: 35 },
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    expect(delivery['Driver Payout']).toBe(0);
    expect(delivery['Delivery Method']).toBe('Florist');
  });
});
