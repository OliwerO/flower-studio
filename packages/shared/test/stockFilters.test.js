import { describe, it, expect } from 'vitest';
import {
  EMPTY_STOCK_FILTER,
  clearStockFilter,
  stockRowMatchesFilter,
  activeStockFilterCount,
} from '../utils/stockFilters.js';

// A flattened BatchArrivalList row (see BatchArrivalList.flatten).
const row = {
  type: 'Peony',
  colour: 'Pink',
  size_cm: 60,
  cultivar: 'Sarah Bernhardt',
  variety: 'Pink 60 Sarah Bernhardt',
  qty: 38,
  reserved: 18,
  cost: 12,
  sell: 42,
  markup: 3.5,
  arrived: '2026-06-10',
  supplier: 'Stojek',
};

describe('stockFilters — EMPTY / clear', () => {
  it('EMPTY_STOCK_FILTER matches everything (no active dimensions)', () => {
    expect(activeStockFilterCount(EMPTY_STOCK_FILTER)).toBe(0);
    expect(stockRowMatchesFilter(row, EMPTY_STOCK_FILTER)).toBe(true);
  });
  it('clearStockFilter returns a fresh empty copy', () => {
    const f = clearStockFilter();
    expect(f).toEqual(EMPTY_STOCK_FILTER);
    expect(f).not.toBe(EMPTY_STOCK_FILTER); // new object
  });
  it('a null/undefined filter matches everything', () => {
    expect(stockRowMatchesFilter(row, null)).toBe(true);
    expect(activeStockFilterCount(undefined)).toBe(0);
  });
});

describe('stockFilters — text columns (type / variety / supplier)', () => {
  it('type is a case-insensitive contains', () => {
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, typeQuery: 'peo' })).toBe(true);
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, typeQuery: 'rose' })).toBe(false);
  });
  it('variety matches the composed variety label OR colour/cultivar', () => {
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, varietyQuery: 'sarah' })).toBe(true);
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, varietyQuery: 'pink' })).toBe(true);
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, varietyQuery: 'blue' })).toBe(false);
  });
  it('supplier is a case-insensitive contains', () => {
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, supplierQuery: 'stoj' })).toBe(true);
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, supplierQuery: 'other' })).toBe(false);
  });
});

describe('stockFilters — numeric ranges (available / cost / sell / markup)', () => {
  it('available (qty) min/max', () => {
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, qtyMin: 30 })).toBe(true);
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, qtyMin: 40 })).toBe(false);
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, qtyMax: 40 })).toBe(true);
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, qtyMax: 30 })).toBe(false);
  });
  it('cost min/max', () => {
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, costMin: 10, costMax: 15 })).toBe(true);
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, costMin: 20 })).toBe(false);
  });
  it('sell min/max', () => {
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, sellMin: 40, sellMax: 50 })).toBe(true);
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, sellMax: 40 })).toBe(false);
  });
  it('markup min/max', () => {
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, markupMin: 3 })).toBe(true);
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, markupMin: 4 })).toBe(false);
  });
  it('a row with null cost is excluded by any cost bound', () => {
    const noCost = { ...row, cost: null };
    expect(stockRowMatchesFilter(noCost, { ...EMPTY_STOCK_FILTER, costMin: 5 })).toBe(false);
    // but unconstrained still matches
    expect(stockRowMatchesFilter(noCost, EMPTY_STOCK_FILTER)).toBe(true);
  });
});

describe('stockFilters — arrived date range', () => {
  it('arrivedFrom / arrivedTo bound the newest-receive date', () => {
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, arrivedFrom: '2026-06-01' })).toBe(true);
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, arrivedFrom: '2026-06-15' })).toBe(false);
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, arrivedTo: '2026-06-30' })).toBe(true);
    expect(stockRowMatchesFilter(row, { ...EMPTY_STOCK_FILTER, arrivedTo: '2026-06-01' })).toBe(false);
  });
  it('a row with no arrived date is excluded by any date bound', () => {
    const noDate = { ...row, arrived: null };
    expect(stockRowMatchesFilter(noDate, { ...EMPTY_STOCK_FILTER, arrivedFrom: '2026-01-01' })).toBe(false);
    expect(stockRowMatchesFilter(noDate, EMPTY_STOCK_FILTER)).toBe(true);
  });
});

describe('stockFilters — activeStockFilterCount', () => {
  it('counts each active dimension once (a range pair = 1)', () => {
    const f = {
      ...EMPTY_STOCK_FILTER,
      typeQuery: 'peony',       // 1
      varietyQuery: 'pink',     // 2
      supplierQuery: 'stojek',  // 3
      qtyMin: 10, qtyMax: 50,   // 4 (one pair)
      costMin: 5,               // 5
      sellMax: 100,             // 6
      markupMin: 2,             // 7
      arrivedFrom: '2026-06-01', arrivedTo: '2026-06-30', // 8 (one pair)
    };
    expect(activeStockFilterCount(f)).toBe(8);
  });
});
