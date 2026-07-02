// Unit tests for the deep-join `chain` construct validation (Explorer v2 Wave 2,
// ADR-0011). validateSpec is pure (no DB), so these run without a harness.
//
// A `chain` is an ordered list of relationship EDGES resolved sequentially: each
// edge must exist on the PREVIOUS hop's entity (not the primary). It is bounded
// (max hops), cycle-free (no entity revisited), edges-only (no free-form joins),
// mutually exclusive with the star-shaped `join`, and — for v2 — plain rows only
// (no groupBy/aggregate). All of that is enforced here before any query runs.

import { describe, it, expect } from 'vitest';
import { validateSpec } from '../services/assistantTools/dataQueryPack.js';

describe('validateSpec — deep-join chain', () => {
  it('accepts a single-hop chain along a real edge', () => {
    expect(validateSpec({ entity: 'orders', chain: ['customer'] })).toEqual({ ok: true });
  });

  it('accepts a multi-hop chain where each edge exists on the running entity', () => {
    // orders → order_lines (lines) → stock (stock)
    expect(validateSpec({ entity: 'orders', chain: ['lines', 'stock'] })).toEqual({ ok: true });
    // orders → customers (customer) → key_people (keyPeople)
    expect(validateSpec({ entity: 'orders', chain: ['customer', 'keyPeople'] })).toEqual({ ok: true });
  });

  it('accepts filters/sort whose fields resolve against any entity in the chain path', () => {
    const spec = {
      entity: 'orders',
      chain: ['customer', 'keyPeople'],
      filters: [{ field: 'status', op: 'eq', value: 'Delivered' }, { field: 'segment', op: 'eq', value: 'VIP' }],
      sort: [{ field: 'name', dir: 'asc' }], // name resolves on customers/key_people
    };
    expect(validateSpec(spec)).toEqual({ ok: true });
  });

  it('rejects an unknown first-hop edge', () => {
    const r = validateSpec({ entity: 'orders', chain: ['bogus'] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/chain edge "bogus"/i);
  });

  it('rejects an edge that does not exist on the running (non-primary) entity', () => {
    // 'stock' is an edge on order_lines, NOT on customers → invalid after hop 1
    const r = validateSpec({ entity: 'orders', chain: ['customer', 'stock'] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/chain edge "stock"/i);
  });

  it('rejects a chain that revisits an entity (cycle)', () => {
    // orders → customers (customer) → orders (orders) revisits the start
    const r = validateSpec({ entity: 'orders', chain: ['customer', 'orders'] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cycle|revisit/i);
  });

  it('rejects a chain longer than the max hop count', () => {
    const r = validateSpec({ entity: 'orders', chain: ['a', 'b', 'c', 'd', 'e'] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too long|max/i);
  });

  it('rejects combining chain with the star-shaped join', () => {
    const r = validateSpec({ entity: 'orders', chain: ['customer'], join: ['lines'] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/chain.*join|join.*chain/i);
  });

  it('rejects combining chain with groupBy/aggregate (v2 = flat rows only)', () => {
    const r1 = validateSpec({ entity: 'orders', chain: ['customer'], aggregate: [{ fn: 'count', as: 'n' }] });
    expect(r1.ok).toBe(false);
    expect(r1.error).toMatch(/chain.*(group|aggregate)/i);
    const r2 = validateSpec({ entity: 'orders', chain: ['customer'], groupBy: ['status'] });
    expect(r2.ok).toBe(false);
  });

  it('rejects a non-array chain and non-string edges', () => {
    expect(validateSpec({ entity: 'orders', chain: 'customer' }).ok).toBe(false);
    expect(validateSpec({ entity: 'orders', chain: [123] }).ok).toBe(false);
  });

  it('leaves ordinary (chain-less) specs unaffected', () => {
    expect(validateSpec({ entity: 'orders', join: ['customer'] })).toEqual({ ok: true });
    expect(validateSpec({ entity: 'orders', filters: [{ field: 'status', op: 'eq', value: 'New' }] })).toEqual({ ok: true });
  });
});
