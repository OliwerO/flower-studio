// Integration test for PUT /api/settings/driver-language
// Task 6 of docs/superpowers/plans/2026-06-01-driver-assignment-telegram-notifications.md
//
// What we're proving:
//   • Owner can set a driver's notification language → 200 + repo row updated
//   • Unsupported language → 400
//   • Non-owner (florist PIN) → 403

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock configService to avoid loading production config on boot
vi.mock('../services/configService.js', () => ({
  getStockYModelEnabled:     () => false,
  getStockXModelEnabled:     () => false,
  getConfig:                 vi.fn((k) => ({ defaultDeliveryFee: 25 }[k] ?? 0)),
  updateConfig:              vi.fn(),
  updateConfigBulk:          vi.fn(),
  getAllConfig:               vi.fn(() => ({})),
  generateOrderId:           async () => 'TEST-1',
  getDriverOfDay:            () => null,
  getDailyState:             () => ({ driverOfDay: null }),
  setDailyDriver:            vi.fn(),
  isPastCutoff:              vi.fn(),
  getActiveSeasonalCategory: vi.fn(),
  loadConfig:                vi.fn(),
  saveConfig:                vi.fn(),
  driverNames:               [],
  autoClearIfNewDay:         vi.fn(),
}));

// Mock driverNotifyService digest (not under test in this file)
vi.mock('../services/driverNotifyService.js', () => ({
  notifyDeliveryDigest: vi.fn().mockResolvedValue(undefined),
  SUPPORTED_LANGS:      ['ru', 'en', 'pl'],
}));

// Mock driverState
vi.mock('../services/driverState.js', () => ({
  getBackupDriverName: vi.fn(() => null),
  setBackupDriverName: vi.fn(),
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

// Import repo and router AFTER mocks are wired
import * as driverTelegramRepo from '../repos/driverTelegramRepo.js';
import settingsRouter from '../routes/settings.js';

// Auth PINs — owner has 'admin' access; florist does not
const OWNER_PIN   = 'test-owner-settings-pin';
const FLORIST_PIN = 'test-florist-settings-pin';

function buildApp() {
  const app = express();
  app.use(express.json());
  // Auth shim: inject role from header — mirrors deliveries.assign-notify pattern
  app.use((req, _res, next) => {
    const pin = req.headers['x-auth-pin'];
    if (pin === OWNER_PIN) {
      req.role = 'owner';
    } else if (pin === FLORIST_PIN) {
      req.role = 'florist';
    } else {
      req.role = 'owner'; // default
    }
    next();
  });
  app.use('/api/settings', settingsRouter);
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

describe('PUT /api/settings/driver-language', () => {
  it('sets a driver language (owner) → 200 + repo row persisted', async () => {
    const res = await supertest(app)
      .put('/api/settings/driver-language')
      .set('x-auth-pin', OWNER_PIN)
      .send({ driverName: 'Nikita', lang: 'en' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ driverName: 'Nikita', lang: 'en' });

    // Verify the repo row was actually written (real pglite path — no repo mock)
    const row = await driverTelegramRepo.getDriver('Nikita');
    expect(row).toMatchObject({ lang: 'en' });
  });

  it('rejects an unsupported language with 400', async () => {
    const res = await supertest(app)
      .put('/api/settings/driver-language')
      .set('x-auth-pin', OWNER_PIN)
      .send({ driverName: 'Nikita', lang: 'de' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lang must be one of/);
  });

  it('rejects a non-owner (florist PIN) with 403', async () => {
    const res = await supertest(app)
      .put('/api/settings/driver-language')
      .set('x-auth-pin', FLORIST_PIN)
      .send({ driverName: 'Nikita', lang: 'en' });

    expect(res.status).toBe(403);
  });
});
