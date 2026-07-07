// Route tests for GET /stock/premade-committed — Task T2, issue #288 follow-up.
//
// Validates the Y-model branch populates bouquets[]:
//   { stockId: { qty: N, bouquets: [{ bouquetId, name, qty }] } }
//
// Coverage:
//   • Stock used by 2 premades → bouquets[] has both entries with correct
//     bouquetId, name, and per-bouquet qty.
//   • Stock item not used by any premade is omitted from response.
//   • Field names match the expected shape (bouquetId, name, qty).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import {
  stock,
  premadeBouquets,
  premadeBouquetLines,
} from '../db/schema.js';

// ── db module mock — injected via dbHolder ──
const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db()              { return dbHolder.db; },
  isPostgresConfigured: true,
  pool:                 null,
  connectPostgres:      async () => {},
  disconnectPostgres:   async () => {},
}));

// ── audit mock — no-op ──
vi.mock('../db/audit.js', () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../services/configService.js', () => ({
  getConfig:                () => undefined,
  getActiveSeasonalCategory: () => null,
  generateOrderId:          async () => 'TEST-001',
}));

// ── Notification / SSE mocks ──
vi.mock('../services/notifications.js', () => ({ broadcastEvent: vi.fn() }));
vi.mock('../services/telegram.js', () => ({ sendTelegramMessage: vi.fn().mockResolvedValue(undefined) }));

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

// ── Seed helpers ──

async function seedStock(overrides = {}) {
  const [row] = await harness.db.insert(stock).values({
    displayName:     overrides.displayName     ?? 'Rose Red',
    currentQuantity: overrides.currentQuantity ?? 20,
    active:          overrides.active          ?? true,
    typeName:        overrides.typeName        ?? 'Rose',
  }).returning();
  return row;
}

async function seedPremade(name = 'Spring Bouquet') {
  const [row] = await harness.db.insert(premadeBouquets).values({
    name,
    createdBy: 'florist',
    notes: '',
  }).returning();
  return row;
}

async function seedPremadeLine(bouquetId, stockId, quantity = 5) {
  const [row] = await harness.db.insert(premadeBouquetLines).values({
    bouquetId,
    stockId,
    flowerName:       'Rose Red',
    quantity,
    costPricePerUnit: '1.00',
    sellPricePerUnit: '3.00',
  }).returning();
  return row;
}

describe('GET /stock/premade-committed — Y-model', () => {
  it('stock used by 2 premades returns bouquets[] with both entries', async () => {
    const rose = await seedStock({ displayName: 'Rose Red' });
    const bq1  = await seedPremade('Morning Bunch');
    const bq2  = await seedPremade('Evening Bunch');
    await seedPremadeLine(bq1.id, rose.id, 3);
    await seedPremadeLine(bq2.id, rose.id, 7);

    const res = await supertest(app)
      .get('/stock/premade-committed')
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    const entry = res.body[rose.id];
    expect(entry).toBeDefined();
    expect(entry.qty).toBe(10);
    expect(Array.isArray(entry.bouquets)).toBe(true);
    expect(entry.bouquets).toHaveLength(2);

    // Both bouquet entries must have correct shape and values
    const b1 = entry.bouquets.find(b => b.bouquetId === bq1.id);
    const b2 = entry.bouquets.find(b => b.bouquetId === bq2.id);

    expect(b1).toBeDefined();
    expect(b1.name).toBe('Morning Bunch');
    expect(b1.qty).toBe(3);

    expect(b2).toBeDefined();
    expect(b2.name).toBe('Evening Bunch');
    expect(b2.qty).toBe(7);
  });

  it('stock item not used by any premade is omitted from the response', async () => {
    const rose     = await seedStock({ displayName: 'Rose Red' });
    const peony    = await seedStock({ displayName: 'Peony White', typeName: 'Peony' });
    const bq       = await seedPremade('Morning Bunch');
    await seedPremadeLine(bq.id, rose.id, 5);
    // peony has no premade lines

    const res = await supertest(app)
      .get('/stock/premade-committed')
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    expect(res.body[rose.id]).toBeDefined();
    expect(res.body[peony.id]).toBeUndefined();
  });

  it('bouquets[] entries have exact field names: bouquetId, name, qty (matches legacy shape)', async () => {
    const rose = await seedStock({ displayName: 'Rose Red' });
    const bq   = await seedPremade('Fancy Bunch');
    await seedPremadeLine(bq.id, rose.id, 4);

    const res = await supertest(app)
      .get('/stock/premade-committed')
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    const [bouquet] = res.body[rose.id].bouquets;
    expect(bouquet).toHaveProperty('bouquetId');
    expect(bouquet).toHaveProperty('name');
    expect(bouquet).toHaveProperty('qty');
    // No extra/unexpected fields (strict shape check)
    expect(Object.keys(bouquet).sort()).toEqual(['bouquetId', 'name', 'qty'].sort());
  });

  it('returns empty object when no premade lines exist at all', async () => {
    await seedStock({ displayName: 'Orphan Stock' });

    const res = await supertest(app)
      .get('/stock/premade-committed')
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});

