// Route-level tests for the four Variety backfill endpoints.
// Uses supertest against the Express app wired to a pglite db.
// Validates: auth gating (403 for Florist), input validation (400),
// happy-path 200 responses, and bulk transaction shape.
//
// Auth pattern: inject req.role directly (same pattern as products.image.test.js)
// to avoid the PIN env-var bootstrap race in auth.js.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock } from '../db/schema.js';
import { authorize } from '../middleware/auth.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import stockRouter from '../routes/stock.js';

// Build app with a role injector middleware instead of PIN auth.
// Role is passed via x-test-role header so tests can switch roles per request.
function buildApp() {
  const app = express();
  app.use(express.json());
  // Role injector replaces authenticate() for test isolation
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

async function seedStock(overrides = {}) {
  const [row] = await harness.db.insert(stock).values({
    displayName: 'Test Rose', active: true, currentQuantity: 10,
    deadStems: 0, typeName: null, ...overrides,
  }).returning();
  return row;
}

describe('GET /stock/needs-backfill', () => {
  it('returns 403 for Florist', async () => {
    const res = await supertest(app).get('/stock/needs-backfill').set('x-test-role', 'florist');
    expect(res.status).toBe(403);
  });

  it('returns rows with type_name IS NULL sorted by display_name', async () => {
    await seedStock({ displayName: 'Zinnia' });
    await seedStock({ displayName: 'Anemone' });
    await seedStock({ displayName: 'Rose (backfilled)', typeName: 'Rose' });
    const res = await supertest(app).get('/stock/needs-backfill').set('x-test-role', 'owner');
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows[0]['Display Name']).toBe('Anemone');
    expect(res.body.total).toBe(3);
    expect(res.body.remaining).toBe(2);
  });

  it('includes backfilled rows when ?includeBackfilled=true', async () => {
    await seedStock({ typeName: null });
    await seedStock({ typeName: 'Rose' });
    const res = await supertest(app)
      .get('/stock/needs-backfill?includeBackfilled=true')
      .set('x-test-role', 'owner');
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(2);
  });
});

describe('GET /stock/distinct/:column', () => {
  it('allows Florist (read-only; feeds the PO evaluation substitute Type/Colour picker)', async () => {
    const res = await supertest(app).get('/stock/distinct/typeName').set('x-test-role', 'florist');
    expect(res.status).toBe(200);
  });

  it('returns 400 for disallowed column', async () => {
    const res = await supertest(app).get('/stock/distinct/displayName').set('x-test-role', 'owner');
    expect(res.status).toBe(400);
  });

  it('returns sorted distinct values for typeName', async () => {
    await seedStock({ typeName: 'Rose' });
    await seedStock({ typeName: 'Peony' });
    await seedStock({ typeName: 'Rose' });
    const res = await supertest(app).get('/stock/distinct/typeName').set('x-test-role', 'owner');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['Peony', 'Rose']);
  });
});

describe('PATCH /stock/:id/variety-attrs', () => {
  it('returns 403 for Florist', async () => {
    const row = await seedStock();
    const res = await supertest(app)
      .patch(`/stock/${row.id}/variety-attrs`)
      .set('x-test-role', 'florist')
      .send({ typeName: 'Rose' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when typeName is absent or empty', async () => {
    const row = await seedStock();
    const res = await supertest(app)
      .patch(`/stock/${row.id}/variety-attrs`)
      .set('x-test-role', 'owner')
      .send({ typeName: '' });
    expect(res.status).toBe(400);
  });

  it('saves variety attrs and returns updated row', async () => {
    const row = await seedStock();
    const res = await supertest(app)
      .patch(`/stock/${row.id}/variety-attrs`)
      .set('x-test-role', 'owner')
      .send({ typeName: 'Peony', colour: 'Pink', sizeCm: 60, cultivar: 'Coral Charm' });
    expect(res.status).toBe(200);
    expect(res.body['Type']).toBe('Peony');
    expect(res.body['Colour']).toBe('Pink');
    expect(res.body['Size']).toBe(60);
    expect(res.body['Cultivar']).toBe('Coral Charm');
  });
});

describe('PATCH /stock/variety-attrs/bulk', () => {
  it('returns 403 for Florist', async () => {
    const res = await supertest(app)
      .patch('/stock/variety-attrs/bulk')
      .set('x-test-role', 'florist')
      .send({ ids: [], attrs: { typeName: 'Rose' } });
    expect(res.status).toBe(403);
  });

  it('returns 400 when ids is empty array', async () => {
    const res = await supertest(app)
      .patch('/stock/variety-attrs/bulk')
      .set('x-test-role', 'owner')
      .send({ ids: [], attrs: { typeName: 'Rose' } });
    expect(res.status).toBe(400);
  });

  it('applies attrs to all selected rows', async () => {
    const r1 = await seedStock({ displayName: 'A' });
    const r2 = await seedStock({ displayName: 'B' });
    const res = await supertest(app)
      .patch('/stock/variety-attrs/bulk')
      .set('x-test-role', 'owner')
      .send({ ids: [r1.id, r2.id], attrs: { typeName: 'Tulip', colour: 'Yellow' } });
    expect(res.status).toBe(200);
    expect(res.body.updated).toHaveLength(2);
    expect(res.body.updated.every(r => r['Type'] === 'Tulip')).toBe(true);
  });
});
