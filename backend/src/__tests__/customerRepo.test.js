// customerRepo tests — PG implementation (Phase 5).
// Mocks the Drizzle `db` handle, NOT airtable.js.
// Verifies: same public API, same wire format, same sort/merge behavior.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module — we verify which Drizzle calls are made, not real SQL.
vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
  },
  isPostgresConfigured: true,
}));

// Mock schema exports so imports resolve without a real DB.
vi.mock('../db/schema.js', () => ({
  customers:    {},
  keyPeople:    {},
  legacyOrders: {},
  orders:       {},
}));

// Mock drizzle-orm operators.
vi.mock('drizzle-orm', () => ({
  eq:     vi.fn((a, b) => ({ eq: [a, b] })),
  and:    vi.fn((...args) => ({ and: args })),
  or:     vi.fn((...args) => ({ or: args })),
  ilike:  vi.fn((col, pat) => ({ ilike: [col, pat] })),
  like:   vi.fn((col, pat) => ({ like: [col, pat] })),
  isNull: vi.fn((col) => ({ isNull: col })),
  asc:    vi.fn((col) => ({ asc: col })),
  desc:   vi.fn((col) => ({ desc: col })),
  sql:    vi.fn((s) => s),
}));

import { db } from '../db/index.js';
import * as repo from '../repos/customerRepo.js';

// Helper: build a fake customer PG row.
function makeRow(overrides = {}) {
  return {
    id:                  'uuid-cust-1',
    airtableId:          'recC1',
    name:                'Alice Kowalska',
    nickname:            'Ala',
    phone:               '+48 555 000 001',
    email:               'alice@test.com',
    link:                null,
    language:            'pl',
    homeAddress:         null,
    sexBusiness:         'Female',
    segment:             'Rare',
    foundUsFrom:         null,
    communicationMethod: 'WhatsApp',
    orderSource:         null,
    createdAt:           new Date('2026-01-01'),
    deletedAt:           null,
    ...overrides,
  };
}

// Helper: chainable Drizzle query mock that resolves to `rows`.
function makeChain(rows) {
  const chain = {
    from:    vi.fn().mockReturnThis(),
    where:   vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    limit:   vi.fn().mockReturnThis(),
    offset:  vi.fn().mockReturnThis(),
  };
  // Make it awaitable: both .then() and direct await work.
  const promise = Promise.resolve(rows);
  Object.assign(promise, chain);
  Object.keys(chain).forEach(k => {
    promise[k] = chain[k];
    chain[k].mockImplementation((...args) => {
      chain[k].mock.calls[chain[k].mock.calls.length - 1] = args; // track
      return promise;
    });
  });
  return promise;
}

beforeEach(() => {
  vi.clearAllMocks();
  repo._resetAggregateCache();
});

// ── pgCustomerToResponse ──
describe('_pgCustomerToResponse (wire format)', () => {
  it('maps PG row to Airtable-shaped response with field aliases', () => {
    const c = repo._pgCustomerToResponse(makeRow(), []);
    expect(c.id).toBe('uuid-cust-1');
    expect(c.Name).toBe('Alice Kowalska');
    expect(c.Nickname).toBe('Ala');
    expect(c.Phone).toBe('+48 555 000 001');
    expect(c.Segment).toBe('Rare');
    expect(c['Segment (client)']).toBe('Rare');
    expect(c['Communication method']).toBe('WhatsApp');
  });

  it('maps first two key_people to Key person 1/2 slots', () => {
    const kp1 = { id: 'kp-1', name: 'Bob', contactDetails: '0700', importantDate: '1990-03-15' };
    const kp2 = { id: 'kp-2', name: 'Carol', contactDetails: null, importantDate: null };
    const c = repo._pgCustomerToResponse(makeRow(), [kp1, kp2]);
    expect(c['Key person 1']).toBe('Bob');
    expect(c['Key person 1 (Name + Contact details)']).toBe('Bob');
    expect(c['Key person 1 (important DATE)']).toBe('1990-03-15');
    expect(c['Key person 2']).toBe('Carol');
    expect(c['Key person 2 (important DATE)']).toBeNull();
    expect(c._keyPeople).toHaveLength(2);
  });

  it('returns null for key person slots when keyPeople is empty', () => {
    const c = repo._pgCustomerToResponse(makeRow(), []);
    expect(c['Key person 1']).toBeNull();
    expect(c['Key person 2']).toBeNull();
  });
});

// ── list ──
describe('repo.list', () => {
  it('returns customers without _agg when withAggregates=false', async () => {
    db.select.mockReturnValue(makeChain([makeRow()]));
    const result = await repo.list({ withAggregates: false });
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('_agg');
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('enriches with _agg when withAggregates=true', async () => {
    const custChain = makeChain([makeRow()]);
    const aggChain  = makeChain([{ customerId: 'uuid-cust-1', lastOrderDate: '2026-04-01', orderCount: '3', totalSpend: '450.00' }]);
    db.select.mockReturnValueOnce(custChain).mockReturnValueOnce(aggChain);
    const result = await repo.list({ withAggregates: true });
    expect(result[0]._agg).toEqual({ lastOrderDate: '2026-04-01', orderCount: 3, totalSpend: 450 });
  });

  it('empty _agg for customers with no orders', async () => {
    const custChain = makeChain([makeRow()]);
    const aggChain  = makeChain([]);
    db.select.mockReturnValueOnce(custChain).mockReturnValueOnce(aggChain);
    const result = await repo.list({ withAggregates: true });
    expect(result[0]._agg).toEqual({ lastOrderDate: null, orderCount: 0, totalSpend: 0 });
  });
});

// ── getById ──
describe('repo.getById', () => {
  it('returns customer with computedSegment=Constant for 10+ orders', async () => {
    const custChain  = makeChain([makeRow()]);
    const kpChain    = makeChain([]);
    const countChain = makeChain([{ count: '12' }]);
    db.select
      .mockReturnValueOnce(custChain)
      .mockReturnValueOnce(kpChain)
      .mockReturnValueOnce(countChain);
    const c = await repo.getById('uuid-cust-1');
    expect(c.computedSegment).toBe('Constant');
  });

  it('computedSegment=New for 1 order', async () => {
    db.select
      .mockReturnValueOnce(makeChain([makeRow()]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([{ count: '1' }]));
    const c = await repo.getById('uuid-cust-1');
    expect(c.computedSegment).toBe('New');
  });

  it('throws 404-shaped error when customer not found', async () => {
    db.select.mockReturnValue(makeChain([]));
    await expect(repo.getById('no-such-uuid')).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ── create ──
describe('repo.create', () => {
  it('maps Airtable field names to PG columns', async () => {
    const insertedRow = makeRow();
    const returning = vi.fn().mockResolvedValue([insertedRow]);
    const values    = vi.fn().mockReturnValue({ returning });
    db.insert.mockReturnValue({ values });
    db.select.mockReturnValue(makeChain([])); // key_people fetch after insert
    await repo.create({ Name: 'Alice Kowalska', Phone: '+48 555 000 001', Segment: 'Rare' });
    const insertedValues = values.mock.calls[0][0];
    expect(insertedValues.name).toBe('Alice Kowalska');
    expect(insertedValues.phone).toBe('+48 555 000 001');
    expect(insertedValues.segment).toBe('Rare');
  });

  it('throws 400 when Name and Nickname are both missing', async () => {
    await expect(repo.create({ Phone: '+48 000' })).rejects.toMatchObject({ statusCode: 400 });
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ── update ──
describe('repo.update', () => {
  it('maps Segment alias → segment column', async () => {
    const updatedRow = makeRow({ segment: 'VIP' });
    const returning  = vi.fn().mockResolvedValue([updatedRow]);
    const where      = vi.fn().mockReturnValue({ returning });
    const set        = vi.fn().mockReturnValue({ where });
    db.update.mockReturnValue({ set });
    db.select.mockReturnValue(makeChain([]));
    const result = await repo.update('uuid-cust-1', { Segment: 'VIP' });
    const setCall = set.mock.calls[0][0];
    expect(setCall).toHaveProperty('segment', 'VIP');
    expect(result.Segment).toBe('VIP');
  });

  it('throws 400 when no recognised fields are in the patch body', async () => {
    await expect(repo.update('uuid-cust-1', { BogusField: 'x' })).rejects.toMatchObject({ statusCode: 400 });
    expect(db.update).not.toHaveBeenCalled();
  });
});

// ── listOrders ──
describe('repo.listOrders', () => {
  it('merges legacy + app orders, sorts date-desc, nulls last', async () => {
    const appRow    = { id: 'order-uuid-1', orderDate: '2026-03-20', customerRequest: 'Pink roses', priceOverride: '300.00', status: 'Delivered' };
    const legRow    = { id: 'lo-uuid-1', orderDate: '2023-04-15', description: 'Roses — Birthday', amount: '150.00' };
    const nullRow   = { id: 'lo-uuid-2', orderDate: null, description: 'Tulips', amount: '0' };
    db.select
      .mockReturnValueOnce(makeChain([appRow]))
      .mockReturnValueOnce(makeChain([legRow, nullRow]));
    const merged = await repo.listOrders('uuid-cust-1');
    expect(merged).toHaveLength(3);
    expect(merged[0].source).toBe('app');
    expect(merged[0].date).toBe('2026-03-20');
    expect(merged[0].amount).toBe(300);
    expect(merged[1].source).toBe('legacy');
    expect(merged[1].date).toBe('2023-04-15');
    expect(merged[2].date).toBeNull();
  });

  it('returns empty array when no orders exist', async () => {
    db.select
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]));
    const result = await repo.listOrders('uuid-cust-1');
    expect(result).toEqual([]);
  });
});

// ── getAggregateMap — caching ──
describe('repo.getAggregateMap — caching', () => {
  it('caches result; second call hits no new DB query', async () => {
    db.select.mockReturnValue(makeChain([
      { customerId: 'uuid-c1', lastOrderDate: '2026-04-01', orderCount: '2', totalSpend: '500.00' },
    ]));
    const first  = await repo.getAggregateMap();
    const second = await repo.getAggregateMap();
    expect(first).toBe(second);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('recomputes after cache reset', async () => {
    db.select.mockReturnValue(makeChain([]));
    await repo.getAggregateMap();
    repo._resetAggregateCache();
    await repo.getAggregateMap();
    expect(db.select).toHaveBeenCalledTimes(2);
  });
});
