// Route tests for GET /stock?grouped=true (Task 2, issue #289).
//
// What we're proving:
//   • no ?grouped → flat shape returned (back-compat)
//   • ?grouped=true → grouped { groups: [...] } shape returned
//
// Auth pattern: inject req.role via x-test-role header (same as
// stock.varietyBackfill.routes.test.js).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

vi.mock('../services/configService.js', () => ({
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
  app = buildApp();
  vi.clearAllMocks();
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

async function seedYModelStock(overrides = {}) {
  const [row] = await harness.db.insert(stock).values({
    displayName: overrides.displayName || 'Rose Red',
    currentQuantity: overrides.currentQuantity ?? 10,
    active: true,
    typeName: overrides.typeName || 'Rose',
    colour: overrides.colour ?? 'Red',
    sizeCm: overrides.sizeCm ?? null,
    cultivar: overrides.cultivar ?? null,
  }).returning();
  return row;
}

async function seedLegacyStock(overrides = {}) {
  const [row] = await harness.db.insert(stock).values({
    displayName: overrides.displayName || 'Legacy Flower',
    currentQuantity: overrides.currentQuantity ?? 5,
    active: true,
    typeName: null,
  }).returning();
  return row;
}

describe('GET /stock — grouped view', () => {
  it('returns flat array when ?grouped is absent (back-compat)', async () => {
    await seedLegacyStock({ currentQuantity: 4 });

    const res = await supertest(app).get('/stock');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns { groups: [...] } shape when ?grouped=true', async () => {
    await seedYModelStock({ displayName: 'Rose Red 50', typeName: 'Rose', colour: 'Red', currentQuantity: 8 });

    const res = await supertest(app).get('/stock?grouped=true');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('groups');
    expect(Array.isArray(res.body.groups)).toBe(true);
    expect(res.body.groups).toHaveLength(1);
  });

  it('grouped response includes correct group fields', async () => {
    await seedYModelStock({
      displayName: 'Tulip Yellow 40',
      typeName: 'Tulip',
      colour: 'Yellow',
      sizeCm: 40,
      currentQuantity: 12,
    });

    const res = await supertest(app).get('/stock?grouped=true');
    expect(res.status).toBe(200);
    const [group] = res.body.groups;
    expect(group.type_name).toBe('Tulip');
    expect(group.colour).toBe('Yellow');
    expect(group.size_cm).toBe(40);
    expect(group.cultivar).toBeNull();
    expect(typeof group.reservedForPremades).toBe('number');
    expect(Array.isArray(group.rows)).toBe(true);
    expect(group.rows).toHaveLength(1);
  });

  it('grouped response with multiple groups', async () => {
    await seedYModelStock({ displayName: 'Rose Red', typeName: 'Rose', colour: 'Red', currentQuantity: 5 });
    await seedYModelStock({ displayName: 'Tulip Yellow', typeName: 'Tulip', colour: 'Yellow', currentQuantity: 3 });

    const res = await supertest(app).get('/stock?grouped=true');
    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(2);
  });

  it('flat request still succeeds and includes legacy + Y-model rows', async () => {
    await seedLegacyStock({ displayName: 'Old Stem', currentQuantity: 7 });
    await seedYModelStock({ displayName: 'New Rose', currentQuantity: 4 });

    const res = await supertest(app).get('/stock');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Both rows appear in flat list (includeEmpty=false → qty > 0, both qualify)
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });
});
