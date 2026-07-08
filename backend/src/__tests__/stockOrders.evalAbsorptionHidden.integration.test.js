// Regression test for #533 — a florist received Hydrangea Pink during PO
// evaluation, but it never showed up in the default Stock view. No error.
//
// Prod investigation (2026-07-08, via check-variety-net.mjs + trace-order-stock.mjs
// against claude_ro) found the REAL mechanism: a live order (202607-007,
// required_by 2026-07-12) already held a Demand Entry of -5 for Hydrangea Pink.
// A PO received exactly +5, so the Variety group netted to 0 — but the group was
// still backed by a genuine open order, due four days later, not by any wrong or
// orphaned demand. `stockRepo.listGroupedByVariety` already keeps a net-zero
// group visible when it has an active order-line consumer (`hasActiveConsumer`,
// added for #323) — but that field was never returned in the API response, and
// both frontends' `hideZero` toggle (StockPanelPage.jsx / StockTab.jsx) only
// exempted premade reservations, not order-line demand. The frontend's default
// `/stock?grouped=true` fetch passes includeEmpty=false, so the backend correctly
// keeps the group in the payload — but the frontend's OWN re-filter then hid it
// anyway, discarding that protection. This is a visibility bug, not a stock-math
// or wrong-allocation bug: the absorption math (ADR-0002) and the netting
// (pitfall #8) are both working as designed.
//
// (An earlier draft of this test simulated an ORPHANED negative demand row with
// no live order line at all — that scenario is correctly hidden by design, since
// there is genuinely nothing left to show. It does not reproduce #533.)

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
import { stock, orders, orderLines } from '../db/schema.js';

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

describe('#533 — receipt that nets a live-order Variety to zero stays visible', () => {
  it('a fresh receipt that exactly covers a live (not-yet-due) order\'s demand ' +
     'still appears in the grouped Stock view, flagged hasActiveConsumer', async () => {
    // Pre-sold Demand Entry: -5 Hydrangea Pink.
    const [orig] = await harness.db.insert(stock).values({
      displayName:     'Hydrangea Pink',
      purchaseName:    'Hydrangea Pink',
      currentQuantity: -5,
      active:          true,
      date:            '2026-07-01',
      typeName:        'Hydrangea',
      colour:          'Pink',
      sizeCm:          null,
      cultivar:        null,
    }).returning();

    // A REAL, still-open order binds to that demand — required 4 days out, like
    // prod order 202607-007 (required_by 2026-07-12, evaluated 2026-07-08).
    const [order] = await harness.db.insert(orders).values({
      appOrderId:   '202607-533',
      customerId:   'cust-533',
      deliveryType: 'Delivery',
      requiredBy:   '2026-07-12',
      status:       'New',
    }).returning();
    await harness.db.insert(orderLines).values({
      orderId:      order.id,
      stockItemId:  orig.id,
      flowerName:   'Hydrangea Pink',
      quantity:     5,
    });

    // Before receiving, the pre-sold group is visible (shown as a -5 shortfall).
    const before = await stockRepo.listGroupedByVariety({ includeEmpty: false });
    const beforeGroup = before.find(g => g.type_name === 'Hydrangea');
    expect(beforeGroup, 'shortfall visible before receive').toBeDefined();
    expect(beforeGroup.hasActiveConsumer).toBe(true);

    // PO for 5 Hydrangea Pink — resolves to the existing card by name.
    const created = await agent().post('/api/stock-orders').send({
      notes: 'hydrangea-live-order',
      lines: [{ stockItemId: orig.id, flowerName: 'Hydrangea Pink', quantity: 5, costPrice: 9, sellPrice: 22, supplier: 'Stefan' }],
    });
    expect(created.status).toBe(201);
    const poId = created.body.id;
    const lineId = created.body.lines[0].id;

    await agent().post(`/api/stock-orders/${poId}/send`).send({ driverName: 'Timur' });
    await agent().post(`/api/stock-orders/${poId}/driver-complete`);
    await agent().patch(`/api/stock-orders/${poId}/lines/${lineId}`).send({ 'Quantity Found': 5 });
    await agent().post(`/api/stock-orders/${poId}/approve-review`);

    // Florist accepts all 5 — evaluation succeeds, no error.
    const evaluated = await agent().post(`/api/stock-orders/${poId}/evaluate`).send({
      lines: [{ lineId, quantityAccepted: 5, writeOffQty: 0 }],
    });
    expect(evaluated.status).toBe(200);
    expect(evaluated.body.success).toBe(true);

    // The 5 received stems net exactly against the live order's demand: the
    // Variety group now totals 0, but the order (still New, due 2026-07-12) still
    // needs those stems. The backend must keep the group visible AND expose
    // hasActiveConsumer so the frontend's hideZero filter can do the same
    // (packages/shared/utils/stockMath.js varietyGroupHasVisibleStock).
    const after = await stockRepo.listGroupedByVariety({ includeEmpty: false });
    const hydrangea = after.find(g => g.type_name === 'Hydrangea');

    expect(hydrangea, 'Hydrangea Pink should appear in the Stock view after receiving 5 stems').toBeDefined();
    expect(hydrangea.hasActiveConsumer).toBe(true);
    const totalQty = hydrangea.rows.reduce((sum, r) => sum + (Number(r.current_quantity) || 0), 0);
    expect(totalQty).toBe(0);
  });
});
