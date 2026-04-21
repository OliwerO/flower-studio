import { describe, it, expect } from 'vitest';
import {
  groupByProduct,
  parseCats,
  activeCount,
  allActive,
  anyActive,
  priceRange,
  groupCategories,
} from '../utils/productGroup.js';

function row(overrides = {}) {
  return {
    id: 'rec1',
    'Wix Product ID': 'prod1',
    'Product Name': 'Rose Bouquet',
    'Image URL': 'https://example.com/a.jpg',
    'Active': true,
    'Price': 100,
    'Category': 'permanent',
    ...overrides,
  };
}

describe('groupByProduct', () => {
  it('groups multiple variants under one product', () => {
    const rows = [
      row({ id: 'rec1', 'Wix Variant ID': 'v1' }),
      row({ id: 'rec2', 'Wix Variant ID': 'v2', 'Price': 200 }),
    ];
    const groups = groupByProduct(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].wixProductId).toBe('prod1');
    expect(groups[0].variants).toHaveLength(2);
  });

  it('falls back to row id when Wix Product ID missing', () => {
    const groups = groupByProduct([{ id: 'rec1', 'Product Name': 'X' }]);
    expect(groups[0].wixProductId).toBe('rec1');
  });

  it('sets Unknown for missing name', () => {
    const groups = groupByProduct([{ id: 'rec1' }]);
    expect(groups[0].name).toBe('Unknown');
  });

  it('returns empty array for empty input', () => {
    expect(groupByProduct([])).toEqual([]);
  });
});

describe('parseCats', () => {
  it('returns array input unchanged', () => {
    expect(parseCats(['a', 'b'])).toEqual(['a', 'b']);
  });
  it('splits CSV strings', () => {
    expect(parseCats('a, b ,c')).toEqual(['a', 'b', 'c']);
  });
  it('drops empty entries', () => {
    expect(parseCats('a,,b')).toEqual(['a', 'b']);
  });
  it('handles falsy input', () => {
    expect(parseCats(null)).toEqual([]);
    expect(parseCats('')).toEqual([]);
    expect(parseCats(undefined)).toEqual([]);
  });
});

describe('activeCount / allActive / anyActive', () => {
  const group = {
    variants: [
      { 'Active': true },
      { 'Active': false },
      { 'Active': true },
    ],
  };

  it('counts active variants', () => {
    expect(activeCount(group)).toBe(2);
  });
  it('allActive is false when one is inactive', () => {
    expect(allActive(group)).toBe(false);
  });
  it('allActive is true when all active', () => {
    expect(allActive({ variants: [{ 'Active': true }, { 'Active': true }] })).toBe(true);
  });
  it('allActive is false for empty variants (no claim)', () => {
    expect(allActive({ variants: [] })).toBe(false);
  });
  it('anyActive is true when at least one active', () => {
    expect(anyActive(group)).toBe(true);
  });
  it('anyActive is false when all inactive', () => {
    expect(anyActive({ variants: [{ 'Active': false }] })).toBe(false);
  });
});

describe('priceRange', () => {
  it('returns [min, max] across variants', () => {
    const group = { variants: [{ 'Price': 100 }, { 'Price': 50 }, { 'Price': 200 }] };
    expect(priceRange(group)).toEqual([50, 200]);
  });
  it('ignores non-finite and zero prices', () => {
    const group = { variants: [{ 'Price': 0 }, { 'Price': 'abc' }, { 'Price': 100 }] };
    expect(priceRange(group)).toEqual([100, 100]);
  });
  it('returns null when no valid prices', () => {
    const group = { variants: [{ 'Price': 0 }] };
    expect(priceRange(group)).toBeNull();
  });
});

describe('groupCategories', () => {
  it('merges + dedupes across variants', () => {
    const group = {
      variants: [
        { 'Category': 'permanent, wedding' },
        { 'Category': ['seasonal', 'wedding'] },
      ],
    };
    const cats = groupCategories(group);
    expect(cats.sort()).toEqual(['permanent', 'seasonal', 'wedding']);
  });
});
