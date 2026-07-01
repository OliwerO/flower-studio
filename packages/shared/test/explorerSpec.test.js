import { describe, it, expect } from 'vitest';
import {
  EXPLORER_ROW_CAP,
  localizeSchema,
  EMPTY_EXPLORER_SPEC,
  activeExplorerFilterCount,
  resolveColumns,
  buildDrillSpec,
  formatExplorerValue,
  toggleSort,
  getSortDir,
  applyColumnFilter,
  columnFilterValues,
  explorerRowsToCsv,
} from '../utils/explorerSpec.js';

// A trimmed descriptor mirroring GET /explorer/schema for the `orders` entity.
const ORDERS_DESCRIPTOR = {
  key: 'orders',
  label: 'Заказы',
  fields: [
    { name: 'id', key: 'id', label: 'ID', type: 'id' },
    { name: 'orderDate', key: 'orderDate', label: 'Дата заказа', type: 'date' },
    { name: 'status', key: 'status', label: 'Статус', type: 'text' },
    { name: 'price', key: 'priceOverride', label: 'Цена', type: 'number' },
  ],
  drills: [
    { join: 'customer', to: 'customers', label: 'Показать: Клиенты', cardinality: 'one', localKey: 'customerId', foreignField: 'id' },
    { join: 'lines', to: 'order_lines', label: 'Показать: Позиции заказа', cardinality: 'many', localKey: 'id', foreignField: 'orderId' },
  ],
};

describe('localizeSchema', () => {
  const SCHEMA = {
    entities: [{
      key: 'orders',
      label: 'Заказы', labelEn: 'Orders',
      fields: [{ name: 'orderDate', key: 'orderDate', label: 'Дата заказа', labelEn: 'Order date', type: 'date' }],
      drills: [{ join: 'customer', to: 'customers', label: 'Показать: Клиенты', labelEn: 'Show: Customers', cardinality: 'one', localKey: 'customerId', foreignField: 'id' }],
    }],
  };

  it('en → swaps entity/field/drill labels to labelEn', () => {
    const out = localizeSchema(SCHEMA, 'en');
    const e = out.entities[0];
    expect(e.label).toBe('Orders');
    expect(e.fields[0].label).toBe('Order date');
    expect(e.drills[0].label).toBe('Show: Customers');
    // Non-label data (keys, types, drill seeds) is preserved.
    expect(e.fields[0].key).toBe('orderDate');
    expect(e.drills[0].localKey).toBe('customerId');
  });

  it('ru (default) → keeps the Russian label', () => {
    const out = localizeSchema(SCHEMA, 'ru');
    expect(out.entities[0].label).toBe('Заказы');
    expect(out.entities[0].fields[0].label).toBe('Дата заказа');
  });

  it('falls back to label when labelEn is absent', () => {
    const noEn = { entities: [{ key: 'x', label: 'Икс', fields: [{ name: 'a', key: 'a', label: 'А', type: 'text' }], drills: [] }] };
    expect(localizeSchema(noEn, 'en').entities[0].label).toBe('Икс');
  });

  it('null-safe', () => {
    expect(localizeSchema(null, 'en')).toBeNull();
  });
});

describe('EMPTY_EXPLORER_SPEC', () => {
  it('creates a blank spec for an entity with empty filters/sort', () => {
    expect(EMPTY_EXPLORER_SPEC('orders')).toEqual({ entity: 'orders', filters: [], sort: [] });
  });
});

describe('activeExplorerFilterCount', () => {
  it('counts the filters on a spec', () => {
    expect(activeExplorerFilterCount({ filters: [{}, {}] })).toBe(2);
    expect(activeExplorerFilterCount({})).toBe(0);
    expect(activeExplorerFilterCount(null)).toBe(0);
  });
});

describe('resolveColumns', () => {
  it('plain query → descriptor fields, reading value via the runtime key', () => {
    const cols = resolveColumns(ORDERS_DESCRIPTOR, EMPTY_EXPLORER_SPEC('orders'));
    expect(cols).toEqual([
      { name: 'id', key: 'id', label: 'ID', type: 'id', agg: false },
      { name: 'orderDate', key: 'orderDate', label: 'Дата заказа', type: 'date', agg: false },
      { name: 'status', key: 'status', label: 'Статус', type: 'text', agg: false },
      // model name `price` → runtime key `priceOverride`
      { name: 'price', key: 'priceOverride', label: 'Цена', type: 'number', agg: false },
    ]);
  });

  it('groupBy/aggregate query → group columns + aggregate alias columns (agg flagged)', () => {
    const spec = { entity: 'orders', groupBy: ['status'], aggregate: [{ fn: 'count', as: 'n' }] };
    const cols = resolveColumns(ORDERS_DESCRIPTOR, spec);
    expect(cols).toEqual([
      { name: 'status', key: 'status', label: 'Статус', type: 'text', agg: false }, // group column keyed by model name
      { name: 'n', key: 'n', label: 'n', type: 'number', agg: true },               // aggregate alias
    ]);
  });
});

describe('buildDrillSpec', () => {
  it('many drill: filters the target FK field by the primary row PK', () => {
    const linesDrill = ORDERS_DESCRIPTOR.drills.find(d => d.join === 'lines');
    const spec = buildDrillSpec(linesDrill, { id: 'ord-1', priceOverride: 100 });
    expect(spec).toEqual({
      entity: 'order_lines',
      filters: [{ field: 'orderId', op: 'eq', value: 'ord-1' }],
      sort: [],
    });
  });

  it('one drill: filters the target PK by the primary row FK', () => {
    const custDrill = ORDERS_DESCRIPTOR.drills.find(d => d.join === 'customer');
    const spec = buildDrillSpec(custDrill, { id: 'ord-1', customerId: 'cust-9' });
    expect(spec).toEqual({
      entity: 'customers',
      filters: [{ field: 'id', op: 'eq', value: 'cust-9' }],
      sort: [],
    });
  });

  it('returns null when the FK value is missing (nothing to drill on)', () => {
    const custDrill = ORDERS_DESCRIPTOR.drills.find(d => d.join === 'customer');
    expect(buildDrillSpec(custDrill, { id: 'ord-1', customerId: null })).toBeNull();
    expect(buildDrillSpec(custDrill, { id: 'ord-1' })).toBeNull();
    expect(buildDrillSpec(null, { id: 'x' })).toBeNull();
  });
});

describe('formatExplorerValue', () => {
  it('renders dates DMY from ISO / date-only / timestamptz strings', () => {
    expect(formatExplorerValue('2026-07-01', 'date')).toBe('01.07.2026');
    expect(formatExplorerValue('2026-07-01T12:34:56.000Z', 'date')).toBe('01.07.2026');
  });
  it('blanks null/undefined', () => {
    expect(formatExplorerValue(null, 'text')).toBe('');
    expect(formatExplorerValue(undefined, 'number')).toBe('');
  });
  it('stringifies numbers and objects; booleans as check/blank', () => {
    expect(formatExplorerValue(42, 'number')).toBe('42');
    expect(formatExplorerValue(true, 'text')).toBe('✓');
    expect(formatExplorerValue(false, 'text')).toBe('');
    expect(formatExplorerValue({ a: 1 }, 'text')).toBe('{"a":1}');
  });
});

describe('toggleSort / getSortDir', () => {
  it('cycles a column asc → desc → off', () => {
    let spec = EMPTY_EXPLORER_SPEC('orders');
    spec = toggleSort(spec, 'orderDate');
    expect(getSortDir(spec, 'orderDate')).toBe('asc');
    spec = toggleSort(spec, 'orderDate');
    expect(getSortDir(spec, 'orderDate')).toBe('desc');
    spec = toggleSort(spec, 'orderDate');
    expect(getSortDir(spec, 'orderDate')).toBeNull();
    expect(spec.sort).toEqual([]);
  });

  it('switching to a different column starts at asc', () => {
    let spec = toggleSort(EMPTY_EXPLORER_SPEC('orders'), 'orderDate'); // asc
    spec = toggleSort(spec, 'status');
    expect(getSortDir(spec, 'status')).toBe('asc');
    expect(getSortDir(spec, 'orderDate')).toBeNull();
  });
});

describe('applyColumnFilter / columnFilterValues', () => {
  it('replaces existing filters on the field, leaves others intact', () => {
    let spec = EMPTY_EXPLORER_SPEC('orders');
    spec = applyColumnFilter(spec, 'status', [{ field: 'status', op: 'eq', value: 'New' }]);
    spec = applyColumnFilter(spec, 'price', [
      { field: 'price', op: 'gte', value: 10 },
      { field: 'price', op: 'lte', value: 50 },
    ]);
    expect(spec.filters).toHaveLength(3);

    // Re-applying status replaces (does not duplicate) its filter.
    spec = applyColumnFilter(spec, 'status', [{ field: 'status', op: 'eq', value: 'Ready' }]);
    expect(spec.filters.filter(f => f.field === 'status')).toEqual([{ field: 'status', op: 'eq', value: 'Ready' }]);
    expect(spec.filters.filter(f => f.field === 'price')).toHaveLength(2);
  });

  it('clears a field by applying an empty list', () => {
    let spec = applyColumnFilter(EMPTY_EXPLORER_SPEC('orders'), 'status', [{ field: 'status', op: 'eq', value: 'New' }]);
    spec = applyColumnFilter(spec, 'status', []);
    expect(spec.filters).toEqual([]);
  });

  it('columnFilterValues extracts current op values for a field', () => {
    let spec = EMPTY_EXPLORER_SPEC('orders');
    spec = applyColumnFilter(spec, 'price', [
      { field: 'price', op: 'gte', value: 10 },
      { field: 'price', op: 'lte', value: 50 },
    ]);
    spec = applyColumnFilter(spec, 'status', [{ field: 'status', op: 'like', value: 'Rea' }]);
    expect(columnFilterValues(spec, 'price')).toEqual({ gte: 10, lte: 50 });
    expect(columnFilterValues(spec, 'status')).toEqual({ like: 'Rea' });
    expect(columnFilterValues(spec, 'orderDate')).toEqual({});
  });
});

describe('explorerRowsToCsv', () => {
  const cols = [
    { key: 'id', label: 'ID', type: 'id' },
    { key: 'orderDate', label: 'Дата заказа', type: 'date' },
    { key: 'priceOverride', label: 'Цена', type: 'number' },
  ];
  it('emits a header row of labels + formatted cells read via key', () => {
    const rows = [{ id: 'ord-1', orderDate: '2026-07-01', priceOverride: 120 }];
    const csv = explorerRowsToCsv(rows, cols);
    const [header, first] = csv.split('\r\n');
    expect(header).toBe('ID,Дата заказа,Цена');
    expect(first).toBe('ord-1,01.07.2026,120');
  });

  it('RFC-4180 escapes commas, quotes, and newlines', () => {
    const rows = [{ id: 'a,b', orderDate: null, priceOverride: 'has "quote"' }];
    const csv = explorerRowsToCsv(rows, cols);
    const first = csv.split('\r\n')[1];
    expect(first).toBe('"a,b",,"has ""quote"""');
  });

  it('EXPLORER_ROW_CAP is exported and matches the engine cap', () => {
    expect(EXPLORER_ROW_CAP).toBe(200);
  });
});
