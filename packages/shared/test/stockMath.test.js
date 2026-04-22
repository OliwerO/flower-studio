import { describe, it, expect } from 'vitest';
import { getEffectiveStock, hasStockShortfall } from '../utils/stockMath.js';

// Model (see stockMath.js header): stock is deducted at order creation, so
// Current Quantity already reflects every pending order's demand. `committed`
// is an informational list, NOT a subtraction. Therefore effective = qty.

describe('getEffectiveStock', () => {
  it('returns qty unchanged for positive stock (committed is ignored)', () => {
    // 10 on shelf; Olha's order for 3 already dropped qty to 7. committed=3
    // is just the same order viewed from the other side — subtracting again
    // would double-count.
    expect(getEffectiveStock(10, 3)).toBe(10);
    expect(getEffectiveStock(7, 3)).toBe(7);
  });

  it('returns qty unchanged for zero stock', () => {
    expect(getEffectiveStock(0, 0)).toBe(0);
    expect(getEffectiveStock(0, 5)).toBe(0);
  });

  it('returns qty unchanged for negative stock (no double count)', () => {
    // 2026-04-22 regression: Hydrangea Pink at -2 with committed=2 used to
    // render as -4 (same order subtracted twice). Must stay at -2.
    expect(getEffectiveStock(-2, 2)).toBe(-2);
    expect(getEffectiveStock(-11, 11)).toBe(-11);
  });

  it('reflects cumulative shortfall honestly', () => {
    // Prior -5 shortfall (existing orders already ate past zero) AND a fresh
    // order for 3 more deducted qty to -8. Display must be -8 (true total
    // stems to buy) — not -5. The pre-2026-04-22 "return qty when < 0" patch
    // broke this case by dropping the legitimate extra demand.
    expect(getEffectiveStock(-8, 3)).toBe(-8);
  });

  it('coerces non-numeric input safely', () => {
    expect(getEffectiveStock(null, null)).toBe(0);
    expect(getEffectiveStock(undefined, undefined)).toBe(0);
    expect(getEffectiveStock('10', '3')).toBe(10);
    expect(getEffectiveStock(NaN, 5)).toBe(0);
  });

  it('ignores the committed argument entirely (no sensitivity test)', () => {
    // Same qty, any committed → same result. Proves committed is ignored.
    expect(getEffectiveStock(5, 0)).toBe(5);
    expect(getEffectiveStock(5, 99)).toBe(5);
    expect(getEffectiveStock(5, -99)).toBe(5);
    expect(getEffectiveStock(5)).toBe(5);
  });
});

describe('hasStockShortfall', () => {
  it('flags true when qty is negative (with or without committed)', () => {
    expect(hasStockShortfall(-1, 0)).toBe(true);
    expect(hasStockShortfall(-1, 5)).toBe(true);
    expect(hasStockShortfall(-999, 0)).toBe(true);
  });

  it('flags false when qty is zero or positive', () => {
    expect(hasStockShortfall(0, 0)).toBe(false);
    expect(hasStockShortfall(0, 5)).toBe(false);
    expect(hasStockShortfall(10, 0)).toBe(false);
    expect(hasStockShortfall(10, 99)).toBe(false);
  });

  it('coerces non-numeric input safely', () => {
    expect(hasStockShortfall(null, null)).toBe(false);
    expect(hasStockShortfall(undefined, undefined)).toBe(false);
    expect(hasStockShortfall('-1', 0)).toBe(true);
    expect(hasStockShortfall('5', 0)).toBe(false);
  });
});
