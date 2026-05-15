// PATCH /products/:id — Available Today auto-zeroes Lead Time Days.
//
// Invariant: a variant tagged "Available Today" must have Lead Time Days = 0.
// The storefront same-day shelf gates on BOTH (tag + LT=0). Without this
// coupling, the owner had to remember to also edit LT after toggling the
// category chip in the florist app. One-direction only — removing the tag
// leaves LT alone, since LT still drives non-same-day earliest-delivery.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db()            { return dbHolder.db; },
  isPostgresConfigured: true,
  pool:               null,
  connectPostgres:    async () => {},
  disconnectPostgres: async () => {},
}));

vi.mock('../db/audit.js', () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));

import productsRouter from '../routes/products.js';
import * as productConfigRepo from '../repos/productConfigRepo.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.role = req.headers['x-test-role'] || 'owner';
    next();
  });
  app.use('/products', productsRouter);
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
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

async function seed(overrides = {}) {
  return productConfigRepo.create({
    wixProductId: 'prod-1',
    wixVariantId: 'var-1',
    productName: 'Red Rose',
    variantName: '5 stems',
    price: 49,
    active: true,
    leadTimeDays: 2,
    ...overrides,
  });
}

describe('PATCH /products/:id — Available Today invariant', () => {
  it('forces Lead Time Days = 0 when Category update includes "Available Today"', async () => {
    const row = await seed({ leadTimeDays: 2 });
    const res = await supertest(app)
      .patch(`/products/${row.id}`)
      .send({ Category: ['Available Today', 'Roses'] });
    expect(res.status).toBe(200);
    expect(Number(res.body['Lead Time Days'])).toBe(0);
    // Category is stored comma-joined by the repo; assert string membership.
    const cats = String(res.body.Category || '');
    expect(cats).toContain('Available Today');
  });

  it('leaves Lead Time Days alone when Category does NOT include "Available Today"', async () => {
    const row = await seed({ leadTimeDays: 3 });
    const res = await supertest(app)
      .patch(`/products/${row.id}`)
      .send({ Category: ['Roses', 'Premium'] });
    expect(res.status).toBe(200);
    expect(Number(res.body['Lead Time Days'])).toBe(3);
  });

  it('does NOT touch Lead Time Days when the request omits Category', async () => {
    const row = await seed({ leadTimeDays: 4 });
    const res = await supertest(app)
      .patch(`/products/${row.id}`)
      .send({ Price: 55 });
    expect(res.status).toBe(200);
    expect(Number(res.body['Lead Time Days'])).toBe(4);
    expect(Number(res.body.Price)).toBe(55);
  });

  it('overrides an explicitly-sent non-zero Lead Time Days when category includes "Available Today"', async () => {
    const row = await seed({ leadTimeDays: 1 });
    const res = await supertest(app)
      .patch(`/products/${row.id}`)
      .send({ Category: ['Available Today'], 'Lead Time Days': 5 });
    expect(res.status).toBe(200);
    expect(Number(res.body['Lead Time Days'])).toBe(0);
  });
});
