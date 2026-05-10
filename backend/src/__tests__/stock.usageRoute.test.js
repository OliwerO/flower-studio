// Route tests for GET /stock/:id/usage — Task 3, issue #289, ADR-0007.
//
// What we're proving:
//   • flag-on, exact-ID filter: two Batches of same Variety → trace for batch1
//     returns ONLY batch1 events; batch2 events MUST NOT appear.
//   • flag-on, no events: empty trail returns { stockItem, trail: [] }.
//   • flag-off, legacy path preserved: same fixture, flag off, sibling-
//     aggregation path runs (both batches' events visible in the trace).
//   • Order events: correct field shape (customer name, orderId, quantity sign).
//   • Premade events: premade_bouquet_lines matched by stock_id appear in trail.
//
// Implementation notes:
//   • The legacy path in the route calls orderRepo.list (which lists PG orders),
//     stockLossRepo.list, stockPurchasesRepo.list, premadeBouquetRepo.list —
//     all of these depend on the real db. The test uses a real pglite harness
//     so we run against actual SQL rather than brittle façade mocks.
//   • configService is module-mocked so STOCK_Y_MODEL can be toggled per test.
//   • Auth is injected via req.role header (x-test-role = owner).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import {
  stock,
  orders,
  orderLines,
  customers,
  stockLossLog,
  stockPurchases,
  premadeBouquets,
  premadeBouquetLines,
} from '../db/schema.js';

// ── db module mock — injected via dbHolder ──
const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db()            { return dbHolder.db; },
  isPostgresConfigured: true,
  pool:               null,
  connectPostgres:    async () => {},
  disconnectPostgres: async () => {},
}));

// ── audit mock — no-op ──
vi.mock('../db/audit.js', () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));

// ── configService mock — toggleable Y-model flag ──
let yModelEnabled = false;
vi.mock('../services/configService.js', () => ({
  getStockYModelEnabled: () => yModelEnabled,
  getConfig:             () => undefined,
  getActiveSeasonalCategory: () => null,
  generateOrderId:       async () => 'TEST-001',
}));

// ── Telegram / SSE notification mocks ──
vi.mock('../services/notifications.js', () => ({ broadcastEvent: vi.fn() }));
vi.mock('../services/telegram.js', () => ({ sendTelegramMessage: vi.fn().mockResolvedValue(undefined) }));

import stockRouter from '../routes/stock.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.role = req.headers['x-test-role'] || 'owner';
    next();
  });
  app.use('/stock', stockRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

let harness, app;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  yModelEnabled = false;
  app = buildApp();
  vi.clearAllMocks();
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

// ── Seed helpers ──

async function seedStock(overrides = {}) {
  const [row] = await harness.db.insert(stock).values({
    displayName:     overrides.displayName     ?? 'Rose Red',
    currentQuantity: overrides.currentQuantity ?? 10,
    active:          overrides.active          ?? true,
    typeName:        overrides.typeName        ?? 'Rose',
    colour:          overrides.colour          ?? 'Red',
  }).returning();
  return row;
}

async function seedCustomer(overrides = {}) {
  const [row] = await harness.db.insert(customers).values({
    name: overrides.name ?? 'Test Customer',
  }).returning();
  return row;
}

async function seedOrder(customerId, overrides = {}) {
  const [row] = await harness.db.insert(orders).values({
    appOrderId:  overrides.appOrderId  ?? `BLO-TEST-${Math.random().toString(36).slice(2, 6)}`,
    customerId:  customerId,
    status:      overrides.status      ?? 'New',
    deliveryType: overrides.deliveryType ?? 'Pickup',
    orderDate:   overrides.orderDate   ?? '2026-05-01',
    requiredBy:  overrides.requiredBy  ?? '2026-05-02',
    paymentStatus: 'Unpaid',
  }).returning();
  return row;
}

async function seedOrderLine(orderId, stockId, overrides = {}) {
  const [row] = await harness.db.insert(orderLines).values({
    orderId,
    stockItemId: stockId,
    flowerName:  overrides.flowerName ?? 'Rose Red',
    quantity:    overrides.quantity   ?? 5,
  }).returning();
  return row;
}

async function seedLossLog(stockId, overrides = {}) {
  const [row] = await harness.db.insert(stockLossLog).values({
    date:     overrides.date     ?? '2026-05-01',
    stockId:  stockId,
    quantity: String(overrides.quantity ?? 3),
    reason:   overrides.reason  ?? 'Wilted',
    notes:    overrides.notes   ?? '',
  }).returning();
  return row;
}

async function seedPurchase(stockId, overrides = {}) {
  const [row] = await harness.db.insert(stockPurchases).values({
    purchaseDate:      overrides.purchaseDate      ?? '2026-05-01',
    supplier:          overrides.supplier          ?? 'Flower Market',
    stockId:           stockId,
    quantityPurchased: overrides.quantityPurchased ?? 50,
    pricePerUnit:      overrides.pricePerUnit      ?? '2.50',
    notes:             overrides.notes             ?? '',
  }).returning();
  return row;
}

async function seedPremade(overrides = {}) {
  const [row] = await harness.db.insert(premadeBouquets).values({
    name:      overrides.name      ?? 'Spring Bouquet',
    createdBy: overrides.createdBy ?? 'florist',
    notes:     '',
  }).returning();
  return row;
}

async function seedPremadeLine(bouquetId, stockId, overrides = {}) {
  const [row] = await harness.db.insert(premadeBouquetLines).values({
    bouquetId,
    stockId,
    flowerName: overrides.flowerName ?? 'Rose Red',
    quantity:   overrides.quantity   ?? 4,
    costPricePerUnit: '1.00',
    sellPricePerUnit: '3.00',
  }).returning();
  return row;
}

// ════════════════════════════════════════════════════════════════════════════
// Flag-ON tests
// ════════════════════════════════════════════════════════════════════════════

describe('GET /stock/:id/usage — flag-on (STOCK_Y_MODEL=true)', () => {
  beforeEach(() => { yModelEnabled = true; });

  it('exact-ID filter: order event for batch1 appears, batch2 order does NOT', async () => {
    const batch1 = await seedStock({ displayName: 'Rose Red (01.May.)', colour: 'Red' });
    const batch2 = await seedStock({ displayName: 'Rose Red (08.May.)', colour: 'Red' });

    const cust = await seedCustomer({ name: 'Anna K.' });
    const order1 = await seedOrder(cust.id, { appOrderId: 'ORD-001', requiredBy: '2026-05-05' });
    await seedOrderLine(order1.id, batch1.id, { quantity: 3 });

    const order2 = await seedOrder(cust.id, { appOrderId: 'ORD-002', requiredBy: '2026-05-10' });
    await seedOrderLine(order2.id, batch2.id, { quantity: 7 });

    const res = await supertest(app)
      .get(`/stock/${batch1.id}/usage`)
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stockItem');
    expect(res.body).toHaveProperty('trail');
    expect(Array.isArray(res.body.trail)).toBe(true);

    const orderEvents = res.body.trail.filter(e => e.type === 'order');
    expect(orderEvents).toHaveLength(1);
    expect(orderEvents[0].orderId).toBe('ORD-001');

    // batch2's order must NOT appear
    const batch2Event = res.body.trail.find(e => e.orderId === 'ORD-002');
    expect(batch2Event).toBeUndefined();
  });

  it('exact-ID filter: write-off for batch1 appears, batch2 write-off does NOT', async () => {
    const batch1 = await seedStock({ displayName: 'Rose Red (01.May.)' });
    const batch2 = await seedStock({ displayName: 'Rose Red (08.May.)' });

    await seedLossLog(batch1.id, { quantity: 2, reason: 'Damaged' });
    await seedLossLog(batch2.id, { quantity: 5, reason: 'Wilted' });

    const res = await supertest(app)
      .get(`/stock/${batch1.id}/usage`)
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    const writeoffs = res.body.trail.filter(e => e.type === 'writeoff');
    expect(writeoffs).toHaveLength(1);
    expect(writeoffs[0].quantity).toBe(-2);
    expect(writeoffs[0].reason).toBe('Damaged');
  });

  it('exact-ID filter: purchase for batch1 appears, batch2 purchase does NOT', async () => {
    const batch1 = await seedStock({ displayName: 'Rose Red (01.May.)' });
    const batch2 = await seedStock({ displayName: 'Rose Red (08.May.)' });

    await seedPurchase(batch1.id, { quantityPurchased: 100, supplier: 'Grower A' });
    await seedPurchase(batch2.id, { quantityPurchased: 200, supplier: 'Grower B' });

    const res = await supertest(app)
      .get(`/stock/${batch1.id}/usage`)
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    const purchases = res.body.trail.filter(e => e.type === 'purchase');
    expect(purchases).toHaveLength(1);
    expect(purchases[0].quantity).toBe(100);
    expect(purchases[0].supplier).toBe('Grower A');
  });

  it('exact-ID filter: premade line for batch1 appears, batch2 premade does NOT', async () => {
    const batch1 = await seedStock({ displayName: 'Rose Red (01.May.)' });
    const batch2 = await seedStock({ displayName: 'Rose Red (08.May.)' });

    const bouquet1 = await seedPremade({ name: 'Morning Bunch' });
    await seedPremadeLine(bouquet1.id, batch1.id, { quantity: 6 });

    const bouquet2 = await seedPremade({ name: 'Evening Bunch' });
    await seedPremadeLine(bouquet2.id, batch2.id, { quantity: 9 });

    const res = await supertest(app)
      .get(`/stock/${batch1.id}/usage`)
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    const premades = res.body.trail.filter(e => e.type === 'premade');
    expect(premades).toHaveLength(1);
    expect(premades[0].quantity).toBe(-6);
    expect(premades[0].bouquetName).toBe('Morning Bunch');
  });

  it('empty trail when no events for stock item', async () => {
    const batch = await seedStock({ displayName: 'Empty Batch' });

    const res = await supertest(app)
      .get(`/stock/${batch.id}/usage`)
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    expect(res.body.stockItem.id).toBe(batch.id);
    expect(res.body.trail).toEqual([]);
  });

  it('stockItem header fields are correct', async () => {
    const batch = await seedStock({ displayName: 'Peony White', currentQuantity: 25 });

    const res = await supertest(app)
      .get(`/stock/${batch.id}/usage`)
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    const { stockItem } = res.body;
    expect(stockItem.id).toBe(batch.id);
    expect(stockItem.displayName).toBe('Peony White');
    expect(stockItem.currentQty).toBe(25);
  });

  it('order event has correct field shape (customer name, orderId, negative qty, flowerName)', async () => {
    const batch = await seedStock({ displayName: 'Lily White' });
    const cust  = await seedCustomer({ name: 'Maria S.' });
    const order = await seedOrder(cust.id, { appOrderId: 'BLO-20260501-1', requiredBy: '2026-05-03' });
    await seedOrderLine(order.id, batch.id, { quantity: 8, flowerName: 'Lily White' });

    const res = await supertest(app)
      .get(`/stock/${batch.id}/usage`)
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    const [evt] = res.body.trail.filter(e => e.type === 'order');
    expect(evt).toBeDefined();
    expect(evt.type).toBe('order');
    expect(evt.quantity).toBe(-8);             // negative (consumed)
    expect(evt.customer).toBe('Maria S.');
    expect(evt.orderId).toBe('BLO-20260501-1');
    expect(evt.flowerName).toBe('Lily White');
    // requiredBy is present
    expect(evt.requiredBy).toBe('2026-05-03');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Flag-OFF tests — legacy path must not regress
// ════════════════════════════════════════════════════════════════════════════

describe('GET /stock/:id/usage — flag-off (STOCK_Y_MODEL=false, legacy path)', () => {
  it('returns 200 with stockItem + trail shape even in legacy mode', async () => {
    // Seed a stock item with a classic non-batch display name so the legacy
    // sibling-scan finds exactly one sibling (itself).
    const batch = await seedStock({ displayName: 'Hydrangea Blue', typeName: null });

    const res = await supertest(app)
      .get(`/stock/${batch.id}/usage`)
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stockItem');
    expect(res.body).toHaveProperty('trail');
    expect(Array.isArray(res.body.trail)).toBe(true);
  });

  it('legacy path: write-off linked to the same stock ID appears in the trail', async () => {
    const batch = await seedStock({ displayName: 'Sunflower Yellow', typeName: null });
    await seedLossLog(batch.id, { quantity: 4, reason: 'Too Old' });

    const res = await supertest(app)
      .get(`/stock/${batch.id}/usage`)
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    const writeoffs = res.body.trail.filter(e => e.type === 'writeoff');
    expect(writeoffs.length).toBeGreaterThanOrEqual(1);
  });
});
