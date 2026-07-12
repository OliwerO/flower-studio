import { describe, it, expect } from 'vitest';
import { findAllMatchingVariety } from '../utils/varietyLookup.js';

// findAllMatchingVariety used to live inline in useOrderEditing.js; it moved to
// its own util (packages/shared/utils/varietyLookup.js) so createBouquetDemand
// (a plain util) can depend on it without a hook↔util circular import. The
// hook re-exports it from '../hooks/useOrderEditing.js' for back-compat —
// see useOrderEditing.test.js for the equivalent coverage via that path.
describe('findAllMatchingVariety', () => {
  const stock = [
    { id: 'rec1', 'Display Name': 'Pink Peonies (06.May.)' },
    { id: 'rec2', 'Display Name': 'Pink Peonies (15.Apr.)' },
    { id: 'rec3', 'Display Name': 'Pink Peonies' },
    { id: 'rec4', 'Display Name': 'Rose' },
    { id: 'rec5', 'Display Name': 'Rose (01.May.)' },
  ];

  it('returns Batches and Demand Entry for matching variety', () => {
    const result = findAllMatchingVariety(stock, 'Pink Peonies');
    expect(result.map(s => s.id)).toEqual(['rec1', 'rec2', 'rec3']);
  });

  it('is case-insensitive', () => {
    expect(findAllMatchingVariety(stock, 'pink peonies')).toHaveLength(3);
    expect(findAllMatchingVariety(stock, 'ROSE')).toHaveLength(2);
  });

  it('returns empty array for unknown variety', () => {
    expect(findAllMatchingVariety(stock, 'Tulip')).toEqual([]);
  });

  it('returns empty array for empty or null input', () => {
    expect(findAllMatchingVariety(stock, '')).toEqual([]);
    expect(findAllMatchingVariety(stock, null)).toEqual([]);
  });

  it('handles items with no Display Name', () => {
    const messy = [{ id: 'x1' }, { id: 'x2', 'Display Name': 'Rose' }];
    expect(findAllMatchingVariety(messy, 'Rose').map(s => s.id)).toEqual(['x2']);
  });
});
