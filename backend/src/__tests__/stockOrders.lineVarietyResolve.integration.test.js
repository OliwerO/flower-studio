// #607 — a Stock Order line's flower is RESOLVED, never invented by accident.
//
// The last of the create-a-flower paths that predate the door (#603). Three
// server-side fallbacks used to mint a Stock Item from whatever phrase was
// typed, using `stockRepo.create`'s "typeName falls back to the display name"
// rule — which is exactly how `Pink Peonies` ended up on prod as a Type sitting
// beside `Peony / Pink` (#562), and how a shopping-list line saved as
// `Roses red 50` would become a flower whose Type is literally `Roses red 50`:
//
//   row 11  composition (`POST /stock-orders`, `POST /:id/lines`) —
//           `resolveOrCreateStockItem` matched an exact display name among
//           ACTIVE cards only, and created on a miss.
//   row 12  evaluation, Y-model line — looked up the 4-tuple through
//           `stockRepo.list`, which also matches dated Batches, and created on
//           a miss with no confirmation of any kind. ADR-0016's confirm rule
//           only ever applied to lines that were ALREADY linked, so a line
//           typed from scratch reached evaluation unconfirmed.
//   row 13  evaluation, legacy name-only line — exact display name, created on
//           a miss. A line with no Type cannot be classified at all; that is
//           precisely the state pitfall `po-line-identity` was written about.
//
// The rule now: resolve through `stockRepo.findVarietyMatch` (case- and
// whitespace-insensitive, null-aware, canonical card only — never a dated
// Batch), and REFUSE rather than invent. Creating a genuinely new Variety
// stays possible but must be deliberate and must be RECORDED on the line
// (`New Variety`), so evaluation can tell a confirmed new flower from a typo
// that nobody ever looked at.

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
import { stock, stockOrders, stockOrderLines } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { PO_STATUS } from '../constants/statuses.js';

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

async function seedCard(fields) {
  const [row] = await harness.db.insert(stock).values({
    currentQuantity: 0, active: true, ...fields,
  }).returning();
  return row;
}

async function allCards() {
  return harness.db.select().from(stock);
}

// ────────────────────────────────────────────────────────────────────────────
// Row 11 — composition
// ────────────────────────────────────────────────────────────────────────────

describe('#607 row 11 — composing a line resolves, never invents', () => {
  it('links a name-only line to the flower she already has, ignoring case', async () => {
    const card = await seedCard({
      displayName: 'Peony Pink', purchaseName: 'Peony Pink',
      typeName: 'Peony', colour: 'Pink',
    });

    const res = await agent().post('/api/stock-orders').send({
      lines: [{ flowerName: '  peony pink ', quantity: 20, costPrice: 10 }],
    });

    expect(res.status).toBe(201);
    const detail = await agent().get(`/api/stock-orders/${res.body.id}`);
    expect(detail.body.lines[0]['Stock Item']).toEqual([card.id]);
    expect((await allCards()).length).toBe(1);
  });

  it('links a name-only line to a DEACTIVATED card rather than minting a twin', async () => {
    const card = await seedCard({
      displayName: 'Ranunculus', purchaseName: 'Ranunculus',
      typeName: 'Ranunculus', active: false,
    });

    const res = await agent().post('/api/stock-orders').send({
      lines: [{ flowerName: 'Ranunculus', quantity: 10 }],
    });

    expect(res.status).toBe(201);
    const detail = await agent().get(`/api/stock-orders/${res.body.id}`);
    expect(detail.body.lines[0]['Stock Item']).toEqual([card.id]);
    expect((await allCards()).length).toBe(1);
  });

  it('REFUSES a name-only line that matches nothing — and creates neither PO nor flower', async () => {
    await seedCard({
      displayName: 'Peony Pink', purchaseName: 'Peony Pink',
      typeName: 'Peony', colour: 'Pink',
    });

    const res = await agent().post('/api/stock-orders').send({
      lines: [{ flowerName: 'Pink Peonies', quantity: 20 }],
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VARIETY_NOT_FOUND');
    expect(res.body.error).toContain('Pink Peonies');
    expect((await allCards()).length).toBe(1);
    expect((await agent().get('/api/stock-orders')).body.length).toBe(0);
  });

  it('links a 4-tuple line onto the existing Variety despite case drift', async () => {
    const card = await seedCard({
      displayName: 'Peony Pink 60cm', purchaseName: 'Peony Pink 60cm',
      typeName: 'Peony', colour: 'Pink', sizeCm: 60,
    });

    const res = await agent().post('/api/stock-orders').send({
      lines: [{ flowerName: 'whatever', type: 'peony', colour: 'PINK', size: 60, quantity: 15 }],
    });

    expect(res.status).toBe(201);
    const detail = await agent().get(`/api/stock-orders/${res.body.id}`);
    expect(detail.body.lines[0]['Stock Item']).toEqual([card.id]);
    expect((await allCards()).length).toBe(1);
  });

  it('REFUSES a 4-tuple that matches nothing until she confirms it is new', async () => {
    await seedCard({
      displayName: 'Peony Pink', purchaseName: 'Peony Pink',
      typeName: 'Peony', colour: 'Pink',
    });

    const res = await agent().post('/api/stock-orders').send({
      lines: [{ flowerName: 'Peony Coral', type: 'Peony', colour: 'Coral', quantity: 15 }],
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VARIETY_NOT_FOUND');
  });

  it('accepts a confirmed new Variety, records the confirmation, and stays unlinked', async () => {
    const res = await agent().post('/api/stock-orders').send({
      lines: [{
        flowerName: 'Peony Coral', type: 'Peony', colour: 'Coral',
        quantity: 15, newVariety: true,
      }],
    });

    expect(res.status).toBe(201);
    const detail = await agent().get(`/api/stock-orders/${res.body.id}`);
    const line = detail.body.lines[0];
    expect(line['Stock Item']).toEqual([]);
    expect(line['New Variety']).toBe(true);
    // A PO line is an intent to buy — the flower is created when it arrives.
    expect((await allCards()).length).toBe(0);
  });

  it('leaves a blank Draft line alone — nothing typed, nothing to resolve', async () => {
    const res = await agent().post('/api/stock-orders').send({
      lines: [{ quantity: 5 }],
    });
    expect(res.status).toBe(201);
  });

  it('applies the same rule to POST /:id/lines', async () => {
    const card = await seedCard({
      displayName: 'Tulip Red', purchaseName: 'Tulip Red',
      typeName: 'Tulip', colour: 'Red',
    });
    const po = await agent().post('/api/stock-orders').send({ lines: [{ quantity: 1 }] });

    const ok = await agent().post(`/api/stock-orders/${po.body.id}/lines`)
      .send({ flowerName: 'tulip red', quantity: 10 });
    expect(ok.status).toBe(200);
    expect(ok.body['Stock Item']).toEqual([card.id]);

    const refused = await agent().post(`/api/stock-orders/${po.body.id}/lines`)
      .send({ flowerName: 'Red Tulips', quantity: 10 });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('VARIETY_NOT_FOUND');

    const confirmed = await agent().post(`/api/stock-orders/${po.body.id}/lines`)
      .send({ flowerName: 'Tulip Yellow', type: 'Tulip', colour: 'Yellow', quantity: 10, newVariety: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body['New Variety']).toBe(true);

    expect((await allCards()).length).toBe(1);
  });

  it('never resolves a dated Batch — that is one delivery, not the Variety', async () => {
    await seedCard({
      displayName: 'Peony Pink (24.Jul.)', purchaseName: 'Peony Pink',
      typeName: 'Peony', colour: 'Pink', date: '2026-07-24',
    });

    const res = await agent().post('/api/stock-orders').send({
      lines: [{ flowerName: 'Peony Pink (24.Jul.)', quantity: 10 }],
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VARIETY_NOT_FOUND');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Send — the moment a line's flower has to be settled
// ────────────────────────────────────────────────────────────────────────────

// A Draft line is also built up field by field through PATCH, which stays
// permissive so the owner isn't fought mid-typing. Send is where it has to be
// real: the driver is about to leave with this list.
describe('#607 — /send settles what composition left open', () => {
  it('links an unlinked line whose attrs match a flower she has', async () => {
    const card = await seedCard({
      displayName: 'Rose Red', purchaseName: 'Rose Red', typeName: 'Rose', colour: 'Red',
    });
    const po = await agent().post('/api/stock-orders').send({ lines: [{ quantity: 5 }] });
    const detail = await agent().get(`/api/stock-orders/${po.body.id}`);
    await agent().patch(`/api/stock-orders/${po.body.id}/lines/${detail.body.lines[0].id}`)
      .send({ Type: 'Rose', Colour: 'Red' });

    const sent = await agent().post(`/api/stock-orders/${po.body.id}/send`).send({ driverName: 'Timur' });
    expect(sent.status).toBe(200);

    const after = await agent().get(`/api/stock-orders/${po.body.id}`);
    expect(after.body.lines[0]['Stock Item']).toEqual([card.id]);
  });

  it('REFUSES to send a line whose flower does not exist and was never confirmed', async () => {
    const po = await agent().post('/api/stock-orders').send({ lines: [{ quantity: 5 }] });
    const detail = await agent().get(`/api/stock-orders/${po.body.id}`);
    await agent().patch(`/api/stock-orders/${po.body.id}/lines/${detail.body.lines[0].id}`)
      .send({ Type: 'Rose', Colour: 'Crimson' });

    const sent = await agent().post(`/api/stock-orders/${po.body.id}/send`).send({ driverName: 'Timur' });
    expect(sent.status).toBe(409);
    expect(sent.body.code).toBe('VARIETY_NOT_FOUND');
    expect(sent.body.error).toContain('Rose');
  });

  it('sends once she confirms the flower is new, and the answer sticks to the line', async () => {
    const po = await agent().post('/api/stock-orders').send({ lines: [{ quantity: 5 }] });
    const detail = await agent().get(`/api/stock-orders/${po.body.id}`);
    const lineId = detail.body.lines[0].id;
    await agent().patch(`/api/stock-orders/${po.body.id}/lines/${lineId}`)
      .send({ Type: 'Rose', Colour: 'Crimson', 'New Variety': true });

    const sent = await agent().post(`/api/stock-orders/${po.body.id}/send`).send({ driverName: 'Timur' });
    expect(sent.status).toBe(200);

    const after = await agent().get(`/api/stock-orders/${po.body.id}`);
    expect(after.body.lines[0]['New Variety']).toBe(true);
  });

  it('drops a stale confirmation once the line is linked to a real card', async () => {
    const card = await seedCard({
      displayName: 'Rose Red', purchaseName: 'Rose Red', typeName: 'Rose', colour: 'Red',
    });
    const po = await agent().post('/api/stock-orders').send({
      lines: [{ flowerName: 'Rose Crimson', type: 'Rose', colour: 'Crimson', quantity: 5, newVariety: true }],
    });
    const detail = await agent().get(`/api/stock-orders/${po.body.id}`);
    expect(detail.body.lines[0]['New Variety']).toBe(true);

    await agent().patch(`/api/stock-orders/${po.body.id}/lines/${detail.body.lines[0].id}`)
      .send({ 'Stock Item': [card.id] });

    const after = await agent().get(`/api/stock-orders/${po.body.id}`);
    expect(after.body.lines[0]['Stock Item']).toEqual([card.id]);
    expect(after.body.lines[0]['New Variety']).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Rows 12 + 13 — evaluation
// ────────────────────────────────────────────────────────────────────────────

// Build a PO sitting in Evaluating with one line whose fields are written
// directly, so a line shape the composition door would now refuse (a legacy
// row, or one that pre-dates this change) can still be exercised.
async function poAwaitingEvaluation(lineFields) {
  const created = await agent().post('/api/stock-orders').send({ lines: [{ quantity: 1 }] });
  const poId = created.body.id;
  const detail = await agent().get(`/api/stock-orders/${poId}`);
  const lineId = detail.body.lines[0].id;

  await harness.db.update(stockOrderLines).set({
    flowerName:     lineFields.flowerName ?? '',
    typeName:       lineFields.type ?? null,
    colour:         lineFields.colour ?? null,
    sizeCm:         lineFields.size ?? null,
    cultivar:       lineFields.cultivar ?? null,
    newVariety:     lineFields.newVariety ?? false,
    costPrice:      String(lineFields.costPrice ?? 12),
    quantityNeeded: 10,
  }).where(eq(stockOrderLines.id, lineId));
  await harness.db.update(stockOrders)
    .set({ status: PO_STATUS.EVALUATING })
    .where(eq(stockOrders.id, poId));
  return { poId, lineId };
}

describe('#607 rows 12/13 — evaluating an unlinked line resolves, never invents', () => {
  it('(row 12) links onto the existing Variety despite case drift, creating no second card', async () => {
    const card = await seedCard({
      displayName: 'Peony Pink 60cm', purchaseName: 'Peony Pink 60cm',
      typeName: 'Peony', colour: 'Pink', sizeCm: 60,
    });
    const { poId, lineId } = await poAwaitingEvaluation({
      flowerName: 'Peony Pink 60cm', type: 'peony', colour: 'Pink', size: 60,
    });

    const res = await agent().post(`/api/stock-orders/${poId}/evaluate`)
      .send({ lines: [{ lineId, quantityAccepted: 10 }] });

    expect(res.status).toBe(200);
    // One receive creates one dated Batch off the canonical card — never a
    // second canonical card for the same Variety.
    const cards = await allCards();
    expect(cards.filter(c => !/\(/.test(c.displayName)).map(c => c.id)).toEqual([card.id]);
  });

  it('(row 12) REFUSES an unconfirmed new Variety, marking the line an error', async () => {
    await seedCard({
      displayName: 'Peony Pink', purchaseName: 'Peony Pink',
      typeName: 'Peony', colour: 'Pink',
    });
    const { poId, lineId } = await poAwaitingEvaluation({
      flowerName: 'Peony Coral', type: 'Peony', colour: 'Coral',
    });

    const res = await agent().post(`/api/stock-orders/${poId}/evaluate`)
      .send({ lines: [{ lineId, quantityAccepted: 10 }] });

    expect(res.status).toBe(207);
    expect(res.body.lineResults[0].status).toBe('error');
    expect(res.body.lineResults[0].error).toMatch(/Peony Coral|confirm/i);
    expect((await allCards()).length).toBe(1);

    const po = await agent().get(`/api/stock-orders/${poId}`);
    expect(po.body.Status).toBe(PO_STATUS.EVAL_ERROR);
  });

  it('(row 12) creates the Variety when the line carries her confirmation', async () => {
    const { poId, lineId } = await poAwaitingEvaluation({
      flowerName: 'Peony Coral', type: 'Peony', colour: 'Coral', newVariety: true,
    });

    const res = await agent().post(`/api/stock-orders/${poId}/evaluate`)
      .send({ lines: [{ lineId, quantityAccepted: 10 }] });

    expect(res.status).toBe(200);
    const cards = await allCards();
    expect(cards.some(c => c.typeName === 'Peony' && c.colour === 'Coral')).toBe(true);
    // The Type is the classification she picked — never the typed phrase.
    expect(cards.every(c => c.typeName !== 'Peony Coral')).toBe(true);
  });

  it('(row 13) links a legacy name-only line onto the flower she has', async () => {
    const card = await seedCard({
      displayName: 'Rose Red 50cm', purchaseName: 'Rose Red 50cm',
      typeName: 'Rose', colour: 'Red', sizeCm: 50,
    });
    const { poId, lineId } = await poAwaitingEvaluation({ flowerName: 'rose red 50cm' });

    const res = await agent().post(`/api/stock-orders/${poId}/evaluate`)
      .send({ lines: [{ lineId, quantityAccepted: 10 }] });

    expect(res.status).toBe(200);
    const cards = await allCards();
    expect(cards.filter(c => !/\(/.test(c.displayName)).map(c => c.id)).toEqual([card.id]);
  });

  it('(row 13) REFUSES a legacy name-only line that matches nothing — a phrase is not a Type', async () => {
    const { poId, lineId } = await poAwaitingEvaluation({ flowerName: 'Roses red 50' });

    const res = await agent().post(`/api/stock-orders/${poId}/evaluate`)
      .send({ lines: [{ lineId, quantityAccepted: 10 }] });

    expect(res.status).toBe(207);
    expect(res.body.lineResults[0].status).toBe('error');
    expect((await allCards()).length).toBe(0);
  });

  it('(row 13) refuses even WITH a confirmation — an unclassified line cannot be created', async () => {
    const { poId, lineId } = await poAwaitingEvaluation({
      flowerName: 'Roses red 50', newVariety: true,
    });

    const res = await agent().post(`/api/stock-orders/${poId}/evaluate`)
      .send({ lines: [{ lineId, quantityAccepted: 10 }] });

    expect(res.status).toBe(207);
    expect(res.body.lineResults[0].error).toMatch(/type/i);
    expect((await allCards()).length).toBe(0);
  });
});
