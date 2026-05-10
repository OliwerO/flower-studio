// Integration tests for stockRepo.listGroupedByVariety (Task 2, issue #289).
//
// What we're proving:
//   • 4-tuple (type_name, colour, size_cm, cultivar) grouping with NULL-aware
//     equality — Eucalyptus null colour vs Eucalyptus "Green" → 2 groups.
//   • reservedForPremades attached per group via getPremadeReservations.
//   • includeEmpty=false (default) hides groups where totalQty=0 AND
//     reservedForPremades=0; keeps groups with reservations even at qty=0.
//   • includeEmpty=true returns all groups.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, premadeBouquets, premadeBouquetLines } from '../db/schema.js';

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

// Helper: insert a stock row with Y-model columns
async function seedStock(overrides = {}) {
  const [row] = await harness.db.insert(stock).values({
    displayName: overrides.displayName || 'Test Flower',
    currentQuantity: overrides.currentQuantity ?? 10,
    active: overrides.active ?? true,
    typeName: overrides.typeName || null,
    colour: overrides.colour ?? null,
    sizeCm: overrides.sizeCm ?? null,
    cultivar: overrides.cultivar ?? null,
  }).returning();
  return row;
}

describe('listGroupedByVariety (issue #289)', () => {
  describe('NULL-aware 4-tuple grouping', () => {
    it('groups two rows sharing the same 4-tuple into one group', async () => {
      await seedStock({ displayName: 'Rose Red 50 (12.May.)', typeName: 'Rose', colour: 'Red', sizeCm: 50, currentQuantity: 10 });
      await seedStock({ displayName: 'Rose Red 50 (14.May.)', typeName: 'Rose', colour: 'Red', sizeCm: 50, currentQuantity: 8 });

      const groups = await stockRepo.listGroupedByVariety({ includeEmpty: true });
      expect(groups).toHaveLength(1);
      expect(groups[0].key).toBe('Rose|Red|50|');
      expect(groups[0].type_name).toBe('Rose');
      expect(groups[0].colour).toBe('Red');
      expect(groups[0].size_cm).toBe(50);
      expect(groups[0].cultivar).toBeNull();
      expect(groups[0].rows).toHaveLength(2);
    });

    it('NULL colour vs "Green" colour → 2 separate groups (NULL-aware equality)', async () => {
      // This is the critical case: NULL != "Green", NULL != NULL (SQL), so we
      // must use the serialized key ("Type|Colour|Size|Cultivar") to distinguish.
      await seedStock({ displayName: 'Eucalyptus (null colour)', typeName: 'Eucalyptus', colour: null, currentQuantity: 5 });
      await seedStock({ displayName: 'Eucalyptus Green', typeName: 'Eucalyptus', colour: 'Green', currentQuantity: 3 });

      const groups = await stockRepo.listGroupedByVariety({ includeEmpty: true });
      expect(groups).toHaveLength(2);

      const keys = groups.map(g => g.key).sort();
      // Key is 4-tuple joined by '|': type|colour|size|cultivar
      // null attrs serialize as '' → 'Eucalyptus|||' (null colour, null size, null cultivar)
      expect(keys).toContain('Eucalyptus|||'); // null colour serialized as ''
      expect(keys).toContain('Eucalyptus|Green||'); // Green colour, null size, null cultivar
    });

    it('NULL size vs integer size → 2 separate groups', async () => {
      await seedStock({ displayName: 'Rose no size', typeName: 'Rose', colour: 'Red', sizeCm: null, currentQuantity: 4 });
      await seedStock({ displayName: 'Rose 60cm', typeName: 'Rose', colour: 'Red', sizeCm: 60, currentQuantity: 6 });

      const groups = await stockRepo.listGroupedByVariety({ includeEmpty: true });
      expect(groups).toHaveLength(2);
    });

    it('rows with type_name IS NULL are excluded (not Y-model rows)', async () => {
      // Legacy stock with no type_name should not appear in any group.
      await seedStock({ displayName: 'Legacy flower', typeName: null, currentQuantity: 10 });
      await seedStock({ displayName: 'Y-model flower', typeName: 'Tulip', currentQuantity: 5 });

      const groups = await stockRepo.listGroupedByVariety({ includeEmpty: true });
      expect(groups).toHaveLength(1);
      expect(groups[0].type_name).toBe('Tulip');
    });
  });

  describe('reservedForPremades attached per group', () => {
    it('attaches summed premade reservations to the correct group', async () => {
      const [rose] = await harness.db.insert(stock).values({
        displayName: 'Rose Red', currentQuantity: 20, typeName: 'Rose', colour: 'Red',
      }).returning();
      const [eucy] = await harness.db.insert(stock).values({
        displayName: 'Eucalyptus', currentQuantity: 10, typeName: 'Eucalyptus',
      }).returning();

      const [bq] = await harness.db.insert(premadeBouquets).values({ name: 'Wedding' }).returning();
      await harness.db.insert(premadeBouquetLines).values([
        { bouquetId: bq.id, stockId: rose.id, flowerName: 'Rose Red', quantity: 5 },
        { bouquetId: bq.id, stockId: eucy.id, flowerName: 'Eucalyptus', quantity: 3 },
      ]);

      const groups = await stockRepo.listGroupedByVariety({ includeEmpty: true });
      const roseGroup = groups.find(g => g.type_name === 'Rose');
      const eucyGroup = groups.find(g => g.type_name === 'Eucalyptus');

      expect(roseGroup.reservedForPremades).toBe(5);
      expect(eucyGroup.reservedForPremades).toBe(3);
    });

    it('sums reservations across all rows in the group (multiple batches)', async () => {
      const [batch1] = await harness.db.insert(stock).values({
        displayName: 'Rose Red (12.May.)', currentQuantity: 15, typeName: 'Rose', colour: 'Red',
      }).returning();
      const [batch2] = await harness.db.insert(stock).values({
        displayName: 'Rose Red (14.May.)', currentQuantity: 10, typeName: 'Rose', colour: 'Red',
      }).returning();

      const [bq1] = await harness.db.insert(premadeBouquets).values({ name: 'BQ1' }).returning();
      const [bq2] = await harness.db.insert(premadeBouquets).values({ name: 'BQ2' }).returning();
      await harness.db.insert(premadeBouquetLines).values([
        { bouquetId: bq1.id, stockId: batch1.id, flowerName: 'Rose', quantity: 4 },
        { bouquetId: bq2.id, stockId: batch2.id, flowerName: 'Rose', quantity: 6 },
      ]);

      const groups = await stockRepo.listGroupedByVariety({ includeEmpty: true });
      expect(groups).toHaveLength(1);
      expect(groups[0].reservedForPremades).toBe(10); // 4 + 6
    });

    it('groups with no premade reservations get reservedForPremades=0', async () => {
      await seedStock({ typeName: 'Tulip', currentQuantity: 5 });

      const groups = await stockRepo.listGroupedByVariety({ includeEmpty: true });
      expect(groups[0].reservedForPremades).toBe(0);
    });
  });

  describe('includeEmpty filter', () => {
    it('includeEmpty=false (default) hides groups where totalQty===0 AND reservedForPremades===0', async () => {
      await seedStock({ typeName: 'Rose', colour: 'Red', currentQuantity: 5 });
      await seedStock({ typeName: 'Tulip', colour: 'Yellow', currentQuantity: 0 });

      const groups = await stockRepo.listGroupedByVariety(); // default includeEmpty=false
      expect(groups).toHaveLength(1);
      expect(groups[0].type_name).toBe('Rose');
    });

    it('includeEmpty=false keeps groups with reservations even when qty=0', async () => {
      const [tulip] = await harness.db.insert(stock).values({
        displayName: 'Tulip depleted', currentQuantity: 0, typeName: 'Tulip', colour: 'Yellow',
      }).returning();

      const [bq] = await harness.db.insert(premadeBouquets).values({ name: 'Premade' }).returning();
      await harness.db.insert(premadeBouquetLines).values([
        { bouquetId: bq.id, stockId: tulip.id, flowerName: 'Tulip', quantity: 3 },
      ]);

      const groups = await stockRepo.listGroupedByVariety(); // default includeEmpty=false
      // qty=0 but reservedForPremades=3 → kept
      expect(groups).toHaveLength(1);
      expect(groups[0].type_name).toBe('Tulip');
      expect(groups[0].reservedForPremades).toBe(3);
    });

    it('includeEmpty=true returns all groups including zero-qty with no reservations', async () => {
      await seedStock({ typeName: 'Rose', currentQuantity: 0 });
      await seedStock({ typeName: 'Tulip', currentQuantity: 5 });

      const groups = await stockRepo.listGroupedByVariety({ includeEmpty: true });
      expect(groups).toHaveLength(2);
    });
  });

  describe('response shape', () => {
    it('each group has key, type_name, colour, size_cm, cultivar, rows (StockItem[]), reservedForPremades', async () => {
      await seedStock({ displayName: 'Peony Pink 50 Coral Charm', typeName: 'Peony', colour: 'Pink', sizeCm: 50, cultivar: 'Coral Charm', currentQuantity: 7 });

      const groups = await stockRepo.listGroupedByVariety({ includeEmpty: true });
      const g = groups[0];
      expect(g).toHaveProperty('key');
      expect(g).toHaveProperty('type_name', 'Peony');
      expect(g).toHaveProperty('colour', 'Pink');
      expect(g).toHaveProperty('size_cm', 50);
      expect(g).toHaveProperty('cultivar', 'Coral Charm');
      expect(g).toHaveProperty('reservedForPremades', 0);
      expect(Array.isArray(g.rows)).toBe(true);
      expect(g.rows).toHaveLength(1);
      // rows are StockItem-shaped (wire format from pgToResponse)
      expect(g.rows[0]).toHaveProperty('Display Name');
      expect(g.rows[0]).toHaveProperty('Current Quantity', 7);
    });
  });
});
