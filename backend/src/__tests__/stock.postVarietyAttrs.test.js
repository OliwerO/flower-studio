// Route-level tests: POST /stock accepts 4-tuple Variety attributes.
// Covers issue #287/#288 follow-up — typeName, colour, sizeCm, cultivar
// are accepted on creation and persisted to type_name, colour, size_cm,
// cultivar columns (already added by migration 0012 / #284).
//
// Auth pattern: inject req.role via x-test-role header (same as
// stock.varietyBackfill.routes.test.js) to avoid PIN env-var bootstrap race.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
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

// Helper: read back the raw PG row by uuid
async function getStockRow(id) {
  const [row] = await harness.db.select().from(stock).where(eq(stock.id, id));
  return row ?? null;
}

describe('POST /stock — 4-tuple Variety attributes', () => {
  it('full 4-tuple: response includes Type/Colour/Size/Cultivar; PG row has correct columns', async () => {
    const res = await supertest(app)
      .post('/stock')
      .set('x-test-role', 'florist')
      .send({
        displayName: 'Rose Sarah Bernhardt 60cm',
        category: 'Flowers',
        quantity: 20,
        costPrice: 3.5,
        typeName: 'Rose',
        colour: 'Pink',
        sizeCm: 60,
        cultivar: 'Sarah Bernhardt',
      });

    expect(res.status).toBe(201);
    expect(res.body.Type).toBe('Rose');
    expect(res.body.Colour).toBe('Pink');
    expect(res.body.Size).toBe(60);
    expect(res.body.Cultivar).toBe('Sarah Bernhardt');

    const row = await getStockRow(res.body._pgId);
    expect(row.typeName).toBe('Rose');
    expect(row.colour).toBe('Pink');
    expect(row.sizeCm).toBe(60);
    expect(row.cultivar).toBe('Sarah Bernhardt');
  });

  it('partial 4-tuple (only typeName): other 3 columns are null in DB', async () => {
    const res = await supertest(app)
      .post('/stock')
      .set('x-test-role', 'florist')
      .send({
        displayName: 'Mystery Flower',
        quantity: 5,
        costPrice: 1,
        typeName: 'Dahlia',
      });

    expect(res.status).toBe(201);
    expect(res.body.Type).toBe('Dahlia');
    expect(res.body.Colour).toBeNull();
    expect(res.body.Size).toBeNull();
    expect(res.body.Cultivar).toBeNull();

    const row = await getStockRow(res.body._pgId);
    expect(row.typeName).toBe('Dahlia');
    expect(row.colour).toBeNull();
    expect(row.sizeCm).toBeNull();
    expect(row.cultivar).toBeNull();
  });

  it('legacy shape (no 4-tuple fields): still works; 4-tuple columns null in DB', async () => {
    const res = await supertest(app)
      .post('/stock')
      .set('x-test-role', 'florist')
      .send({
        displayName: 'Legacy Stem',
        category: 'Greenery',
        quantity: 10,
        costPrice: 0.5,
      });

    expect(res.status).toBe(201);
    expect(res.body.Type).toBeNull();
    expect(res.body.Colour).toBeNull();
    expect(res.body.Size).toBeNull();
    expect(res.body.Cultivar).toBeNull();

    const row = await getStockRow(res.body._pgId);
    expect(row.typeName).toBeNull();
    expect(row.colour).toBeNull();
    expect(row.sizeCm).toBeNull();
    expect(row.cultivar).toBeNull();
  });

  it('empty string for colour is coerced to null', async () => {
    const res = await supertest(app)
      .post('/stock')
      .set('x-test-role', 'florist')
      .send({
        displayName: 'Whiteless Rose',
        quantity: 8,
        costPrice: 2,
        typeName: 'Rose',
        colour: '',
        cultivar: '',
      });

    expect(res.status).toBe(201);
    expect(res.body.Colour).toBeNull();
    expect(res.body.Cultivar).toBeNull();

    const row = await getStockRow(res.body._pgId);
    expect(row.colour).toBeNull();
    expect(row.cultivar).toBeNull();
  });

  it('invalid sizeCm (non-numeric string) is coerced to null', async () => {
    const res = await supertest(app)
      .post('/stock')
      .set('x-test-role', 'florist')
      .send({
        displayName: 'Bad Size Tulip',
        quantity: 5,
        costPrice: 1,
        typeName: 'Tulip',
        sizeCm: 'abc',
      });

    // Non-numeric sizeCm should coerce to null rather than crash
    expect(res.status).toBe(201);
    expect(res.body.Size).toBeNull();

    const row = await getStockRow(res.body._pgId);
    expect(row.sizeCm).toBeNull();
  });
});
