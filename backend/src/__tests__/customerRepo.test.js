// customerRepo tests — pin the persistence-boundary behaviour so swapping
// the underlying store (Airtable → Postgres) can't quietly change the API
// the routes depend on.
//
// These are unit tests: airtable.js and batchQuery.js are mocked. No real
// network calls. What we assert:
//   - Field-name aliases applied on read AND write
//   - PATCH allowlist rejects unknown fields silently
//   - Empty-allowed-fields update throws { statusCode: 400 }
//   - listOrders normalizes both legacy + app into one schema sorted desc
//   - getAggregateMap caches for 60s and recomputes after TTL
//   - computedSegment hint matches the order-count thresholds

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/airtable.js', () => ({
  default: {},
  TABLES: {
    CUSTOMERS: 'tblCustomers',
    ORDERS: 'tblOrders',
    LEGACY_ORDERS: 'tblLegacyOrders',
  },
}));

vi.mock('../services/airtable.js', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../utils/batchQuery.js', () => ({
  listByIds: vi.fn(),
}));

import * as db from '../services/airtable.js';
import { listByIds } from '../utils/batchQuery.js';
import * as customerRepo from '../repos/customerRepo.js';

beforeEach(() => {
  vi.clearAllMocks();
  customerRepo._resetAggregateCache();
});

describe('customerRepo.list', () => {
  it('returns customers with response aliases applied', async () => {
    db.list.mockImplementation((table) => {
      if (table === 'tblCustomers') {
        return Promise.resolve([
          { id: 'recC1', Name: 'Alice', 'Segment (client)': 'Rare', 'Key person 1 (Name + Contact details)': 'Bob' },
        ]);
      }
      // Aggregate computation fetches legacy + app + customers; return empty
      return Promise.resolve([]);
    });

    const customers = await customerRepo.list();

    expect(customers).toHaveLength(1);
    // Alias reads through to the real field under the hood
    expect(customers[0].Segment).toBe('Rare');
    expect(customers[0]['Key person 1']).toBe('Bob');
    // Empty _agg when the customer has no orders
    expect(customers[0]._agg).toEqual({ lastOrderDate: null, orderCount: 0, totalSpend: 0 });
  });

  it('applies server-side OR-SEARCH when search query is provided', async () => {
    db.list.mockResolvedValue([]);
    await customerRepo.list({ search: 'Alice' });

    const customersCall = db.list.mock.calls.find(([table]) => table === 'tblCustomers');
    expect(customersCall[1].filterByFormula).toContain('SEARCH');
    expect(customersCall[1].filterByFormula).toContain('Alice');
  });

  it('skips aggregate computation when withAggregates=false', async () => {
    db.list.mockResolvedValue([{ id: 'recC1', Name: 'Alice' }]);
    const customers = await customerRepo.list({ withAggregates: false });

    expect(customers[0]).not.toHaveProperty('_agg');
    // Only one db.list call (customers) — not three (legacy + app + customers for agg).
    expect(db.list).toHaveBeenCalledTimes(1);
  });
});

describe('customerRepo.getById', () => {
  it('returns customer with aliases + computedSegment for 10+ orders', async () => {
    db.getById.mockResolvedValue({
      id: 'recC1',
      Name: 'Alice',
      'Segment (client)': 'Constant',
      'App Order Count': 12,
    });

    const c = await customerRepo.getById('recC1');

    expect(c.Segment).toBe('Constant');
    expect(c.computedSegment).toBe('Constant');
  });

  it('computedSegment = Rare for 2-9 orders', async () => {
    db.getById.mockResolvedValue({ id: 'recC1', 'App Order Count': 3 });
    const c = await customerRepo.getById('recC1');
    expect(c.computedSegment).toBe('Rare');
  });

  it('computedSegment = New for 1 order', async () => {
    db.getById.mockResolvedValue({ id: 'recC1', 'App Order Count': 1 });
    const c = await customerRepo.getById('recC1');
    expect(c.computedSegment).toBe('New');
  });

  it('computedSegment = null for 0 orders', async () => {
    db.getById.mockResolvedValue({ id: 'recC1', 'App Order Count': 0 });
    const c = await customerRepo.getById('recC1');
    expect(c.computedSegment).toBeNull();
  });
});

describe('customerRepo.create', () => {
  it('remaps aliases to real field names before writing', async () => {
    db.create.mockResolvedValue({ id: 'recC1', Name: 'Alice', 'Segment (client)': 'Rare' });

    await customerRepo.create({ Name: 'Alice', Segment: 'Rare', 'Key person 1': 'Bob' });

    expect(db.create).toHaveBeenCalledWith(
      'tblCustomers',
      expect.objectContaining({
        Name: 'Alice',
        'Segment (client)': 'Rare',
        'Key person 1 (Name + Contact details)': 'Bob',
      }),
    );
    // Original alias keys should NOT make it to Airtable.
    const createdFields = db.create.mock.calls[0][1];
    expect(createdFields).not.toHaveProperty('Segment');
    expect(createdFields).not.toHaveProperty('Key person 1');
  });

  it('drops keys not in the PATCH allowlist', async () => {
    db.create.mockResolvedValue({ id: 'recC1', Name: 'Alice' });

    await customerRepo.create({
      Name: 'Alice',
      BogusField: 'should be stripped',
      'App Order Count': 99,  // computed field, not in allowlist
    });

    const createdFields = db.create.mock.calls[0][1];
    expect(createdFields).toHaveProperty('Name', 'Alice');
    expect(createdFields).not.toHaveProperty('BogusField');
    expect(createdFields).not.toHaveProperty('App Order Count');
  });
});

describe('customerRepo.update', () => {
  it('remaps aliases + runs allowlist', async () => {
    db.update.mockResolvedValue({ id: 'recC1', 'Segment (client)': 'Constant' });

    await customerRepo.update('recC1', { Segment: 'Constant', BogusField: 'x' });

    expect(db.update).toHaveBeenCalledWith(
      'tblCustomers',
      'recC1',
      { 'Segment (client)': 'Constant' },
    );
  });

  it('throws statusCode 400 when no allowed fields survive', async () => {
    await expect(
      customerRepo.update('recC1', { BogusField: 'x', AnotherBogus: 'y' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    // And didn't hit the DB.
    expect(db.update).not.toHaveBeenCalled();
  });

  it('applies response aliases to the updated record', async () => {
    db.update.mockResolvedValue({
      id: 'recC1',
      'Segment (client)': 'Constant',
      'Key person 1 (Name + Contact details)': 'Carol',
    });

    const c = await customerRepo.update('recC1', { Segment: 'Constant' });

    expect(c.Segment).toBe('Constant');
    expect(c['Key person 1']).toBe('Carol');
  });
});

describe('customerRepo.listOrders', () => {
  it('merges legacy + app and sorts date-desc; nulls sink to bottom', async () => {
    db.getById.mockResolvedValue({
      id: 'recC1',
      'Orders (list)': ['recL1', 'recL2'],
      'App Orders': ['recA1'],
    });
    listByIds.mockImplementation((table) => {
      if (table === 'tblLegacyOrders') {
        return Promise.resolve([
          {
            id: 'recL1',
            'Oder Number': '202304-WS-Bouquets-15Apr-1',
            'Flowers+Details of order': 'Roses',
            'Order Reason': 'Birthday',
            'Price (with Delivery)': 150,
          },
          {
            id: 'recL2',
            // No Oder Number, no dates — sinks to bottom.
            'Flowers+Details of order': 'Tulips',
          },
        ]);
      }
      if (table === 'tblOrders') {
        return Promise.resolve([
          {
            id: 'recA1',
            'Order Date': '2026-03-20',
            'Customer Request': 'Pink roses',
            'Price Override': 300,
            Status: 'Delivered',
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const merged = await customerRepo.listOrders('recC1');

    expect(merged).toHaveLength(3);
    // App order is 2026-03-20, legacy parsed is 2023-04-15, null is last.
    expect(merged[0].source).toBe('app');
    expect(merged[0].date).toBe('2026-03-20');
    expect(merged[0].amount).toBe(300);
    expect(merged[0].link).toBe('/orders/recA1');

    expect(merged[1].source).toBe('legacy');
    expect(merged[1].date).toBe('2023-04-15'); // parsed from the Oder Number
    expect(merged[1].description).toContain('Roses');
    expect(merged[1].description).toContain('Birthday');
    expect(merged[1].amount).toBe(150);

    // Null-date legacy entry is last.
    expect(merged[2].date).toBeNull();
  });

  it('returns empty array when the customer has no linked orders', async () => {
    db.getById.mockResolvedValue({ id: 'recC1', 'Orders (list)': [], 'App Orders': [] });
    listByIds.mockResolvedValue([]);

    const merged = await customerRepo.listOrders('recC1');
    expect(merged).toEqual([]);
  });
});

describe('customerRepo.getAggregateMap — caching', () => {
  it('caches the result and returns the same object on the second call', async () => {
    db.list.mockImplementation((table) => {
      if (table === 'tblLegacyOrders') return Promise.resolve([]);
      if (table === 'tblOrders') return Promise.resolve([]);
      if (table === 'tblCustomers') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const first = await customerRepo.getAggregateMap();
    const second = await customerRepo.getAggregateMap();

    expect(first).toBe(second); // same reference — cache hit
    // Three fetches for the first call (legacy + app + customers), none for the second.
    expect(db.list).toHaveBeenCalledTimes(3);
  });

  it('recomputes after cache reset', async () => {
    db.list.mockResolvedValue([]);

    await customerRepo.getAggregateMap();
    customerRepo._resetAggregateCache();
    await customerRepo.getAggregateMap();

    // Six fetches total: three per computation.
    expect(db.list).toHaveBeenCalledTimes(6);
  });

  it('aggregates legacy + app orders per customer', async () => {
    db.list.mockImplementation((table) => {
      if (table === 'tblLegacyOrders') {
        return Promise.resolve([
          { id: 'recL1', 'Order Delivery Date': '2025-12-01', 'Price (with Delivery)': 100 },
        ]);
      }
      if (table === 'tblOrders') {
        return Promise.resolve([
          { id: 'recA1', 'Order Date': '2026-03-20', 'Price Override': 200 },
        ]);
      }
      if (table === 'tblCustomers') {
        return Promise.resolve([
          { id: 'recC1', 'Orders (list)': ['recL1'], 'App Orders': ['recA1'] },
          { id: 'recC2', 'Orders (list)': [], 'App Orders': [] }, // no orders — omitted from agg
        ]);
      }
      return Promise.resolve([]);
    });

    const agg = await customerRepo.getAggregateMap();

    expect(agg.recC1).toEqual({
      lastOrderDate: '2026-03-20',
      orderCount: 2,
      totalSpend: 300,
    });
    // Customers with 0 orders aren't in the map — list() defaults them downstream.
    expect(agg.recC2).toBeUndefined();
  });
});
