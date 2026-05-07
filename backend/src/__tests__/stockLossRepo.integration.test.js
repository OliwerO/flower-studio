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

import * as stockLossRepo from '../repos/stockLossRepo.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('stockLossRepo', () => {
  it('creates and lists a loss entry without stock link', async () => {
    const entry = await stockLossRepo.create({
      date: '2026-05-01', stockId: null, quantity: 10, reason: 'Wilted', notes: '',
    });
    expect(entry.Quantity).toBe(10);
    expect(entry.Reason).toBe('Wilted');
    expect(entry.id).toBeTruthy();

    const list = await stockLossRepo.list({});
    expect(list).toHaveLength(1);
  });

  it('filters by date range', async () => {
    await stockLossRepo.create({ date: '2026-03-01', stockId: null, quantity: 5, reason: 'Damaged', notes: '' });
    await stockLossRepo.create({ date: '2026-05-01', stockId: null, quantity: 3, reason: 'Wilted', notes: '' });
    const filtered = await stockLossRepo.list({ from: '2026-04-01', to: '2026-06-01' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].Reason).toBe('Wilted');
  });

  it('updates a loss entry', async () => {
    const entry = await stockLossRepo.create({ date: '2026-05-01', stockId: null, quantity: 10, reason: 'Wilted', notes: '' });
    const updated = await stockLossRepo.update(entry.id, { quantity: 5, reason: 'Damaged' });
    expect(updated.Quantity).toBe(5);
    expect(updated.Reason).toBe('Damaged');
  });

  it('soft-deletes a loss entry', async () => {
    const entry = await stockLossRepo.create({ date: '2026-05-01', stockId: null, quantity: 10, reason: 'Wilted', notes: '' });
    await stockLossRepo.remove(entry.id);
    const list = await stockLossRepo.list({});
    expect(list).toHaveLength(0);
  });

  it('getById returns the raw row', async () => {
    const entry = await stockLossRepo.create({ date: '2026-05-01', stockId: null, quantity: 7, reason: 'Other', notes: 'test' });
    const raw = await stockLossRepo.getById(entry.id);
    expect(raw).not.toBeNull();
    expect(raw.quantity).toBeDefined(); // raw DB row, not wire format
  });
});
