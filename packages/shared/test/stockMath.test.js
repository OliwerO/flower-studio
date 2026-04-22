import { describe, it, expect } from 'vitest';
import { getEffectiveStock, hasStockShortfall } from '../utils/stockMath.js';

describe('getEffectiveStock', () => {
  it('subtracts committed when qty is positive', () => {
    expect(getEffectiveStock(10, 3)).toBe(7);
  });

  it('returns qty unchanged when qty is already negative (NO double count)', () => {
    // Regression for the 2026-04-22 bug: stock was -2 and committed was 2
    // from the same order → old code showed -4 (double-counted).
    expect(getEffectiveStock(-2, 2)).toBe(-2);
    expect(getEffectiveStock(-11, 11)).toBe(-11);
  });

  it('returns 0 when qty is 0 with no committed', () => {
    expect(getEffectiveStock(0, 0)).toBe(0);
  });

  it('returns negative committed when qty is 0 with pending orders', () => {
    // qty=0 is not yet negative, so the pending orders ARE additional demand.
    expect(getEffectiveStock(0, 5)).toBe(-5);
  });

  it('coerces non-numeric input safely', () => {
    expect(getEffectiveStock(null, null)).toBe(0);
    expect(getEffectiveStock(undefined, undefined)).toBe(0);
    expect(getEffectiveStock('10', '3')).toBe(7);
  });

  it('treats negative committed as zero (defensive)', () => {
    expect(getEffectiveStock(10, -5)).toBe(10);
  });
});

describe('hasStockShortfall', () => {
  it('flags true when stock is already negative', () => {
    expect(hasStockShortfall(-1, 0)).toBe(true);
    expect(hasStockShortfall(-1, 5)).toBe(true);
  });

  it('flags true when pending orders exceed available positive stock', () => {
    expect(hasStockShortfall(5, 10)).toBe(true);
  });

  it('flags false when stock covers pending orders', () => {
    expect(hasStockShortfall(10, 5)).toBe(false);
    expect(hasStockShortfall(10, 10)).toBe(false);
  });

  it('flags false when no committed and positive stock', () => {
    expect(hasStockShortfall(10, 0)).toBe(false);
    expect(hasStockShortfall(0, 0)).toBe(false);
  });
});
