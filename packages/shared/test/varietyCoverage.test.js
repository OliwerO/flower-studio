import { describe, it, expect } from 'vitest';
import { allocateVarietyCoverage } from '../utils/stockMath.js';

// Date-aware coverage for one Variety (CR-39, decision: a LATE arrival signals
// an incoming PO but does NOT cover the dated demand). On-hand is available any
// time; an arrival covers a demand only when arrival.date <= demand.date.
// Earliest demand consumes the shared on-hand + arrival pools first.

const batch = (id, qty, date) => ({ id, current_quantity: qty, date });
const demand = (id, qty, date) => ({ id, current_quantity: -qty, date });

describe('allocateVarietyCoverage', () => {
  it('an in-time arrival fully covers the demand (no shortfall, not late)', () => {
    const { demands } = allocateVarietyCoverage(
      [demand('d', 12, '2026-06-18')], new Map(), [{ date: '2026-06-16', qty: 20 }],
    );
    expect(demands[0]).toMatchObject({ date: '2026-06-18', demandQty: 12, shortQty: 0, latePoQty: 0 });
  });

  it('a LATE arrival does NOT cover the demand, but is signalled via latePoQty', () => {
    const { demands } = allocateVarietyCoverage(
      [demand('d', 7, '2026-06-15')], new Map(), [{ date: '2026-06-16', qty: 7 }],
    );
    expect(demands[0]).toMatchObject({ demandQty: 7, shortQty: 7, latePoQty: 7 });
  });

  it('no PO → full shortfall, nothing late', () => {
    const { demands } = allocateVarietyCoverage(
      [demand('d', 5, '2026-06-20')], new Map(), [],
    );
    expect(demands[0]).toMatchObject({ shortQty: 5, latePoQty: 0 });
  });

  it('on-hand stock covers the demand (available any date)', () => {
    const { demands } = allocateVarietyCoverage(
      [batch('b', 10, '2026-06-10'), demand('d', 7, '2026-06-15')], new Map(), [],
    );
    expect(demands[0].shortQty).toBe(0);
  });

  it('reservations reduce the on-hand available to demands', () => {
    const { demands } = allocateVarietyCoverage(
      [batch('b', 10, '2026-06-10'), demand('d', 7, '2026-06-15')],
      new Map([['b', 6]]), [], // 10 on hand − 6 reserved = 4 free → 3 short
    );
    expect(demands[0].shortQty).toBe(3);
  });

  it('earliest demand consumes the shared on-hand pool first (FEFO by needed date)', () => {
    const { demands } = allocateVarietyCoverage(
      [batch('b', 10, '2026-06-10'), demand('d1', 6, '2026-06-13'), demand('d2', 6, '2026-06-17')],
      new Map(), [],
    );
    const byDate = Object.fromEntries(demands.map(d => [d.date, d.shortQty]));
    expect(byDate['2026-06-13']).toBe(0); // takes 6 of 10
    expect(byDate['2026-06-17']).toBe(2); // takes remaining 4 → 2 short
  });

  it('an arrival is in-time only for demands needed on/after its date', () => {
    const { demands } = allocateVarietyCoverage(
      [demand('d1', 5, '2026-06-15'), demand('d2', 5, '2026-06-18')],
      new Map(), [{ date: '2026-06-16', qty: 6 }],
    );
    const byDate = Object.fromEntries(demands.map(d => [d.date, d]));
    // 06-15: arrival on 16 is late → short 5, signalled late
    expect(byDate['2026-06-15']).toMatchObject({ shortQty: 5, latePoQty: 6 });
    // 06-18: arrival on 16 is in time → covers 5
    expect(byDate['2026-06-18'].shortQty).toBe(0);
  });
});
