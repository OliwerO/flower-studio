import { describe, it, expect } from 'vitest';
import { varietyFinancials } from '../utils/varietyFinancials.js';

function makeRow({ qty = 0, date = null, cost = null, sell = null, supplier = null } = {}) {
  return {
    current_quantity: qty,
    date,
    current_cost_price: cost,
    current_sell_price: sell,
    supplier,
  };
}

describe('varietyFinancials', () => {
  it('returns all nulls for empty rows', () => {
    expect(varietyFinancials([])).toEqual({ cost: null, sell: null, markup: null, supplier: null });
  });

  it('picks cost/sell from the newest positive-qty batch when multiple batches', () => {
    const rows = [
      makeRow({ qty: 10, date: '2026-06-01', cost: 1.50, sell: 3.50 }),
      makeRow({ qty: 5,  date: '2026-06-15', cost: 1.80, sell: 4.00 }),
      makeRow({ qty: 8,  date: '2026-06-10', cost: 1.60, sell: 3.80 }),
    ];
    const fin = varietyFinancials(rows);
    expect(fin.cost).toBe(1.80);
    expect(fin.sell).toBe(4.00);
  });

  it('falls back to any priced row when no positive-qty batch (demand entries only)', () => {
    const rows = [
      makeRow({ qty: -3, date: '2026-06-20', cost: 1.50, sell: 3.50 }),
      makeRow({ qty: -1, date: '2026-06-25', cost: null, sell: null }),
    ];
    const fin = varietyFinancials(rows);
    expect(fin.cost).toBe(1.50);
    expect(fin.sell).toBe(3.50);
  });

  it('falls back when no row has positive qty, picks first priced row', () => {
    const rows = [
      makeRow({ qty: 0, date: null, cost: null, sell: null }),
      makeRow({ qty: 0, date: null, cost: 2.00, sell: 5.00 }),
    ];
    const fin = varietyFinancials(rows);
    expect(fin.cost).toBe(2.00);
    expect(fin.sell).toBe(5.00);
  });

  it('prefers positive-qty batch over demand fallback', () => {
    const rows = [
      makeRow({ qty: -2, date: '2026-06-01', cost: 0.50, sell: 1.00 }), // demand entry — fallback candidate
      makeRow({ qty: 10, date: '2026-06-05', cost: 1.80, sell: 4.00 }), // positive batch — wins
    ];
    const fin = varietyFinancials(rows);
    expect(fin.cost).toBe(1.80);
    expect(fin.sell).toBe(4.00);
  });

  describe('markup', () => {
    it('computes markup as sell / cost when both > 0', () => {
      const rows = [makeRow({ qty: 10, cost: 2.00, sell: 5.00 })];
      const fin = varietyFinancials(rows);
      expect(fin.markup).toBeCloseTo(2.5);
    });

    it('returns null markup when cost is 0', () => {
      const rows = [makeRow({ qty: 10, cost: 0, sell: 5.00 })];
      const fin = varietyFinancials(rows);
      expect(fin.markup).toBeNull();
    });

    it('returns null markup when sell is 0', () => {
      const rows = [makeRow({ qty: 10, cost: 2.00, sell: 0 })];
      const fin = varietyFinancials(rows);
      expect(fin.markup).toBeNull();
    });

    it('returns null markup when cost is null', () => {
      const rows = [makeRow({ qty: 10, cost: null, sell: 4.00 })];
      const fin = varietyFinancials(rows);
      expect(fin.markup).toBeNull();
    });

    it('returns null markup when sell is null', () => {
      const rows = [makeRow({ qty: 10, cost: 2.00, sell: null })];
      const fin = varietyFinancials(rows);
      expect(fin.markup).toBeNull();
    });
  });

  describe('supplier aggregation', () => {
    it('returns null when no supplier on any row', () => {
      const rows = [makeRow({ qty: 5 }), makeRow({ qty: 3 })];
      expect(varietyFinancials(rows).supplier).toBeNull();
    });

    it('returns the supplier name when only one supplier', () => {
      const rows = [makeRow({ qty: 5, supplier: 'Rosa Farm' })];
      expect(varietyFinancials(rows).supplier).toBe('Rosa Farm');
    });

    it('returns "A, B" for exactly two distinct suppliers', () => {
      const rows = [
        makeRow({ qty: 5, supplier: 'Rosa Farm' }),
        makeRow({ qty: 3, supplier: 'Flower Co' }),
      ];
      expect(varietyFinancials(rows).supplier).toBe('Rosa Farm, Flower Co');
    });

    it('returns "A +2" for three distinct suppliers', () => {
      const rows = [
        makeRow({ qty: 5, supplier: 'Rosa Farm' }),
        makeRow({ qty: 3, supplier: 'Flower Co' }),
        makeRow({ qty: 2, supplier: 'Green House' }),
      ];
      expect(varietyFinancials(rows).supplier).toBe('Rosa Farm +2');
    });

    it('deduplicates the same supplier across rows', () => {
      const rows = [
        makeRow({ qty: 5, supplier: 'Rosa Farm' }),
        makeRow({ qty: 3, supplier: 'Rosa Farm' }),
      ];
      expect(varietyFinancials(rows).supplier).toBe('Rosa Farm');
    });
  });

  it('accepts display-key field names (Airtable-style)', () => {
    const rows = [{
      current_quantity: 10,
      date: '2026-06-01',
      'Current Cost Price': 1.50,
      'Current Sell Price': 3.75,
      Supplier: 'Display Farms',
    }];
    const fin = varietyFinancials(rows);
    expect(fin.cost).toBe(1.50);
    expect(fin.sell).toBe(3.75);
    expect(fin.supplier).toBe('Display Farms');
  });
});
