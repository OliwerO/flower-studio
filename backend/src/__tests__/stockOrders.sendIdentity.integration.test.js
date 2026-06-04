// Regression: a new-Variety PO line (Y-model #304 — Type set, no explicit
// Flower Name) must compose a Flower Name on persistence and be sendable.
//
// The bug ("cannot send PO to driver"): the ungated Variety UI let the owner
// fill the "Type *" field instead of a Flower Name. The line persisted with an
// empty Flower Name + Type. POST /:id/lines accepted it (Type counts as
// identity), but POST /:id/send's blank-check only looked at Stock Item ||
// Flower Name — so it rejected the line as blank and the PO never reached the
// driver. Fix: compose Flower Name from the Variety attrs at persistence, and
// count Type as identity on /send (consistent with line-add).

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

describe('PO send — new-Variety line identity (#304 regression)', () => {
  it('create composes Flower Name from Type/Colour/Size and the PO is sendable', async () => {
    const created = await agent().post('/api/stock-orders').send({
      notes: 'y-model',
      lines: [{ flowerName: '', type: 'Peony', colour: 'Pink', size: 50, quantity: 10, costPrice: 0 }],
    });
    expect(created.status).toBe(201);
    const poId = created.body.id;

    const got = await agent().get(`/api/stock-orders/${poId}`);
    expect(got.body.lines).toHaveLength(1);
    expect(got.body.lines[0]['Flower Name']).toBe('Peony Pink 50cm');
    expect(got.body.lines[0].Type).toBe('Peony');

    const sent = await agent().post(`/api/stock-orders/${poId}/send`).send({ driverName: 'Timur' });
    expect(sent.status).toBe(200);
    expect(sent.body.Status).toBe('Sent');
  });

  it('inline PATCH of Type onto a blank Draft line composes a Flower Name and stays sendable', async () => {
    const created = await agent().post('/api/stock-orders').send({ lines: [{ flowerName: 'Seed', quantity: 1 }] });
    const poId = created.body.id;

    const blank = await agent().post(`/api/stock-orders/${poId}/lines`).send({ flowerName: '', quantity: 5 });
    const lineId = blank.body.id;

    await agent().patch(`/api/stock-orders/${poId}/lines/${lineId}`).send({ Type: 'Rose' });

    const got = await agent().get(`/api/stock-orders/${poId}`);
    const line = got.body.lines.find(l => l.id === lineId);
    expect(String(line['Flower Name'] || '').trim()).not.toBe('');
    expect(line.Type).toBe('Rose');

    const sent = await agent().post(`/api/stock-orders/${poId}/send`).send({ driverName: 'Timur' });
    expect(sent.status).toBe(200);
  });

  it('still blocks /send on a genuinely blank line (no stock item, no name, no Type)', async () => {
    const created = await agent().post('/api/stock-orders').send({ lines: [{ flowerName: 'Real', quantity: 1 }] });
    const poId = created.body.id;
    await agent().post(`/api/stock-orders/${poId}/lines`).send({ flowerName: '', quantity: 1 });

    const sent = await agent().post(`/api/stock-orders/${poId}/send`).send({ driverName: 'Timur' });
    expect(sent.status).toBe(400);
    expect(sent.body.error).toMatch(/blank line/i);
  });
});
