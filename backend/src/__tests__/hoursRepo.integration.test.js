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

import * as hoursRepo from '../repos/hoursRepo.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('hoursRepo', () => {
  it('creates and retrieves a florist hours entry', async () => {
    const entry = await hoursRepo.create({
      Name: 'Anya', Date: '2026-05-01', Hours: 8,
      'Hourly Rate': 30, Bonus: 0, Deduction: 0, Notes: '', 'Delivery Count': 2,
    });
    expect(entry.Name).toBe('Anya');
    expect(entry.Hours).toBe(8);
    expect(entry.id).toBeTruthy();

    const list = await hoursRepo.list({ month: '2026-05' });
    expect(list).toHaveLength(1);
    expect(list[0].Name).toBe('Anya');
  });

  it('filters by name', async () => {
    await hoursRepo.create({ Name: 'Anya', Date: '2026-05-01', Hours: 6, 'Hourly Rate': 30, Bonus: 0, Deduction: 0, Notes: '', 'Delivery Count': 0 });
    await hoursRepo.create({ Name: 'Daria', Date: '2026-05-01', Hours: 7, 'Hourly Rate': 30, Bonus: 0, Deduction: 0, Notes: '', 'Delivery Count': 0 });
    const anya = await hoursRepo.list({ name: 'Anya' });
    expect(anya).toHaveLength(1);
    expect(anya[0].Name).toBe('Anya');
  });

  it('updates an entry', async () => {
    const entry = await hoursRepo.create({ Name: 'Anya', Date: '2026-05-01', Hours: 6, 'Hourly Rate': 30, Bonus: 0, Deduction: 0, Notes: '', 'Delivery Count': 0 });
    const updated = await hoursRepo.update(entry.id, { Hours: 8, Bonus: 50 });
    expect(updated.Hours).toBe(8);
    expect(updated.Bonus).toBe(50);
  });

  it('soft-deletes an entry', async () => {
    const entry = await hoursRepo.create({ Name: 'Anya', Date: '2026-05-01', Hours: 6, 'Hourly Rate': 30, Bonus: 0, Deduction: 0, Notes: '', 'Delivery Count': 0 });
    await hoursRepo.remove(entry.id);
    const list = await hoursRepo.list({});
    expect(list).toHaveLength(0);
  });
});
