import { describe, it, expect } from 'vitest';
import { stockAllocationEngine } from '../utils/stockAllocationEngine.js';

// ─── Fixture helpers ────────────────────────────────────────────────────────
// Batch row: isDemandEntry=false, currentQuantity positive (physical stems)
function batch(id, currentQuantity, date) {
  return { id, currentQuantity, date, isDemandEntry: false };
}
// Demand Entry row: isDemandEntry=true, currentQuantity negative (committed future demand)
function demandEntry(id, currentQuantity, date) {
  return { id, currentQuantity, date, isDemandEntry: true };
}

// ─── Fixture 7: Mixed Batch + Demand + Reservation rows ──────────────────────
describe('stockAllocationEngine — fixture 7: mixed rows with reservations', () => {
  // Two batches: b1 has 15 stems, 5 reserved for premades → freeQty 10 (sufficient for qty=8)
  //              b2 has 20 stems, 0 reserved → freeQty 20 (also sufficient)
  // One same-date demand entry (priority over batches per smart-default rule 1)
  // One past-date demand entry
  const requiredBy = '2026-05-20';
  const rows = [
    batch('b1', 15, '2026-05-05'),  // older batch (FIFO would pick this first)
    batch('b2', 20, '2026-05-08'),  // newer batch
    demandEntry('d_same', -4, '2026-05-20'), // same-date → smart-default
    demandEntry('d_past', -2, '2026-05-12'), // past-date
  ];
  const reservations = new Map([['b1', 5]]); // 5 reserved for premades on b1

  it('all option kinds present', () => {
    const options = stockAllocationEngine(rows, reservations, requiredBy, 8);
    const kinds = new Set(options.map((o) => o.kind));
    expect(kinds.has('batch')).toBe(true);
    expect(kinds.has('merge')).toBe(true);
    expect(kinds.has('fresh')).toBe(true);
  });

  it('b1 freeQty accounts for reservations (15 - 5 = 10)', () => {
    const options = stockAllocationEngine(rows, reservations, requiredBy, 8);
    const b1 = options.find((o) => o.kind === 'batch' && o.stockId === 'b1');
    expect(b1.freeQty).toBe(10);
    expect(b1.reservedQty).toBe(5);
    expect(b1.total).toBe(15);
    expect(b1.sufficient).toBe(true); // 10 >= 8
  });

  it('b2 freeQty is unaffected by reservations (20 - 0 = 20)', () => {
    const options = stockAllocationEngine(rows, reservations, requiredBy, 8);
    const b2 = options.find((o) => o.kind === 'batch' && o.stockId === 'b2');
    expect(b2.freeQty).toBe(20);
    expect(b2.reservedQty).toBe(0);
    expect(b2.sufficient).toBe(true);
  });

  it('smart-default: same-date merge wins over sufficient batch (rule 1 > rule 2)', () => {
    const options = stockAllocationEngine(rows, reservations, requiredBy, 8);
    const def = options.find((o) => o.isDefault);
    expect(def.kind).toBe('merge');
    expect(def.stockId).toBe('d_same');
  });

  it('past-date demand entry is flagged isPastDate: true', () => {
    const options = stockAllocationEngine(rows, reservations, requiredBy, 8);
    const past = options.find((o) => o.kind === 'merge' && o.stockId === 'd_past');
    expect(past.isPastDate).toBe(true);
  });

  it('same-date demand entry is NOT flagged isPastDate', () => {
    const options = stockAllocationEngine(rows, reservations, requiredBy, 8);
    const same = options.find((o) => o.kind === 'merge' && o.stockId === 'd_same');
    expect(same.isPastDate).toBe(false);
  });

  it('output order: batches first, then merges, then fresh', () => {
    const options = stockAllocationEngine(rows, reservations, requiredBy, 8);
    const batchEnd = Math.max(...options.map((o, i) => (o.kind === 'batch' ? i : -1)));
    const mergeStart = options.findIndex((o) => o.kind === 'merge');
    const freshIdx = options.findIndex((o) => o.kind === 'fresh');
    expect(batchEnd).toBeLessThan(mergeStart);
    expect(mergeStart).toBeLessThan(freshIdx);
  });

  it('batches ranked FIFO (oldest first)', () => {
    const options = stockAllocationEngine(rows, reservations, requiredBy, 8);
    const batches = options.filter((o) => o.kind === 'batch');
    expect(batches[0].stockId).toBe('b1');
    expect(batches[1].stockId).toBe('b2');
  });

  it('exactly one option is the default', () => {
    const options = stockAllocationEngine(rows, reservations, requiredBy, 8);
    expect(options.filter((o) => o.isDefault)).toHaveLength(1);
  });
});

// ─── Fixture 6: Past-date Demand Entries ─────────────────────────────────────
describe('stockAllocationEngine — fixture 6: past-date demand entries', () => {
  const requiredBy = '2026-05-20';
  const rows = [
    demandEntry('d_old', -3, '2026-05-10'), // earlier than requiredBy → past
    demandEntry('d_future', -2, '2026-05-25'), // later than requiredBy
  ];

  it('past-date merge is flagged with isPastDate: true', () => {
    const options = stockAllocationEngine(rows, new Map(), requiredBy, 5);
    const old = options.find((o) => o.kind === 'merge' && o.stockId === 'd_old');
    expect(old.isPastDate).toBe(true);
  });

  it('future-date merge is NOT flagged with isPastDate', () => {
    const options = stockAllocationEngine(rows, new Map(), requiredBy, 5);
    const future = options.find((o) => o.kind === 'merge' && o.stockId === 'd_future');
    expect(future.isPastDate).toBe(false);
  });

  it('smart-default: past-date merge is never the default', () => {
    const options = stockAllocationEngine(rows, new Map(), requiredBy, 5);
    const def = options.find((o) => o.isDefault);
    // No same-date merge, no sufficient batch → default is fresh
    expect(def.kind).toBe('fresh');
    expect(def.isDefault).toBe(true);
  });

  it('past-date merge is still in the options list (UI can show/grey it)', () => {
    const options = stockAllocationEngine(rows, new Map(), requiredBy, 5);
    const old = options.find((o) => o.kind === 'merge' && o.stockId === 'd_old');
    expect(old).toBeDefined();
  });

  it('exactly one option is the default', () => {
    const options = stockAllocationEngine(rows, new Map(), requiredBy, 5);
    expect(options.filter((o) => o.isDefault)).toHaveLength(1);
  });
});

// ─── Fixture 5: Multiple Demand Entries on different dates ───────────────────
describe('stockAllocationEngine — fixture 5: multiple demand entries', () => {
  const rows = [
    demandEntry('d1', -2, '2026-05-18'),
    demandEntry('d2', -5, '2026-05-20'), // same date as requiredBy
    demandEntry('d3', -1, '2026-05-25'),
  ];
  const requiredBy = '2026-05-20';

  it('returns merge options for all demand entries plus fresh', () => {
    const options = stockAllocationEngine(rows, new Map(), requiredBy, 5);
    const merges = options.filter((o) => o.kind === 'merge');
    expect(merges).toHaveLength(3);
    expect(options.filter((o) => o.kind === 'fresh')).toHaveLength(1);
  });

  it('merge options carry their respective dates', () => {
    const options = stockAllocationEngine(rows, new Map(), requiredBy, 5);
    const merges = options.filter((o) => o.kind === 'merge');
    const dates = merges.map((m) => m.date).sort();
    expect(dates).toEqual(['2026-05-18', '2026-05-20', '2026-05-25']);
  });

  it('merge options carry stockId references', () => {
    const options = stockAllocationEngine(rows, new Map(), requiredBy, 5);
    const mergeIds = options.filter((o) => o.kind === 'merge').map((m) => m.stockId);
    expect(mergeIds).toContain('d1');
    expect(mergeIds).toContain('d2');
    expect(mergeIds).toContain('d3');
  });

  it('smart-default: same-date merge (d2) is default', () => {
    const options = stockAllocationEngine(rows, new Map(), requiredBy, 5);
    const def = options.find((o) => o.isDefault);
    expect(def.kind).toBe('merge');
    expect(def.stockId).toBe('d2');
  });

  it('exactly one option is the default', () => {
    const options = stockAllocationEngine(rows, new Map(), requiredBy, 5);
    expect(options.filter((o) => o.isDefault)).toHaveLength(1);
  });
});

// ─── Fixture 4: Same-date Demand Entry (no Batch) ────────────────────────────
describe('stockAllocationEngine — fixture 4: same-date demand entry, no batch', () => {
  it('returns a merge option and a fresh option', () => {
    const rows = [demandEntry('d1', -3, '2026-05-20')]; // same date as requiredBy
    const options = stockAllocationEngine(rows, new Map(), '2026-05-20', 5);
    const kinds = options.map((o) => o.kind);
    expect(kinds).toContain('merge');
    expect(kinds).toContain('fresh');
  });

  it('merge option carries correct metadata', () => {
    const rows = [demandEntry('d1', -3, '2026-05-20')];
    const options = stockAllocationEngine(rows, new Map(), '2026-05-20', 5);
    const m = options.find((o) => o.kind === 'merge');
    expect(m).toMatchObject({
      kind: 'merge',
      stockId: 'd1',
      date: '2026-05-20',
      currentQty: -3,
      isPastDate: false,
    });
  });

  it('smart-default: same-date merge is the default (smart-default rule 1)', () => {
    const rows = [demandEntry('d1', -3, '2026-05-20')];
    const options = stockAllocationEngine(rows, new Map(), '2026-05-20', 5);
    const def = options.find((o) => o.isDefault);
    expect(def).toBeDefined();
    expect(def.kind).toBe('merge');
    expect(def.date).toBe('2026-05-20');
  });

  it('exactly one option is the default', () => {
    const rows = [demandEntry('d1', -3, '2026-05-20')];
    const options = stockAllocationEngine(rows, new Map(), '2026-05-20', 5);
    expect(options.filter((o) => o.isDefault)).toHaveLength(1);
  });
});

// ─── Fixture 3: Partial Batch coverage ───────────────────────────────────────
describe('stockAllocationEngine — fixture 3: partial batch coverage', () => {
  it('returns batch option with sufficient=false when freeQty < qty', () => {
    const rows = [batch('b1', 4, '2026-05-05')]; // only 4, need 10
    const options = stockAllocationEngine(rows, new Map(), '2026-05-20', 10);
    const b = options.find((o) => o.kind === 'batch');
    expect(b).toBeDefined();
    expect(b.sufficient).toBe(false);
    expect(b.freeQty).toBe(4);
  });

  it('smart-default: fresh is the default when batch cannot cover fully', () => {
    const rows = [batch('b1', 4, '2026-05-05')]; // only 4, need 10
    const options = stockAllocationEngine(rows, new Map(), '2026-05-20', 10);
    const def = options.find((o) => o.isDefault);
    expect(def).toBeDefined();
    expect(def.kind).toBe('fresh');
  });

  it('exactly one option is the default', () => {
    const rows = [batch('b1', 4, '2026-05-05')];
    const options = stockAllocationEngine(rows, new Map(), '2026-05-20', 10);
    expect(options.filter((o) => o.isDefault)).toHaveLength(1);
  });
});

// ─── Fixture 2: Existing Batch covers fully ──────────────────────────────────
describe('stockAllocationEngine — fixture 2: batch covers fully', () => {
  it('returns a batch option and a fresh option', () => {
    const rows = [batch('b1', 20, '2026-05-05')];
    const options = stockAllocationEngine(rows, new Map(), '2026-05-20', 10);
    expect(options).toHaveLength(2);
    const kinds = options.map((o) => o.kind);
    expect(kinds).toContain('batch');
    expect(kinds).toContain('fresh');
  });

  it('batch option carries correct metadata', () => {
    const rows = [batch('b1', 20, '2026-05-05')];
    const options = stockAllocationEngine(rows, new Map(), '2026-05-20', 10);
    const b = options.find((o) => o.kind === 'batch');
    expect(b).toMatchObject({
      kind: 'batch',
      stockId: 'b1',
      freeQty: 20,
      total: 20,
      reservedQty: 0,
      date: '2026-05-05',
      sufficient: true,
    });
  });

  it('smart-default: batch is the default when it covers fully', () => {
    const rows = [batch('b1', 20, '2026-05-05')];
    const options = stockAllocationEngine(rows, new Map(), '2026-05-20', 10);
    const def = options.find((o) => o.isDefault);
    expect(def).toBeDefined();
    expect(def.kind).toBe('batch');
  });

  it('exactly one option is the default', () => {
    const rows = [batch('b1', 20, '2026-05-05')];
    const options = stockAllocationEngine(rows, new Map(), '2026-05-20', 10);
    const defaults = options.filter((o) => o.isDefault);
    expect(defaults).toHaveLength(1);
  });
});

// ─── Fixture 8: Over-reserved row (data-integrity edge case) ─────────────────
// Reservations exceed currentQuantity → freeQty negative.
// The engine must NOT mark the row as sufficient and must NOT default to it,
// regardless of qty (incl. zero/negative qty). The negative freeQty itself is
// preserved on the option so the picker UI can surface it as a warning.
describe('stockAllocationEngine — fixture 8: over-reserved row', () => {
  const requiredBy = '2026-05-20';

  it('negative freeQty is exposed but never sufficient (qty > 0)', () => {
    const rows = [batch('b1', 5, '2026-05-05')];           // 5 stems
    const reservations = new Map([['b1', 12]]);            // 12 reserved (overflow)
    const options = stockAllocationEngine(rows, reservations, requiredBy, 3);
    const b1 = options.find((o) => o.kind === 'batch');
    expect(b1.freeQty).toBe(-7);                           // raw signed math preserved
    expect(b1.reservedQty).toBe(12);
    expect(b1.sufficient).toBe(false);                     // never sufficient
    expect(b1.isDefault).toBe(false);
  });

  it('over-reserved row never sufficient even when qty <= 0', () => {
    // qty=0 (degenerate) — without the freeQty>0 guard, freeQty=-7 would
    // be >= 0 and the engine would have falsely marked the batch sufficient.
    const rows = [batch('b1', 5, '2026-05-05')];
    const reservations = new Map([['b1', 12]]);
    const options = stockAllocationEngine(rows, reservations, requiredBy, 0);
    const b1 = options.find((o) => o.kind === 'batch');
    expect(b1.sufficient).toBe(false);
    expect(b1.isDefault).toBe(false);
  });

  it('smart-default falls through to fresh when only over-reserved batches exist', () => {
    const rows = [batch('b1', 5, '2026-05-05')];
    const reservations = new Map([['b1', 12]]);
    const options = stockAllocationEngine(rows, reservations, requiredBy, 3);
    const def = options.find((o) => o.isDefault);
    expect(def.kind).toBe('fresh');
  });
});

// ─── Fixture 1: No Batch and no Demand Entry ─────────────────────────────────
describe('stockAllocationEngine — fixture 1: no rows', () => {
  it('returns only a fresh option when there are no rows', () => {
    const options = stockAllocationEngine([], new Map(), '2026-05-20', 5);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ kind: 'fresh', date: '2026-05-20' });
  });

  it('smart-default: fresh is the default when no rows exist', () => {
    const options = stockAllocationEngine([], new Map(), '2026-05-20', 5);
    const def = options.find((o) => o.isDefault);
    expect(def).toBeDefined();
    expect(def.kind).toBe('fresh');
  });
});
