// Integration test for issue #545 — order-side PATCH (Required By / Delivery
// Time) cascades to the linked delivery and fires a driver Telegram
// notification, using the SAME notifyDeliveryTimeChanged seam the
// delivery-side direct edit uses (see deliveries.time-change-notify.
// integration.test.js for that half).
//
// As in the delivery-side suite, only the outbound Telegram transport
// (services/telegram.js's sendToChat) is mocked — orderRepo's cascade,
// driverNotifyService's guards, and driverTelegramRepo's registration lookup
// all run for real against the pglite harness. This proves the order-side
// cascade path produces a POST-cascade delivery snapshot that the notify
// seam can correctly diff against the pre-update snapshot.
//
// What we're proving (mirrors the 5 mandatory scenarios in the issue):
//   (a) Order-side Required By / Delivery Time change, with an assigned +
//       registered driver on the linked delivery, fires exactly one
//       notification containing the new time.
//   (c) A no-op save (same value re-sent) does NOT fire.
//   (d) An unassigned driver does NOT fire.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock ONLY the outbound Telegram network call — never a real send in tests.
vi.mock('../services/telegram.js', () => ({
  sendToChat: vi.fn().mockResolvedValue(undefined),
  escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
}));

// orders.js pulls in several orderService exports that aren't exercised by
// the "no status change" PATCH branch under test — stub them so the route
// module loads without dragging in orderService's heavier transitive deps
// (Wix, Claude intake, etc).
vi.mock('../services/orderService.js', () => ({
  createOrder:           vi.fn(),
  transitionStatus:      vi.fn(),
  cancelWithStockReturn: vi.fn(),
  deleteOrder:           vi.fn(),
  editBouquetLines:      vi.fn(),
}));

vi.mock('../services/notifications.js', () => ({
  broadcast: vi.fn(),
}));

// Mock configService (orders.js imports getDriverOfDay/getConfig/generateOrderId
// directly — none used by the PATCH branch under test, but avoids the
// production config path at module load).
vi.mock('../services/configService.js', () => ({
  getConfig:                vi.fn((k) => ({ defaultDeliveryFee: 25, driverCostPerDelivery: 10 }[k] ?? 0)),
  updateConfig:             vi.fn(),
  generateOrderId:          async () => 'TEST-O-1',
  getDriverOfDay:           () => 'Timur',
  isPastCutoff:             vi.fn(),
  getActiveSeasonalCategory: vi.fn(),
  loadConfig:               vi.fn(),
  saveConfig:               vi.fn(),
}));

import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { eq } from 'drizzle-orm';
import { orders, deliveries, driverTelegramChats } from '../db/schema.js';
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

// Import these AFTER mocks are in place. driverNotifyService + driverTelegramRepo
// + orderRepo are intentionally REAL here (not mocked) — see module comment above.
import { sendToChat } from '../services/telegram.js';
import ordersRouter from '../routes/orders.js';

const OWNER_PIN = 'test-owner-pin-time-2';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.role = 'owner';
    next();
  });
  app.use('/api/orders', ordersRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

let harness, app, orderId, deliveryId;

async function seedOrderAndDelivery(deliveryOverrides = {}) {
  const [order] = await harness.db.insert(orders).values({
    status:       'New',
    appOrderId:   'TEST-O-1',
    customerId:   'cust-test-3',
    deliveryType: 'Delivery',
    requiredBy:   '2026-08-01',
    deliveryTime: '10:00-12:00',
  }).returning();
  orderId = order.id;

  const [delivery] = await harness.db.insert(deliveries).values({
    orderId:         order.id,
    deliveryAddress: 'ul. Rozana 9',
    status:          DELIVERY_STATUS.PENDING,
    assignedDriver:  'Nikita',
    deliveryDate:    '2026-08-01',
    deliveryTime:    '10:00-12:00',
    ...deliveryOverrides,
  }).returning();
  deliveryId = delivery.id;
}

async function registerDriver(driverName = 'Nikita', overrides = {}) {
  await harness.db.insert(driverTelegramChats).values({
    driverName, chatId: '55443322', lang: 'ru', ...overrides,
  });
}

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

describe('order-side Required By / Delivery Time cascade → driver Telegram notification (#545)', () => {
  it('fires exactly once, with old time -> new time, when Delivery Time is patched via the order', async () => {
    await seedOrderAndDelivery();
    await registerDriver('Nikita');

    const res = await supertest(app)
      .patch(`/api/orders/${orderId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Delivery Time': '14:00-16:00' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(sendToChat).toHaveBeenCalledTimes(1);
    const [chatId, text] = sendToChat.mock.calls[0];
    expect(chatId).toBe('55443322');
    expect(text).toContain('10:00-12:00'); // old time
    expect(text).toContain('14:00-16:00'); // new time

    // Confirm the cascade actually landed on the delivery row (not just the order).
    const [row] = await harness.db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
    expect(row.deliveryTime).toBe('14:00-16:00');
  });

  it('fires when Required By changes (cascades to the delivery\'s Delivery Date)', async () => {
    await seedOrderAndDelivery();
    await registerDriver('Nikita');

    const res = await supertest(app)
      .patch(`/api/orders/${orderId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Required By': '2026-08-05' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(sendToChat).toHaveBeenCalledTimes(1);
    const text = sendToChat.mock.calls[0][1];
    expect(text).toContain('2026-08-01'); // old date
    expect(text).toContain('2026-08-05'); // new date
  });

  it('does NOT fire on a no-op save (same Delivery Time re-sent)', async () => {
    await seedOrderAndDelivery(); // deliveryTime already '10:00-12:00'
    await registerDriver('Nikita');

    const res = await supertest(app)
      .patch(`/api/orders/${orderId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Delivery Time': '10:00-12:00' }); // identical value

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('does NOT fire when the linked delivery has no assigned driver', async () => {
    await seedOrderAndDelivery({ assignedDriver: null });

    const res = await supertest(app)
      .patch(`/api/orders/${orderId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Delivery Time': '14:00-16:00' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('does NOT fire when the assigned driver has never registered on Telegram', async () => {
    await seedOrderAndDelivery(); // assignedDriver: 'Nikita', but no registerDriver() call

    const res = await supertest(app)
      .patch(`/api/orders/${orderId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Delivery Time': '14:00-16:00' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('does NOT fire for a Pickup order (no linked delivery to cascade into)', async () => {
    const [order] = await harness.db.insert(orders).values({
      status:       'New',
      appOrderId:   'TEST-O-PICKUP',
      customerId:   'cust-test-4',
      deliveryType: 'Pickup',
      requiredBy:   '2026-08-01',
    }).returning();

    const res = await supertest(app)
      .patch(`/api/orders/${order.id}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Required By': '2026-08-09' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('does NOT fire on an unrelated field PATCH (Florist Note) that leaves the schedule untouched', async () => {
    await seedOrderAndDelivery();
    await registerDriver('Nikita');

    const res = await supertest(app)
      .patch(`/api/orders/${orderId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Florist Note': 'Extra ribbon requested' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(sendToChat).not.toHaveBeenCalled();
  });
});
