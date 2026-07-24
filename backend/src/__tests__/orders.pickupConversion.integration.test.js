// Regression test for #554 — "Delivery fee not removed when order changed
// from delivery to pickup." Repro was: convert an order from Delivery to
// Pickup in order details → the delivery fee stayed in the final price and
// the delivery address/recipient/driver info kept showing, even after a
// refresh.
//
// Root causes fixed:
//   1. GET /api/orders (list) computed Delivery Fee / Final Price from the
//      linked delivery record unconditionally — it never checked whether
//      the order was STILL a Delivery type. Converting to Pickup only
//      cancels the linked delivery (doesn't delete it), so the fee kept
//      counting forever (backend/src/routes/orders.js).
//   2. orderRepo.updateOrder's existing Delivery→Pickup cascade (#317)
//      cancelled the delivery's Status but left its fee/address/recipient/
//      driver fields (and the order's own redundant Delivery Fee column)
//      untouched — a landmine for any other ungated reader.
//
// This test hits the REAL express router + a real pglite Postgres (not
// mocked repos) so it proves the fix end-to-end: seed a Delivery order with
// a fee, PATCH it to Pickup, then verify via the actual HTTP responses
// (list + detail) AND the raw DB rows.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { deliveries, orders } from '../db/schema.js';
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

vi.mock('../services/configService.js', () => ({
  getConfig: vi.fn((k) => ({ defaultDeliveryFee: 25, driverCostPerDelivery: 10 }[k] ?? 0)),
  updateConfig: vi.fn(),
  generateOrderId: vi.fn(async () => 'BLO-TEST-554'),
  getDriverOfDay: vi.fn(() => 'Timur'),
  isPastCutoff: vi.fn(),
  getActiveSeasonalCategory: vi.fn(),
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));
vi.mock('../services/driverNotifyService.js', () => ({
  notifyDeliveryAssigned: vi.fn().mockResolvedValue(undefined),
}));

import * as orderRepo from '../repos/orderRepo.js';
import ordersRouter from '../routes/orders.js';

// Seed config for the direct orderRepo.createOrder call — mirrors the
// pattern in orderRepo.integration.test.js / orderDeliveryCascade.integration.test.js.
const seedConfig = {
  getConfig: (k) => ({ defaultDeliveryFee: 25, driverCostPerDelivery: 10 }[k] ?? 0),
  getDriverOfDay: () => 'Timur',
  generateOrderId: async () => 'BLO-TEST-554',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  // Auth shim — every request is the owner (mirrors deliveries.assign-notify.integration.test.js).
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

let harness, app, stockId1, orderId, deliveryId;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
  app = buildApp();

  const { stock } = await import('../db/schema.js');
  const [s1] = await harness.db.insert(stock).values({
    airtableId: 'recStock554', displayName: 'Red Rose', currentQuantity: 100,
    currentCostPrice: '4.50', currentSellPrice: '15.00', active: true,
  }).returning();
  stockId1 = s1.id;

  // Seed a Delivery order with a fee + address + assigned driver — 3 roses
  // at 15 zł = 45 zł flower total, + 25 zł delivery fee = 70 zł Final Price.
  const { order, delivery } = await orderRepo.createOrder({
    customer: 'recCust554', customerRequest: '#554 repro',
    deliveryType: 'Delivery',
    requiredBy: '2026-08-01',
    orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', sellPricePerUnit: 15, costPricePerUnit: 4.5, quantity: 3 }],
    delivery: { address: 'ul. Floriańska 1', date: '2026-08-01', fee: 25, driver: 'Timur' },
    paymentStatus: 'Unpaid', createdBy: 'florist',
  }, seedConfig, { actor: { actorRole: 'florist' } });

  orderId = order.id;
  deliveryId = delivery.id;
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('PATCH /api/orders/:id — Delivery → Pickup conversion clears the fee and address (#554)', () => {
  it('cancels + blanks the linked delivery, clears the order-level fee, and Final Price excludes the fee in both list and detail views', async () => {
    // Sanity: before conversion, Final Price includes the fee everywhere.
    const beforeList = await supertest(app).get('/api/orders');
    const beforeOrder = beforeList.body.find(o => o.id === orderId || o._pgId === orderId);
    expect(beforeOrder['Final Price']).toBe(70);
    expect(beforeOrder['Delivery Fee']).toBe(25);

    // Convert Delivery → Pickup.
    const patchRes = await supertest(app)
      .patch(`/api/orders/${orderId}`)
      .send({ 'Delivery Type': 'Pickup' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body['Delivery Type']).toBe('Pickup');

    // ── DB assertions: the linked delivery is cancelled AND blanked ──
    const [deliveryRow] = await harness.db.select().from(deliveries)
      .where(eq(deliveries.id, deliveryId));
    expect(deliveryRow.status).toBe(DELIVERY_STATUS.CANCELLED);
    expect(deliveryRow.deliveryFee).toBeNull();
    expect(deliveryRow.deliveryAddress).toBe('');
    expect(deliveryRow.recipientName).toBe('');
    expect(deliveryRow.recipientPhone).toBe('');
    expect(deliveryRow.assignedDriver).toBeNull();
    expect(deliveryRow.driverInstructions).toBe('');
    expect(deliveryRow.driverPayout).toBeNull();

    // ── DB assertion: the order's own (redundant) Delivery Fee column is cleared ──
    const [orderRow] = await harness.db.select().from(orders).where(eq(orders.id, orderId));
    expect(orderRow.deliveryFee).toBeNull();

    // ── GET /api/orders (list) — Final Price must exclude the fee ──
    const listRes = await supertest(app).get('/api/orders');
    const listOrder = listRes.body.find(o => o.id === orderId || o._pgId === orderId);
    expect(listOrder['Final Price']).toBe(45); // flowers only — NOT 70
    expect(Number(listOrder['Delivery Fee'] || 0)).toBe(0);
    expect(listOrder['Delivery Address'] || '').toBe('');
    expect(listOrder['Assigned Driver'] || '').toBe('');

    // ── GET /api/orders/:id (detail) — Final Price must exclude the fee too ──
    const detailRes = await supertest(app).get(`/api/orders/${orderId}`);
    expect(detailRes.body['Final Price']).toBe(45);
    expect(detailRes.body['Delivery Type']).toBe('Pickup');
  });

  it('does NOT touch the fee for an order that stays Delivery type (no false-positive gating)', async () => {
    // Patch an unrelated field — Final Price must still include the fee.
    const patchRes = await supertest(app)
      .patch(`/api/orders/${orderId}`)
      .send({ 'Florist Note': 'Add ribbon' });
    expect(patchRes.status).toBe(200);

    const listRes = await supertest(app).get('/api/orders');
    const listOrder = listRes.body.find(o => o.id === orderId || o._pgId === orderId);
    expect(listOrder['Final Price']).toBe(70);
    expect(listOrder['Delivery Fee']).toBe(25);

    const [deliveryRow] = await harness.db.select().from(deliveries)
      .where(eq(deliveries.id, deliveryId));
    expect(deliveryRow.status).toBe(DELIVERY_STATUS.PENDING);
    expect(Number(deliveryRow.deliveryFee)).toBe(25);
  });
});
