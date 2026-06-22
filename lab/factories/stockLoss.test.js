// lab/factories/stockLoss.test.js
//
// TDD coverage for makeStockLoss factory.
// Tests were written BEFORE the factory implementation (red phase).

import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { makeStockLoss, LOSS_REASON } from './stockLoss.js';

describe('makeStockLoss', () => {
  beforeEach(() => faker.seed(42));

  it('returns a uuid id', () => {
    const r = makeStockLoss({ date: '2026-06-12' });
    expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('has required NOT-NULL columns present and non-null', () => {
    const r = makeStockLoss({ date: '2026-06-12' });
    expect(r.date).toBeTruthy();
    expect(r.quantity).not.toBeNull();
    expect(r.quantity).not.toBeUndefined();
    expect(r.reason).toBeTruthy();
    expect(r.notes).not.toBeUndefined();
  });

  it('defaults reason to Wilted (a valid LOSS_REASON)', () => {
    const r = makeStockLoss({ date: '2026-06-12' });
    expect(LOSS_REASON).toContain(r.reason);
    expect(r.reason).toBe('Wilted');
  });

  it('honours explicit reason when it is a valid LOSS_REASON', () => {
    for (const reason of LOSS_REASON) {
      const r = makeStockLoss({ date: '2026-06-12', reason });
      expect(r.reason).toBe(reason);
    }
  });

  it('stockId shorthand maps to stock_id and is not leaked', () => {
    const id = faker.string.uuid();
    const r = makeStockLoss({ date: '2026-06-12', stockId: id });
    expect(r.stock_id).toBe(id);
    expect(r.stockId).toBeUndefined();
  });

  it('stock_id defaults to null', () => {
    const r = makeStockLoss({ date: '2026-06-12' });
    expect(r.stock_id).toBeNull();
  });

  it('deleted_at defaults to null', () => {
    const r = makeStockLoss({ date: '2026-06-12' });
    expect(r.deleted_at).toBeNull();
  });

  it('airtable_id defaults to null', () => {
    const r = makeStockLoss({ date: '2026-06-12' });
    expect(r.airtable_id).toBeNull();
  });

  it('created_at is a Date', () => {
    const r = makeStockLoss({ date: '2026-06-12' });
    expect(r.created_at).toBeInstanceOf(Date);
  });

  it('honours explicit quantity', () => {
    const r = makeStockLoss({ date: '2026-06-12', quantity: 7 });
    expect(r.quantity).toBe(7);
  });

  it('is deterministic under the same faker seed', () => {
    faker.seed(42);
    const a = makeStockLoss({ date: '2026-06-12' });
    faker.seed(42);
    const b = makeStockLoss({ date: '2026-06-12' });
    // Compare only faker-derived fields — created_at uses wall clock.
    expect(a.id).toEqual(b.id);
  });
});

describe('LOSS_REASON export', () => {
  it('contains the five canonical values', () => {
    expect(LOSS_REASON).toContain('Wilted');
    expect(LOSS_REASON).toContain('Damaged');
    expect(LOSS_REASON).toContain('Arrived Broken');
    expect(LOSS_REASON).toContain('Overstock');
    expect(LOSS_REASON).toContain('Other');
  });
});
