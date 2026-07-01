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

import * as repo from '../repos/savedViewRepo.js';
import { savedViews } from '../db/schema.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

const sampleSpec = {
  entity: 'orders',
  filters: [{ field: 'status', op: 'eq', value: 'New' }],
  joins: [],
};

describe('savedViewRepo', () => {
  it('create then list round-trip, spec survives verbatim', async () => {
    const created = await repo.create({ name: 'Open orders', spec: sampleSpec });
    expect(created.id).toBeTruthy();
    expect(created.name).toBe('Open orders');
    expect(created.spec).toEqual(sampleSpec);

    const rows = await repo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(created.id);
    expect(rows[0].spec).toEqual(sampleSpec);
  });

  it('list is newest-first (by created_at desc)', async () => {
    // Seed explicit, distinct created_at so the ORDER BY is exercised
    // deterministically — two same-tick repo.create() calls can tie on
    // created_at under pglite's now() granularity (real inserts differ).
    const [older] = await harness.db.insert(savedViews)
      .values({ name: 'Older', spec: sampleSpec, createdAt: new Date('2026-06-01T00:00:00Z') })
      .returning();
    const [newer] = await harness.db.insert(savedViews)
      .values({ name: 'Newer', spec: sampleSpec, createdAt: new Date('2026-06-02T00:00:00Z') })
      .returning();

    const rows = await repo.list();
    expect(rows.map(r => r.id)).toEqual([newer.id, older.id]);
  });

  it('rename changes name and is reflected in list', async () => {
    const created = await repo.create({ name: 'Original', spec: sampleSpec });
    const renamed = await repo.rename(created.id, 'Renamed');
    expect(renamed.name).toBe('Renamed');

    const rows = await repo.list();
    expect(rows.find(r => r.id === created.id).name).toBe('Renamed');
  });

  it('rename returns null for missing id', async () => {
    expect(await repo.rename('00000000-0000-0000-0000-000000000000', 'x')).toBeNull();
  });

  it('remove soft-deletes: drops out of list() but the row still exists', async () => {
    const created = await repo.create({ name: 'To remove', spec: sampleSpec });
    expect(await repo.remove(created.id)).toBe(true);

    const rows = await repo.list();
    expect(rows.find(r => r.id === created.id)).toBeUndefined();

    // Row still exists underneath — a second remove is a no-op (already gone).
    expect(await repo.remove(created.id)).toBe(false);

    // Renaming a soft-deleted view is also a no-op.
    expect(await repo.rename(created.id, 'nope')).toBeNull();
  });

  it('remove returns false for missing id', async () => {
    expect(await repo.remove('00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});
