import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { makeStockItem } from './stockItem.js';

describe('makeStockItem', () => {
  beforeEach(() => faker.seed(42));

  it('produces a Batch (with date suffix) by default', () => {
    const s = makeStockItem();
    expect(s.display_name).toMatch(/\(\d{2}\.[A-Z][a-z]{2}\.\)$/);  // "(06.May.)"
    expect(s.current_quantity).toBeGreaterThanOrEqual(0);
  });

  it('produces a Demand Entry when type=demand', () => {
    const s = makeStockItem({ type: 'demand', display_name: 'Pink Peonies' });
    expect(s.display_name).toBe('Pink Peonies');
    expect(s.current_quantity).toBeLessThan(0);  // demand = negative qty
  });

  it('honours qty + cost overrides', () => {
    const s = makeStockItem({ current_quantity: 25, current_cost_price: 12.5, current_sell_price: 30 });
    expect(s.current_quantity).toBe(25);
    expect(s.current_cost_price).toBe(12.5);
    expect(s.current_sell_price).toBe(30);
  });

  it('does not leak factory-only keys (type, variety, arrivalDate)', () => {
    const s = makeStockItem({ type: 'demand', variety: 'Roses', arrivalDate: new Date() });
    expect(s).not.toHaveProperty('type');
    expect(s).not.toHaveProperty('variety');
    expect(s).not.toHaveProperty('arrivalDate');
  });

  it('is deterministic under the same faker seed', () => {
    faker.seed(42);
    const a = makeStockItem();
    faker.seed(42);
    const b = makeStockItem();
    expect(a).toEqual(b);
  });
});
