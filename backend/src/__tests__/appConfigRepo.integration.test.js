import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import * as appConfigRepo from '../repos/appConfigRepo.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('appConfigRepo', () => {
  it('get returns null when key is missing', async () => {
    const val = await appConfigRepo.get('config');
    expect(val).toBeNull();
  });

  it('set and get round-trip', async () => {
    await appConfigRepo.set('config', { defaultDeliveryFee: 35 });
    const val = await appConfigRepo.get('config');
    expect(val).toEqual({ defaultDeliveryFee: 35 });
  });

  it('set is idempotent (upsert)', async () => {
    await appConfigRepo.set('config', { v: 1 });
    await appConfigRepo.set('config', { v: 2 });
    const val = await appConfigRepo.get('config');
    expect(val.v).toBe(2);
  });

  it('nextOrderId increments counter per month key', async () => {
    const first  = await appConfigRepo.nextOrderId('202605');
    const second = await appConfigRepo.nextOrderId('202605');
    expect(first).toBe('202605-001');
    expect(second).toBe('202605-002');
  });

  it('nextOrderId tracks different month keys independently', async () => {
    const may = await appConfigRepo.nextOrderId('202605');
    const jun = await appConfigRepo.nextOrderId('202606');
    expect(may).toBe('202605-001');
    expect(jun).toBe('202606-001');
  });
});
