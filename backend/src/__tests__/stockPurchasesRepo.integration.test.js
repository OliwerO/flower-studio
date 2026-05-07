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

import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

describe('stockPurchasesRepo', () => {
  it('creates a purchase record without a stock link', async () => {
    const p = await stockPurchasesRepo.create({
      purchaseDate: '2026-05-07',
      supplier: 'Rynkowy',
      quantityPurchased: 50,
      pricePerUnit: 1.25,
      notes: '',
    });

    expect(p.id).toBeTruthy();
    expect(p['Purchase Date']).toBe('2026-05-07');
    expect(p.Supplier).toBe('Rynkowy');
    expect(p['Quantity Purchased']).toBe(50);
    expect(p['Price Per Unit']).toBe(1.25);
    expect(p.Flower).toEqual([]);
  });

  it('stores stockAirtableId and exposes it via Flower field', async () => {
    const p = await stockPurchasesRepo.create({
      purchaseDate: '2026-05-07',
      supplier: 'Rynkowy',
      stockAirtableId: 'recABC123',
      quantityPurchased: 20,
      pricePerUnit: 2.00,
      notes: 'test',
    });

    expect(p.Flower).toEqual(['recABC123']);
  });

  describe('noteMarkerExists', () => {
    it('returns false when no matching row', async () => {
      const result = await stockPurchasesRepo.noteMarkerExists('PO #recXXX L#recYYY primary');
      expect(result).toBe(false);
    });

    it('returns true after a matching row is created', async () => {
      const marker = 'PO #recPO1 L#recLN1 primary';
      await stockPurchasesRepo.create({
        purchaseDate: '2026-05-07',
        supplier: 'Test',
        quantityPurchased: 10,
        notes: marker,
      });

      expect(await stockPurchasesRepo.noteMarkerExists(marker)).toBe(true);
    });

    it('does not match partial markers that share a prefix', async () => {
      await stockPurchasesRepo.create({
        purchaseDate: '2026-05-07',
        supplier: 'Test',
        quantityPurchased: 5,
        notes: 'PO #recPO1 L#recLN1 primary',
      });

      // Different line — must not match
      expect(await stockPurchasesRepo.noteMarkerExists('PO #recPO1 L#recLN2 primary')).toBe(false);
    });
  });

  describe('list', () => {
    it('returns all rows when no date range given', async () => {
      await stockPurchasesRepo.create({ purchaseDate: '2026-04-01', supplier: 'A', quantityPurchased: 10 });
      await stockPurchasesRepo.create({ purchaseDate: '2026-05-01', supplier: 'B', quantityPurchased: 5 });
      const rows = await stockPurchasesRepo.list();
      expect(rows).toHaveLength(2);
    });

    it('filters by from/to date range inclusive', async () => {
      await stockPurchasesRepo.create({ purchaseDate: '2026-03-15', supplier: 'A', quantityPurchased: 10 });
      await stockPurchasesRepo.create({ purchaseDate: '2026-04-10', supplier: 'B', quantityPurchased: 5 });
      await stockPurchasesRepo.create({ purchaseDate: '2026-05-20', supplier: 'C', quantityPurchased: 3 });
      const rows = await stockPurchasesRepo.list({ from: '2026-04-01', to: '2026-04-30' });
      expect(rows).toHaveLength(1);
      expect(rows[0].Supplier).toBe('B');
    });
  });

  describe('findDateByPoMarker', () => {
    it('returns null when no rows for this PO', async () => {
      const result = await stockPurchasesRepo.findDateByPoMarker('recNONE');
      expect(result).toBeNull();
    });

    it('returns the purchase_date of the most recent matching row', async () => {
      await stockPurchasesRepo.create({
        purchaseDate: '2026-05-01',
        supplier: 'Test',
        quantityPurchased: 10,
        notes: 'PO #recPO9 L#recL1 primary',
      });
      await stockPurchasesRepo.create({
        purchaseDate: '2026-05-01',
        supplier: 'Test',
        quantityPurchased: 5,
        notes: 'PO #recPO9 L#recL2 alt - substitute for "Rose"',
      });

      const date = await stockPurchasesRepo.findDateByPoMarker('recPO9');
      expect(date).toBe('2026-05-01');
    });
  });
});
