// Regression tests for the Stock Item link on PATCH /stock-orders/:id/lines/:lineId.
//
// `'Stock Item'` was missing from that route's field allow-list until
// 2026-07-29, even though `stockOrderRepo`'s field mapper has always handled
// it. The Draft line editor's flower picker sent `Stock Item` on every pick and
// had it silently dropped — the link only ever got written later, at
// evaluation, by name/4-tuple resolution. Nothing failed loudly, so the gap
// went unnoticed.
//
// ADR-0014 makes the link something the owner actively changes: editing a
// Variety attr re-links the line to the matching Stock Item, or detaches it
// when the combination is new. Both directions have to round-trip to the
// server, or the form's decision is lost on refresh and evaluation receives
// stems into whatever card the line was last linked to — which is #558.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/driverNotifyService.js', () => ({
  notifyDeliveryAssigned: vi.fn().mockResolvedValue(undefined),
  notifyDeliveryDigest:   vi.fn().mockResolvedValue(undefined),
  notifyPoAssigned:       vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));
vi.mock('../services/orderService.js', () => ({
  createOrder: vi.fn(),
  autoMatchStock: vi.fn(),
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

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import stockOrdersRouter from '../routes/stockOrders.js';
import { stock } from '../db/schema.js';

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

// Inserted straight into the table rather than through POST /stock — this
// suite is about the PO line route, not stock creation validation.
async function makeStockItem({ displayName, typeName, colour, sizeCm }) {
  const [row] = await harness.db.insert(stock).values({
    displayName, typeName, colour, sizeCm,
    currentQuantity: 0, active: true, category: 'Other',
  }).returning();
  return row;
}

async function makeDraftPoWithLine(line = { flowerName: 'Seed', quantity: 1, costPrice: 1 }) {
  const created = await agent().post('/api/stock-orders').send({ lines: [line] });
  expect(created.status).toBe(201);
  const detail = await agent().get(`/api/stock-orders/${created.body.id}`);
  return { poId: created.body.id, lineId: detail.body.lines[0].id };
}

describe('PATCH /stock-orders/:id/lines/:lineId — Stock Item link', () => {
  it('persists a Stock Item link set from the line editor', async () => {
    const pink = await makeStockItem({
      displayName: 'Peony Pink 60cm', typeName: 'Peony', colour: 'Pink', sizeCm: 60,
    });
    const { poId, lineId } = await makeDraftPoWithLine();

    const patched = await agent().patch(`/api/stock-orders/${poId}/lines/${lineId}`).send({
      'Stock Item': [pink.id],
      'Flower Name': 'Peony Pink 60cm',
      Type: 'Peony', Colour: 'Pink', Size: 60,
    });

    expect(patched.status).toBe(200);
    expect(patched.body['Stock Item']).toEqual([pink.id]);

    // Survives a refetch — the point of the fix.
    const detail = await agent().get(`/api/stock-orders/${poId}`);
    expect(detail.body.lines[0]['Stock Item']).toEqual([pink.id]);
  });

  it('detaches the link when the form sends an empty array (ADR-0014)', async () => {
    const pink = await makeStockItem({
      displayName: 'Peony Pink 60cm', typeName: 'Peony', colour: 'Pink', sizeCm: 60,
    });
    const { poId, lineId } = await makeDraftPoWithLine();

    await agent().patch(`/api/stock-orders/${poId}/lines/${lineId}`)
      .send({ 'Stock Item': [pink.id], Type: 'Peony', Colour: 'Pink', Size: 60 });

    // Owner changes Colour to a Variety that does not exist → the form detaches.
    const detached = await agent().patch(`/api/stock-orders/${poId}/lines/${lineId}`)
      .send({ 'Stock Item': [], Colour: 'White' });

    expect(detached.status).toBe(200);
    expect(detached.body['Stock Item']).toEqual([]);
    expect(detached.body.Colour).toBe('White');

    const detail = await agent().get(`/api/stock-orders/${poId}`);
    expect(detail.body.lines[0]['Stock Item']).toEqual([]);
    // Without the detach the line would still point at the Pink card, and
    // evaluation — which skips attr resolution on a linked line — would receive
    // White stems into it. That is #558.
    expect(detail.body.lines[0].Colour).toBe('White');
  });

  it('re-links to a different Stock Item when an attr edit matches another Variety', async () => {
    const p60 = await makeStockItem({
      displayName: 'Peony Pink 60cm', typeName: 'Peony', colour: 'Pink', sizeCm: 60,
    });
    const p70 = await makeStockItem({
      displayName: 'Peony Pink 70cm', typeName: 'Peony', colour: 'Pink', sizeCm: 70,
    });
    const { poId, lineId } = await makeDraftPoWithLine();

    await agent().patch(`/api/stock-orders/${poId}/lines/${lineId}`)
      .send({ 'Stock Item': [p60.id], Type: 'Peony', Colour: 'Pink', Size: 60 });

    const relinked = await agent().patch(`/api/stock-orders/${poId}/lines/${lineId}`)
      .send({ 'Stock Item': [p70.id], Size: 70, 'Flower Name': 'Peony Pink 70cm' });

    expect(relinked.status).toBe(200);
    expect(relinked.body['Stock Item']).toEqual([p70.id]);
    expect(relinked.body.Size).toBe(70);
  });
});
