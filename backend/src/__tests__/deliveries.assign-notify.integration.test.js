// Integration test for delivery PATCH diff-detection: notify driver on assignment.
// Task 5 of docs/superpowers/plans/2026-06-01-driver-assignment-telegram-notifications.md
//
// What we're proving:
//   • notifyDeliveryAssigned fires when Assigned Driver changes empty → 'Nikita'
//   • notifyDeliveryAssigned does NOT fire on a no-op PATCH (unrelated field)
//   • notifyDeliveryAssigned does NOT fire on self-claim (driver advances Status)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the notify seam BEFORE importing the deliveries router so the
// route's top-level import resolves to the mock.
vi.mock('../services/driverNotifyService.js', () => ({
  notifyDeliveryAssigned: vi.fn().mockResolvedValue(undefined),
  notifyDeliveryDigest:   vi.fn().mockResolvedValue(undefined),
  notifyPoAssigned:       vi.fn().mockResolvedValue(undefined),
}));

// Mock delivery-complete Telegram alert (out-of-band, not under test here)
vi.mock('../services/orderService.js', () => ({
  sendDeliveryCompleteAlert: vi.fn(),
}));

// Mock configService (loaded by orderRepo via services, avoids production path)
vi.mock('../services/configService.js', () => ({
  getStockYModelEnabled:    () => false,
  getStockXModelEnabled:    () => false,
  getConfig:                vi.fn((k) => ({ defaultDeliveryFee: 25, driverCostPerDelivery: 10 }[k] ?? 0)),
  updateConfig:             vi.fn(),
  generateOrderId:          async () => 'TEST-D-1',
  getDriverOfDay:           () => 'Timur',
  isPastCutoff:             vi.fn(),
  getActiveSeasonalCategory: vi.fn(),
  loadConfig:               vi.fn(),
  saveConfig:               vi.fn(),
}));

import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { eq } from 'drizzle-orm';
import { orders, deliveries } from '../db/schema.js';
import express from 'express';
import supertest from 'supertest';
import { DELIVERY_STATUS } from '../constants/statuses.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

// Import these AFTER mocks are in place
import { notifyDeliveryAssigned } from '../services/driverNotifyService.js';
import deliveriesRouter from '../routes/deliveries.js';

// Auth env — owner and one driver
const OWNER_PIN = 'test-owner-pin-5';
const DRIVER_PIN = 'test-driver-nikita-pin-9';

function buildApp() {
  const app = express();
  app.use(express.json());
  // Auth middleware shim: inject role + driverName from headers set by tests
  app.use((req, _res, next) => {
    const pin = req.headers['x-auth-pin'];
    if (pin === OWNER_PIN) {
      req.role = 'owner';
    } else if (pin === DRIVER_PIN) {
      req.role = 'driver';
      req.driverName = 'Nikita';
    } else {
      req.role = 'owner'; // default to owner if no header provided
    }
    next();
  });
  app.use('/api/deliveries', deliveriesRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

let harness, app, deliveryId;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
  app = buildApp();

  // Seed a minimal order + delivery (no stock lines needed for delivery PATCH tests)
  const [order] = await harness.db.insert(orders).values({
    status:       'New',
    appOrderId:   'TEST-D-1',
    customerId:   'cust-test-1',
    deliveryType: 'Delivery',
  }).returning();

  const [delivery] = await harness.db.insert(deliveries).values({
    orderId:         order.id,
    deliveryAddress: 'ul. Testowa 1',
    status:          DELIVERY_STATUS.PENDING,
    assignedDriver:  null,
  }).returning();

  deliveryId = delivery.id;
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('delivery assignment → driver notification diff-detection', () => {
  it('notifies when Assigned Driver changes empty → Nikita (owner PIN)', async () => {
    const res = await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Assigned Driver': 'Nikita' });

    expect(res.status).toBe(200);

    // Wait a tick for the fire-and-forget notify to be invoked
    await new Promise(r => setImmediate(r));

    expect(notifyDeliveryAssigned).toHaveBeenCalledTimes(1);
    expect(notifyDeliveryAssigned.mock.calls[0][0]).toMatchObject({
      driverName: 'Nikita',
    });
  });

  it('does NOT notify on a no-op PATCH that leaves Assigned Driver unchanged', async () => {
    // First assign a driver
    await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Assigned Driver': 'Nikita' });

    // Clear the mock after assignment
    vi.clearAllMocks();

    // PATCH an unrelated field — Driver Notes — leaving Assigned Driver unchanged
    const res = await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Driver Notes': 'Deliver before noon' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(notifyDeliveryAssigned).not.toHaveBeenCalled();
  });

  it('does NOT notify on self-claim (driver advances Status to Out for Delivery)', async () => {
    // Driver advances status — this stamps their name as Assigned Driver
    // but it's a self-claim and must NOT trigger a notification
    const res = await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .set('x-auth-pin', DRIVER_PIN)
      .send({ Status: DELIVERY_STATUS.OUT_FOR_DELIVERY });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(notifyDeliveryAssigned).not.toHaveBeenCalled();
  });
});

describe('courier_time persistence (CR-32)', () => {
  it('round-trips Courier Time through PATCH and persists it on the delivery row', async () => {
    const res = await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Courier Time': '10:00-11:00' });

    expect(res.status).toBe(200);
    expect(res.body['Courier Time']).toBe('10:00-11:00');

    const [row] = await harness.db
      .select().from(deliveries).where(eq(deliveries.id, deliveryId));
    expect(row.courierTime).toBe('10:00-11:00');
  });

  it('leaves Courier Time null when not supplied (assigned later, not at create)', async () => {
    const [row] = await harness.db
      .select().from(deliveries).where(eq(deliveries.id, deliveryId));
    expect(row.courierTime).toBeNull();
  });
});
