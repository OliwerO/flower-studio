// Regression tests for #593 (root cause of #558) — a PO line's flower identity
// must be IMMUTABLE once the line is linked to a Stock Item, or once the PO has
// left Draft.
//
// The bug: `PATCH /:id/lines/:lineId` filtered the body through an allow-list
// that had no `'Stock Item'` entry, so a re-pick sent by both apps' flower
// picker silently changed the line's NAME + money while leaving its Variety
// attrs (`type_name`/`colour`) and its `stock_id` pointing at the OLD flower.
// Downstream, Pending Arrivals and the receive follow the link (old flower)
// while the evaluation screen shows the name (new flower) — that divergence
// produced the live #558 incident (line read "Hydrangea White", was bound to
// the Hydrangea Blue card, and 10 stems were received as Blue).
//
// Owner decision (2026-07-30, superseding the 2026-07-24 hard lock): a line's
// identity may MOVE, but only ever onto a Variety that already exists. Editing
// an attr re-resolves the line onto the matching Stock Item (so "Peony 60cm →
// 70cm" is one edit, not a delete-and-retype); an identity matching nothing is
// refused with VARIETY_NOT_FOUND, because silently minting a Variety from a
// typo is what fragmented stock before (#562). Creating a genuinely new Variety
// stays possible via an explicit `New Variety: true` confirmation.
// The route also stops silently dropping unknown keys — a dropped field that
// returns 200 is what let #558 ship unnoticed.

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
import { stock } from '../db/schema.js';
import { eq } from 'drizzle-orm';

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

async function seedCard(displayName, typeName, colour) {
  const [row] = await harness.db.insert(stock).values({
    displayName, purchaseName: displayName, currentQuantity: 0, active: true,
    typeName, colour,
  }).returning();
  return row;
}

// A Draft PO carrying one line linked to `card`, mirroring the #558 shape.
async function createPoWithLinkedLine(card) {
  const created = await agent().post('/api/stock-orders').send({
    notes: '#593',
    lines: [{
      stockItemId: card.id, flowerName: card.displayName, quantity: 10,
      costPrice: 25, sellPrice: 60, supplier: 'Stefan',
      type: card.typeName, colour: card.colour,
    }],
  });
  expect(created.status).toBe(201);
  const poId = created.body.id;
  const detail = await agent().get(`/api/stock-orders/${poId}`);
  expect(detail.status).toBe(200);
  return { poId, line: detail.body.lines[0] };
}

describe('PATCH /stock-orders/:id/lines/:lineId — identity lock (#593 / #558)', () => {
  it('(#558) re-points a linked line onto another EXISTING Variety and keeps name+link in sync', async () => {
    const blue  = await seedCard('Hydrangea Blue',  'Hydrangea', 'Blue');
    const white = await seedCard('Hydrangea White', 'Hydrangea', 'White');
    const { poId, line } = await createPoWithLinkedLine(blue);

    // Exactly what both apps' flower picker sends on a re-pick.
    const res = await agent().patch(`/api/stock-orders/${poId}/lines/${line.id}`).send({
      'Flower Name': 'Hydrangea White',
      'Stock Item': [white.id],
      Supplier: 'OZ',
      'Cost Price': 16.28,
    });

    expect(res.status).toBe(200);

    // Name, attrs and link all move together — the #558 split is impossible.
    const after = await agent().get(`/api/stock-orders/${poId}`);
    const row = after.body.lines.find((l) => l.id === line.id);
    expect(row['Flower Name']).toBe('Hydrangea White');
    expect(row['Stock Item']).toEqual([white.id]);
    expect(row.Colour).toBe('White');
  });

  it('(#558) REFUSES a flower that does not exist yet, leaving the line untouched', async () => {
    const blue = await seedCard('Hydrangea Blue', 'Hydrangea', 'Blue');
    const { poId, line } = await createPoWithLinkedLine(blue);

    const res = await agent().patch(`/api/stock-orders/${poId}/lines/${line.id}`)
      .send({ Colour: 'Lilac' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VARIETY_NOT_FOUND');

    const after = await agent().get(`/api/stock-orders/${poId}`);
    const row = after.body.lines.find((l) => l.id === line.id);
    expect(row['Flower Name']).toBe('Hydrangea Blue');
    expect(row['Stock Item']).toEqual([blue.id]);
    expect(row.Colour).toBe('Blue');
    expect(Number(row['Cost Price'])).toBe(25);
    expect(row.Supplier).toBe('Stefan');
  });

  it('(the routine case) an attr edit onto an existing Variety re-links in one step', async () => {
    // The owner stocks Peony in 60cm and 70cm; swapping size must not force a
    // delete-and-retype — this is why the hard lock was superseded.
    const p60 = await seedCard('Peony Pink 60', 'Peony', 'Pink');
    const p70 = await seedCard('Peony Pink 70', 'Peony', 'Pink');
    await harness.db.update(stock).set({ sizeCm: 60 }).where(eq(stock.id, p60.id));
    await harness.db.update(stock).set({ sizeCm: 70 }).where(eq(stock.id, p70.id));
    const { poId, line } = await createPoWithLinkedLine(p60);
    await agent().patch(`/api/stock-orders/${poId}/lines/${line.id}`).send({ Size: 60 });

    const res = await agent().patch(`/api/stock-orders/${poId}/lines/${line.id}`)
      .send({ Size: 70 });

    expect(res.status).toBe(200);
    const after = await agent().get(`/api/stock-orders/${poId}`);
    const row = after.body.lines.find((l) => l.id === line.id);
    expect(row['Stock Item']).toEqual([p70.id]);
    expect(row.Size).toBe(70);
  });

  it('still allows editing quantity / cost / supplier on a linked line', async () => {
    const blue = await seedCard('Hydrangea Blue', 'Hydrangea', 'Blue');
    const { poId, line } = await createPoWithLinkedLine(blue);

    const res = await agent().patch(`/api/stock-orders/${poId}/lines/${line.id}`).send({
      'Quantity Needed': 15, 'Cost Price': 16.28, Supplier: 'OZ',
    });

    expect(res.status).toBe(200);
    const after = await agent().get(`/api/stock-orders/${poId}`);
    const row = after.body.lines.find((l) => l.id === line.id);
    expect(row['Quantity Needed']).toBe(15);
    expect(Number(row['Cost Price'])).toBe(16.28);
    expect(row.Supplier).toBe('OZ');
    // identity untouched
    expect(row['Flower Name']).toBe('Hydrangea Blue');
    expect(row['Stock Item']).toEqual([blue.id]);
  });

  it('re-sending the SAME identity values is a harmless no-op, not a 409', async () => {
    const blue = await seedCard('Hydrangea Blue', 'Hydrangea', 'Blue');
    const { poId, line } = await createPoWithLinkedLine(blue);

    const res = await agent().patch(`/api/stock-orders/${poId}/lines/${line.id}`).send({
      'Flower Name': 'Hydrangea Blue',
      'Stock Item': [blue.id],
      'Quantity Needed': 12,
    });

    expect(res.status).toBe(200);
    const after = await agent().get(`/api/stock-orders/${poId}`);
    expect(after.body.lines.find((l) => l.id === line.id)['Quantity Needed']).toBe(12);
  });

  it('still lets a Draft UNLINKED line compose its Variety (DraftLineEditor flow)', async () => {
    const created = await agent().post('/api/stock-orders').send({
      notes: '#593-draft', lines: [{ flowerName: '', quantity: 5, costPrice: 3 }],
    });
    expect(created.status).toBe(201);
    const poId = created.body.id;
    const detail = await agent().get(`/api/stock-orders/${poId}`);
    const line = detail.body.lines[0];

    const res = await agent().patch(`/api/stock-orders/${poId}/lines/${line.id}`)
      .send({ Type: 'Tulip', Colour: 'Yellow' });

    expect(res.status).toBe(200);
    expect(res.body.Type).toBe('Tulip');
    expect(res.body.Colour).toBe('Yellow');
    // the route composes a name from the attrs so the line stays sendable
    expect(String(res.body['Flower Name'] || '').trim()).not.toBe('');
  });

  it('a Draft UNLINKED line CAN be linked to a Stock Item (first assignment persists)', async () => {
    const blue = await seedCard('Hydrangea Blue', 'Hydrangea', 'Blue');
    const created = await agent().post('/api/stock-orders').send({
      notes: '#593-link', lines: [{ flowerName: '', quantity: 5, costPrice: 3 }],
    });
    const poId = created.body.id;
    const detail = await agent().get(`/api/stock-orders/${poId}`);
    const line = detail.body.lines[0];
    expect(line['Stock Item'] ?? []).toEqual([]);

    const res = await agent().patch(`/api/stock-orders/${poId}/lines/${line.id}`).send({
      'Flower Name': 'Hydrangea Blue',
      'Stock Item': [blue.id],
    });

    expect(res.status).toBe(200);
    const after = await agent().get(`/api/stock-orders/${poId}`);
    const row = after.body.lines.find((l) => l.id === line.id);
    // Previously 'Stock Item' was absent from the allow-list, so the link was
    // silently dropped and the line stayed unlinked with only a name.
    expect(row['Stock Item']).toEqual([blue.id]);
    expect(row['Flower Name']).toBe('Hydrangea Blue');
  });

  it('rejects an unknown field instead of silently dropping it', async () => {
    const blue = await seedCard('Hydrangea Blue', 'Hydrangea', 'Blue');
    const { poId, line } = await createPoWithLinkedLine(blue);

    const res = await agent().patch(`/api/stock-orders/${poId}/lines/${line.id}`)
      .send({ 'Bogus Field': 'x', 'Quantity Needed': 7 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bogus field/i);
    // and nothing was applied
    const after = await agent().get(`/api/stock-orders/${poId}`);
    expect(after.body.lines.find((l) => l.id === line.id)['Quantity Needed']).toBe(10);
  });
});
