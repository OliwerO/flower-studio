import { describe, it, expect } from 'vitest';
import { findDuplicateStockItem } from '../hooks/useOrderEditing.js';

describe('findDuplicateStockItem', () => {
  const stock = [
    { id: 'rec1', 'Display Name': 'Antirrhinum Yellow' },
    { id: 'rec2', 'Display Name': 'Hydrangea Pink' },
    { id: 'rec3', 'Display Name': '  Peony Coral  ' },
  ];

  it('finds an exact case-insensitive match', () => {
    expect(findDuplicateStockItem(stock, 'antirrhinum yellow')?.id).toBe('rec1');
    expect(findDuplicateStockItem(stock, 'HYDRANGEA PINK')?.id).toBe('rec2');
  });

  it('trims surrounding whitespace on both sides', () => {
    expect(findDuplicateStockItem(stock, '  Antirrhinum Yellow  ')?.id).toBe('rec1');
    expect(findDuplicateStockItem(stock, 'Peony Coral')?.id).toBe('rec3');
  });

  it('returns null when nothing matches', () => {
    expect(findDuplicateStockItem(stock, 'Tulip')).toBeNull();
    expect(findDuplicateStockItem(stock, 'Antirrhinum White')).toBeNull();
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(findDuplicateStockItem(stock, '')).toBeNull();
    expect(findDuplicateStockItem(stock, '   ')).toBeNull();
    expect(findDuplicateStockItem(stock, null)).toBeNull();
    expect(findDuplicateStockItem(stock, undefined)).toBeNull();
  });

  it('handles items missing a Display Name without throwing', () => {
    const messy = [{ id: 'rec1' }, { id: 'rec2', 'Display Name': 'Rose' }];
    expect(findDuplicateStockItem(messy, 'Rose')?.id).toBe('rec2');
    expect(findDuplicateStockItem(messy, 'Anything')).toBeNull();
  });
});
