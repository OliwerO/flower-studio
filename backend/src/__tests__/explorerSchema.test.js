// backend/src/__tests__/explorerSchema.test.js
//
// Unit tests for explorerSchema.js — describeSchema() projects the
// query_records allow-list (SCHEMA in dataQueryPack.js) into a UI-safe
// descriptor for the Explorer front-end (ADR-0010).
//
// Coverage:
//   - all 12 allow-listed entities are listed (8 pre-existing + 4 new)
//   - new entities (key_people, stock_orders, stock_order_lines, florist_hours)
//     carry their drills (joins) with Russian labels
//   - drift/leak guard: the entire descriptor is plain JSON-serializable data —
//     no Drizzle column object (which carries functions / circular refs) leaks out

import { describe, it, expect } from 'vitest';
import { describeSchema } from '../services/assistantTools/explorerSchema.js';

const EXPECTED_ENTITY_KEYS = [
  'orders', 'customers', 'order_lines', 'stock', 'purchases', 'writeoffs', 'deliveries', 'marketing',
  'key_people', 'stock_orders', 'stock_order_lines', 'florist_hours',
];

describe('explorerSchema.describeSchema', () => {
  it('lists all 12 allow-listed entities', () => {
    const { entities } = describeSchema();
    const keys = entities.map(e => e.key);
    expect(keys.sort()).toEqual([...EXPECTED_ENTITY_KEYS].sort());
    expect(entities.length).toBe(12);
  });

  it('every entity has a non-empty Russian label and a fields array', () => {
    const { entities } = describeSchema();
    for (const e of entities) {
      expect(typeof e.label).toBe('string');
      expect(e.label.length).toBeGreaterThan(0);
      expect(Array.isArray(e.fields)).toBe(true);
      expect(e.fields.length).toBeGreaterThan(0);
      for (const f of e.fields) {
        expect(typeof f.name).toBe('string');
        expect(typeof f.label).toBe('string');
        expect(['date', 'number', 'id', 'text']).toContain(f.type);
      }
    }
  });

  it('key_people carries a drill to customers', () => {
    const { entities } = describeSchema();
    const keyPeople = entities.find(e => e.key === 'key_people');
    expect(keyPeople).toBeDefined();
    expect(keyPeople.label).toBe('Близкие клиента');
    const drill = keyPeople.drills.find(d => d.join === 'customer');
    expect(drill).toBeDefined();
    expect(drill.to).toBe('customers');
    expect(drill.cardinality).toBe('one');
    expect(drill.label).toMatch(/^Показать: /);
  });

  it('customers carries a new drill to key_people (many)', () => {
    const { entities } = describeSchema();
    const customers = entities.find(e => e.key === 'customers');
    expect(customers).toBeDefined();
    const drill = customers.drills.find(d => d.join === 'keyPeople');
    expect(drill).toBeDefined();
    expect(drill.to).toBe('key_people');
    expect(drill.cardinality).toBe('many');
  });

  it('stock_orders carries a drill to stock_order_lines (many)', () => {
    const { entities } = describeSchema();
    const stockOrders = entities.find(e => e.key === 'stock_orders');
    expect(stockOrders).toBeDefined();
    expect(stockOrders.softDelete).toBe(false); // no deletedAt column
    const drill = stockOrders.drills.find(d => d.join === 'lines');
    expect(drill).toBeDefined();
    expect(drill.to).toBe('stock_order_lines');
    expect(drill.cardinality).toBe('many');
  });

  it('stock_order_lines carries drills to stock and po (both one)', () => {
    const { entities } = describeSchema();
    const lines = entities.find(e => e.key === 'stock_order_lines');
    expect(lines).toBeDefined();
    expect(lines.softDelete).toBe(false); // no deletedAt column
    const stockDrill = lines.drills.find(d => d.join === 'stock');
    const poDrill = lines.drills.find(d => d.join === 'po');
    expect(stockDrill).toBeDefined();
    expect(stockDrill.to).toBe('stock');
    expect(stockDrill.cardinality).toBe('one');
    expect(poDrill).toBeDefined();
    expect(poDrill.to).toBe('stock_orders');
    expect(poDrill.cardinality).toBe('one');
  });

  it('florist_hours is near-standalone: soft-deletable, no drills', () => {
    const { entities } = describeSchema();
    const hours = entities.find(e => e.key === 'florist_hours');
    expect(hours).toBeDefined();
    expect(hours.softDelete).toBe(true);
    expect(hours.drills).toEqual([]);
  });

  it('drift/leak guard: the entire descriptor is plain JSON-serializable data', () => {
    const result = describeSchema();
    // JSON round-trip must reproduce an identical structure — if any value
    // were a Drizzle column object (carries symbols/functions/circular refs),
    // JSON.stringify would either throw or silently drop data, and the
    // round-tripped structure would differ from the original.
    let serialized;
    expect(() => { serialized = JSON.stringify(result); }).not.toThrow();
    const roundTripped = JSON.parse(serialized);
    expect(roundTripped).toEqual(result);

    // Extra guard: walk every leaf value and assert it's a JSON-safe primitive
    // (no functions, no class instances carrying non-enumerable Drizzle internals).
    const walk = (value) => {
      if (value === null) return;
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (typeof value === 'object') {
        expect(value.constructor === Object || value.constructor === undefined).toBe(true);
        Object.values(value).forEach(walk);
        return;
      }
      expect(['string', 'number', 'boolean']).toContain(typeof value);
    };
    walk(result);
  });
});
