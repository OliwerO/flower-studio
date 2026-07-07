// Integration tests for PO evaluate write-off idempotency — closes the gap
// tracked by the (now-deleted) it.todo in stockOrderRepo.integration.test.js
// and BACKLOG's "PO evaluate write-off retry idempotency" entry.
//
// What we're proving:
//   - A retry of evaluatePurchaseOrder (after a partial failure moved the PO
//     to Eval Error) does NOT duplicate stock_loss_log rows for a line whose
//     write-off already landed on the first attempt (ADR-0003 write-off
//     extension: marker-gated, mirrors the existing receive-side guard).
//   - Primary and Substitute (alt) write-offs carry independent markers, so
//     one landing does not skip the other.
//   - stockLossRepo.noteMarkerExists is true once a matching row exists and
//     stays true even after the row is soft-deleted (deletedAt is deliberately
//     ignored — "was ever recorded" is the idempotency question).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, stockOrders, stockOrderLines, stockLossLog } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

vi.mock('../services/configService.js', () => ({
  getStockYModelEnabled: () => false,
  getConfig: () => undefined, // targetMarkup → falls back to 1
  getActiveSeasonalCategory: () => null,
  generateOrderId: async () => 'TEST-001',
}));
vi.mock('../services/notifications.js', () => ({ broadcast: () => {} }));
vi.mock('../services/orderService.js', () => ({
  findOrdersNeedingSubstitution: async () => [],
}));

import * as stockOrderRepo from '../repos/stockOrderRepo.js';
import * as stockLossRepo from '../repos/stockLossRepo.js';
import { evaluatePurchaseOrder } from '../services/stockOrderService.js';

const TODAY = '2026-07-07';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
  vi.restoreAllMocks();
});

async function seedStockItem(overrides = {}) {
  const [row] = await harness.db.insert(stock).values({
    displayName:     overrides.displayName ?? 'Peony Pink',
    currentQuantity: overrides.currentQuantity ?? 0,
    active:          true,
    typeName:        overrides.typeName ?? 'Peony',
  }).returning();
  return row;
}

async function seedPoWithLine({ poNumber = 'PO-20260707-1', status = 'Evaluating', line = {} } = {}) {
  const [po] = await harness.db.insert(stockOrders).values({
    poNumber,
    createdDate: TODAY,
    status,
  }).returning();
  const [lineRow] = await harness.db.insert(stockOrderLines).values({
    poId:            po.id,
    flowerName:      line.flowerName ?? 'Peony Pink',
    quantityNeeded:  line.quantityNeeded ?? 20,
    stockId:         line.stockId ?? null,
    substituteFlowerName: line.substituteFlowerName ?? '',
    substituteQuantityFound: line.substituteQuantityFound ?? 0,
    substituteCost:  line.substituteCost ?? '0',
    costPrice:       line.costPrice ?? '5',
    sellPrice:       line.sellPrice ?? '15',
  }).returning();
  return { po, line: lineRow };
}

async function countLossRows() {
  const rows = await harness.db.select().from(stockLossLog);
  return rows;
}

describe('evaluatePurchaseOrder — write-off idempotency (ADR-0003 extension)', () => {
  it('does not duplicate a primary write-off on Eval Error retry', async () => {
    const stockItem = await seedStockItem();
    const { po, line } = await seedPoWithLine({
      line: { stockId: stockItem.id, quantityNeeded: 20 },
    });

    // Fail the first attempt AFTER the write-off lands, by throwing once when
    // the line's final "mark PROCESSED" update happens (mirrors a real
    // partial failure: write-off recorded, then something else broke before
    // the line could be marked done).
    let updateLineCalls = 0;
    const originalUpdateLine = stockOrderRepo.updateLine;
    const spy = vi.spyOn(stockOrderRepo, 'updateLine').mockImplementation(async (id, fields) => {
      if (fields && fields['Eval Status'] === 'Processed') {
        updateLineCalls += 1;
        if (updateLineCalls === 1) {
          throw new Error('simulated failure after write-off landed');
        }
      }
      return originalUpdateLine(id, fields);
    });

    const evalLines = [{
      lineId: line.id,
      quantityAccepted: 12,
      writeOffQty: 8,
      writeOffReason: 'Damaged',
    }];

    // First attempt: write-off should land, then the simulated failure marks
    // the PO Eval Error.
    const firstResult = await evaluatePurchaseOrder(po.id, evalLines);
    expect(firstResult.outcome).toBe('partial');

    const afterFirst = await countLossRows();
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].notes).toContain('primary writeoff');

    const poAfterFirst = await stockOrderRepo.getById(po.id);
    expect(poAfterFirst.Status).toBe('Eval Error');

    // Second attempt (retry): write-off must NOT be duplicated. The line's
    // Eval Status was never set to Processed (the throw happened on that very
    // write), so the line is NOT skipped by the "already processed" guard —
    // it re-runs, and the marker gate must catch the write-off specifically.
    spy.mockImplementation(originalUpdateLine); // let it succeed this time
    const secondResult = await evaluatePurchaseOrder(po.id, evalLines);
    expect(secondResult.outcome).toBe('complete');

    const afterSecond = await countLossRows();
    expect(afterSecond).toHaveLength(1); // still exactly one — no duplicate

    const lineAfter = await stockOrderRepo.getLineById(line.id);
    expect(lineAfter['Eval Status']).toBe('Processed');

    const poAfterSecond = await stockOrderRepo.getById(po.id);
    expect(poAfterSecond.Status).toBe('Complete');

    spy.mockRestore();
  });

  it('gives primary and alt write-offs independent markers — neither skips the other on retry', async () => {
    const stockItem = await seedStockItem({ displayName: 'Rose Red', typeName: 'Rose' });
    const { po, line } = await seedPoWithLine({
      line: {
        stockId: stockItem.id,
        quantityNeeded: 30,
        substituteFlowerName: 'Mystery Rose',
        substituteQuantityFound: 10,
        substituteCost: '50',
      },
    });

    let updateLineCalls = 0;
    const originalUpdateLine = stockOrderRepo.updateLine;
    const spy = vi.spyOn(stockOrderRepo, 'updateLine').mockImplementation(async (id, fields) => {
      if (fields && fields['Eval Status'] === 'Processed') {
        updateLineCalls += 1;
        if (updateLineCalls === 1) {
          throw new Error('simulated failure after both write-offs landed');
        }
      }
      return originalUpdateLine(id, fields);
    });

    const evalLines = [{
      lineId: line.id,
      quantityAccepted: 15,
      writeOffQty: 5,
      writeOffReason: 'Damaged',
      altQuantityAccepted: 6,
      altWriteOffQty: 4,
      altWriteOffReason: 'Wilted',
    }];

    const firstResult = await evaluatePurchaseOrder(po.id, evalLines);
    expect(firstResult.outcome).toBe('partial');

    const afterFirst = await countLossRows();
    expect(afterFirst).toHaveLength(2);
    const markersFirst = afterFirst.map(r => r.notes).sort();
    expect(markersFirst.some(n => n.includes('primary writeoff'))).toBe(true);
    expect(markersFirst.some(n => n.includes('alt writeoff'))).toBe(true);

    spy.mockImplementation(originalUpdateLine);
    const secondResult = await evaluatePurchaseOrder(po.id, evalLines);
    expect(secondResult.outcome).toBe('complete');

    const afterSecond = await countLossRows();
    expect(afterSecond).toHaveLength(2); // still exactly two — no duplicates

    spy.mockRestore();
  });
});

describe('stockLossRepo.noteMarkerExists — idempotency marker lookup', () => {
  it('returns false for an absent marker', async () => {
    const exists = await stockLossRepo.noteMarkerExists('PO #PO-NONE L#none primary writeoff');
    expect(exists).toBe(false);
  });

  it('returns true once a matching row is created', async () => {
    const marker = 'PO #PO-20260707-1 L#abc123 primary writeoff';
    await stockLossRepo.create({
      date: TODAY,
      quantity: 3,
      reason: 'Damaged',
      notes: `PO evaluation write-off (primary) — ${marker}`,
    });
    const exists = await stockLossRepo.noteMarkerExists(marker);
    expect(exists).toBe(true);
  });

  it('still returns true when the matching row is soft-deleted', async () => {
    const marker = 'PO #PO-20260707-2 L#def456 alt writeoff';
    const created = await stockLossRepo.create({
      date: TODAY,
      quantity: 2,
      reason: 'Wilted',
      notes: `PO evaluation write-off (substitute) — ${marker}`,
    });
    await stockLossRepo.remove(created.id);
    const exists = await stockLossRepo.noteMarkerExists(marker);
    expect(exists).toBe(true); // deletedAt deliberately ignored — a manually
    // deleted row must not resurrect on PO evaluate retry.
  });
});
