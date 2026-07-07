// Integration tests for receiveIntoStock — issue #327, PRD #324 line 150.
//
// What we're proving:
//   - New dated Batch created by receiveIntoStock carries Variety attrs
//     (Type/Colour/Size/Cultivar) from the PO line context.
//   - When the orig Stock Item has NULL Variety attrs and the PO line carries
//     non-null attrs, the orig is backfilled in the same operation.
//   - When the orig already has Variety attrs, they take precedence as a
//     fallback when PO line omits an individual attr.
//   - Absorption math (batchQty = qty + existingQty when existingQty < 0) is
//     preserved — this hotfix does NOT touch absorption semantics per
//     ADR-0002. Only Variety identity propagates.
//   - The new Batch is visible in /stock?grouped=true once Variety attrs are
//     populated (proves the production symptom of #323 is resolved).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

// configService mock so listGroupedByVariety can be checked under Y-model flag
let yModelEnabled = false;
vi.mock('../services/configService.js', () => ({
  getStockYModelEnabled: () => yModelEnabled,
  getConfig: () => undefined,
  getActiveSeasonalCategory: () => null,
  generateOrderId: async () => 'TEST-001',
}));

// notifications + orderService used elsewhere in the route but not the seam
vi.mock('../services/notifications.js', () => ({ broadcast: () => {} }));

import { __testing } from '../services/stockOrderService.js';
import * as stockRepo from '../repos/stockRepo.js';

const { receiveIntoStock } = __testing;

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  yModelEnabled = false;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

async function seedOrigStockItem(overrides = {}) {
  const [row] = await harness.db.insert(stock).values({
    displayName:     overrides.displayName ?? 'Peony Pink',
    currentQuantity: overrides.currentQuantity ?? 0,
    active:          true,
    typeName:        overrides.typeName ?? null,
    colour:          overrides.colour   ?? null,
    sizeCm:          overrides.sizeCm   ?? null,
    cultivar:        overrides.cultivar ?? null,
  }).returning();
  return row;
}

const TODAY = '2026-05-20';
const PEONY_PINK_60 = { Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null };

describe('receiveIntoStock — Variety attrs propagation (#327)', () => {
  it('writes Variety attrs from PO line context onto the new dated Batch', async () => {
    const orig = await seedOrigStockItem({ currentQuantity: 0 });

    const newBatchId = await receiveIntoStock(
      orig.id, 50, 8, 25, 'Stefan', TODAY, PEONY_PINK_60,
    );

    const newBatch = await harness.db
      .select().from(stock).where(eq(stock.id, newBatchId)).then(r => r[0]);

    expect(newBatch.typeName).toBe('Peony');
    expect(newBatch.colour).toBe('Pink');
    expect(newBatch.sizeCm).toBe(60);
    expect(newBatch.cultivar).toBe(null);
    expect(newBatch.currentQuantity).toBe(50);
    expect(newBatch.displayName).toBe('Peony Pink (20.May.)');
  });

  it('backfills Variety attrs onto orig when orig had NULL attrs and PO line carries them', async () => {
    const orig = await seedOrigStockItem({ currentQuantity: 0 });
    expect(orig.typeName).toBe(null);

    await receiveIntoStock(orig.id, 12, 11, 28, 'Stefan', TODAY, PEONY_PINK_60);

    const origAfter = await harness.db
      .select().from(stock).where(eq(stock.id, orig.id)).then(r => r[0]);

    expect(origAfter.typeName).toBe('Peony');
    expect(origAfter.colour).toBe('Pink');
    expect(origAfter.sizeCm).toBe(60);
    expect(origAfter.cultivar).toBe(null);
  });

  it('does NOT touch orig Variety attrs when orig already has them', async () => {
    const orig = await seedOrigStockItem({
      currentQuantity: 0,
      typeName: 'Peony', colour: 'Pink', sizeCm: 50, cultivar: 'Sarah Bernhardt',
    });

    // PO line claims Cultivar='Other' but orig was Sarah Bernhardt — orig wins.
    await receiveIntoStock(
      orig.id, 10, 8, 25, 'Stefan', TODAY,
      { Type: 'Peony', Colour: 'Pink', Size: 50, Cultivar: 'Other' },
    );

    const origAfter = await harness.db
      .select().from(stock).where(eq(stock.id, orig.id)).then(r => r[0]);

    expect(origAfter.cultivar).toBe('Sarah Bernhardt');
  });

  it('preserves absorption math when orig has negative qty (ADR-0002)', async () => {
    const orig = await seedOrigStockItem({ currentQuantity: -46 });

    const newBatchId = await receiveIntoStock(
      orig.id, 50, 8, 25, 'Stefan', TODAY, PEONY_PINK_60,
    );

    const [newBatch, origAfter] = await Promise.all([
      harness.db.select().from(stock).where(eq(stock.id, newBatchId)).then(r => r[0]),
      harness.db.select().from(stock).where(eq(stock.id, orig.id)).then(r => r[0]),
    ]);

    // Absorption: batchQty = 50 + (-46) = 4; orig zeroed
    expect(newBatch.currentQuantity).toBe(4);
    expect(origAfter.currentQuantity).toBe(0);

    // Both rows carry Variety attrs so the audit-marker chain is inspectable
    expect(newBatch.typeName).toBe('Peony');
    expect(origAfter.typeName).toBe('Peony');
  });

  it('makes the new Batch visible in /stock?grouped=true under STOCK_Y_MODEL', async () => {
    yModelEnabled = true;
    const orig = await seedOrigStockItem({ currentQuantity: 0 });

    await receiveIntoStock(orig.id, 50, 8, 25, 'Stefan', TODAY, PEONY_PINK_60);

    const groups = await stockRepo.listGroupedByVariety({ includeEmpty: false });
    const peonyGroup = groups.find(g => g.type_name === 'Peony' && g.colour === 'Pink');

    expect(peonyGroup).toBeDefined();
    expect(peonyGroup.rows.length).toBeGreaterThanOrEqual(1);
    expect(peonyGroup.rows.some(r => r['Current Quantity'] === 50)).toBe(true);
  });

  it('falls back to orig attrs when PO line omits an individual attr', async () => {
    const orig = await seedOrigStockItem({
      currentQuantity: 0,
      typeName: 'Rose', colour: 'Red', sizeCm: 60, cultivar: 'Red Naomi',
    });

    // Line carries only Type — others omitted (null). Orig's attrs fill in.
    const newBatchId = await receiveIntoStock(
      orig.id, 25, 5, 15, 'OZ', TODAY,
      { Type: 'Rose', Colour: null, Size: null, Cultivar: null },
    );

    const newBatch = await harness.db
      .select().from(stock).where(eq(stock.id, newBatchId)).then(r => r[0]);

    expect(newBatch.typeName).toBe('Rose');
    expect(newBatch.colour).toBe('Red');       // from orig
    expect(newBatch.sizeCm).toBe(60);          // from orig
    expect(newBatch.cultivar).toBe('Red Naomi'); // from orig
  });

  it('when no varietyAttrs passed, falls back to orig (back-compat)', async () => {
    const orig = await seedOrigStockItem({
      currentQuantity: 0,
      typeName: 'Tulip', colour: 'Yellow', sizeCm: 40, cultivar: null,
    });

    const newBatchId = await receiveIntoStock(orig.id, 30, 4, 10, 'Mateusz', TODAY);

    const newBatch = await harness.db
      .select().from(stock).where(eq(stock.id, newBatchId)).then(r => r[0]);

    expect(newBatch.typeName).toBe('Tulip');
    expect(newBatch.colour).toBe('Yellow');
    expect(newBatch.sizeCm).toBe(40);
  });
});
