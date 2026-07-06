// Integration tests for GET /stock/pending-po auto-create — C3 (ultracode audit).
//
// What we're proving:
//   - When a pending PO has an unlinked Y-model line (Type/Colour/Size/Cultivar
//     set, no Stock Item link), the auto-created stock card carries those
//     Variety attrs. Without them the card has type_name = NULL and is invisible
//     in listGroupedByVariety — the incoming flowers "disappear" from the
//     grouped Stock view (same failure class as #327 / #323).
//   - A legacy line (Flower Name only, no Variety attrs) still auto-creates an
//     attr-less card — no regression to the pre-Y-model flow.
//
// Auth pattern + db/configService mocks mirror stock.groupedRoute.test.js.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, stockOrders, stockOrderLines } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

let yModelEnabled = true;
vi.mock('../services/configService.js', () => ({
  getStockYModelEnabled: () => yModelEnabled,
  getConfig: () => undefined,
  getActiveSeasonalCategory: () => null,
  generateOrderId: async () => 'TEST-001',
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
  yModelEnabled = true;
  app = buildApp();
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

async function seedPendingPo() {
  const [po] = await harness.db.insert(stockOrders).values({
    poNumber: 'PO-20260622-1', status: 'Sent', createdDate: '2026-06-22',
  }).returning();
  return po;
}

describe('GET /stock/pending-po auto-create — Variety attrs (C3)', () => {
  it('carries Type/Colour/Size/Cultivar from a Y-model PO line onto the auto-created card', async () => {
    const po = await seedPendingPo();
    await harness.db.insert(stockOrderLines).values({
      poId: po.id,
      flowerName: 'Peony Pink 60cm Sarah',
      quantityNeeded: 30,
      costPrice: '8', sellPrice: '24',
      typeName: 'Peony', colour: 'Pink', sizeCm: 60, cultivar: 'Sarah',
    });

    const res = await supertest(app).get('/stock/pending-po');
    expect(res.status).toBe(200);

    const created = await harness.db.select().from(stock)
      .where(eq(stock.displayName, 'Peony Pink 60cm Sarah')).then(r => r[0]);
    expect(created).toBeTruthy();
    expect(created.typeName).toBe('Peony');
    expect(created.colour).toBe('Pink');
    expect(created.sizeCm).toBe(60);
    expect(created.cultivar).toBe('Sarah');
  });

  it('defaults type_name to the flower name for a legacy (name-only) line (Y-model NOT NULL safety net)', async () => {
    const po = await seedPendingPo();
    await harness.db.insert(stockOrderLines).values({
      poId: po.id,
      flowerName: 'Mystery Bloom',
      quantityNeeded: 10,
      costPrice: '5', sellPrice: '15',
      // no Variety attrs
    });

    const res = await supertest(app).get('/stock/pending-po');
    expect(res.status).toBe(200);

    const created = await harness.db.select().from(stock)
      .where(eq(stock.displayName, 'Mystery Bloom')).then(r => r[0]);
    expect(created).toBeTruthy();
    // NOT NULL on prod → default from the base name instead of 500; colour null.
    expect(created.typeName).toBe('Mystery Bloom');
    expect(created.colour).toBe(null);
  });
});
