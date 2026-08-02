// backend/src/__tests__/orders.convertToDeliveryPricing.integration.test.js
//
// POST /api/orders/:id/convert-to-delivery — pricing wiring (issue #618 /
// ADR-0019). The cost/method/distance resolution logic added in this route
// handler (backend/src/routes/orders.js) is a SEPARATE implementation from
// createOrder's (backend/src/repos/orderRepo.js) — orderRepo.deliveryPricingCreate.integration.test.js
// covers createOrder, but nothing exercised this route's copy of the same
// rules. The only existing convertToDelivery coverage
// (orderDeliveryCascade.integration.test.js) calls orderRepo.convertToDelivery
// directly, bypassing the route entirely — so the route's cost resolution,
// Florist-zero override, and Delivery Method validation had zero coverage.
//
// Wiring follows the established supertest + pglite pattern from
// deliveries.pricingFieldsPersist.integration.test.js: a dbHolder + vi.mock
// of '../db/index.js' points orderRepo at the per-test pglite harness, a
// mocked configService supplies deterministic getConfig/getDriverOfDay, and
// driverNotifyService is mocked out so no real network calls happen (the
// route notifies the assigned driver on a successful conversion).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/driverNotifyService.js', () => ({
  notifyDeliveryAssigned:    vi.fn().mockResolvedValue(undefined),
  notifyDeliveryTimeChanged: vi.fn().mockResolvedValue(undefined),
  notifyDeliveryDigest:      vi.fn().mockResolvedValue(undefined),
  notifyPoAssigned:          vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/configService.js', () => ({
  getConfig:                 vi.fn((k) => ({ defaultDeliveryFee: 25, driverCostPerDelivery: 30 }[k] ?? 0)),
  updateConfig:              vi.fn(),
  generateOrderId:           vi.fn(),
  getDriverOfDay:            vi.fn(() => 'Timur'),
  isPastCutoff:              vi.fn(),
  getActiveSeasonalCategory: vi.fn(),
  loadConfig:                vi.fn(),
  saveConfig:                vi.fn(),
}));

import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import express from 'express';
import supertest from 'supertest';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

// Import AFTER mocks are in place.
import ordersRoutes from '../routes/orders.js';
import * as orderRepo from '../repos/orderRepo.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.role = 'owner'; next(); });
  app.use('/api/orders', ordersRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

let harness, app;

// Local config passed to orderRepo.createOrder directly when seeding — the
// route itself reads the mocked configService module above. Values match so
// seed setup and route behavior stay consistent.
let orderIdCounter = 0;
const seedConfig = {
  getConfig: (k) => ({ defaultDeliveryFee: 25, driverCostPerDelivery: 30 }[k] ?? 0),
  getDriverOfDay: () => 'Timur',
  generateOrderId: async () => `BLO-CTDP-${++orderIdCounter}`,
};

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
  app = buildApp();
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

async function seedPickupOrder() {
  const { order } = await orderRepo.createOrder({
    customer: 'recCust1', customerRequest: 'Pickup test', deliveryType: 'Pickup',
    orderLines: [],
    paymentStatus: 'Unpaid', createdBy: 'florist',
  }, seedConfig, { actor: { actorRole: 'florist' } });
  return order;
}

describe('POST /api/orders/:id/convert-to-delivery — pricing (#618 / ADR-0019)', () => {
  it('persists client-supplied distance, band, and cost onto the created delivery', async () => {
    const order = await seedPickupOrder();

    const res = await supertest(app).post(`/api/orders/${order.id}/convert-to-delivery`).send({
      address: 'ul. Kwiatowa 1', fee: 50,
      distanceKm: 4.2, distanceBand: { upToKm: 5, price: 35 }, cost: 35,
    });

    expect(res.status).toBe(201);
    expect(res.body['Driver Payout']).toBe(35);
    expect(res.body['Distance (km)']).toBe(4.2);
    expect(res.body['Distance Band']).toEqual({ upToKm: 5, price: 35 });
  });

  it('falls back to the flat driverCostPerDelivery constant when no cost is supplied (unresolved address)', async () => {
    const order = await seedPickupOrder();

    const res = await supertest(app).post(`/api/orders/${order.id}/convert-to-delivery`).send({
      address: 'unresolvable address', fee: 40,
    });

    expect(res.status).toBe(201);
    expect(res.body['Driver Payout']).toBe(30); // getConfig('driverCostPerDelivery')
    expect(res.body['Distance (km)']).toBeNull();
  });

  it('Delivery Method Florist always costs zero, even with a supplied cost', async () => {
    const order = await seedPickupOrder();

    const res = await supertest(app).post(`/api/orders/${order.id}/convert-to-delivery`).send({
      address: 'ul. Kwiatowa 1', fee: 50, method: 'Florist', cost: 35,
    });

    expect(res.status).toBe(201);
    expect(res.body['Driver Payout']).toBe(0);
    expect(res.body['Delivery Method']).toBe('Florist');
  });

  it('rejects an invalid Delivery Method with 400', async () => {
    const order = await seedPickupOrder();

    const res = await supertest(app).post(`/api/orders/${order.id}/convert-to-delivery`).send({
      address: 'ul. Kwiatowa 1', method: 'Bogus',
    });

    expect(res.status).toBe(400);
  });
});
