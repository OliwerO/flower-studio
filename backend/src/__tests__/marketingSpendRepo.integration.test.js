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

import * as repo from '../repos/marketingSpendRepo.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('marketingSpendRepo', () => {
  it('creates and lists spend entries', async () => {
    await repo.create({ month: '2026-03-01', channel: 'Instagram', amount: 500, notes: '' });
    await repo.create({ month: '2026-04-01', channel: 'Google', amount: 300, notes: '' });
    const all = await repo.list({});
    expect(all).toHaveLength(2);
  });

  it('filters by date range', async () => {
    await repo.create({ month: '2026-02-01', channel: 'Instagram', amount: 200, notes: '' });
    await repo.create({ month: '2026-04-01', channel: 'Google', amount: 400, notes: '' });
    const filtered = await repo.list({ from: '2026-03', to: '2026-05' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].Channel).toBe('Google');
  });
});
