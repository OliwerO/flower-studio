// Regression: issue #524 — adding an off-plan line to an in-flight Stock
// Order (Sent/Shopping status, via the "+ Add line" inline forms in both
// apps) must succeed with only a flower name + quantity. Supplier and
// purchase price are optional and can be filled in later; the identity rule
// (pitfall #6 — a Stock Item link OR a Flower Name) still applies.
//
// The route itself (POST /:id/lines) already defaulted Supplier/Cost Price
// to '' / 0 when omitted — the bug was purely client-side (the "ready" gate
// in AddLineInlineForm / AddExtraLineForm required both before enabling
// Save). This suite locks the server-side contract those forms depend on.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/driverNotifyService.js', () => ({
  notifyDeliveryAssigned: vi.fn().mockResolvedValue(undefined),
  notifyDeliveryDigest:   vi.fn().mockResolvedValue(undefined),
  notifyPoAssigned:       vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));
vi.mock('../services/orderService.js', () => ({ createOrder: vi.fn(), autoMatchStock: vi.fn() }));
vi.mock('../services/configService.js', () => ({
  getConfig:      vi.fn((k) => ({}[k] ?? 0)),
  getDriverOfDay: () => 'Timur',
}));

import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock } from '../db/schema.js';
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

// A PO line's flower must resolve to one she already has (#607), so these
// fixtures stock the flowers first. That is also the real shape: an off-plan
// line at the market is nearly always a flower already in the catalogue.
async function seedCard(displayName, typeName, colour = null) {
  const [row] = await harness.db.insert(stock).values({
    displayName, purchaseName: displayName, typeName, colour,
    currentQuantity: 0, active: true,
  }).returning();
  return row;
}

// Helper: Draft PO with one seed line → send to driver → returns poId + seedLineId
async function createSentPO() {
  const created = await agent().post('/api/stock-orders').send({
    lines: [{ flowerName: 'Seed', type: 'Seed', quantity: 1, newVariety: true }],
  });
  const poId = created.body.id;
  await agent().post(`/api/stock-orders/${poId}/send`).send({ driverName: 'Timur' });
  const got = await agent().get(`/api/stock-orders/${poId}`);
  const seedLineId = got.body.lines[0].id;
  return { poId, seedLineId };
}

describe('PO line add — supplier & cost price optional (#524)', () => {
  it('adds a line to a Sent PO with only flower name + quantity — no supplier, no cost', async () => {
    await seedCard('Off-plan Rose', 'Rose');
    const { poId } = await createSentPO();

    const res = await agent().post(`/api/stock-orders/${poId}/lines`).send({
      flowerName: 'Off-plan Rose',
      quantity: 12,
    });

    expect(res.status).toBe(200);
    expect(res.body['Flower Name']).toBe('Off-plan Rose');
    expect(res.body['Quantity Needed']).toBe(12);
    expect(res.body.Supplier).toBe('');
    expect(Number(res.body['Cost Price'])).toBe(0);
  });

  it('adds a line to a Shopping PO with only flower name + quantity — no supplier, no cost', async () => {
    await seedCard('Off-plan Peony', 'Peony');
    const { poId, seedLineId } = await createSentPO();

    // Any Driver Status patch while Sent flips the PO to Shopping (mirrors
    // the driver opening the shopping run).
    await agent().patch(`/api/stock-orders/${poId}/lines/${seedLineId}`).send({ 'Driver Status': 'Found All' });
    const poCheck = await agent().get(`/api/stock-orders/${poId}`);
    expect(poCheck.body.Status).toBe('Shopping');

    const res = await agent().post(`/api/stock-orders/${poId}/lines`).send({
      flowerName: 'Off-plan Peony',
      quantity: 6,
    });

    expect(res.status).toBe(200);
    expect(res.body['Flower Name']).toBe('Off-plan Peony');
    expect(res.body.Supplier).toBe('');
    expect(Number(res.body['Cost Price'])).toBe(0);
  });

  it('still rejects a Sent-PO line add with no identity (no stock item, no flower name, no Type)', async () => {
    const { poId } = await createSentPO();

    const res = await agent().post(`/api/stock-orders/${poId}/lines`).send({ quantity: 5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stock item or flower name/i);
  });

  it('accepts a Sent-PO line keyed on a new-Variety Type alone (no Flower Name, no supplier, no cost)', async () => {
    await seedCard('Ranunculus', 'Ranunculus');
    const { poId } = await createSentPO();

    const res = await agent().post(`/api/stock-orders/${poId}/lines`).send({
      type: 'Ranunculus',
      quantity: 8,
    });

    expect(res.status).toBe(200);
    expect(res.body.Type).toBe('Ranunculus');
    expect(res.body.Supplier).toBe('');
    expect(Number(res.body['Cost Price'])).toBe(0);
  });
});
