// Repro candidate for #533 — a pre-sold (negative-qty) Variety that is
// received during PO evaluation can NET TO ZERO after absorption and then drop
// out of the default grouped Stock view (includeEmpty=false), so the florist
// "received" it but it does not appear in stock. No error is shown.
//
// receiveIntoStock absorption (ADR-0002): when the orig has negative qty,
// batchQty = received + existingQty and the orig is zeroed. If received exactly
// covers the backlog, BOTH rows end at 0. listGroupedByVariety hides a group
// when totalQty===0 && reservedForPremades===0 && !hasActiveConsumer.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/driverNotifyService.js', () => ({
  notifyDeliveryAssigned: vi.fn().mockResolvedValue(undefined),
  notifyDeliveryDigest:   vi.fn().mockResolvedValue(undefined),
  notifyPoAssigned:       vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));
vi.mock('../services/orderService.js', () => ({
  createOrder: vi.fn(), autoMatchStock: vi.fn(),
  findOrdersNeedingSubstitution: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/configService.js', () => ({
  getConfig:      vi.fn((k) => ({ targetMarkup: 2.5 }[k] ?? 0)),
  getDriverOfDay: () => 'Timur',
  getActiveSeasonalCategory: () => null,
}));

import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import express from 'express';
import supertest from 'supertest';
import { stock } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import stockOrdersRouter from '../routes/stockOrders.js';
import * as stockRepo from '../repos/stockRepo.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.role = 'owner'; next(); });
  app.use('/api/stock-orders', stockOrdersRouter);
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
  return app;
}

let harness, app;
const agent = () => supertest(app);

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

describe('#533 — pre-sold Variety nets to zero after receive and vanishes from Stock view', () => {
  // it.fails: this reproduces the CURRENT (broken) behaviour — the group is
  // hidden after a net-to-zero receive. When the fix lands, flip this back to a
  // normal `it` (the assertion will then pass, and it.fails would error).
  it.fails('received stems for a fully-backordered flower are still visible in the grouped view', async () => {
    // Owner already has a classified "Hydrangea Pink" variety, but it is
    // pre-sold: negative on-hand demand of -12, and (post-settlement) no live
    // order line references it. Seed that state directly.
    const [orig] = await harness.db.insert(stock).values({
      displayName:     'Hydrangea Pink',
      purchaseName:    'Hydrangea Pink',
      currentQuantity: -12,
      active:          true,
      date:            '2026-07-01',
      typeName:        'Hydrangea',
      colour:          'Pink',
      sizeCm:          null,
      cultivar:        null,
    }).returning();

    // Before receiving, the pre-sold group IS visible (shown as a -12 shortfall).
    const before = await stockRepo.listGroupedByVariety({ includeEmpty: false });
    expect(before.find(g => g.type_name === 'Hydrangea'), 'shortfall visible before receive').toBeDefined();

    // PO for 12 Hydrangea Pink — resolves to the existing card by name.
    const created = await agent().post('/api/stock-orders').send({
      notes: 'hydrangea-presold',
      lines: [{ stockItemId: orig.id, flowerName: 'Hydrangea Pink', quantity: 12, costPrice: 9, sellPrice: 22, supplier: 'Stefan' }],
    });
    expect(created.status).toBe(201);
    const poId = created.body.id;
    const lineId = created.body.lines[0].id;

    await agent().post(`/api/stock-orders/${poId}/send`).send({ driverName: 'Timur' });
    await agent().post(`/api/stock-orders/${poId}/driver-complete`);
    await agent().patch(`/api/stock-orders/${poId}/lines/${lineId}`).send({ 'Quantity Found': 12 });
    await agent().post(`/api/stock-orders/${poId}/approve-review`);

    // Florist accepts all 12 — evaluation succeeds, no error.
    const evaluated = await agent().post(`/api/stock-orders/${poId}/evaluate`).send({
      lines: [{ lineId, quantityAccepted: 12, writeOffQty: 0 }],
    });
    expect(evaluated.status).toBe(200);
    expect(evaluated.body.success).toBe(true);

    // The 12 received stems immediately covered the backlog: orig zeroed, new
    // batch = 12 + (-12) = 0. The whole Variety group now totals 0 → it drops
    // out of the default Stock view. The florist received Hydrangea Pink but it
    // "did not appear in stock" and no error was shown. THIS is the #533 symptom.
    const after = await stockRepo.listGroupedByVariety({ includeEmpty: false });
    const hydrangea = after.find(g => g.type_name === 'Hydrangea');

    // What the owner expects: to see that Hydrangea Pink came in.
    expect(hydrangea, 'Hydrangea Pink should appear in the Stock view after receiving 12 stems').toBeDefined();
  });
});
