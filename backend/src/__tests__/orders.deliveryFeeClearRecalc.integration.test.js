// Regression test for #644 — "Order total incorrectly includes driver payment
// fee in customer price".
//
// Owner's repro (prod order 202608-002): customer price 1000 zł, delivery FREE
// for the customer, but the courier is still paid 35 zł. She cleared the
// customer Delivery Fee and entered 35 as the Driver Payout. The order total
// stayed 1035 zł and never recalculated back to 1000.
//
// Root cause (prod row confirms it):
//     orders.delivery_fee   = 35.00   ← stale copy written at creation
//     deliveries.delivery_fee = NULL  ← what she actually cleared
//     deliveries.driver_payout = 35.00
//
// `GET /api/orders/:id` computed the fee as
//     order['Delivery Fee'] || delivery?.['Delivery Fee'] || 0
// i.e. the order's own redundant column WINS over the delivery sub-record —
// the exact inversion CLAUDE.md pitfall #2 warns about ("Delivery fee lives on
// the delivery record; the order-level field may be empty or stale"). Nothing
// keeps that column in sync: PATCH /api/deliveries/:id writes only the
// delivery row, so clearing the fee there can never change the total.
//
// The list endpoint already re-derived the fee from the delivery record, so
// the same order showed 1000 in the list and 1035 in the detail — which is why
// the total "wouldn't recalculate" no matter how many times she reopened it.
//
// Driver Payout is a COST, never part of what the customer owes; the last test
// pins that it can never reach the total.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/driverNotifyService.js', () => ({
  notifyDeliveryAssigned:    vi.fn().mockResolvedValue(undefined),
  notifyDeliveryTimeChanged: vi.fn().mockResolvedValue(undefined),
  notifyDeliveryDigest:      vi.fn().mockResolvedValue(undefined),
  notifyPoAssigned:          vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/orderService.js', () => ({
  sendDeliveryCompleteAlert: vi.fn(),
}));

vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));

vi.mock('../services/configService.js', () => ({
  getConfig:                 vi.fn((k) => ({ defaultDeliveryFee: 35, driverCostPerDelivery: 35 }[k] ?? 0)),
  updateConfig:              vi.fn(),
  generateOrderId:           async () => 'TEST-644',
  getDriverOfDay:            () => 'Timur',
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

// Import AFTER the mocks are in place.
import * as orderRepo from '../repos/orderRepo.js';
import ordersRouter from '../routes/orders.js';
import deliveriesRouter from '../routes/deliveries.js';

const seedConfig = {
  getConfig: (k) => ({ defaultDeliveryFee: 35, driverCostPerDelivery: 35 }[k] ?? 0),
  getDriverOfDay: () => 'Timur',
  generateOrderId: async () => 'TEST-644',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.role = 'owner'; req.driverName = null; next(); });
  app.use('/api/orders', ordersRouter);
  app.use('/api/deliveries', deliveriesRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

let harness, app, orderId, deliveryId;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
  app = buildApp();

  const { stock } = await import('../db/schema.js');
  const [s1] = await harness.db.insert(stock).values({
    airtableId: 'recStock644', displayName: 'Red Rose', currentQuantity: 100,
    currentCostPrice: '4.50', currentSellPrice: '15.00', active: true,
  }).returning();

  // The owner's order: Price Override 1000 replaces the flower total; the
  // wizard's pre-filled 35 zł customer delivery fee rides on top → 1035.
  const { order, delivery } = await orderRepo.createOrder({
    customer: 'recCust644', customerRequest: '#644 repro',
    deliveryType: 'Delivery',
    requiredBy: '2026-08-10',
    priceOverride: 1000,
    orderLines: [{ stockItemId: s1.id, flowerName: 'Red Rose', sellPricePerUnit: 15, costPricePerUnit: 4.5, quantity: 3 }],
    delivery: { address: 'ul. Floriańska 1', date: '2026-08-10', fee: 35, driver: 'Timur' },
    paymentStatus: 'Unpaid', createdBy: 'florist',
  }, seedConfig, { actor: { actorRole: 'owner' } });

  orderId = order.id;
  deliveryId = delivery.id;
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('#644 — clearing the customer Delivery Fee recalculates the order total', () => {
  it('detail and list agree on the total BEFORE any edit (control)', async () => {
    const detail = await supertest(app).get(`/api/orders/${orderId}`);
    expect(detail.body['Final Price']).toBe(1035);

    const list = await supertest(app).get('/api/orders');
    const row = list.body.find(o => o.id === orderId);
    expect(row['Final Price']).toBe(1035);
  });

  it('drops the fee from the total once the customer fee is cleared on the delivery record', async () => {
    const patch = await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .send({ 'Delivery Fee': null, 'Driver Payout': 35 });
    expect(patch.status).toBe(200);

    // The detail view is the one the owner reopened over and over.
    const detail = await supertest(app).get(`/api/orders/${orderId}`);
    expect(detail.body['Final Price']).toBe(1000);
    expect(Number(detail.body['Delivery Fee'] || 0)).toBe(0);

    // ...and the list must agree with it, not disagree by 35.
    const list = await supertest(app).get('/api/orders');
    const row = list.body.find(o => o.id === orderId);
    expect(row['Final Price']).toBe(1000);
  });

  it('follows a fee CHANGE too, not only a clear', async () => {
    await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .send({ 'Delivery Fee': 50 });

    const detail = await supertest(app).get(`/api/orders/${orderId}`);
    expect(detail.body['Final Price']).toBe(1050);
    expect(Number(detail.body['Delivery Fee'])).toBe(50);

    const list = await supertest(app).get('/api/orders');
    const row = list.body.find(o => o.id === orderId);
    expect(row['Final Price']).toBe(1050);
  });

  it('never lets Driver Payout reach the customer total', async () => {
    await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .send({ 'Delivery Fee': null, 'Driver Payout': 500 });

    const detail = await supertest(app).get(`/api/orders/${orderId}`);
    expect(detail.body['Final Price']).toBe(1000);
    expect(Number(detail.body.delivery['Driver Payout'])).toBe(500);
  });

  it('still ignores a Pickup order\'s stale delivery fee (pitfall #10 gate intact)', async () => {
    await supertest(app)
      .patch(`/api/orders/${orderId}`)
      .send({ 'Delivery Type': 'Pickup' });

    const detail = await supertest(app).get(`/api/orders/${orderId}`);
    expect(detail.body['Final Price']).toBe(1000);
  });
});
