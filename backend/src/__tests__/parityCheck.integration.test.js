// Parity check integration test — seeds an intentional drift between
// Airtable (mocked) and Postgres (pglite), then runs runParityCheck() and
// asserts the right parity_log rows are emitted.
//
// What we're proving:
//   • Airtable rows missing from PG → kind='missing_pg' rows logged.
//   • PG rows missing from Airtable → kind='missing_at' rows logged.
//   • Field-by-field divergence → kind='field_mismatch' rows logged
//     with the offending field name + both values.
//   • Identical state produces zero parity_log entries.
//   • runParityCheck returns accurate aggregate counts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, parityLog } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

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
  stockRepo._setMode('shadow');
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

// Helper: insert a PG row with airtable_id pre-set, mirroring backfill.
async function seedPgRow(fields) {
  const [row] = await harness.db.insert(stock).values({
    airtableId: fields.airtableId,
    displayName: fields['Display Name'],
    category: fields.Category ?? null,
    currentQuantity: fields['Current Quantity'] ?? 0,
    currentCostPrice: fields['Current Cost Price'] != null ? String(fields['Current Cost Price']) : null,
    currentSellPrice: fields['Current Sell Price'] != null ? String(fields['Current Sell Price']) : null,
    supplier: fields.Supplier ?? null,
    active: fields.Active !== false,
    deadStems: fields['Dead/Unsold Stems'] ?? 0,
  }).returning();
  return row;
}

describe('runParityCheck()', () => {
  it('returns clean summary when Airtable and PG match', async () => {
    const airtableRows = [
      { id: 'recA', 'Display Name': 'Rose', Category: 'Roses', 'Current Quantity': 10, Active: true, 'Dead/Unsold Stems': 0 },
      { id: 'recB', 'Display Name': 'Tulip', Category: 'Tulips', 'Current Quantity': 5, Active: true, 'Dead/Unsold Stems': 0 },
    ];
    airtable.list.mockResolvedValue(airtableRows);
    for (const r of airtableRows) await seedPgRow({ airtableId: r.id, ...r });

    const result = await stockRepo.runParityCheck();

    expect(result.ran).toBe(true);
    expect(result.airtableCount).toBe(2);
    expect(result.postgresCount).toBe(2);
    expect(result.mismatches).toEqual({});

    const parityRows = await harness.db.select().from(parityLog);
    expect(parityRows).toHaveLength(0);
  });

  it('flags Airtable rows missing from PG as missing_pg', async () => {
    airtable.list.mockResolvedValue([
      { id: 'recA', 'Display Name': 'Rose', 'Current Quantity': 10, Active: true, 'Dead/Unsold Stems': 0 },
      { id: 'recB', 'Display Name': 'Tulip', 'Current Quantity': 5, Active: true, 'Dead/Unsold Stems': 0 },
    ]);
    // Only seed recA — recB is missing in PG.
    await seedPgRow({ airtableId: 'recA', 'Display Name': 'Rose', 'Current Quantity': 10 });

    const result = await stockRepo.runParityCheck();

    expect(result.mismatches.missing_pg).toBe(1);

    const missing = await harness.db.select().from(parityLog);
    expect(missing).toHaveLength(1);
    expect(missing[0].kind).toBe('missing_pg');
    expect(missing[0].entityId).toBe('recB');
  });

  it('flags PG rows missing from Airtable as missing_at', async () => {
    airtable.list.mockResolvedValue([
      { id: 'recA', 'Display Name': 'Rose', 'Current Quantity': 10, Active: true, 'Dead/Unsold Stems': 0 },
    ]);
    await seedPgRow({ airtableId: 'recA', 'Display Name': 'Rose', 'Current Quantity': 10 });
    await seedPgRow({ airtableId: 'recOrphan', 'Display Name': 'Phantom', 'Current Quantity': 99 });

    const result = await stockRepo.runParityCheck();

    expect(result.mismatches.missing_at).toBe(1);

    const orphans = await harness.db.select().from(parityLog);
    expect(orphans.find(p => p.kind === 'missing_at').entityId).toBe('recOrphan');
  });

  it('flags field-level divergence as field_mismatch with both values', async () => {
    airtable.list.mockResolvedValue([
      { id: 'recA', 'Display Name': 'Rose', 'Current Quantity': 50, 'Current Cost Price': 4.5, Active: true, 'Dead/Unsold Stems': 0 },
    ]);
    // PG has different qty + price.
    await seedPgRow({ airtableId: 'recA', 'Display Name': 'Rose', 'Current Quantity': 30, 'Current Cost Price': 5.0 });

    const result = await stockRepo.runParityCheck();
    expect(result.mismatches.field_mismatch).toBeGreaterThanOrEqual(2);

    const mismatches = await harness.db.select().from(parityLog);
    const qtyDiff = mismatches.find(m => m.field === 'Current Quantity');
    expect(qtyDiff).toBeTruthy();
    expect(qtyDiff.airtableValue).toBe(50);
    expect(qtyDiff.postgresValue).toBe(30);

    const priceDiff = mismatches.find(m => m.field === 'Current Cost Price');
    expect(priceDiff).toBeTruthy();
    expect(priceDiff.airtableValue).toBe(4.5);
    expect(priceDiff.postgresValue).toBe(5);
  });

  it('treats null vs empty string vs missing as equal (no false positives)', async () => {
    airtable.list.mockResolvedValue([
      { id: 'recA', 'Display Name': 'Rose', 'Current Quantity': 10, Supplier: '',  Active: true, 'Dead/Unsold Stems': 0 },
    ]);
    // PG has Supplier=null (Airtable returns missing fields as undefined; '' on edited-then-cleared).
    await seedPgRow({ airtableId: 'recA', 'Display Name': 'Rose', 'Current Quantity': 10, Supplier: null });

    const result = await stockRepo.runParityCheck();
    expect(result.mismatches.field_mismatch ?? 0).toBe(0);
  });

  it('combined drift: each kind logged independently with correct counts', async () => {
    airtable.list.mockResolvedValue([
      { id: 'recA', 'Display Name': 'Rose', 'Current Quantity': 10, Active: true, 'Dead/Unsold Stems': 0 },
      { id: 'recB', 'Display Name': 'Tulip', 'Current Quantity': 5, Active: true, 'Dead/Unsold Stems': 0 },  // missing in PG
    ]);
    // recA has wrong qty; recOrphan exists only in PG.
    await seedPgRow({ airtableId: 'recA', 'Display Name': 'Rose', 'Current Quantity': 99 });
    await seedPgRow({ airtableId: 'recOrphan', 'Display Name': 'Ghost', 'Current Quantity': 1 });

    const result = await stockRepo.runParityCheck();

    expect(result.mismatches.missing_pg).toBe(1);    // recB
    expect(result.mismatches.missing_at).toBe(1);    // recOrphan
    expect(result.mismatches.field_mismatch).toBeGreaterThanOrEqual(1); // recA qty
  });

  it('returns ran:false when DATABASE_URL not configured (db is null)', async () => {
    dbHolder.db = null;
    const result = await stockRepo.runParityCheck();
    expect(result.ran).toBe(false);
    expect(result.reason).toMatch(/DATABASE_URL/);
  });
});
