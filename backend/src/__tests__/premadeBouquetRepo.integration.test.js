// premadeBouquetRepo integration tests — pglite-backed CRUD + dual-lookup +
// CASCADE coverage. Phase 7.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { premadeBouquets, premadeBouquetLines, stock } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import * as premadeBouquetRepo from '../repos/premadeBouquetRepo.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('premadeBouquetRepo', () => {
  it('create + line CRUD round-trip', async () => {
    const b = await premadeBouquetRepo.create({ Name: 'Spring Mix', 'Created By': 'florist' });
    expect(b.Name).toBe('Spring Mix');
    expect(b._pgId).toBeDefined();

    const line = await premadeBouquetRepo.createLine({
      'Premade Bouquets':    [b._pgId],
      'Flower Name':         'Tulip',
      Quantity:              10,
      'Cost Price Per Unit': 2.5,
      'Sell Price Per Unit': 8,
    });
    expect(line.Quantity).toBe(10);
    expect(line['Cost Price Per Unit']).toBe(2.5);
    expect(line['Sell Price Per Unit']).toBe(8);

    const lines = await premadeBouquetRepo.getLinesByBouquetId(b._pgId);
    expect(lines).toHaveLength(1);
  });

  it('CASCADE on delete', async () => {
    const b = await premadeBouquetRepo.create({ Name: 'X' });
    await premadeBouquetRepo.createLine({
      'Premade Bouquets': [b._pgId], 'Flower Name': 'Rose', Quantity: 5,
    });
    await premadeBouquetRepo.deleteById(b._pgId);
    const remaining = await harness.db.select().from(premadeBouquetLines)
      .where(eq(premadeBouquetLines.bouquetId, b._pgId));
    expect(remaining).toHaveLength(0);
  });

  it('getLinesByStockId resolves recXXX and uuid', async () => {
    const [s] = await harness.db.insert(stock).values({
      displayName: 'Lily', currentQuantity: 0, active: true,
    }).returning();

    const b = await premadeBouquetRepo.create({ Name: 'Lily Bouquet' });
    await premadeBouquetRepo.createLine({
      'Premade Bouquets': [b._pgId], 'Stock Item': [s.id], 'Flower Name': 'Lily', Quantity: 3,
    });
    const found = await premadeBouquetRepo.getLinesByStockId(s.id);
    expect(found).toHaveLength(1);

    // Now insert a line referencing a recXXX-style stock id
    const b2 = await premadeBouquetRepo.create({ Name: 'Legacy' });
    await premadeBouquetRepo.createLine({
      'Premade Bouquets': [b2._pgId], 'Stock Item': ['recLEGACY'], 'Flower Name': 'Legacy', Quantity: 2,
    });
    const foundLegacy = await premadeBouquetRepo.getLinesByStockId('recLEGACY');
    expect(foundLegacy).toHaveLength(1);
  });

  it('getById dual-lookup (recXXX or uuid)', async () => {
    const [row] = await harness.db.insert(premadeBouquets).values({
      airtableId: 'recBQ1', name: 'AT Bouquet',
    }).returning();
    const byAt = await premadeBouquetRepo.getById('recBQ1');
    expect(byAt._pgId).toBe(row.id);
    expect(byAt.id).toBe('recBQ1');
    const byUuid = await premadeBouquetRepo.getById(row.id);
    expect(byUuid._pgId).toBe(row.id);
  });

  it('create() rejects empty name', async () => {
    await expect(premadeBouquetRepo.create({ Name: '' })).rejects.toThrow(/name/i);
  });

  it('update() patches only provided fields', async () => {
    const b = await premadeBouquetRepo.create({ Name: 'Orig', Notes: 'original notes' });
    const updated = await premadeBouquetRepo.update(b._pgId, { 'Price Override': 199.99 });
    expect(updated['Price Override']).toBe(199.99);
    expect(updated.Name).toBe('Orig');
    expect(updated.Notes).toBe('original notes');
  });

  it('lineToWire Stock Item array shape', async () => {
    const [s] = await harness.db.insert(stock).values({
      displayName: 'Peony', currentQuantity: 0, active: true,
    }).returning();
    const b = await premadeBouquetRepo.create({ Name: 'Peony Mix' });
    const line = await premadeBouquetRepo.createLine({
      'Premade Bouquets': [b._pgId], 'Stock Item': [s.id], 'Flower Name': 'Peony', Quantity: 4,
    });
    expect(line['Stock Item']).toEqual([s.id]);

    // Line without stock item link → empty array
    const lineNoStock = await premadeBouquetRepo.createLine({
      'Premade Bouquets': [b._pgId], 'Flower Name': 'Mystery', Quantity: 1,
    });
    expect(lineNoStock['Stock Item']).toEqual([]);
  });
});
