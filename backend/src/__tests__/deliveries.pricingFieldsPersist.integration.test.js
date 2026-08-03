// backend/src/__tests__/deliveries.pricingFieldsPersist.integration.test.js
//
// Regression lock for ADR-0019's "three fields accepted and silently dropped"
// defect: Driver Payment Status, Taxi Cost, and Delivery Result were in the
// PATCH allow-list but had no column behind them. Same failure shape as #558
// (the PO-line identity drop) — an accepted-but-discarded field.
//
// Wiring follows the established pattern for this route file (see
// deliveries.assign-notify.integration.test.js): a dbHolder + vi.mock of
// '../db/index.js' points orderRepo at the per-test pglite harness, and the
// Telegram-touching services are mocked out so no real network calls happen.

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

vi.mock('../services/configService.js', () => ({
  getConfig:                 vi.fn((k) => ({ defaultDeliveryFee: 25, driverCostPerDelivery: 10 }[k] ?? 0)),
  updateConfig:              vi.fn(),
  generateOrderId:           async () => 'TEST-PRICING-1',
  getDriverOfDay:            () => 'Timur',
  isPastCutoff:              vi.fn(),
  getActiveSeasonalCategory: vi.fn(),
  loadConfig:                vi.fn(),
  saveConfig:                vi.fn(),
}));

import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { eq } from 'drizzle-orm';
import { orders, deliveries } from '../db/schema.js';
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
import deliveriesRoutes from '../routes/deliveries.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.role = 'owner'; req.driverName = null; next(); });
  app.use('/api/deliveries', deliveriesRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

let harness, app;

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

describe('PATCH /api/deliveries/:id — pricing fields persist', () => {
  it('persists Driver Payment Status, Taxi Cost, Delivery Result, distance, and band — none silently dropped', async () => {
    const [order] = await harness.db.insert(orders).values({
      appOrderId: 'TEST-2', status: 'New', deliveryType: 'Delivery', customerId: 'cust-test-2',
      orderDate: new Date().toISOString().slice(0, 10),
    }).returning();
    const [delivery] = await harness.db.insert(deliveries).values({ orderId: order.id }).returning();

    const res = await supertest(app).patch(`/api/deliveries/${delivery.id}`).send({
      'Driver Payment Status': 'Paid',
      'Taxi Cost': 15,
      'Delivery Result': 'Success',
      'Distance (km)': 4.2,
      'Distance Band': { upToKm: 5, price: 35 },
    });

    expect(res.status).toBe(200);
    expect(res.body['Driver Payment Status']).toBe('Paid');
    expect(res.body['Taxi Cost']).toBe(15);
    expect(res.body['Delivery Result']).toBe('Success');
    expect(res.body['Distance (km)']).toBe(4.2);
    expect(res.body['Distance Band']).toEqual({ upToKm: 5, price: 35 });

    const [row] = await harness.db.select().from(deliveries).where(eq(deliveries.id, delivery.id));
    expect(row.driverPaymentStatus).toBe('Paid');
    expect(Number(row.taxiCost)).toBe(15);
  });

  it('rejects an invalid Driver Payment Status', async () => {
    const [order] = await harness.db.insert(orders).values({
      appOrderId: 'TEST-3', status: 'New', deliveryType: 'Delivery', customerId: 'cust-test-3',
      orderDate: new Date().toISOString().slice(0, 10),
    }).returning();
    const [delivery] = await harness.db.insert(deliveries).values({ orderId: order.id }).returning();

    const res = await supertest(app).patch(`/api/deliveries/${delivery.id}`)
      .send({ 'Driver Payment Status': 'Half-paid' });

    expect(res.status).toBe(400);
  });

  it('forces Driver Payout to 0 when Delivery Method changes to Florist', async () => {
    const [order] = await harness.db.insert(orders).values({
      appOrderId: 'TEST-4', status: 'New', deliveryType: 'Delivery', customerId: 'cust-test-4',
      orderDate: new Date().toISOString().slice(0, 10),
    }).returning();
    const [delivery] = await harness.db.insert(deliveries).values({
      orderId: order.id, driverPayout: '40.00',
    }).returning();

    const res = await supertest(app).patch(`/api/deliveries/${delivery.id}`)
      .send({ 'Delivery Method': 'Florist' });

    expect(res.status).toBe(200);
    expect(res.body['Driver Payout']).toBe(0);
  });

  it('also forces Taxi Cost to 0 when Delivery Method changes to Florist', async () => {
    const [order] = await harness.db.insert(orders).values({
      appOrderId: 'TEST-5', status: 'New', deliveryType: 'Delivery', customerId: 'cust-test-5',
      orderDate: new Date().toISOString().slice(0, 10),
    }).returning();
    const [delivery] = await harness.db.insert(deliveries).values({ orderId: order.id }).returning();

    const res = await supertest(app).patch(`/api/deliveries/${delivery.id}`)
      .send({ 'Delivery Method': 'Florist', 'Taxi Cost': 50 });

    expect(res.status).toBe(200);
    expect(res.body['Taxi Cost']).toBe(0);
  });

  it('forces Driver Payout to 0 on a later PATCH that omits Delivery Method, when the delivery is already stored as Florist', async () => {
    const [order] = await harness.db.insert(orders).values({
      appOrderId: 'TEST-6', status: 'New', deliveryType: 'Delivery', customerId: 'cust-test-6',
      orderDate: new Date().toISOString().slice(0, 10),
    }).returning();
    const [delivery] = await harness.db.insert(deliveries).values({ orderId: order.id }).returning();

    // First PATCH sets the delivery to Florist.
    const first = await supertest(app).patch(`/api/deliveries/${delivery.id}`)
      .send({ 'Delivery Method': 'Florist' });
    expect(first.status).toBe(200);

    // Second PATCH touches only Driver Payout — no 'Delivery Method' in this
    // request body. The effective method must still be read from the
    // delivery's EXISTING stored method, not just this request's fields.
    const second = await supertest(app).patch(`/api/deliveries/${delivery.id}`)
      .send({ 'Driver Payout': 40 });

    expect(second.status).toBe(200);
    expect(second.body['Driver Payout']).toBe(0);
  });

  it('rejects an invalid Delivery Method', async () => {
    const [order] = await harness.db.insert(orders).values({
      appOrderId: 'TEST-7', status: 'New', deliveryType: 'Delivery', customerId: 'cust-test-7',
      orderDate: new Date().toISOString().slice(0, 10),
    }).returning();
    const [delivery] = await harness.db.insert(deliveries).values({ orderId: order.id }).returning();

    const res = await supertest(app).patch(`/api/deliveries/${delivery.id}`)
      .send({ 'Delivery Method': 'Bogus' });

    expect(res.status).toBe(400);
  });
});
