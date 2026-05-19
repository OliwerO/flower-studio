// stockRepo.resolveBatchByFEFO — FEFO router unit tests against pglite.
//
// Closes #319: when multiple Batches share a Variety, the order line should
// drain the oldest non-negative Batch first. Without FEFO routing, the
// picker's arbitrary choice of representative Batch drove uneven decrement
// and led to drift (Hydrangea White: one row at -2, six others untouched).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

import { resolveBatchByFEFO } from '../repos/stockRepo.js';

let harness;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

// Helper: seed a Batch (positive qty) or DE (negative qty).
async function seedRow({ qty, date, typeName = 'Hydrangea', colour = 'White', sizeCm = null, cultivar = null }) {
  const [row] = await harness.db.insert(stock).values({
    displayName: `${typeName} ${colour ?? ''} (${date ?? 'undated'})`.trim(),
    currentQuantity: qty,
    active: true,
    typeName,
    colour,
    sizeCm,
    cultivar,
    date,
  }).returning();
  return row;
}

const HYDRANGEA_WHITE = { typeName: 'Hydrangea', colour: 'White', sizeCm: null, cultivar: null };

describe('resolveBatchByFEFO', () => {
  it('returns the only Batch when one exists', async () => {
    const b = await seedRow({ qty: 5, date: '2026-05-16' });

    const result = await harness.db.transaction(async (tx) => {
      return resolveBatchByFEFO(HYDRANGEA_WHITE, 3, tx);
    });

    expect(result).toBe(b.id);
  });

  it('returns null when no Batches exist for the Variety', async () => {
    await seedRow({ qty: 5, date: '2026-05-16', typeName: 'Peony', colour: 'Pink' });

    const result = await harness.db.transaction(async (tx) => {
      return resolveBatchByFEFO(HYDRANGEA_WHITE, 3, tx);
    });

    expect(result).toBeNull();
  });

  it('prefers the older Batch when both fully cover the line quantity', async () => {
    const older = await seedRow({ qty: 10, date: '2026-05-16' });
    await seedRow({ qty: 10, date: '2026-05-18' });

    const result = await harness.db.transaction(async (tx) => {
      return resolveBatchByFEFO(HYDRANGEA_WHITE, 5, tx);
    });

    expect(result).toBe(older.id);
  });

  it('prefers the Batch that fully covers when older one is short', async () => {
    await seedRow({ qty: 2, date: '2026-05-16' });
    const newer = await seedRow({ qty: 10, date: '2026-05-18' });

    const result = await harness.db.transaction(async (tx) => {
      return resolveBatchByFEFO(HYDRANGEA_WHITE, 5, tx);
    });

    expect(result).toBe(newer.id);
  });

  it('falls back to oldest Batch when none can fully cover (will go negative)', async () => {
    const oldest = await seedRow({ qty: 1, date: '2026-05-16' });
    await seedRow({ qty: 2, date: '2026-05-18' });

    const result = await harness.db.transaction(async (tx) => {
      return resolveBatchByFEFO(HYDRANGEA_WHITE, 5, tx);
    });

    expect(result).toBe(oldest.id);
  });

  it('skips Demand Entries (negative quantity)', async () => {
    await seedRow({ qty: -3, date: '2026-05-16' }); // DE
    const batch = await seedRow({ qty: 5, date: '2026-05-18' });

    const result = await harness.db.transaction(async (tx) => {
      return resolveBatchByFEFO(HYDRANGEA_WHITE, 2, tx);
    });

    expect(result).toBe(batch.id);
  });

  it('returns null when only DEs exist for the Variety', async () => {
    await seedRow({ qty: -3, date: '2026-05-16' });

    const result = await harness.db.transaction(async (tx) => {
      return resolveBatchByFEFO(HYDRANGEA_WHITE, 2, tx);
    });

    expect(result).toBeNull();
  });

  it('matches Variety with NULL-aware equality (empty colour ≠ "Green")', async () => {
    await seedRow({ qty: 5, date: '2026-05-16', typeName: 'Eucalyptus', colour: 'Green' });
    const nullColour = await seedRow({ qty: 7, date: '2026-05-18', typeName: 'Eucalyptus', colour: null });

    const result = await harness.db.transaction(async (tx) => {
      return resolveBatchByFEFO(
        { typeName: 'Eucalyptus', colour: null, sizeCm: null, cultivar: null },
        3, tx,
      );
    });

    expect(result).toBe(nullColour.id);
  });

  it('orders NULL date last (legacy rows deprioritised)', async () => {
    await seedRow({ qty: 10, date: null });            // legacy, no Y-model date
    const dated = await seedRow({ qty: 10, date: '2026-05-18' });

    const result = await harness.db.transaction(async (tx) => {
      return resolveBatchByFEFO(HYDRANGEA_WHITE, 5, tx);
    });

    expect(result).toBe(dated.id);
  });

  it('skips soft-deleted Batches', async () => {
    const deleted = await seedRow({ qty: 10, date: '2026-05-16' });
    await harness.db.update(stock).set({ deletedAt: new Date() }).where(
      // eslint-disable-next-line no-restricted-syntax
      (await import('drizzle-orm')).eq(stock.id, deleted.id),
    );
    const live = await seedRow({ qty: 5, date: '2026-05-18' });

    const result = await harness.db.transaction(async (tx) => {
      return resolveBatchByFEFO(HYDRANGEA_WHITE, 3, tx);
    });

    expect(result).toBe(live.id);
  });

  it('reproduces #319 shape — 3 Batches, picks oldest with cover', async () => {
    // Mirrors prod Hydrangea White: old batch already short, mid full, new full.
    const oldDrained = await seedRow({ qty: -2, date: '2026-05-12' }); // already negative
    const mid = await seedRow({ qty: 5, date: '2026-05-16' });
    await seedRow({ qty: 2, date: '2026-05-18' });

    const result = await harness.db.transaction(async (tx) => {
      return resolveBatchByFEFO(HYDRANGEA_WHITE, 3, tx);
    });

    // oldDrained is a DE-like negative row → skipped.
    // mid (5/16, qty=5) fully covers 3 → picked.
    expect(result).toBe(mid.id);
  });
});
