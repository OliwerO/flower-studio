// Integration test for PO PATCH diff-detection: notify assigned driver only on
// a genuine assignment change. Follow-up to PR #369 (driver notifications) —
// the PATCH path previously re-pinged on every save with a non-empty driver.
//
// What we're proving:
//   • notifyPoAssigned fires when Assigned Driver changes '' → 'Nikita'
//   • notifyPoAssigned does NOT fire when re-saving the SAME driver
//   • notifyPoAssigned fires again when the driver actually changes Nikita → Timur

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the notify seam BEFORE importing the router so the route's top-level
// import resolves to the mock.
vi.mock('../services/driverNotifyService.js', () => ({
  notifyDeliveryAssigned: vi.fn().mockResolvedValue(undefined),
  notifyDeliveryDigest:   vi.fn().mockResolvedValue(undefined),
  notifyPoAssigned:       vi.fn().mockResolvedValue(undefined),
}));

// SSE broadcast — no-op (not under test).
vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));

// orderService is imported by stockOrders.js — stub it out.
vi.mock('../services/orderService.js', () => ({
  createOrder: vi.fn(),
  autoMatchStock: vi.fn(),
}));

// configService (loaded by the route) — avoid the production config path.
vi.mock('../services/configService.js', () => ({
  getConfig:      vi.fn((k) => ({}[k] ?? 0)),
  getDriverOfDay: () => 'Timur',
}));

import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import express from 'express';
import supertest from 'supertest';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

// Import AFTER mocks are in place.
import { notifyPoAssigned } from '../services/driverNotifyService.js';
import * as stockOrderRepo from '../repos/stockOrderRepo.js';
import stockOrdersRouter from '../routes/stockOrders.js';

const OWNER_PIN = 'test-owner-pin-po';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.role = req.headers['x-auth-pin'] === OWNER_PIN ? 'owner' : 'owner';
    next();
  });
  app.use('/api/stock-orders', stockOrdersRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

let harness, app, poId;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
  app = buildApp();

  const po = await stockOrderRepo.create({
    Status: 'Draft',
    'Assigned Driver': '',
    'Planned Date': '2026-06-03',
  });
  poId = po['Stock Order ID'] || po.id;
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('PO assignment → driver notification diff-detection', () => {
  it('notifies when Assigned Driver changes empty → Nikita', async () => {
    const res = await supertest(app)
      .patch(`/api/stock-orders/${poId}`)
      .set('x-auth-pin', OWNER_PIN)
      .send({ 'Assigned Driver': 'Nikita' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(notifyPoAssigned).toHaveBeenCalledTimes(1);
    expect(notifyPoAssigned.mock.calls[0][0]).toMatchObject({ driverName: 'Nikita' });
  });

  it('does NOT notify when re-saving the SAME driver', async () => {
    await supertest(app).patch(`/api/stock-orders/${poId}`)
      .set('x-auth-pin', OWNER_PIN).send({ 'Assigned Driver': 'Nikita' });

    vi.clearAllMocks();

    const res = await supertest(app).patch(`/api/stock-orders/${poId}`)
      .set('x-auth-pin', OWNER_PIN).send({ 'Assigned Driver': 'Nikita' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(notifyPoAssigned).not.toHaveBeenCalled();
  });

  it('notifies again when the driver actually changes Nikita → Timur', async () => {
    await supertest(app).patch(`/api/stock-orders/${poId}`)
      .set('x-auth-pin', OWNER_PIN).send({ 'Assigned Driver': 'Nikita' });

    vi.clearAllMocks();

    const res = await supertest(app).patch(`/api/stock-orders/${poId}`)
      .set('x-auth-pin', OWNER_PIN).send({ 'Assigned Driver': 'Timur' });

    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));

    expect(notifyPoAssigned).toHaveBeenCalledTimes(1);
    expect(notifyPoAssigned.mock.calls[0][0]).toMatchObject({ driverName: 'Timur' });
  });
});
