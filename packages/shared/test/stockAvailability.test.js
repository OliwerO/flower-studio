import { describe, it, expect } from 'vitest';
import { isStockItemAvailable, hasAvailableStockMatch } from '../utils/stockAvailability.js';

describe('isStockItemAvailable', () => {
  it('is available when Current Quantity > 0', () => {
    expect(isStockItemAvailable({ id: 's1', 'Current Quantity': 5 })).toBe(true);
  });

  it('is available when a pending PO covers it, even at qty 0', () => {
    expect(isStockItemAvailable({ id: 's1', 'Current Quantity': 0 }, { s1: { ordered: 3 } })).toBe(true);
  });

  it('is not available at qty 0 with no pending PO', () => {
    expect(isStockItemAvailable({ id: 's1', 'Current Quantity': 0 }, {})).toBe(false);
  });

  it('is not available at negative qty with no pending PO (genuine shortfall)', () => {
    expect(isStockItemAvailable({ id: 's1', 'Current Quantity': -2 }, {})).toBe(false);
  });

  it('handles a missing stock item', () => {
    expect(isStockItemAvailable(null)).toBe(false);
  });
});

describe('hasAvailableStockMatch', () => {
  const stockItems = [
    { id: 'rose', 'Display Name': 'Rose', 'Current Quantity': 5 },
    { id: 'tulip', 'Display Name': 'Tulip', 'Current Quantity': 0 },
    { id: 'peony', 'Display Name': 'Peony', 'Current Quantity': -3 },
  ];

  it('suppresses (true) when an in-stock exact match exists', () => {
    expect(hasAvailableStockMatch(stockItems, 'Rose')).toBe(true);
  });

  it('suppresses (true) when the exact match is out of stock but on a pending PO', () => {
    expect(hasAvailableStockMatch(stockItems, 'Tulip', { tulip: { ordered: 10 } })).toBe(true);
  });

  it('does not suppress (false) when the exact match is out of stock with no pending PO', () => {
    expect(hasAvailableStockMatch(stockItems, 'Tulip', {})).toBe(false);
  });

  it('does not suppress (false) when the exact match is negative stock with no pending PO', () => {
    expect(hasAvailableStockMatch(stockItems, 'Peony')).toBe(false);
  });

  it('does not suppress (false) when there is no matching name at all', () => {
    expect(hasAvailableStockMatch(stockItems, 'Lily')).toBe(false);
  });

  it('matches case-insensitively', () => {
    expect(hasAvailableStockMatch(stockItems, 'rOsE')).toBe(true);
  });

  it('does not suppress on a blank query', () => {
    expect(hasAvailableStockMatch(stockItems, '')).toBe(false);
    expect(hasAvailableStockMatch(stockItems, undefined)).toBe(false);
  });
});
