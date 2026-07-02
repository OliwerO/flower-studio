import { describe, it, expect } from 'vitest';
import {
  EXPLORER_MAX_CHAIN,
  isChainSpec,
  EMPTY_CHAIN_SPEC,
  chainPathEntities,
  resolveChainColumns,
  chainCellValue,
  chainRowsToCsv,
  availableChainEdges,
  chainHasFanOut,
  chainAppendEdge,
  chainRemoveLast,
} from '../utils/explorerSpec.js';

// A trimmed descriptor mirroring GET /explorer/schema (localized, so `label` is
// the display label). Covers the flagship path stock → order_lines → orders →
// customers → key_people plus the reverse/edge shapes describeSchema emits.
const SCHEMA = {
  entities: [
    {
      key: 'stock', table: 'stock', label: 'Stock',
      fields: [{ name: 'name', key: 'displayName', label: 'Name', type: 'text' }, { name: 'quantity', key: 'currentQuantity', label: 'Qty', type: 'number' }],
      drills: [{ join: 'lines', to: 'order_lines', label: 'Show: Order lines', cardinality: 'many', localKey: 'id', foreignField: 'stockItemId' }],
    },
    {
      key: 'order_lines', table: 'order_lines', label: 'Order lines',
      fields: [{ name: 'flowerName', key: 'flowerName', label: 'Flower', type: 'text' }, { name: 'quantity', key: 'quantity', label: 'Qty', type: 'number' }],
      drills: [{ join: 'order', to: 'orders', label: 'Show: Orders', cardinality: 'one', localKey: 'orderId', foreignField: 'id' }],
    },
    {
      key: 'orders', table: 'orders', label: 'Orders',
      fields: [{ name: 'id', key: 'id', label: 'ID', type: 'id' }, { name: 'status', key: 'status', label: 'Status', type: 'text' }, { name: 'price', key: 'priceOverride', label: 'Price', type: 'number' }],
      drills: [
        { join: 'customer', to: 'customers', label: 'Show: Customers', cardinality: 'one', localKey: 'customerId', foreignField: 'id' },
        { join: 'lines', to: 'order_lines', label: 'Show: Order lines', cardinality: 'many', localKey: 'id', foreignField: 'orderId' },
      ],
    },
    {
      key: 'customers', table: 'customers', label: 'Customers',
      fields: [{ name: 'id', key: 'id', label: 'ID', type: 'id' }, { name: 'name', key: 'name', label: 'Name', type: 'text' }],
      drills: [{ join: 'keyPeople', to: 'key_people', label: 'Show: Key people', cardinality: 'many', localKey: 'id', foreignField: 'customerId' }],
    },
    {
      key: 'key_people', table: 'key_people', label: 'Key people',
      fields: [{ name: 'name', key: 'name', label: 'Name', type: 'text' }],
      drills: [],
    },
    // divergent table name (SCHEMA key ≠ table)
    { key: 'purchases', table: 'stock_purchases', label: 'Purchases', fields: [{ name: 'id', key: 'id', label: 'ID', type: 'id' }], drills: [] },
  ],
};

describe('isChainSpec / EMPTY_CHAIN_SPEC', () => {
  it('detects a chain spec and builds a blank one', () => {
    expect(isChainSpec({ entity: 'orders', chain: [] })).toBe(true);
    expect(isChainSpec({ entity: 'orders' })).toBe(false);
    expect(EMPTY_CHAIN_SPEC('stock')).toEqual({ entity: 'stock', chain: [], filters: [], sort: [] });
  });
});

describe('chainPathEntities', () => {
  it('resolves the ordered entities along the flagship path', () => {
    const spec = { entity: 'stock', chain: ['lines', 'order', 'customer', 'keyPeople'] };
    expect(chainPathEntities(SCHEMA, spec).map(e => e.key)).toEqual(['stock', 'order_lines', 'orders', 'customers', 'key_people']);
  });
  it('returns just the primary for an empty chain', () => {
    expect(chainPathEntities(SCHEMA, { entity: 'orders', chain: [] }).map(e => e.key)).toEqual(['orders']);
  });
  it('stops at an unresolvable edge (defensive)', () => {
    expect(chainPathEntities(SCHEMA, { entity: 'orders', chain: ['bogus'] }).map(e => e.key)).toEqual(['orders']);
  });
});

describe('resolveChainColumns', () => {
  it('emits hop-prefixed columns across the whole path, keyed by table', () => {
    const spec = { entity: 'orders', chain: ['customer'] };
    const cols = resolveChainColumns(SCHEMA, spec);
    expect(cols.map(c => c.label)).toEqual([
      'Orders · ID', 'Orders · Status', 'Orders · Price',
      'Customers · ID', 'Customers · Name',
    ]);
    // Same-named columns stay distinct by table.
    const orderId = cols.find(c => c.label === 'Orders · ID');
    const custId = cols.find(c => c.label === 'Customers · ID');
    expect(orderId.table).toBe('orders');
    expect(custId.table).toBe('customers');
    expect(orderId.colId).not.toBe(custId.colId);
    // Price reads via the runtime key.
    expect(cols.find(c => c.label === 'Orders · Price').key).toBe('priceOverride');
  });
});

describe('chainCellValue', () => {
  it('reads a nested cell via table + runtime key', () => {
    const row = { orders: { id: 'o1', priceOverride: 120 }, customers: { id: 'c1', name: 'Anna' } };
    const cols = resolveChainColumns(SCHEMA, { entity: 'orders', chain: ['customer'] });
    expect(chainCellValue(row, cols.find(c => c.label === 'Orders · Price'))).toBe(120);
    expect(chainCellValue(row, cols.find(c => c.label === 'Customers · Name'))).toBe('Anna');
    expect(chainCellValue({}, cols[0])).toBeUndefined();
  });
});

describe('chainRowsToCsv', () => {
  it('emits header labels + nested cells, DMY dates, RFC-4180 escaping', () => {
    const cols = [
      { table: 'orders', key: 'status', label: 'Orders · Status', type: 'text' },
      { table: 'customers', key: 'name', label: 'Customers · Name', type: 'text' },
    ];
    const rows = [{ orders: { status: 'New' }, customers: { name: 'A, B' } }];
    const csv = chainRowsToCsv(rows, cols);
    expect(csv.split('\r\n')[0]).toBe('Orders · Status,Customers · Name');
    expect(csv.split('\r\n')[1]).toBe('New,"A, B"');
  });
});

describe('availableChainEdges', () => {
  it('returns the tail entity edges, excluding revisits', () => {
    const spec = { entity: 'orders', chain: ['customer'] };
    // tail = customers → keyPeople available; orders would revisit (customers has no orders edge here anyway)
    expect(availableChainEdges(SCHEMA, spec).map(e => e.join)).toEqual(['keyPeople']);
  });
  it('drops an edge that revisits an entity already on the path', () => {
    // orders → lines(order_lines) → order(orders) would revisit orders → excluded
    const spec = { entity: 'orders', chain: ['lines'] };
    expect(availableChainEdges(SCHEMA, spec).map(e => e.to)).not.toContain('orders');
  });
  it('returns nothing once the chain is at max length', () => {
    const spec = { entity: 'stock', chain: ['lines', 'order', 'customer', 'keyPeople'] }; // length 4 = MAX
    expect(availableChainEdges(SCHEMA, spec)).toEqual([]);
    expect(EXPLORER_MAX_CHAIN).toBe(4);
  });
});

describe('chainHasFanOut', () => {
  it('true when any hop is many, false when all one', () => {
    expect(chainHasFanOut(SCHEMA, { entity: 'orders', chain: ['customer'] })).toBe(false);
    expect(chainHasFanOut(SCHEMA, { entity: 'orders', chain: ['customer', 'keyPeople'] })).toBe(true);
    expect(chainHasFanOut(SCHEMA, { entity: 'orders', chain: ['lines'] })).toBe(true);
  });
});

describe('chainAppendEdge / chainRemoveLast', () => {
  it('appends and pops hops (pop resets sort)', () => {
    let spec = EMPTY_CHAIN_SPEC('orders');
    spec = chainAppendEdge(spec, 'customer');
    spec = chainAppendEdge(spec, 'keyPeople');
    expect(spec.chain).toEqual(['customer', 'keyPeople']);
    spec = { ...spec, sort: [{ field: 'name', dir: 'asc' }] };
    spec = chainRemoveLast(spec);
    expect(spec.chain).toEqual(['customer']);
    expect(spec.sort).toEqual([]);
  });
});
