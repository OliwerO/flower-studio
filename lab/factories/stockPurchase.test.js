// lab/factories/stockPurchase.test.js
//
// TDD coverage for makeStockPurchase factory.
// Tests were written BEFORE the factory implementation (red phase).

import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { makeStockPurchase } from './stockPurchase.js';

describe('makeStockPurchase', () => {
  beforeEach(() => faker.seed(42));

  it('returns a uuid id', () => {
    const r = makeStockPurchase({ purchase_date: '2026-06-12' });
    expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('has required NOT-NULL columns present and non-null', () => {
    const r = makeStockPurchase({ purchase_date: '2026-06-12' });
    expect(r.purchase_date).toBeTruthy();
    expect(r.supplier).not.toBeUndefined();
    expect(r.quantity_purchased).not.toBeNull();
    expect(r.quantity_purchased).not.toBeUndefined();
    expect(r.notes).not.toBeUndefined();
  });

  it('stockId shorthand maps to stock_id and is not leaked', () => {
    const id = faker.string.uuid();
    const r = makeStockPurchase({ purchase_date: '2026-06-12', stockId: id });
    expect(r.stock_id).toBe(id);
    expect(r.stockId).toBeUndefined();
  });

  it('stock_id defaults to null', () => {
    const r = makeStockPurchase({ purchase_date: '2026-06-12' });
    expect(r.stock_id).toBeNull();
  });

  it('airtable_id defaults to null', () => {
    const r = makeStockPurchase({ purchase_date: '2026-06-12' });
    expect(r.airtable_id).toBeNull();
  });

  it('stock_airtable_id defaults to null', () => {
    const r = makeStockPurchase({ purchase_date: '2026-06-12' });
    expect(r.stock_airtable_id).toBeNull();
  });

  it('supplier defaults to empty string', () => {
    const r = makeStockPurchase({ purchase_date: '2026-06-12' });
    expect(r.supplier).toBe('');
  });

  it('quantity_purchased defaults to 0', () => {
    const r = makeStockPurchase({ purchase_date: '2026-06-12' });
    expect(r.quantity_purchased).toBe(0);
  });

  it('price_per_unit defaults to null', () => {
    const r = makeStockPurchase({ purchase_date: '2026-06-12' });
    expect(r.price_per_unit).toBeNull();
  });

  it('created_at is a Date', () => {
    const r = makeStockPurchase({ purchase_date: '2026-06-12' });
    expect(r.created_at).toBeInstanceOf(Date);
  });

  it('quantity_accepted defaults to null', () => {
    const r = makeStockPurchase({ purchase_date: '2026-06-12' });
    expect(r.quantity_accepted).toBeNull();
  });

  it('honours explicit quantity_purchased and price_per_unit', () => {
    const r = makeStockPurchase({ purchase_date: '2026-06-12', quantity_purchased: 40, price_per_unit: 5 });
    expect(r.quantity_purchased).toBe(40);
    expect(r.price_per_unit).toBe(5);
  });

  it('honours explicit quantity_accepted', () => {
    const r = makeStockPurchase({ purchase_date: '2026-06-12', quantity_accepted: 35 });
    expect(r.quantity_accepted).toBe(35);
  });

  it('honours explicit supplier and notes', () => {
    const r = makeStockPurchase({ purchase_date: '2026-06-12', supplier: 'Stojek', notes: 'PO #PO-1 L#1 primary' });
    expect(r.supplier).toBe('Stojek');
    expect(r.notes).toBe('PO #PO-1 L#1 primary');
  });

  it('is deterministic under the same faker seed', () => {
    faker.seed(42);
    const a = makeStockPurchase({ purchase_date: '2026-06-12' });
    faker.seed(42);
    const b = makeStockPurchase({ purchase_date: '2026-06-12' });
    // Compare only faker-derived fields — created_at uses wall clock.
    expect(a.id).toEqual(b.id);
  });
});
