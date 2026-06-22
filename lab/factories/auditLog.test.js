// lab/factories/auditLog.test.js
//
// Coverage for makeAuditLog factory — the seed source for `premade_dissolved`
// trace events (the 5th Y-model trace event type).

import { describe, it, expect } from 'vitest';
import { makeAuditLog } from './auditLog.js';

describe('makeAuditLog', () => {
  it('has required NOT-NULL columns present and non-null', () => {
    const r = makeAuditLog({ stockId: 'abc' });
    expect(r.entity_type).toBeTruthy();
    expect(r.entity_id).toBeTruthy();
    expect(r.action).toBeTruthy();
    expect(r.diff).not.toBeNull();
    expect(r.diff).not.toBeUndefined();
    expect(r.actor_role).toBeTruthy();
    expect(r.created_at).toBeTruthy();
  });

  it('OMITS the bigserial id column (Postgres assigns it)', () => {
    const r = makeAuditLog({ stockId: 'abc' });
    expect(r).not.toHaveProperty('id');
  });

  it('defaults entity_type to stock', () => {
    expect(makeAuditLog({ stockId: 'abc' }).entity_type).toBe('stock');
  });

  it('defaults action to premade_dissolved', () => {
    expect(makeAuditLog({ stockId: 'abc' }).action).toBe('premade_dissolved');
  });

  it('defaults actor_role to owner', () => {
    expect(makeAuditLog({ stockId: 'abc' }).actor_role).toBe('owner');
  });

  it('defaults diff to { before, after } shape', () => {
    const r = makeAuditLog({ stockId: 'abc' });
    expect(r.diff).toHaveProperty('before');
    expect(r.diff).toHaveProperty('after');
  });

  it('stockId shorthand maps to entity_id and is not leaked', () => {
    const r = makeAuditLog({ stockId: 'stock-123' });
    expect(r.entity_id).toBe('stock-123');
    expect(r.stockId).toBeUndefined();
  });

  it('carries a dissolve diff.after payload (qty + bouquet_name)', () => {
    const r = makeAuditLog({
      stockId: 'abc',
      diff: { before: null, after: { qty: 5, bouquet_id: 'b1', bouquet_name: 'Winter Wreath' } },
    });
    expect(r.diff.after.qty).toBe(5);
    expect(r.diff.after.bouquet_name).toBe('Winter Wreath');
  });

  it('honours an explicit created_at literal (drives the trace date deterministically)', () => {
    const r = makeAuditLog({ stockId: 'abc', created_at: '2026-06-21T09:00:00Z' });
    expect(r.created_at).toBe('2026-06-21T09:00:00Z');
  });

  it('actor_pin_label defaults to null', () => {
    expect(makeAuditLog({ stockId: 'abc' }).actor_pin_label).toBeNull();
  });
});
