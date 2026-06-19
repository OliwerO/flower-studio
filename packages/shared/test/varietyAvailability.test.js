import { describe, it, expect } from 'vitest';
import { getVarietyAvailability, arrivalsForVariety } from '../utils/stockMath.js';

// S3.2-i — the single labelled availability model for the bouquet picker
// (CR-23/28). One Variety in → all buckets out, each named. effective = net +
// incoming; the picker hides effective <= 0 by default (D3).
describe('getVarietyAvailability', () => {
  it('healthy batch: onHand == net == effective, no committed/reserved/incoming', () => {
    const a = getVarietyAvailability([{ id: 'a', current_quantity: 30 }]);
    expect(a).toMatchObject({
      onHand: 30, committed: 0, reserved: 0, incoming: 0, net: 30, effective: 30,
    });
    expect(a.arrivals).toEqual([]);
  });

  it('committed demand subtracts from net (batch + negative demand entry)', () => {
    const a = getVarietyAvailability([
      { id: 'a', current_quantity: 30 },
      { id: 'b', current_quantity: -8 },
    ]);
    expect(a.onHand).toBe(30);
    expect(a.committed).toBe(8);
    expect(a.net).toBe(22);
    expect(a.effective).toBe(22);
  });

  it('premade reservations subtract from net', () => {
    const a = getVarietyAvailability(
      [{ id: 'a', current_quantity: 30 }, { id: 'b', current_quantity: -8 }],
      new Map([['a', 3]]),
    );
    expect(a.reserved).toBe(3);
    expect(a.net).toBe(19); // 30 - 8 - 3
  });

  it('incoming PO arrivals add to effective but NOT to net', () => {
    const a = getVarietyAvailability(
      [{ id: 'a', current_quantity: 30 }, { id: 'b', current_quantity: -8 }],
      new Map([['a', 3]]),
      [{ date: '2026-06-16', qty: 8 }],
    );
    expect(a.net).toBe(19);
    expect(a.incoming).toBe(8);
    expect(a.effective).toBe(27); // net 19 + incoming 8
  });

  it('Peony net-zero case: -7 committed + 7 incoming → effective 0 (hide target)', () => {
    const a = getVarietyAvailability(
      [{ id: 'p', current_quantity: -7 }],
      new Map(),
      [{ date: '2026-06-16', qty: 7 }],
    );
    expect(a.onHand).toBe(0);
    expect(a.committed).toBe(7);
    expect(a.net).toBe(-7);
    expect(a.incoming).toBe(7);
    expect(a.effective).toBe(0);
  });

  it('sorts arrivals oldest-first and drops non-positive qty', () => {
    const a = getVarietyAvailability(
      [{ id: 'a', current_quantity: 0 }],
      new Map(),
      [{ date: '2026-06-20', qty: 5 }, { date: '2026-06-16', qty: 3 }, { date: '2026-06-18', qty: 0 }],
    );
    expect(a.incoming).toBe(8);
    expect(a.arrivals).toEqual([
      { date: '2026-06-16', qty: 3 },
      { date: '2026-06-20', qty: 5 },
    ]);
  });
});

describe('arrivalsForVariety', () => {
  it('flattens pending-PO pos rows into [{date, qty}]', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    const pendingPO = {
      a: { ordered: 8, plannedDate: '2026-06-16', pos: [{ quantity: 8, plannedDate: '2026-06-16' }] },
    };
    expect(arrivalsForVariety(rows, pendingPO)).toEqual([{ date: '2026-06-16', qty: 8 }]);
  });

  it('falls back to info.plannedDate when a pos line has no plannedDate', () => {
    const rows = [{ id: 'a' }];
    const pendingPO = { a: { plannedDate: '2026-06-16', pos: [{ quantity: 5 }] } };
    expect(arrivalsForVariety(rows, pendingPO)).toEqual([{ date: '2026-06-16', qty: 5 }]);
  });

  it('skips rows with no pending PO and pos lines with qty <= 0', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    const pendingPO = { b: { plannedDate: '2026-06-16', pos: [{ quantity: 0, plannedDate: '2026-06-16' }] } };
    expect(arrivalsForVariety(rows, pendingPO)).toEqual([]);
  });

  it('returns [] for empty/absent pendingPO', () => {
    expect(arrivalsForVariety([{ id: 'a' }], {})).toEqual([]);
    expect(arrivalsForVariety([{ id: 'a' }], undefined)).toEqual([]);
  });
});
