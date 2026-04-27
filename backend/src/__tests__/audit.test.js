// Tests for the audit-log diff helper. The actual recordAudit() call
// requires a Drizzle handle and is exercised by repo tests in Phase 3+;
// here we lock down minimalDiff's edge cases so they don't drift.

import { describe, it, expect } from 'vitest';
import { _internal } from '../db/audit.js';

const { minimalDiff } = _internal;

describe('minimalDiff', () => {
  it('treats create (no before) by returning the full after', () => {
    expect(minimalDiff(null, { name: 'Rose', qty: 5 }))
      .toEqual({ before: null, after: { name: 'Rose', qty: 5 } });
  });

  it('treats delete (no after) by returning the full before', () => {
    expect(minimalDiff({ name: 'Rose', qty: 5 }, null))
      .toEqual({ before: { name: 'Rose', qty: 5 }, after: null });
  });

  it('returns only changed keys on update', () => {
    const before = { name: 'Rose', qty: 5, color: 'red' };
    const after  = { name: 'Rose', qty: 7, color: 'red' };
    expect(minimalDiff(before, after))
      .toEqual({ before: { qty: 5 }, after: { qty: 7 } });
  });

  it('handles a key that disappears (treated as null on the missing side)', () => {
    const before = { qty: 5, notes: 'fresh' };
    const after  = { qty: 5 };
    expect(minimalDiff(before, after))
      .toEqual({ before: { notes: 'fresh' }, after: { notes: null } });
  });

  it('uses JSON.stringify equality for arrays / objects to avoid identity bugs', () => {
    const before = { tags: ['a', 'b'] };
    const after  = { tags: ['a', 'b'] };  // same content, different reference
    expect(minimalDiff(before, after)).toEqual({ before: {}, after: {} });
  });

  it('produces empty diff when nothing changes', () => {
    const row = { qty: 5 };
    expect(minimalDiff(row, row)).toEqual({ before: {}, after: {} });
  });
});
