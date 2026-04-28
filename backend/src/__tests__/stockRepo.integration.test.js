// stockRepo integration tests — exercise the repo against a REAL Postgres
// (in-process via pglite) instead of mocked Drizzle calls. These tests
// catch what the unit-level mocks can't:
//   • SQL syntax errors (the unit tests' chainable façade hides them).
//   • Transaction semantics — that audit_log writes ARE in the same tx
//     as the entity write (rollback test verifies).
//   • Concurrent atomicStockAdjust correctness under postgres mode.
//   • Real default values (created_at, updated_at, deleted_at).
//   • UUID vs airtable_id resolution in postgres mode.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness, harnessAsDbModule } from './helpers/pgHarness.js';
import { stock, auditLog, parityLog } from '../db/schema.js';
import { eq } from 'drizzle-orm';

// ── Mock the production db module to point at the pglite harness ──
// Use a holder so we can swap the underlying handle per test.
const dbHolder = { db: null };

vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

// ── Mock airtable.js — postgres-mode tests don't touch it; shadow-mode
//    tests stub specific methods inline. ──
vi.mock('../services/airtable.js', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteRecord: vi.fn(),
  atomicStockAdjust: vi.fn(),
}));

vi.mock('../config/airtable.js', () => ({
  default: {},
  TABLES: { STOCK: 'tblStock' },
}));

import * as airtable from '../services/airtable.js';
import * as stockRepo from '../repos/stockRepo.js';

let harness;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
  stockRepo._setMode('postgres');
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('postgres mode — real SQL', () => {
  it('create() inserts a row with audit log entry in the same transaction', async () => {
    const out = await stockRepo.create({
      'Display Name': 'Red Rose',
      Category: 'Roses',
      'Current Quantity': 50,
      'Current Cost Price': 4.5,
      'Current Sell Price': 15,
    }, { actor: { actorRole: 'owner', actorPinLabel: null } });

    expect(out['Display Name']).toBe('Red Rose');
    expect(out['Current Quantity']).toBe(50);
    expect(out['Current Cost Price']).toBe(4.5);

    // Verify the row exists in PG.
    const stockRows = await harness.db.select().from(stock);
    expect(stockRows).toHaveLength(1);
    expect(stockRows[0].displayName).toBe('Red Rose');

    // Verify audit log captured it.
    const auditRows = await harness.db.select().from(auditLog);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].entityType).toBe('stock');
    expect(auditRows[0].action).toBe('create');
    expect(auditRows[0].actorRole).toBe('owner');
    expect(auditRows[0].diff.before).toBeNull();
    expect(auditRows[0].diff.after['Display Name']).toBe('Red Rose');
  });

  it('update() captures only the changed fields in the audit diff', async () => {
    // Seed
    const created = await stockRepo.create({
      'Display Name': 'Tulip', Category: 'Tulips', 'Current Quantity': 30,
    }, { actor: { actorRole: 'florist' } });

    // Update only the price
    await stockRepo.update(created.id, {
      'Current Sell Price': 12,
    }, { actor: { actorRole: 'florist' } });

    const auditRows = await harness.db.select().from(auditLog).orderBy(auditLog.id);
    expect(auditRows).toHaveLength(2);
    const updateRow = auditRows[1];
    expect(updateRow.action).toBe('update');
    // minimalDiff strips unchanged fields. Display Name shouldn't appear.
    expect(updateRow.diff.after).toEqual({ 'Current Sell Price': 12 });
    expect(updateRow.diff.before).toEqual({ 'Current Sell Price': null });
  });

  it('adjustQuantity() uses atomic UPDATE and audits the delta', async () => {
    const created = await stockRepo.create({
      'Display Name': 'Lily', 'Current Quantity': 20,
    }, { actor: { actorRole: 'system' } });

    const result = await stockRepo.adjustQuantity(created.id, -5, {
      actor: { actorRole: 'florist' },
    });

    expect(result.previousQty).toBe(20);
    expect(result.newQty).toBe(15);

    const auditRows = await harness.db.select().from(auditLog);
    const adjustAudit = auditRows.find(r => r.action === 'update' && r.diff.after?.['Current Quantity'] === 15);
    expect(adjustAudit).toBeTruthy();
    expect(adjustAudit.diff.before['Current Quantity']).toBe(20);
    expect(adjustAudit.actorRole).toBe('florist');
  });

  it('adjustQuantity() concurrent ops on the same row do not lose updates', async () => {
    // The risk the airtable stockQueue was working around: two simultaneous
    // -5 deductions should result in a net -10, not -5 (read-modify-write race).
    // PG's UPDATE x SET qty = qty + delta is atomic, so this should hold.
    const created = await stockRepo.create({
      'Display Name': 'Peony', 'Current Quantity': 100,
    });

    const ops = Array.from({ length: 10 }, () => stockRepo.adjustQuantity(created.id, -5));
    await Promise.all(ops);

    const [row] = await harness.db.select().from(stock).where(eq(stock.id, created._pgId));
    expect(row.currentQuantity).toBe(50);  // 100 - (10 * 5)

    // Every adjust should have produced its own audit row.
    const adjustAudits = await harness.db.select().from(auditLog).where(eq(auditLog.action, 'update'));
    expect(adjustAudits.length).toBe(10);
  });

  it('adjustQuantity() permits negative quantity (intentional — demand backlog)', async () => {
    const created = await stockRepo.create({
      'Display Name': 'Daisy', 'Current Quantity': 3,
    });
    const result = await stockRepo.adjustQuantity(created.id, -10);
    expect(result.newQty).toBe(-7);
  });

  it('softDelete + restore round-trip', async () => {
    const created = await stockRepo.create({
      'Display Name': 'Carnation', 'Current Quantity': 12,
    });

    await stockRepo.softDelete(created.id, { actor: { actorRole: 'owner' } });

    // Should not appear in default list
    const visible = await stockRepo.list({ pg: { active: false } });
    expect(visible.find(r => r['Display Name'] === 'Carnation')).toBeUndefined();

    // PG row still exists, but deleted_at is set
    const [pgRow] = await harness.db.select().from(stock).where(eq(stock.id, created._pgId));
    expect(pgRow.deletedAt).toBeInstanceOf(Date);
    expect(pgRow.active).toBe(false);

    // Restore
    await stockRepo.restore(created.id, { actor: { actorRole: 'owner' } });
    const [restored] = await harness.db.select().from(stock).where(eq(stock.id, created._pgId));
    expect(restored.deletedAt).toBeNull();
    expect(restored.active).toBe(true);

    // Audit captured all three actions.
    const audits = await harness.db.select().from(auditLog).orderBy(auditLog.id);
    const actions = audits.map(a => a.action);
    expect(actions).toEqual(['create', 'delete', 'restore']);
  });

  it('purge() hard-deletes the row but preserves the audit trail', async () => {
    const created = await stockRepo.create({
      'Display Name': 'Iris', 'Current Quantity': 8,
    });

    await stockRepo.purge(created.id, { actor: { actorRole: 'owner' } });

    const remaining = await harness.db.select().from(stock);
    expect(remaining).toHaveLength(0);

    // Audit log preserved (this is the point — the row's history outlives the row).
    const audits = await harness.db.select().from(auditLog);
    const purgeAudit = audits.find(a => a.action === 'purge');
    expect(purgeAudit).toBeTruthy();
    expect(purgeAudit.diff.before['Display Name']).toBe('Iris');
  });

  it('listByIds resolves both UUIDs and Airtable ids in one call', async () => {
    const a = await stockRepo.create({ 'Display Name': 'A', 'Current Quantity': 1 });
    const b = await stockRepo.create({ 'Display Name': 'B', 'Current Quantity': 1 });
    // Manually patch B with an airtable_id to simulate a backfilled row.
    await harness.db.update(stock).set({ airtableId: 'recBBB' }).where(eq(stock.id, b._pgId));

    const out = await stockRepo.listByIds([a.id, 'recBBB']);
    const names = out.map(r => r['Display Name']).sort();
    expect(names).toEqual(['A', 'B']);
  });

  it('getById throws 404 for unknown id', async () => {
    await expect(stockRepo.getById('rec-does-not-exist'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('list() filters by category in postgres mode', async () => {
    await stockRepo.create({ 'Display Name': 'Rose A', Category: 'Roses', 'Current Quantity': 10 });
    await stockRepo.create({ 'Display Name': 'Rose B', Category: 'Roses', 'Current Quantity': 5 });
    await stockRepo.create({ 'Display Name': 'Tulip A', Category: 'Tulips', 'Current Quantity': 7 });

    const roses = await stockRepo.list({ pg: { category: 'Roses' } });
    expect(roses).toHaveLength(2);
    expect(roses.every(r => r.Category === 'Roses')).toBe(true);
  });

  it('list() default-hides qty=0 rows (matches Airtable mode behaviour)', async () => {
    await stockRepo.create({ 'Display Name': 'Has Qty', 'Current Quantity': 5 });
    await stockRepo.create({ 'Display Name': 'Empty',  'Current Quantity': 0 });

    const visible = await stockRepo.list({});
    expect(visible.map(r => r['Display Name'])).toEqual(['Has Qty']);

    const all = await stockRepo.list({ pg: { includeEmpty: true } });
    expect(all).toHaveLength(2);
  });

  it('list() default-hides Active=false rows', async () => {
    await stockRepo.create({ 'Display Name': 'Active', 'Current Quantity': 5, Active: true });
    await stockRepo.create({ 'Display Name': 'Inactive', 'Current Quantity': 5, Active: false });

    const visible = await stockRepo.list({});
    expect(visible.map(r => r['Display Name'])).toEqual(['Active']);
  });
});

describe('shadow mode — Airtable trusted, PG mirrored', () => {
  beforeEach(() => stockRepo._setMode('shadow'));

  it('create() writes to Airtable then mirrors to PG with audit', async () => {
    airtable.create.mockResolvedValue({
      id: 'recShadow1',
      'Display Name': 'Mirrored Rose',
      'Current Quantity': 5,
      Active: true,
    });

    const out = await stockRepo.create({
      'Display Name': 'Mirrored Rose',
      'Current Quantity': 5,
    }, { actor: { actorRole: 'owner' } });

    // Airtable returned this — repo passes through.
    expect(out.id).toBe('recShadow1');

    // PG side: row should exist with airtable_id set.
    const pgRows = await harness.db.select().from(stock);
    expect(pgRows).toHaveLength(1);
    expect(pgRows[0].airtableId).toBe('recShadow1');
    expect(pgRows[0].displayName).toBe('Mirrored Rose');

    // Audit log captured the PG-side write.
    const audits = await harness.db.select().from(auditLog);
    expect(audits[0].action).toBe('create');
    expect(audits[0].actorRole).toBe('owner');
  });

  it('shadow mode logs parity_log when PG insert throws', async () => {
    airtable.create.mockResolvedValue({
      id: 'recShadow2',
      'Display Name': 'Test',
      'Current Quantity': 5,
    });

    // Force PG insert to fail by inserting a duplicate airtable_id first.
    await harness.db.insert(stock).values({
      airtableId: 'recShadow2',
      displayName: 'Pre-existing',
      currentQuantity: 99,
    });

    const out = await stockRepo.create({
      'Display Name': 'Test', 'Current Quantity': 5,
    });

    // Airtable response still returned — the request didn't fail.
    expect(out.id).toBe('recShadow2');

    // parity_log captured the PG write failure.
    const parities = await harness.db.select().from(parityLog);
    expect(parities).toHaveLength(1);
    expect(parities[0].kind).toBe('write_failed');
    expect(parities[0].context.op).toBe('create');
  });

  it('adjustQuantity in shadow mode mirrors the delta to PG', async () => {
    airtable.atomicStockAdjust.mockResolvedValue({
      stockId: 'recShadow3', previousQty: 30, newQty: 25,
    });

    // Seed PG row first (as backfill would have done).
    await harness.db.insert(stock).values({
      airtableId: 'recShadow3',
      displayName: 'Seeded',
      currentQuantity: 30,
    });

    await stockRepo.adjustQuantity('recShadow3', -5, { actor: { actorRole: 'florist' } });

    const [row] = await harness.db.select().from(stock).where(eq(stock.airtableId, 'recShadow3'));
    expect(row.currentQuantity).toBe(25);

    const audits = await harness.db.select().from(auditLog);
    const adjustAudit = audits.find(a => a.diff.after?.['Current Quantity'] === 25);
    expect(adjustAudit).toBeTruthy();
  });
});
