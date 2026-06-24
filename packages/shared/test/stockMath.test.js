import { describe, it, expect } from 'vitest';
import { getEffectiveStock, hasStockShortfall, getVarietyTotals, getVarietyAvailability, arrivalsForVariety, allocateLinesAgainstVariety } from '../utils/stockMath.js';

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

describe('getVarietyTotals — Variety bucket aggregation per ADR-0005', () => {
  it('separates onHand (Batches) from planned (Demand Entries)', () => {
    const rows = [
      { id: 'b1', current_quantity: 10, date: '2026-05-10' },
      { id: 'b2', current_quantity: -3, date: '2026-05-12' },
      { id: 'b3', current_quantity:  5, date: '2026-05-11' },
    ];
    expect(getVarietyTotals(rows, new Map())).toEqual({
      onHand: 15, planned: 3, reservedForPremades: 0, net: 12, reclaimable: 0,
    });
  });

  it('subtracts reservedForPremades from onHand-side; net adjusts', () => {
    const rows = [{ id: 'b1', current_quantity: 10, date: '2026-05-10' }];
    const reservations = new Map([['b1', 4]]);
    expect(getVarietyTotals(rows, reservations))
      .toEqual({ onHand: 10, planned: 0, reservedForPremades: 4, net: 6, reclaimable: 4 });
  });

  it('regression — pitfall #8 v1: NEVER computes qty - committed (double-count)', () => {
    const rows = [{ id: 'b1', current_quantity: 10, date: '2026-05-10' }];
    const polluted = rows.map(r => ({ ...r, committed: 5 }));
    expect(getVarietyTotals(polluted, new Map()).onHand).toBe(10);
    expect(getVarietyTotals(polluted, new Map()).net).toBe(10);
  });

  it('regression — pitfall #8 v2: cumulative shortfall stays negative under net', () => {
    const rows = [
      { id: 'd1', current_quantity: -5, date: '2026-05-10' },
      { id: 'd2', current_quantity: -3, date: '2026-05-12' },
    ];
    expect(getVarietyTotals(rows, new Map()))
      .toEqual({ onHand: 0, planned: 8, reservedForPremades: 0, net: -8, reclaimable: 0 });
  });

  it('reclaimable = min(reservedForPremades, planned shortfall) — 0 when no shortfall', () => {
    const rows = [{ id: 'b1', current_quantity: 10, date: '2026-05-10' }];
    const reservations = new Map([['b1', 4]]);
    expect(getVarietyTotals(rows, reservations).reclaimable).toBe(4);
  });

  it('reclaimable when both onHand and planned exist', () => {
    // onHand=10, planned=15, reservedForPremades=6
    // net = onHand - planned - reservedForPremades = 10 - 15 - 6 = -11
    // reclaimable = min(reservedForPremades, max(0, planned - onHand)) = min(6, 5) = 5
    // NOTE: original test spec had net:-5 which contradicts the formula proven by Test 2.
    // Corrected to net:-11 per plan reconciliation (2026-05-10).
    const rows = [
      { id: 'b1', current_quantity:  10, date: '2026-05-10' },
      { id: 'd1', current_quantity: -15, date: '2026-05-12' },
    ];
    const reservations = new Map([['b1', 6]]);
    expect(getVarietyTotals(rows, reservations))
      .toEqual({ onHand: 10, planned: 15, reservedForPremades: 6, net: -11, reclaimable: 5 });
  });

  it('handles empty rows array', () => {
    expect(getVarietyTotals([], new Map()))
      .toEqual({ onHand: 0, planned: 0, reservedForPremades: 0, net: 0, reclaimable: 0 });
  });
});

describe('getVarietyAvailability — S1.1 available bucket', () => {
  it('getVarietyAvailability exposes available = net + reserved', () => {
    const rows = [{ id: 'b', current_quantity: 28 }];
    const reservations = new Map([['b', 6]]);
    const a = getVarietyAvailability(rows, reservations, []);
    expect(a.net).toBe(22);        // grabbable now (onHand 28 − reserved 6)
    expect(a.reserved).toBe(6);
    expect(a.available).toBe(28);  // net + reserved (reclaimable premade)
  });
});

describe('arrivalsForVariety — S1.2 overdue tagging', () => {
  it('arrivalsForVariety tags overdue when planned date is in the past', () => {
    const rows = [{ id: 's' }];
    const pendingPO = { s: { pos: [{ quantity: 20, plannedDate: '2026-06-16' }] } };
    const [arr] = arrivalsForVariety(rows, pendingPO, '2026-06-21');
    expect(arr).toMatchObject({ qty: 20, date: '2026-06-16', overdue: true });
  });

  it('arrivalsForVariety tags overdue:false for future dates', () => {
    const rows = [{ id: 's' }];
    const pendingPO = { s: { pos: [{ quantity: 10, plannedDate: '2026-07-01' }] } };
    const [arr] = arrivalsForVariety(rows, pendingPO, '2026-06-21');
    expect(arr).toMatchObject({ qty: 10, date: '2026-07-01', overdue: false });
  });

  it('arrivalsForVariety without todayIso keeps overdue:false (existing callers)', () => {
    const rows = [{ id: 's' }];
    const pendingPO = { s: { pos: [{ quantity: 5, plannedDate: '2026-01-01' }] } };
    const [arr] = arrivalsForVariety(rows, pendingPO);
    expect(arr.overdue).toBe(false);
  });

  it('getVarietyAvailability preserves overdue flag through arrivals map', () => {
    const rows = [{ id: 's', current_quantity: -7 }];
    const pendingPO = { s: { pos: [{ quantity: 7, plannedDate: '2026-06-16' }] } };
    const rawArrivals = arrivalsForVariety(rows, pendingPO, '2026-06-21');
    const a = getVarietyAvailability(rows, new Map(), rawArrivals);
    expect(a.arrivals[0].overdue).toBe(true);
  });
});

describe('allocateLinesAgainstVariety — sibling netting', () => {
  // The exact reported bug: Anemone Burgundy, 7 on hand, two lines [7, 10].
  // Earlier line claims the 7 → line 2 sees 0 left → shows 10 short, not 3.
  it('nets the on-hand across same-Variety sibling lines (7 → [7,10])', () => {
    const variety = { net: 7 }; // one shared avail object, as the UI maps it
    const lines = [{ stockItemId: 'a', quantity: 7 }, { stockItemId: 'b', quantity: 10 }];
    const nets = allocateLinesAgainstVariety(lines, () => ({ key: variety, net: 7 }));
    expect(nets).toEqual([7, 0]);
    // shortfall the badge shows = qty - remaining
    const shortfalls = lines.map((l, i) => Math.max(0, l.quantity - nets[i]));
    expect(shortfalls).toEqual([0, 10]);
    // invariant: total short === totalRequested - onHand
    expect(shortfalls.reduce((s, x) => s + x, 0)).toBe(17 - 7);
  });

  it('three lines drain progressively ([5,5,5] vs net 12)', () => {
    const v = { net: 12 };
    const lines = [{ quantity: 5 }, { quantity: 5 }, { quantity: 5 }];
    const nets = allocateLinesAgainstVariety(lines, () => ({ key: v, net: 12 }));
    expect(nets).toEqual([12, 7, 2]);
    const short = lines.map((l, i) => Math.max(0, l.quantity - nets[i]));
    expect(short).toEqual([0, 0, 3]); // total 3 = 15 - 12
  });

  it('different varieties do not cross-consume', () => {
    const a = { net: 5 }, b = { net: 4 };
    const lines = [{ quantity: 5 }, { quantity: 4 }, { quantity: 3 }];
    const nets = allocateLinesAgainstVariety(lines, (l, i) =>
      i < 2 ? { key: a, net: 5 } : { key: b, net: 4 });
    // line0 drains a; line1 a is gone → 0; line2 is variety b, full 4 available
    expect(nets).toEqual([5, 0, 4]);
  });

  it('skips lines whose resolve returns null (deferred — no consumption)', () => {
    const v = { net: 7 };
    const lines = [{ quantity: 7, deferred: true }, { quantity: 10 }];
    const nets = allocateLinesAgainstVariety(lines, (l) =>
      l.deferred ? null : { key: v, net: 7 });
    // deferred line consumes nothing → line 2 still sees the full 7
    expect(nets[1]).toBe(7);
  });

  it('order matters — first line gets the stock', () => {
    const v = { net: 6 };
    const a = allocateLinesAgainstVariety([{ quantity: 6 }, { quantity: 2 }], () => ({ key: v, net: 6 }));
    const b = allocateLinesAgainstVariety([{ quantity: 2 }, { quantity: 6 }], () => ({ key: v, net: 6 }));
    expect(a).toEqual([6, 0]);
    expect(b).toEqual([6, 4]);
  });

  it('legacy fallback nets against single-item qty by stockItemId key', () => {
    const lines = [{ stockItemId: 's1', quantity: 4 }, { stockItemId: 's1', quantity: 5 }];
    const nets = allocateLinesAgainstVariety(lines, (l) => ({ key: l.stockItemId, net: 6 }));
    expect(nets).toEqual([6, 2]); // 6 - 4 = 2 left for line 2 → shows 3 short
  });
});
