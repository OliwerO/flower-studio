import { describe, it, expect } from 'vitest';
import { findDuplicateStockItem, isStockItemVisible } from '../hooks/useOrderEditing.js';

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

describe('isStockItemVisible', () => {
  it('hides a depleted dated Batch with no pending PO', () => {
    const item = { id: 'rec1', 'Display Name': 'Rose (06.May.)', 'Current Quantity': 0 };
    expect(isStockItemVisible(item, {})).toBe(false);
  });

  it('shows a depleted dated Batch that has pending PO demand', () => {
    const item = { id: 'rec1', 'Display Name': 'Rose (06.May.)', 'Current Quantity': 0 };
    expect(isStockItemVisible(item, { rec1: { ordered: 5 } })).toBe(true);
  });

  it('shows a dated Batch with positive qty regardless of pending PO', () => {
    const item = { id: 'rec2', 'Display Name': 'Rose (06.May.)', 'Current Quantity': 6 };
    expect(isStockItemVisible(item, {})).toBe(true);
  });

  it('shows an undated Demand Entry regardless of negative qty', () => {
    const item = { id: 'rec3', 'Display Name': 'Rose', 'Current Quantity': -5 };
    expect(isStockItemVisible(item, {})).toBe(true);
  });

  it('shows a non-dated zero-qty item (pending demand)', () => {
    const item = { id: 'rec4', 'Display Name': 'Lavender', 'Current Quantity': 0 };
    expect(isStockItemVisible(item, {})).toBe(true);
  });

  it('defaults pendingPO to empty object when omitted', () => {
    const item = { id: 'rec5', 'Display Name': 'Tulip (10.Apr.)', 'Current Quantity': 0 };
    expect(isStockItemVisible(item)).toBe(false);
  });
});
