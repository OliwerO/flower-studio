// stockRepo tests — pin the persistence-boundary behaviour for the Phase 3
// SQL migration cutover. We assert all three modes (airtable / shadow /
// postgres) on the same code paths so swapping STOCK_BACKEND can't quietly
// change the API the routes depend on.
//
// Mocking strategy: the real airtable.js + db/index.js + db/audit.js are
// stubbed so no real network or DB calls occur. The Drizzle handle exposes
// a chainable query-builder façade backed by mock functions; we assert on
// the methods that were called rather than executing real SQL.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── airtable.js mock — replaces the legacy single-store path. ──
vi.mock('../services/airtable.js', () => ({
  list:               vi.fn(),
  getById:            vi.fn(),
  create:             vi.fn(),
  update:             vi.fn(),
  deleteRecord:       vi.fn(),
  atomicStockAdjust:  vi.fn(),
}));

// ── config/airtable.js mock — TABLES.STOCK becomes a sentinel string. ──
vi.mock('../config/airtable.js', () => ({
  default: {},
  TABLES: {
    STOCK: 'tblStock',
  },
}));

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

import * as airtable from '../services/airtable.js';
import { recordAudit } from '../db/audit.js';
import * as stockRepo from '../repos/stockRepo.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockDb = makeMockDb();
  stockRepo._setMode('airtable');
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
// Airtable mode (today's behaviour — no PG involvement)
// ─────────────────────────────────────────────────────────────────────

describe('airtable mode', () => {
  beforeEach(() => stockRepo._setMode('airtable'));

  it('list() passes filterByFormula straight through to airtable.list', async () => {
    airtable.list.mockResolvedValue([{ id: 'recA', 'Display Name': 'Tulip' }]);
    const out = await stockRepo.list({ filterByFormula: '{Active} = TRUE()' });
    expect(airtable.list).toHaveBeenCalledWith('tblStock', { filterByFormula: '{Active} = TRUE()' });
    expect(out).toEqual([{ id: 'recA', 'Display Name': 'Tulip' }]);
  });

  it('create() drops disallowed fields and writes only to Airtable', async () => {
    airtable.create.mockResolvedValue({ id: 'recA', 'Display Name': 'Lily' });
    await stockRepo.create({ 'Display Name': 'Lily', BogusField: 'x' });
    expect(airtable.create).toHaveBeenCalledWith('tblStock', { 'Display Name': 'Lily' });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('create() throws 400 when Display Name missing', async () => {
    await expect(stockRepo.create({ Category: 'Roses' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(airtable.create).not.toHaveBeenCalled();
  });

  it('update() rejects when no allowed fields survive', async () => {
    await expect(stockRepo.update('recA', { BogusField: 'x' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(airtable.update).not.toHaveBeenCalled();
  });

  it('adjustQuantity() delegates to atomicStockAdjust', async () => {
    airtable.atomicStockAdjust.mockResolvedValue({ stockId: 'recA', previousQty: 5, newQty: 3 });
    const r = await stockRepo.adjustQuantity('recA', -2);
    expect(airtable.atomicStockAdjust).toHaveBeenCalledWith('recA', -2);
    expect(r).toEqual({ stockId: 'recA', previousQty: 5, newQty: 3 });
  });

  it('softDelete() sets Active=false in Airtable', async () => {
    airtable.update.mockResolvedValue({ id: 'recA', Active: false });
    await stockRepo.softDelete('recA');
    expect(airtable.update).toHaveBeenCalledWith('tblStock', 'recA', { Active: false });
  });

  it('restore() throws — restore requires PG-backed mode', async () => {
    await expect(stockRepo.restore('recA'))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Shadow mode (Airtable trusted, PG best-effort)
// ─────────────────────────────────────────────────────────────────────

describe('shadow mode', () => {
  beforeEach(() => stockRepo._setMode('shadow'));

  it('list() reads from Airtable (trusted store) — never touches PG', async () => {
    airtable.list.mockResolvedValue([{ id: 'recA' }]);
    const out = await stockRepo.list({ filterByFormula: '{Active}' });
    expect(airtable.list).toHaveBeenCalled();
    expect(out).toEqual([{ id: 'recA' }]);
  });

  it('create() writes Airtable first, then mirrors to PG with audit', async () => {
    airtable.create.mockResolvedValue({ id: 'recA', 'Display Name': 'Lily', 'Current Quantity': 5 });
    await stockRepo.create({ 'Display Name': 'Lily', 'Current Quantity': 5 }, {
      actor: { actorRole: 'florist', actorPinLabel: null },
    });
    expect(airtable.create).toHaveBeenCalledWith('tblStock', { 'Display Name': 'Lily', 'Current Quantity': 5 });
    expect(recordAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      entityType: 'stock',
      action: 'create',
      actorRole: 'florist',
    }));
  });

  it('create() returns Airtable response even when PG insert throws', async () => {
    airtable.create.mockResolvedValue({ id: 'recA', 'Display Name': 'Lily' });
    // Force PG insert to throw by replacing the transaction handler.
    mockDb.transaction = async () => { throw new Error('PG down'); };
    const out = await stockRepo.create({ 'Display Name': 'Lily' });
    expect(out).toEqual({ id: 'recA', 'Display Name': 'Lily' });
  });

  it('adjustQuantity() defers to atomicStockAdjust for the Airtable side', async () => {
    airtable.atomicStockAdjust.mockResolvedValue({ stockId: 'recA', previousQty: 10, newQty: 7 });
    const r = await stockRepo.adjustQuantity('recA', -3);
    expect(airtable.atomicStockAdjust).toHaveBeenCalledWith('recA', -3);
    expect(r.newQty).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Postgres mode
// ─────────────────────────────────────────────────────────────────────

describe('postgres mode', () => {
  beforeEach(() => {
    stockRepo._setMode('postgres');
    mockDb._reset();
  });

  it('list() never calls airtable.list', async () => {
    mockDb._setRows([]);
    await stockRepo.list({ pg: { active: true } });
    expect(airtable.list).not.toHaveBeenCalled();
  });

  it('create() inserts to PG with audit, returns Airtable-shaped response', async () => {
    const out = await stockRepo.create({ 'Display Name': 'Peony', 'Current Quantity': 12 }, {
      actor: { actorRole: 'owner', actorPinLabel: null },
    });
    expect(airtable.create).not.toHaveBeenCalled();
    expect(out['Display Name']).toBe('Peony');
    expect(out['Current Quantity']).toBe(12);
    expect(recordAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      entityType: 'stock',
      action: 'create',
      actorRole: 'owner',
    }));
  });

  it('softDelete() throws 404 when row not found', async () => {
    mockDb._setRows([]);
    await expect(stockRepo.softDelete('recMissing'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('restore() refuses without backend mode (already covered) — succeeds with audit in postgres mode', async () => {
    mockDb._setRows([{ id: 'pg-1', airtableId: 'recA', displayName: 'X', deletedAt: new Date(), active: false, currentQuantity: 0, deadStems: 0 }]);
    await stockRepo.restore('recA', { actor: { actorRole: 'owner' } });
    expect(recordAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'restore',
      actorRole: 'owner',
    }));
  });
});

// ─────────────────────────────────────────────────────────────────────
// valuesEqual (parity diff helper)
// ─────────────────────────────────────────────────────────────────────

describe('valuesEqual', () => {
  const { valuesEqual } = stockRepo._internal;

  it('treats null / undefined / empty string as equal', () => {
    expect(valuesEqual(null, undefined)).toBe(true);
    expect(valuesEqual('', null)).toBe(true);
    expect(valuesEqual(undefined, '')).toBe(true);
  });

  it('compares numbers strictly', () => {
    expect(valuesEqual(5, 5)).toBe(true);
    expect(valuesEqual(5, 6)).toBe(false);
  });

  it('compares booleans strictly', () => {
    expect(valuesEqual(true, true)).toBe(true);
    expect(valuesEqual(true, false)).toBe(false);
  });

  it('serialises arrays for content equality', () => {
    expect(valuesEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(valuesEqual(['a', 'b'], ['b', 'a'])).toBe(false);
  });

  it('does not coerce string-vs-number — Airtable always returns numbers for numeric fields', () => {
    // Locks the strict-equality contract. A string-shaped quantity from
    // either store would be a real bug worth surfacing, not papering over.
    expect(valuesEqual('5', 5)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Mode getter / setter
// ─────────────────────────────────────────────────────────────────────

describe('mode helpers', () => {
  it('_setMode + getBackendMode round-trip', () => {
    stockRepo._setMode('shadow');
    expect(stockRepo.getBackendMode()).toBe('shadow');
    stockRepo._setMode('postgres');
    expect(stockRepo.getBackendMode()).toBe('postgres');
  });

  it('_setMode rejects invalid values', () => {
    expect(() => stockRepo._setMode('mongo')).toThrow();
  });
});
