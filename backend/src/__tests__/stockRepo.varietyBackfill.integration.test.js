// stockRepo variety-backfill integration tests — exercises the four new
// repo methods against pglite (real SQL, same migrations as Railway).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, auditLog } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));
import * as stockRepo from '../repos/stockRepo.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

// Seed helpers
async function seedRow(overrides = {}) {
  const base = {
    displayName: 'Test Rose', active: true, currentQuantity: 10,
    deadStems: 0, substituteFor: null, ...overrides,
  };
  const [row] = await harness.db.insert(stock).values(base).returning();
  return row;
}

describe('findByTypeNameNull', () => {
  it('returns rows where type_name IS NULL, sorted by display_name', async () => {
    await seedRow({ displayName: 'Zinnia', typeName: null });
    await seedRow({ displayName: 'Anemone', typeName: null });
    await seedRow({ displayName: 'Rose', typeName: 'Rose' }); // already backfilled — excluded
    const rows = await stockRepo.findByTypeNameNull();
    expect(rows).toHaveLength(2);
    expect(rows[0]['Display Name']).toBe('Anemone');
    expect(rows[1]['Display Name']).toBe('Zinnia');
  });

  it('excludes soft-deleted rows', async () => {
    await seedRow({ displayName: 'Deleted', typeName: null, deletedAt: new Date() });
    const rows = await stockRepo.findByTypeNameNull();
    expect(rows).toHaveLength(0);
  });

  it('includeBackfilled=true also returns rows where type_name IS NOT NULL', async () => {
    await seedRow({ displayName: 'A', typeName: null });
    await seedRow({ displayName: 'B', typeName: 'Peony' });
    const rows = await stockRepo.findByTypeNameNull({ includeBackfilled: true });
    expect(rows).toHaveLength(2);
  });
});

describe('distinctValues', () => {
  it('returns sorted distinct non-null values for a given column', async () => {
    await seedRow({ typeName: 'Rose' });
    await seedRow({ typeName: 'Peony' });
    await seedRow({ typeName: 'Rose' }); // duplicate — should appear once
    await seedRow({ typeName: null });   // null — excluded
    const values = await stockRepo.distinctValues('typeName');
    expect(values).toEqual(['Peony', 'Rose']);
  });

  it('throws 400 for disallowed column names (SQL injection guard)', async () => {
    await expect(stockRepo.distinctValues('; DROP TABLE stock;--')).rejects.toThrow();
  });
});
