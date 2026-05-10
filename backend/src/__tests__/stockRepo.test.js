// stockRepo tests — pin the persistence-boundary behaviour for the Postgres
// backend (Phase 7 PR 2b: Airtable fallback branches removed).
//
// Mocking strategy: db/index.js + db/audit.js are stubbed so no real network
// or DB calls occur. The Drizzle handle exposes a chainable query-builder
// façade backed by mock functions; we assert on the methods that were called
// rather than executing real SQL.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── db/audit.js mock — recordAudit captures arguments per call. ──
vi.mock('../db/audit.js', () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

// ── db/index.js mock — chainable query-builder façade. ──
//
// Each query returns an awaitable thenable backed by the mock store. The
// transaction() helper invokes its callback with the same façade so repo
// code that calls `db.transaction(async (tx) => ...)` sees a consistent API.
function makeMockDb() {
  // Per-test in-memory rows. Tests mutate via setRows().
  let rows = [];

  function chainable(initial) {
    let result = initial;
    const wrap = () => ({
      from:    () => wrap(),
      where:   () => wrap(),
      orderBy: () => wrap(),
      limit:   () => wrap(),
      values:  (v) => {
        const newRow = Array.isArray(v)
          ? v.map(r => ({ id: r.id || `pg-${Math.random().toString(36).slice(2, 8)}`, ...r }))
          : [{ id: v.id || `pg-${Math.random().toString(36).slice(2, 8)}`, ...v }];
        rows.push(...newRow);
        result = newRow;
        return wrap();
      },
      set:     (patch) => {
        result = result.map(r => ({ ...r, ...patch }));
        return wrap();
      },
      returning: () => Promise.resolve(result),
      then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
    });
    return wrap();
  }

  const dbHandle = {
    select: () => chainable(rows),
    insert: () => chainable([]),
    update: () => chainable(rows),
    delete: () => chainable(rows),
    transaction: async (cb) => cb(dbHandle),
    _setRows: (next) => { rows = next; },
    _getRows: () => rows,
    _reset:   () => { rows = []; },
  };
  return dbHandle;
}

let mockDb;

vi.mock('../db/index.js', () => {
  // Re-evaluated once at module load. We replace `db` per test via the proxy
  // below so each test starts with fresh rows.
  return {
    get db() { return mockDb; },
    isPostgresConfigured: true,
    pool: null,
    connectPostgres: vi.fn(),
    disconnectPostgres: vi.fn(),
  };
});

// ── schema mock — pgTable returns column placeholder objects. The real
//    Drizzle column objects carry SQL-generation magic; we don't need that
//    for our chainable façade so trivial sentinels suffice. ──
vi.mock('../db/schema.js', () => {
  const stockCols = {
    id: 'stock.id',
    airtableId: 'stock.airtable_id',
    displayName: 'stock.display_name',
    category: 'stock.category',
    currentQuantity: 'stock.current_quantity',
    active: 'stock.active',
    deletedAt: 'stock.deleted_at',
  };
  const parityCols = {};
  return { stock: stockCols, parityLog: parityCols };
});

// ── drizzle-orm helper mocks — return descriptive sentinels so we can assert
//    on which conditions were used. The real fns produce SQL fragments. ──
vi.mock('drizzle-orm', () => {
  const mk = (kind) => (...args) => ({ kind, args });
  return {
    and:     mk('and'),
    eq:      mk('eq'),
    isNull:  mk('isNull'),
    inArray: mk('inArray'),
    gt:      mk('gt'),
    sql:     Object.assign((...args) => ({ kind: 'sql', args }), {
      raw: (s) => ({ kind: 'sql.raw', value: s }),
    }),
  };
});

import { recordAudit } from '../db/audit.js';
import * as stockRepo from '../repos/stockRepo.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockDb = makeMockDb();
});

// ─────────────────────────────────────────────────────────────────────
// Wire-format mapping
// ─────────────────────────────────────────────────────────────────────

describe('pgToResponse + responseToPg round-trip', () => {
  const { pgToResponse, responseToPg } = stockRepo._internal;

  it('translates a fully-populated PG row to Airtable wire shape', () => {
    const row = {
      id: 'uuid-123', airtableId: 'recABC',
      displayName: 'Red Rose', purchaseName: 'Rose Red Imp',
      category: 'Roses', currentQuantity: 50, unit: 'stem',
      currentCostPrice: '4.50', currentSellPrice: '15.00',
      supplier: 'WholesaleCo', reorderThreshold: 10,
      active: true, supplierNotes: 'fresh weekly',
      deadStems: 3, lotSize: 25, farmer: 'Kowalski',
      lastRestocked: '2026-04-25',
      substituteFor: ['recOther'],
    };
    const resp = pgToResponse(row);
    expect(resp.id).toBe('recABC');         // recXXX takes priority during cutover
    expect(resp._pgId).toBe('uuid-123');
    expect(resp['Display Name']).toBe('Red Rose');
    expect(resp['Current Cost Price']).toBe(4.5);   // numeric → number
    expect(resp['Substitute For']).toEqual(['recOther']);
  });

  it('falls back to PG uuid when airtable_id is null (post-Phase 7)', () => {
    const resp = pgToResponse({ id: 'uuid-456', airtableId: null, displayName: 'X', currentQuantity: 0, deadStems: 0, active: true });
    expect(resp.id).toBe('uuid-456');
  });

  it('responseToPg only carries keys present in the input (partial update)', () => {
    const out = responseToPg({ 'Current Quantity': 7, Active: false });
    expect(out).toEqual({ currentQuantity: 7, active: false });
  });

  it('responseToPg coerces numeric prices to strings to preserve precision', () => {
    const out = responseToPg({ 'Current Cost Price': 4.5, 'Current Sell Price': 15 });
    expect(out.currentCostPrice).toBe('4.5');
    expect(out.currentSellPrice).toBe('15');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Postgres mode
// ─────────────────────────────────────────────────────────────────────

describe('postgres mode', () => {
  beforeEach(() => {
    mockDb._reset();
  });

  it('list() never calls airtable (no airtable dependency)', async () => {
    mockDb._setRows([]);
    // Should complete without error — PG-only path.
    await stockRepo.list({ pg: { active: true } });
  });

  it('create() inserts to PG with audit, returns Airtable-shaped response', async () => {
    const out = await stockRepo.create({ 'Display Name': 'Peony', 'Current Quantity': 12 }, {
      actor: { actorRole: 'owner', actorPinLabel: null },
    });
    expect(out['Display Name']).toBe('Peony');
    expect(out['Current Quantity']).toBe(12);
    expect(recordAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      entityType: 'stock',
      action: 'create',
      actorRole: 'owner',
    }));
  });

  it('create() throws 400 when Display Name missing', async () => {
    await expect(stockRepo.create({ Category: 'Roses' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('update() rejects when no allowed fields survive', async () => {
    await expect(stockRepo.update('recA', { BogusField: 'x' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('softDelete() throws 404 when row not found', async () => {
    mockDb._setRows([]);
    await expect(stockRepo.softDelete('recMissing'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('restore() succeeds with audit in postgres mode', async () => {
    mockDb._setRows([{ id: 'pg-1', airtableId: 'recA', displayName: 'X', deletedAt: new Date(), active: false, currentQuantity: 0, deadStems: 0 }]);
    await stockRepo.restore('recA', { actor: { actorRole: 'owner' } });
    expect(recordAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'restore',
      actorRole: 'owner',
    }));
  });

  it('getBackendMode() always returns postgres', () => {
    expect(stockRepo.getBackendMode()).toBe('postgres');
  });
});

// ─────────────────────────────────────────────────────────────────────
// computeDemandDate — pure helper, no DB I/O
// ─────────────────────────────────────────────────────────────────────

describe('computeDemandDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns requiredBy when present', () => {
    const result = stockRepo.computeDemandDate({ requiredBy: '2026-05-15', orderDate: '2026-05-10' });
    expect(result).toBe('2026-05-15');
  });

  it('returns orderDate when requiredBy is absent', () => {
    const result = stockRepo.computeDemandDate({ orderDate: '2026-05-10' });
    expect(result).toBe('2026-05-10');
  });

  it('returns today (YYYY-MM-DD) when neither is present', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
    const result = stockRepo.computeDemandDate({});
    expect(result).toBe('2026-05-10');
  });

  it('returns today when called with no argument', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
    const result = stockRepo.computeDemandDate();
    expect(result).toBe('2026-06-01');
  });

  it('null requiredBy falls through to orderDate', () => {
    const result = stockRepo.computeDemandDate({ requiredBy: null, orderDate: '2026-05-12' });
    expect(result).toBe('2026-05-12');
  });
});
