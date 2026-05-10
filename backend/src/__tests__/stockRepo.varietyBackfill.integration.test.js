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

describe('updateVarietyAttrs', () => {
  it('sets type_name, colour, size_cm, cultivar and writes audit log', async () => {
    const row = await seedRow({ displayName: 'Peony A', typeName: null });
    const actor = { actorRole: 'owner', actorPinLabel: null };
    const result = await stockRepo.updateVarietyAttrs(row.id, {
      typeName: 'Peony', colour: 'Pink', sizeCm: 50, cultivar: 'Sarah Bernhardt',
    }, { actor });
    expect(result['Type']).toBe('Peony');
    expect(result['Colour']).toBe('Pink');
    expect(result['Size']).toBe(50);
    expect(result['Cultivar']).toBe('Sarah Bernhardt');

    const audits = await harness.db.select().from(auditLog);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('variety_backfill');
    expect(audits[0].actorRole).toBe('owner');
    expect(audits[0].diff.after['Type']).toBe('Peony');
  });

  it('trims cultivar whitespace before saving', async () => {
    const { eq } = await import('drizzle-orm');
    const row = await seedRow({ typeName: null });
    await stockRepo.updateVarietyAttrs(row.id, {
      typeName: 'Rose', cultivar: '  White O\'Hara  ',
    }, { actor: { actorRole: 'owner', actorPinLabel: null } });
    const [updated] = await harness.db.select().from(stock).where(eq(stock.id, row.id));
    expect(updated.cultivar).toBe("White O'Hara");
  });

  it('throws 400 when typeName is empty string', async () => {
    const row = await seedRow({ typeName: null });
    await expect(stockRepo.updateVarietyAttrs(row.id, { typeName: '' }, { actor: { actorRole: 'owner' } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 404 for unknown id', async () => {
    await expect(stockRepo.updateVarietyAttrs('00000000-0000-0000-0000-000000000000', { typeName: 'Rose' }, { actor: { actorRole: 'owner' } }))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('bulkUpdateVarietyAttrs', () => {
  it('applies attrs to multiple rows in a single transaction, writes one audit row each', async () => {
    const r1 = await seedRow({ displayName: 'Tulip 1', typeName: null });
    const r2 = await seedRow({ displayName: 'Tulip 2', typeName: null });
    const actor = { actorRole: 'owner', actorPinLabel: null };
    const results = await stockRepo.bulkUpdateVarietyAttrs(
      [r1.id, r2.id],
      { typeName: 'Tulip', colour: 'Yellow' },
      { actor },
    );
    expect(results).toHaveLength(2);
    expect(results.every(r => r['Type'] === 'Tulip')).toBe(true);

    const audits = await harness.db.select().from(auditLog);
    expect(audits).toHaveLength(2);
    expect(audits.every(a => a.action === 'variety_backfill')).toBe(true);
  });

  it('rolls back all rows when one id is invalid (transaction atomicity)', async () => {
    const { eq } = await import('drizzle-orm');
    const r1 = await seedRow({ typeName: null });
    const badId = '00000000-0000-0000-0000-000000000000';
    await expect(stockRepo.bulkUpdateVarietyAttrs([r1.id, badId], { typeName: 'Rose' }, { actor: { actorRole: 'owner' } }))
      .rejects.toMatchObject({ statusCode: 404 });
    // r1 should be rolled back — typeName still null
    const [unchanged] = await harness.db.select().from(stock).where(eq(stock.id, r1.id));
    expect(unchanged.typeName).toBeNull();
  });
});
