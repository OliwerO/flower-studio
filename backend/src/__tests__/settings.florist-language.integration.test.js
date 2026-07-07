// Integration test for PUT /api/settings/florist-language
// Task 6 of docs/superpowers/plans/2026-06-02-florist-new-order-telegram.md
//
// What we're proving:
//   • Owner can set the florist group notification language → 200 + body { lang }
//   • Unsupported language → 400
//   • Non-owner (florist PIN) → 403

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock configService to avoid loading production config on boot
vi.mock('../services/configService.js', () => ({
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

// Mock driverNotifyService (not under test in this file)
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
import * as floristTelegramRepo from '../repos/floristTelegramRepo.js';
import settingsRouter from '../routes/settings.js';

// Auth PINs — owner has 'admin' access; florist does not
const OWNER_PIN   = 'test-owner-settings-pin';
const FLORIST_PIN = 'test-florist-settings-pin';

function buildApp() {
  const app = express();
  app.use(express.json());
  // Auth shim: inject role from header — mirrors driver-language test pattern
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

describe('PUT /api/settings/florist-language', () => {
  it('owner sets florist language → 200 + repo row persisted', async () => {
    const res = await supertest(app)
      .put('/api/settings/florist-language')
      .set('x-auth-pin', OWNER_PIN)
      .send({ lang: 'en' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lang: 'en' });

    // Verify the repo row was actually written (real pglite path — no repo mock)
    const storedLang = await floristTelegramRepo.getFloristLang();
    expect(storedLang).toBe('en');
  });

  it('rejects an invalid lang with 400', async () => {
    const res = await supertest(app)
      .put('/api/settings/florist-language')
      .set('x-auth-pin', OWNER_PIN)
      .send({ lang: 'xx' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lang must be one of/);
  });

  it('rejects a non-owner (florist PIN) with 403', async () => {
    const res = await supertest(app)
      .put('/api/settings/florist-language')
      .set('x-auth-pin', FLORIST_PIN)
      .send({ lang: 'en' });

    expect(res.status).toBe(403);
  });
});
