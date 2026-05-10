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
