// Integration test for issue #545 — delivery-side PATCH triggers a driver
// Telegram notification when Delivery Date/Time is edited after assignment.
//
// Unlike deliveries.assign-notify.integration.test.js (which mocks the whole
// driverNotifyService seam), this suite mocks ONLY the outbound Telegram
// transport (services/telegram.js's sendToChat) and lets everything else run
// for real against the pglite harness: the route, orderRepo.updateDelivery's
// cascade, driverNotifyService.notifyDeliveryTimeChanged's guards (assigned /
// registered / non-terminal / actually-changed), and driverTelegramRepo's
// registration lookup. This is the strongest proof that the no-op,
// terminal-status, and unregistered-driver guards actually hold end-to-end —
// a test that mocked the whole service would only prove "the route calls it",
// not that the guards inside it are wired correctly.
//
// What we're proving (mirrors the 5 mandatory scenarios in the issue):
//   (b) Delivery-side Delivery Time change with an assigned + registered
//       driver fires exactly one notification containing the new time.
//   (c) A no-op save (same Delivery Time re-sent) does NOT fire.
//   (d) An unassigned driver, and a driver with no Telegram registration,
//       do NOT fire.
//   (e) A terminal-status delivery (Delivered / Cancelled) does NOT fire.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock ONLY the outbound Telegram network call — never a real send in tests.
vi.mock('../services/telegram.js', () => ({
  sendToChat: vi.fn().mockResolvedValue(undefined),
  escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
}));

// Mock delivery-complete Telegram alert (out-of-band, not under test here)
vi.mock('../services/orderService.js', () => ({
  sendDeliveryCompleteAlert: vi.fn(),
}));

// Mock configService (loaded by orderRepo via services, avoids production path)
vi.mock('../services/configService.js', () => ({
  getConfig:                vi.fn((k) => ({ defaultDeliveryFee: 25, driverCostPerDelivery: 10 }[k] ?? 0)),
  updateConfig:             vi.fn(),
  generateOrderId:          async () => 'TEST-D-2',
  getDriverOfDay:           () => 'Timur',
  isPastCutoff:             vi.fn(),
  getActiveSeasonalCategory: vi.fn(),
  loadConfig:               vi.fn(),
  saveConfig:               vi.fn(),
}));

import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
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
// are intentionally REAL here (not mocked) — see module comment above.
import { sendToChat } from '../services/telegram.js';
import deliveriesRouter from '../routes/deliveries.js';

const OWNER_PIN = 'test-owner-pin-time-1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.role = 'owner';
    next();
  });
  app.use('/api/deliveries', deliveriesRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

let harness, app, deliveryId, orderId;

async function seedOrderAndDelivery(deliveryOverrides = {}) {
  const [order] = await harness.db.insert(orders).values({
    status:       'New',
    appOrderId:   'TEST-D-2',
    customerId:   'cust-test-2',
    deliveryType: 'Delivery',
  }).returning();
  orderId = order.id;

  const [delivery] = await harness.db.insert(deliveries).values({
    orderId:         order.id,
    deliveryAddress: 'ul. Kwiatowa 5',
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
    driverName, chatId: '99887766', lang: 'ru', ...overrides,
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

describe('delivery-side Delivery Time/Date change → driver Telegram notification (#545)', () => {
  it('fires exactly once, with old time -> new time, for an assigned + registered driver', async () => {
    await seedOrderAndDelivery();
    await registerDriver('Nikita');

    const res = await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Delivery Time': '14:00-16:00' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(sendToChat).toHaveBeenCalledTimes(1);
    const [chatId, text] = sendToChat.mock.calls[0];
    expect(chatId).toBe('99887766');
    expect(text).toContain('10:00-12:00'); // old time
    expect(text).toContain('14:00-16:00'); // new time
  });

  it('fires when Delivery Date changes with no Delivery Time in the same PATCH', async () => {
    await seedOrderAndDelivery();
    await registerDriver('Nikita');

    const res = await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Delivery Date': '2026-08-03' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(sendToChat).toHaveBeenCalledTimes(1);
    const text = sendToChat.mock.calls[0][1];
    expect(text).toContain('2026-08-01'); // old date
    expect(text).toContain('2026-08-03'); // new date
  });

  it('does NOT fire on a no-op save (same Delivery Time re-sent)', async () => {
    await seedOrderAndDelivery(); // deliveryTime already '10:00-12:00'
    await registerDriver('Nikita');

    const res = await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Delivery Time': '10:00-12:00' }); // identical value

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('does NOT fire when no driver is assigned to the delivery', async () => {
    await seedOrderAndDelivery({ assignedDriver: null });
    // No driver_telegram_chats row needed — nobody to notify anyway.

    const res = await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Delivery Time': '14:00-16:00' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('does NOT fire when the assigned driver has never registered on Telegram', async () => {
    await seedOrderAndDelivery(); // assignedDriver: 'Nikita', but no registerDriver() call

    const res = await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Delivery Time': '14:00-16:00' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('does NOT fire when the delivery is already Delivered (terminal)', async () => {
    await seedOrderAndDelivery({ status: DELIVERY_STATUS.DELIVERED });
    await registerDriver('Nikita');

    const res = await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Delivery Time': '14:00-16:00' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('does NOT fire when the delivery is already Cancelled (terminal)', async () => {
    await seedOrderAndDelivery({ status: DELIVERY_STATUS.CANCELLED });
    await registerDriver('Nikita');

    const res = await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Delivery Time': '14:00-16:00' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('does NOT fire on an unrelated field PATCH (Driver Notes) that leaves the schedule untouched', async () => {
    await seedOrderAndDelivery();
    await registerDriver('Nikita');

    const res = await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Driver Notes': 'Ring the bell twice' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(sendToChat).not.toHaveBeenCalled();
  });

  it('fires ONLY the assignment notification when one PATCH both assigns a driver and changes the schedule (review follow-up)', async () => {
    await seedOrderAndDelivery({ assignedDriver: null }); // deliveryTime defaults to '10:00-12:00'
    await registerDriver('Nikita');

    const res = await supertest(app)
      .patch(`/api/deliveries/${deliveryId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Assigned Driver': 'Nikita', 'Delivery Time': '14:00-16:00' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    // Exactly one Telegram send — the assignment message — not a second
    // "was 10:00-12:00 -> now 14:00-16:00" reschedule message on top of it.
    expect(sendToChat).toHaveBeenCalledTimes(1);
    const text = sendToChat.mock.calls[0][1];
    expect(text).not.toContain('10:00-12:00'); // would only appear in the (suppressed) time-change "was" line
  });
});
