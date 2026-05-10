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
