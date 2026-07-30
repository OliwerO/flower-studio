// Regression tests for #562 — `POST /api/stock` must MATCH an existing Variety
// before it creates a new one.
//
// The bug: the only rule on the create-a-flower door was "displayName is not
// empty". Seven screens across three apps funnel into it (both receive forms,
// both new-order wizards, both order-detail "+ Add new" blocks, and the shared
// bouquet-demand helper), so any of them could mint `Pink Peonies / Pink`
// beside the real `Peony / Pink`, or `peony` beside `Peony`. Stock then splits
// across two cards and neither shows the true count (#319, #558's sibling).
//
// The fix is deliberately invisible to callers: every caller posts
// `quantity: 0` and then logs the real movement against `res.data.id`
// (`/stock-purchases`, or an order line), so returning the EXISTING card
// instead of a duplicate loses nothing. Creating a genuinely new Variety stays
// possible — it just has to be asked for explicitly via `newVariety: true`.
//
// Matching rules pinned here:
//   • case- and whitespace-insensitive on the Variety 4-tuple and on the name;
//   • null-aware (ADR-0006 strict identity: a blank Colour ≠ Colour "Pink");
//   • matches inactive and zero-quantity cards (else deactivating a flower
//     silently re-opens the duplicate door);
//   • never matches a dated Batch row — `Peony Pink (24.Jul.)` is one delivery,
//     not the Variety's canonical card (pitfall `batch-variety-attrs`).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock } from '../db/schema.js';
import { eq, isNull, and } from 'drizzle-orm';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

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
  app = buildApp();
  vi.clearAllMocks();
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

async function countRows() {
  const rows = await harness.db.select().from(stock).where(isNull(stock.deletedAt));
  return rows.length;
}

// Seed a canonical (undated) Variety card straight through the route, so the
// stored shape is exactly what production has.
async function seedVariety(body) {
  const res = await supertest(app).post('/stock').send({ quantity: 0, costPrice: 1, ...body });
  expect(res.status).toBe(201);
  return res.body;
}

describe('POST /stock — matches an existing Variety before creating', () => {
  it('same 4-tuple in different case returns the EXISTING card, creates nothing', async () => {
    const existing = await seedVariety({
      displayName: 'Peony Pink 60cm', typeName: 'Peony', colour: 'Pink', sizeCm: 60,
    });
    const before = await countRows();

    const res = await supertest(app).post('/stock').send({
      displayName: 'Pink Peonies', typeName: 'peony', colour: 'pink', sizeCm: 60,
      quantity: 0, costPrice: 9,
    });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(existing.id);
    expect(res.body['Display Name']).toBe('Peony Pink 60cm');
    expect(await countRows()).toBe(before);
  });

  it('surrounding whitespace does not create a near-twin', async () => {
    const existing = await seedVariety({
      displayName: 'Rose Red', typeName: 'Rose', colour: 'Red', cultivar: 'Freedom',
    });

    const res = await supertest(app).post('/stock').send({
      displayName: 'Rose Red', typeName: '  Rose ', colour: 'Red ', cultivar: ' freedom',
      quantity: 0, costPrice: 4,
    });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(existing.id);
  });

  it('matches a deactivated / zero-quantity card rather than duplicating it', async () => {
    const existing = await seedVariety({
      displayName: 'Tulip Yellow', typeName: 'Tulip', colour: 'Yellow', quantity: 0,
    });
    await harness.db.update(stock).set({ active: false }).where(eq(stock.id, existing.id));
    const before = await countRows();

    const res = await supertest(app).post('/stock').send({
      displayName: 'Tulip Yellow', typeName: 'Tulip', colour: 'Yellow', quantity: 0, costPrice: 2,
    });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(existing.id);
    expect(await countRows()).toBe(before);
  });

  it('a genuinely different Variety still creates (strict null-aware identity)', async () => {
    await seedVariety({ displayName: 'Peony Pink 60cm', typeName: 'Peony', colour: 'Pink', sizeCm: 60 });
    const before = await countRows();

    const bigger = await supertest(app).post('/stock').send({
      displayName: 'Peony Pink 70cm', typeName: 'Peony', colour: 'Pink', sizeCm: 70, quantity: 0, costPrice: 5,
    });
    expect(bigger.status).toBe(201);

    // Blank Colour is its own identity — it must not collapse onto Pink.
    const colourless = await supertest(app).post('/stock').send({
      displayName: 'Peony', typeName: 'Peony', colour: null, sizeCm: 60, quantity: 0, costPrice: 5,
    });
    expect(colourless.status).toBe(201);

    expect(await countRows()).toBe(before + 2);
  });

  it('newVariety:true is the deliberate escape hatch and still creates', async () => {
    const existing = await seedVariety({
      displayName: 'Peony Pink', typeName: 'Peony', colour: 'Pink',
    });
    const before = await countRows();

    const res = await supertest(app).post('/stock').send({
      displayName: 'Peony Pink', typeName: 'Peony', colour: 'Pink',
      quantity: 0, costPrice: 5, newVariety: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(existing.id);
    expect(await countRows()).toBe(before + 1);
  });

  it('never matches a dated Batch — a delivery row is not the canonical card', async () => {
    // Only a dated Batch carries this identity; the canonical card does not exist yet.
    await seedVariety({
      displayName: 'Ranunculus White (24.Jul.)', typeName: 'Ranunculus', colour: 'White',
    });
    const before = await countRows();

    const res = await supertest(app).post('/stock').send({
      displayName: 'Ranunculus White', typeName: 'Ranunculus', colour: 'White', quantity: 0, costPrice: 3,
    });

    expect(res.status).toBe(201);
    expect(res.body['Display Name']).toBe('Ranunculus White');
    expect(await countRows()).toBe(before + 1);
  });

  it('prefers the canonical card when both it and a dated Batch exist', async () => {
    const canonical = await seedVariety({
      displayName: 'Hydrangea Blue', typeName: 'Hydrangea', colour: 'Blue',
    });
    await seedVariety({
      displayName: 'Hydrangea Blue (24.Jul.)', typeName: 'Hydrangea', colour: 'Blue',
    });

    const res = await supertest(app).post('/stock').send({
      displayName: 'Hydrangea Blue', typeName: 'Hydrangea', colour: 'Blue', quantity: 0, costPrice: 20,
    });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(canonical.id);
  });

  it('falls back to a case-insensitive name match when no Type is given', async () => {
    const existing = await seedVariety({ displayName: 'Eucalyptus' });
    const before = await countRows();

    const res = await supertest(app).post('/stock').send({
      displayName: '  eucalyptus ', quantity: 0, costPrice: 1,
    });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(existing.id);
    expect(await countRows()).toBe(before);
  });

  it('still 400s on a missing displayName', async () => {
    const res = await supertest(app).post('/stock').send({ quantity: 0, costPrice: 1 });
    expect(res.status).toBe(400);
  });

  it('a soft-deleted card is not matched — it must not resurrect', async () => {
    const gone = await seedVariety({ displayName: 'Freesia', typeName: 'Freesia' });
    await harness.db.update(stock).set({ deletedAt: new Date() }).where(eq(stock.id, gone.id));

    const res = await supertest(app).post('/stock').send({
      displayName: 'Freesia', typeName: 'Freesia', quantity: 0, costPrice: 1,
    });

    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(gone.id);
  });
});

describe('stockRepo.list — Variety 4-tuple filters are case-insensitive', () => {
  it('finds a stored "Peony/Pink" when queried as "peony/pink"', async () => {
    await seedVariety({ displayName: 'Peony Pink', typeName: 'Peony', colour: 'Pink', cultivar: 'Sarah Bernhardt' });

    const { list } = await import('../repos/stockRepo.js');
    const matches = await list({
      pg: { typeName: 'peony', colour: 'PINK', cultivar: 'sarah bernhardt', includeEmpty: true, includeInactive: true },
    });

    expect(matches).toHaveLength(1);
    expect(matches[0].Type).toBe('Peony');
  });

  it('still respects null-aware identity when filtering case-insensitively', async () => {
    await seedVariety({ displayName: 'Peony', typeName: 'Peony', colour: null });
    await seedVariety({ displayName: 'Peony Pink', typeName: 'Peony', colour: 'Pink' });

    const { list } = await import('../repos/stockRepo.js');
    const blank = await list({ pg: { typeName: 'PEONY', colour: null, includeEmpty: true, includeInactive: true } });

    expect(blank).toHaveLength(1);
    expect(blank[0]['Display Name']).toBe('Peony');
  });
});

// Guard against a silent regression in the row-count helper itself.
describe('harness sanity', () => {
  it('counts only non-deleted rows', async () => {
    const a = await seedVariety({ displayName: 'Sanity A', typeName: 'Sanity A' });
    const before = await countRows();
    await harness.db.update(stock).set({ deletedAt: new Date() }).where(eq(stock.id, a.id));
    expect(await countRows()).toBe(before - 1);
    const alive = await harness.db.select().from(stock).where(and(isNull(stock.deletedAt)));
    expect(alive.every(r => r.deletedAt === null)).toBe(true);
  });
});
