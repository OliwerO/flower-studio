// stockOrderRepo integration tests — exercise against real Postgres (pglite).
// Catches SQL syntax errors, default values, FK CASCADE behaviour, and
// dual-lookup correctness. Phase 7 of the SQL migration.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stockOrders, stockOrderLines, stock } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import * as stockOrderRepo from '../repos/stockOrderRepo.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('stockOrderRepo header CRUD', () => {
  it('create() inserts with sensible defaults', async () => {
    const po = await stockOrderRepo.create({
      'Stock Order ID': 'PO-20260508-1',
      'Created Date':   '2026-05-08',
      Status:           'Draft',
    });
    expect(po.Status).toBe('Draft');
    expect(po['Stock Order ID']).toBe('PO-20260508-1');
    expect(po._pgId).toBeDefined();
    expect(po['Created Date']).toBe('2026-05-08');
  });

  it('create() defaults Created Date to today when omitted', async () => {
    const po = await stockOrderRepo.create({
      'Stock Order ID': 'PO-NODATE',
      Status:           'Draft',
    });
    expect(po['Created Date']).toBe(new Date().toISOString().split('T')[0]);
  });

  it('getById() resolves recXXX via airtable_id and uuid via primary key', async () => {
    const [row] = await harness.db.insert(stockOrders).values({
      airtableId:  'recABC123',
      poNumber:    'PO-20260101-1',
      createdDate: '2026-01-01',
    }).returning();

    const byAt = await stockOrderRepo.getById('recABC123');
    expect(byAt._pgId).toBe(row.id);
    expect(byAt.id).toBe('recABC123');

    const byUuid = await stockOrderRepo.getById(row.id);
    expect(byUuid._pgId).toBe(row.id);
  });

  it('getById() throws 404 for missing id', async () => {
    await expect(stockOrderRepo.getById('recDOESNOTEXIST'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('nextPoSequence() returns MAX(N)+1 for the date with gaps', async () => {
    await harness.db.insert(stockOrders).values([
      { poNumber: 'PO-20260508-1', createdDate: '2026-05-08' },
      { poNumber: 'PO-20260508-3', createdDate: '2026-05-08' },  // gap at 2
      { poNumber: 'PO-20260507-2', createdDate: '2026-05-07' },
    ]);
    const seq = await stockOrderRepo.nextPoSequence('2026-05-08');
    expect(seq).toBe(4);
  });

  it('nextPoSequence() returns 1 when no POs exist for the date', async () => {
    await harness.db.insert(stockOrders).values([
      { poNumber: 'PO-20260507-2', createdDate: '2026-05-07' },
    ]);
    const seq = await stockOrderRepo.nextPoSequence('2026-05-08');
    expect(seq).toBe(1);
  });

  it('nextPoSequence() rejects non-numeric tails (defensive)', async () => {
    await harness.db.insert(stockOrders).values([
      { poNumber: 'PO-20260508-5abc', createdDate: '2026-05-08' },  // malformed
      { poNumber: 'PO-20260508-2', createdDate: '2026-05-08' },
    ]);
    const seq = await stockOrderRepo.nextPoSequence('2026-05-08');
    expect(seq).toBe(3);  // ignores malformed, uses 2 as MAX
  });

  it('update() patches only provided fields', async () => {
    const po = await stockOrderRepo.create({ 'Stock Order ID': 'PO-X', 'Created Date': '2026-05-08' });
    const updated = await stockOrderRepo.update(po._pgId, {
      Status: 'Sent', 'Assigned Driver': 'Timur',
    });
    expect(updated.Status).toBe('Sent');
    expect(updated['Assigned Driver']).toBe('Timur');
    expect(updated['Stock Order ID']).toBe('PO-X');  // unchanged
  });

  it('update() accepts recXXX id', async () => {
    const [row] = await harness.db.insert(stockOrders).values({
      airtableId:  'recUPD1',
      poNumber:    'PO-U',
      createdDate: '2026-05-08',
    }).returning();
    const updated = await stockOrderRepo.update('recUPD1', { Status: 'Sent' });
    expect(updated.Status).toBe('Sent');
    expect(updated._pgId).toBe(row.id);
  });

  it('list() filters by status and driver scope', async () => {
    await harness.db.insert(stockOrders).values([
      { poNumber: 'PO-A', createdDate: '2026-05-08', status: 'Draft', assignedDriver: 'Timur' },
      { poNumber: 'PO-B', createdDate: '2026-05-08', status: 'Sent',  assignedDriver: 'Timur' },
      { poNumber: 'PO-C', createdDate: '2026-05-08', status: 'Draft', assignedDriver: 'Nikita' },
    ]);
    const draftAll  = await stockOrderRepo.list({ status: 'Draft' });
    expect(draftAll).toHaveLength(2);
    const draftTimur = await stockOrderRepo.list({ status: 'Draft', role: 'driver', driverName: 'Timur' });
    expect(draftTimur).toHaveLength(1);
    expect(draftTimur[0]['Stock Order ID']).toBe('PO-A');
  });

  it('listByIds() accepts mixed recXXX/uuid arrays', async () => {
    const [row1] = await harness.db.insert(stockOrders).values({
      airtableId: 'recMIX1', poNumber: 'PO-1', createdDate: '2026-05-08',
    }).returning();
    const [row2] = await harness.db.insert(stockOrders).values({
      poNumber: 'PO-2', createdDate: '2026-05-08',
    }).returning();
    const found = await stockOrderRepo.listByIds(['recMIX1', row2.id]);
    expect(found).toHaveLength(2);
  });
});

describe('stockOrderRepo line CRUD', () => {
  it('CASCADE deletes lines when PO is deleted', async () => {
    const po = await stockOrderRepo.create({ 'Stock Order ID': 'PO-CD', 'Created Date': '2026-05-08' });
    await stockOrderRepo.createLine({
      'Stock Orders':    [po._pgId],
      'Flower Name':     'Rose',
      'Quantity Needed': 25,
    });
    let lines = await stockOrderRepo.getLinesByPoId(po._pgId);
    expect(lines).toHaveLength(1);

    await stockOrderRepo.deleteById(po._pgId);
    lines = await harness.db.select().from(stockOrderLines).where(eq(stockOrderLines.poId, po._pgId));
    expect(lines).toHaveLength(0);
  });

  it('Stock Item link routes to stock_id (uuid) or stock_airtable_id (recXXX)', async () => {
    const [s] = await harness.db.insert(stock).values({
      displayName: 'Rose', currentQuantity: 10, active: true,
    }).returning();

    const po = await stockOrderRepo.create({ 'Stock Order ID': 'PO-S', 'Created Date': '2026-05-08' });
    const line1 = await stockOrderRepo.createLine({
      'Stock Orders': [po._pgId], 'Stock Item': [s.id], 'Flower Name': 'Rose',
    });
    const line2 = await stockOrderRepo.createLine({
      'Stock Orders': [po._pgId], 'Stock Item': ['recXYZ789'], 'Flower Name': 'Tulip',
    });

    const [r1] = await harness.db.select().from(stockOrderLines).where(eq(stockOrderLines.id, line1._pgId));
    const [r2] = await harness.db.select().from(stockOrderLines).where(eq(stockOrderLines.id, line2._pgId));
    expect(r1.stockId).toBe(s.id);
    expect(r1.stockAirtableId).toBeNull();
    expect(r2.stockAirtableId).toBe('recXYZ789');
    expect(r2.stockId).toBeNull();
  });

  it('updateLine maps Alt * fields to substitute_* columns', async () => {
    const po = await stockOrderRepo.create({ 'Stock Order ID': 'PO-A', 'Created Date': '2026-05-08' });
    const line = await stockOrderRepo.createLine({
      'Stock Orders': [po._pgId], 'Flower Name': 'Rose',
    });
    await stockOrderRepo.updateLine(line._pgId, {
      'Alt Flower Name':    'Pink Rose',
      'Alt Cost':           4.5,
      'Alt Quantity Found': 20,
      'Alt Supplier':       'Market B',
      // Substitute Variety identity classified at shopping entry (#2)
      'Alt Type':           'Rose',
      'Alt Colour':         'Pink',
      'Alt Size':           50,
      'Alt Cultivar':       'Pink Ohara',
    });
    const [r] = await harness.db.select().from(stockOrderLines).where(eq(stockOrderLines.id, line._pgId));
    expect(r.substituteFlowerName).toBe('Pink Rose');
    expect(Number(r.substituteCost)).toBe(4.5);
    expect(r.substituteQuantityFound).toBe(20);
    expect(r.substituteSupplier).toBe('Market B');
    expect(r.substituteTypeName).toBe('Rose');
    expect(r.substituteColour).toBe('Pink');
    expect(r.substituteSizeCm).toBe(50);
    expect(r.substituteCultivar).toBe('Pink Ohara');
  });

  it('updateLine normalises a blank Alt Type / zero Alt Size to NULL', async () => {
    const po = await stockOrderRepo.create({ 'Stock Order ID': 'PO-AN', 'Created Date': '2026-05-08' });
    const line = await stockOrderRepo.createLine({ 'Stock Orders': [po._pgId], 'Flower Name': 'Rose' });
    await stockOrderRepo.updateLine(line._pgId, { 'Alt Type': '  ', 'Alt Size': 0, 'Alt Colour': '' });
    const [r] = await harness.db.select().from(stockOrderLines).where(eq(stockOrderLines.id, line._pgId));
    expect(r.substituteTypeName).toBeNull();
    expect(r.substituteSizeCm).toBeNull();
    expect(r.substituteColour).toBeNull();
  });

  it('lineToWire reads substitute_* back as Alt * for API surface', async () => {
    const po = await stockOrderRepo.create({ 'Stock Order ID': 'PO-W', 'Created Date': '2026-05-08' });
    const line = await stockOrderRepo.createLine({
      'Stock Orders':       [po._pgId],
      'Flower Name':        'Rose',
      'Alt Flower Name':    'Pink Rose',
      'Alt Cost':           4.5,
      'Alt Quantity Found': 20,
      'Alt Type':           'Rose',
      'Alt Colour':         'Pink',
      'Alt Size':           50,
      'Alt Cultivar':       'Pink Ohara',
    });
    expect(line['Alt Flower Name']).toBe('Pink Rose');
    expect(line['Alt Cost']).toBe(4.5);
    expect(line['Alt Quantity Found']).toBe(20);
    expect(line['Alt Type']).toBe('Rose');
    expect(line['Alt Colour']).toBe('Pink');
    expect(line['Alt Size']).toBe(50);
    expect(line['Alt Cultivar']).toBe('Pink Ohara');
  });

  it('getLinesForPos returns Map<pgUuid, line[]>', async () => {
    const po1 = await stockOrderRepo.create({ 'Stock Order ID': 'PO-M1', 'Created Date': '2026-05-08' });
    const po2 = await stockOrderRepo.create({ 'Stock Order ID': 'PO-M2', 'Created Date': '2026-05-08' });
    await stockOrderRepo.createLine({ 'Stock Orders': [po1._pgId], 'Flower Name': 'A', 'Quantity Needed': 1 });
    await stockOrderRepo.createLine({ 'Stock Orders': [po1._pgId], 'Flower Name': 'B', 'Quantity Needed': 2 });
    await stockOrderRepo.createLine({ 'Stock Orders': [po2._pgId], 'Flower Name': 'C', 'Quantity Needed': 3 });

    const map = await stockOrderRepo.getLinesForPos([po1._pgId, po2._pgId]);
    expect(map.get(po1._pgId)).toHaveLength(2);
    expect(map.get(po2._pgId)).toHaveLength(1);
  });

  it('getLinesByPoId accepts recXXX or uuid', async () => {
    const [row] = await harness.db.insert(stockOrders).values({
      airtableId: 'recPO_LINES', poNumber: 'PO-L', createdDate: '2026-05-08',
    }).returning();
    await stockOrderRepo.createLine({
      'Stock Orders': [row.id], 'Flower Name': 'Lily', 'Quantity Needed': 5,
    });

    const byAt = await stockOrderRepo.getLinesByPoId('recPO_LINES');
    expect(byAt).toHaveLength(1);
    const byUuid = await stockOrderRepo.getLinesByPoId(row.id);
    expect(byUuid).toHaveLength(1);
  });
});

describe('write-off retry idempotency (T9 review carry-over — captures pre-existing gap)', () => {
  // The PO evaluate flow logs write-offs into stock_loss_log via fire-and-forget
  // promises with NO marker-based skip guard. On EVAL_ERROR retry, write-offs
  // re-run — duplicating loss rows. ADR-0003 marker idempotency was extended
  // to receives (stock_purchases) only.
  //
  // This test documents the gap. Fixing it requires adding a marker to
  // stockLossRepo.create + a lossMarkerExists analog. Tracked in BACKLOG.
  it.todo('write-off should be idempotent on PO evaluate retry — pre-existing gap, see BACKLOG');
});
