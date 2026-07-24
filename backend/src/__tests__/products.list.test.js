// GET /products — issue #267: exclude phantom bouquets that were never
// synced to Wix (no Wix Product ID) from the dashboard/florist listing.
//
// Root cause: product_config rows created directly in Postgres (never
// pushed to or pulled from Wix) have wix_product_id = NULL. The shared
// groupByProduct helper (packages/shared/utils/productGroup.js) keys such
// rows on their PG UUID, so they rendered as extra "ghost" bouquets in the
// dashboard ProductsTab and florist BouquetsPage even though they don't
// exist in the real Wix catalog. Prod verification (2026-06-19): 19 such
// rows, ALL Active=false, created on migration day.
//
// Both apps hit this exact same endpoint (BouquetsPage.jsx calls
// client.get('/products'), same as ProductsTab.jsx), so the route-level
// fix covers both without any frontend change.

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

describe('GET /products — phantom (unsynced) bouquet exclusion (#267)', () => {
  it('excludes rows with no Wix Product ID', async () => {
    await seed({ productName: 'Synced Rose' });
    await seed({
      wixProductId: null, wixVariantId: null,
      productName: 'Phantom Rose', active: false,
    });

    const res = await supertest(app).get('/products');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]['Product Name']).toBe('Synced Rose');
  });

  it('still returns wix-linked rows regardless of Active state', async () => {
    await seed({ productName: 'Active Rose', active: true });
    await seed({
      wixProductId: 'prod-2', wixVariantId: 'var-2',
      productName: 'Inactive Rose', active: false,
    });

    const res = await supertest(app).get('/products');
    expect(res.status).toBe(200);
    const names = res.body.map(r => r['Product Name']).sort();
    expect(names).toEqual(['Active Rose', 'Inactive Rose']);
  });

  it('returns an empty list (not an error) when every row is unsynced', async () => {
    await seed({
      wixProductId: null, wixVariantId: null,
      productName: 'Phantom Rose', active: false,
    });

    const res = await supertest(app).get('/products');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
