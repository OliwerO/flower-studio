// Regression: PO evaluation must record stock_purchases.quantity_purchased
// as the FOUND (bought/paid-for) quantity, not the post-write-off ACCEPTED
// quantity — issue #492. The supplier bills for what was bought at market
// regardless of later breakage.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/driverNotifyService.js', () => ({
  notifyDeliveryAssigned: vi.fn().mockResolvedValue(undefined),
  notifyDeliveryDigest:   vi.fn().mockResolvedValue(undefined),
  notifyPoAssigned:       vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));
vi.mock('../services/orderService.js', () => ({ createOrder: vi.fn(), autoMatchStock: vi.fn() }));
vi.mock('../services/configService.js', () => ({
  getConfig:      vi.fn((k) => ({ targetMarkup: 2.5 }[k] ?? 0)),
  getDriverOfDay: () => 'Timur',
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

import stockOrdersRouter from '../routes/stockOrders.js';
import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';

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

describe('PO evaluate — Found vs Accepted purchase quantity (#492)', () => {
  it('primary line: records quantity_purchased=Found, quantity_accepted=Accepted', async () => {
    const created = await agent().post('/api/stock-orders').send({
      notes: 'found-vs-accepted',
      lines: [{ flowerName: 'Ranunculus', quantity: 20, costPrice: 5, sellPrice: 12, supplier: 'Stefan' }],
    });
    expect(created.status).toBe(201);
    const poId = created.body.id;
    const lineId = created.body.lines[0].id;

    await agent().post(`/api/stock-orders/${poId}/send`).send({ driverName: 'Timur' });
    await agent().post(`/api/stock-orders/${poId}/driver-complete`);

    // Owner enters actual quantities during Reviewing.
    await agent().patch(`/api/stock-orders/${poId}/lines/${lineId}`).send({ 'Quantity Found': 20 });
    const approved = await agent().post(`/api/stock-orders/${poId}/approve-review`);
    expect(approved.status).toBe(200);

    // Florist evaluates: 3 stems arrived broken, 17 accepted.
    const evaluated = await agent().post(`/api/stock-orders/${poId}/evaluate`).send({
      lines: [{ lineId, quantityAccepted: 17, writeOffQty: 3, writeOffReason: 'Arrived Broken' }],
    });
    expect(evaluated.status).toBe(200);

    const [purchase] = await stockPurchasesRepo.list({ from: '1900-01-01', to: '2100-01-01' });
    expect(purchase).toBeDefined();
    expect(purchase['Quantity Purchased']).toBe(20); // Found — the money-spend basis
    expect(purchase['Quantity Accepted']).toBe(17);   // Accepted — kept after write-off

    const amountPaid = purchase['Price Per Unit'] * purchase['Quantity Purchased'];
    expect(amountPaid).toBe(100); // 20 * 5, not 17 * 5 = 85
  });

  it('substitute line: records quantity_purchased=Alt Quantity Found, quantity_accepted=altQuantityAccepted', async () => {
    const created = await agent().post('/api/stock-orders').send({
      notes: 'sub-found-vs-accepted',
      lines: [{ flowerName: 'Peony', quantity: 10, costPrice: 8, sellPrice: 20, supplier: 'Stefan' }],
    });
    const poId = created.body.id;
    const lineId = created.body.lines[0].id;

    await agent().post(`/api/stock-orders/${poId}/send`).send({ driverName: 'Timur' });
    await agent().post(`/api/stock-orders/${poId}/driver-complete`);

    // Driver substitutes: found 10 Ranunculus at market for 90 zł total.
    await agent().patch(`/api/stock-orders/${poId}/lines/${lineId}`).send({
      'Alt Supplier':       'OZ',
      'Alt Flower Name':    'Ranunculus',
      'Alt Quantity Found': 10,
      'Alt Cost':           90,
    });
    await agent().post(`/api/stock-orders/${poId}/approve-review`);

    // Florist accepts 8, writes off 2.
    const evaluated = await agent().post(`/api/stock-orders/${poId}/evaluate`).send({
      lines: [{ lineId, quantityAccepted: 0, writeOffQty: 0, altQuantityAccepted: 8, altWriteOffQty: 2, altWriteOffReason: 'Arrived Broken' }],
    });
    expect(evaluated.status).toBe(200);

    const purchases = await stockPurchasesRepo.list({ from: '1900-01-01', to: '2100-01-01' });
    const subPurchase = purchases.find(p => p.Supplier === 'OZ');
    expect(subPurchase).toBeDefined();
    expect(subPurchase['Quantity Purchased']).toBe(10); // Alt Quantity Found
    expect(subPurchase['Quantity Accepted']).toBe(8);

    const amountPaid = subPurchase['Price Per Unit'] * subPurchase['Quantity Purchased'];
    expect(amountPaid).toBeCloseTo(90, 2); // altCostTotal, not 8 * (90/10) = 72
  });
});
