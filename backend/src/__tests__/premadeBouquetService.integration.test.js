// premadeBouquetService integration tests — exercise the full service against
// real Postgres (via pglite). Phase 7: premade bouquets and lines now live in
// PG, so seeding goes via Drizzle inserts directly into the new tables, not
// the airtable mock.
//
// Backstops the 2026-05-04 bug where return-to-stock incremented Airtable
// (frozen post-cutover) while the dashboard read from PG.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, premadeBouquets, premadeBouquetLines } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const dbHolder = { db: null };

vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));
vi.mock('../services/orderService.js', () => ({
  autoMatchStock: vi.fn().mockResolvedValue(0),
  createOrder: vi.fn(),
}));

import * as stockRepo from '../repos/stockRepo.js';
import {
  returnPremadeBouquetToStock,
  createPremadeBouquet,
  matchPremadeBouquetToOrder,
} from '../services/premadeBouquetService.js';

const defaultConfig = {
  defaultDeliveryFee: 20,
  defaultMarkup: 1.2,
  timeslots: [],
};

let harness;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

async function seedStockRow(displayName, qty) {
  const [row] = await harness.db.insert(stock).values({
    airtableId: `recStock_${displayName}`,
    displayName,
    category: 'Test',
    currentQuantity: qty,
    currentCostPrice: '1',
    currentSellPrice: '5',
  }).returning();
  return row;
}

// Seeds a premade bouquet + its lines directly into pglite.
async function seedPremadeBouquet(name, lineSpecs /* [{stockUuid, flowerName, qty}] */) {
  const [b] = await harness.db.insert(premadeBouquets).values({
    name,
  }).returning();
  for (const ls of lineSpecs) {
    await harness.db.insert(premadeBouquetLines).values({
      bouquetId:        b.id,
      stockId:          ls.stockUuid,
      flowerName:       ls.flowerName,
      quantity:         ls.qty,
      costPricePerUnit: '1',
      sellPricePerUnit: '5',
    });
  }
  return b;
}

describe('returnPremadeBouquetToStock — postgres mode (regression for 2026-05-04 bug)', () => {
  it('increments PG stock quantities, not Airtable', async () => {
    // Seed two stock rows in PG with the qty AFTER the premade was created
    // (i.e. already deducted by 3 and 2 stems respectively).
    const rose = await seedStockRow('Rose', 7);        // started at 10, 3 in bouquet
    const euca = await seedStockRow('Eucalyptus', 8);  // started at 10, 2 in bouquet

    // Seed the premade in PG (rather than Airtable mock)
    const bouquet = await seedPremadeBouquet('Spring Pink', [
      { stockUuid: rose.id, flowerName: 'Rose', qty: 3 },
      { stockUuid: euca.id, flowerName: 'Eucalyptus', qty: 2 },
    ]);

    const result = await returnPremadeBouquetToStock(bouquet.id);

    // PG rows should be back to their pre-bouquet quantities.
    const [roseAfter] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    const [eucaAfter] = await harness.db.select().from(stock).where(eq(stock.id, euca.id));
    expect(roseAfter.currentQuantity).toBe(10);
    expect(eucaAfter.currentQuantity).toBe(10);

    // Bouquet record removed (CASCADE removes lines)
    const [check] = await harness.db.select().from(premadeBouquets).where(eq(premadeBouquets.id, bouquet.id));
    expect(check).toBeUndefined();

    // Service still reports per-line summary so the toast can name what came back.
    expect(result.returnedItems).toHaveLength(2);
    expect(result.returnedItems[0]).toMatchObject({ flowerName: 'Rose', quantityReturned: 3, newStockQty: 10 });
  });

  it('handles a line whose Stock Item link is missing without aborting other returns', async () => {
    const rose = await seedStockRow('Rose', 7);

    // Seed bouquet with one linked + one orphan line
    const [b] = await harness.db.insert(premadeBouquets).values({ name: 'Mixed' }).returning();
    await harness.db.insert(premadeBouquetLines).values([
      { bouquetId: b.id, stockId: rose.id, flowerName: 'Rose', quantity: 3, costPricePerUnit: '1', sellPricePerUnit: '5' },
      { bouquetId: b.id, stockId: null, flowerName: 'Mystery', quantity: 2, costPricePerUnit: '1', sellPricePerUnit: '5' },
    ]);

    const result = await returnPremadeBouquetToStock(b.id);

    const [roseAfter] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    expect(roseAfter.currentQuantity).toBe(10);
    expect(result.returnedItems).toHaveLength(1);
    expect(result.returnedItems[0].flowerName).toBe('Rose');
  });
});

describe('createPremadeBouquet — postgres mode', () => {
  it('decrements PG stock when the bouquet is composed', async () => {
    const rose = await seedStockRow('Rose', 10);

    await createPremadeBouquet({
      name: 'Solo',
      lines: [
        // Pass the airtableId — stockRepo.adjustQuantity accepts either form.
        { stockItemId: rose.airtableId, flowerName: 'Rose', quantity: 4, costPricePerUnit: 4, sellPricePerUnit: 10 },
      ],
      createdBy: 'Florist',
    });

    const [roseAfter] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    expect(roseAfter.currentQuantity).toBe(6);

    // PG bouquet + line should exist
    const allBouquets = await harness.db.select().from(premadeBouquets);
    expect(allBouquets).toHaveLength(1);
    expect(allBouquets[0].name).toBe('Solo');
    const allLines = await harness.db.select().from(premadeBouquetLines);
    expect(allLines).toHaveLength(1);
    expect(allLines[0].quantity).toBe(4);
  });
});

// ── Flag-on integration tests (STOCK_Y_MODEL=true) — issue #285 ──
// These tests verify the reservation model: build does NOT decrement Batch,
// dissolve clears lines without crediting Batch, sale routes through standard
// createOrder allocation (no skipDeduction).
//
// configService is spied on so toggling doesn't affect the legacy describe blocks above.

import * as configService from '../services/configService.js';
import { createOrder } from '../services/orderService.js';

describe('createPremadeBouquet flag-on (STOCK_Y_MODEL=true) — issue #285', () => {
  let flagSpy;

  beforeEach(() => {
    flagSpy = vi.spyOn(configService, 'getStockYModelEnabled').mockReturnValue(true);
  });

  afterEach(() => {
    flagSpy.mockRestore();
  });

  it('build leaves Batch unchanged + writes premade_bouquet_lines row', async () => {
    const [rose] = await harness.db.insert(stock).values({
      displayName: 'Pink Rose 60cm', currentQuantity: 10, typeName: 'Rose', colour: 'Pink', sizeCm: 60,
    }).returning();
    await createPremadeBouquet({
      name: 'B1',
      lines: [{ stockItemId: rose.id, flowerName: 'Pink Rose 60cm', quantity: 4, costPricePerUnit: 1, sellPricePerUnit: 5 }],
      createdBy: 'Florist',
    });
    const [after] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    expect(after.currentQuantity).toBe(10);                       // Batch UNCHANGED
    const lines = await harness.db.select().from(premadeBouquetLines).where(eq(premadeBouquetLines.stockId, rose.id));
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(4);
  });

  it('build rejects when free qty insufficient', async () => {
    const [rose] = await harness.db.insert(stock).values({
      displayName: 'Rose', currentQuantity: 5, typeName: 'Rose',
    }).returning();
    const [bq] = await harness.db.insert(premadeBouquets).values({ name: 'Existing' }).returning();
    await harness.db.insert(premadeBouquetLines).values({
      bouquetId: bq.id, stockId: rose.id, flowerName: 'Rose', quantity: 4,
    });
    await expect(createPremadeBouquet({
      name: 'New',
      lines: [{ stockItemId: rose.id, flowerName: 'Rose', quantity: 3, costPricePerUnit: 1, sellPricePerUnit: 5 }],
      createdBy: 'Florist',
    })).rejects.toThrow(/Insufficient free stems/);
    const [after] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    expect(after.currentQuantity).toBe(5);                        // Batch unchanged on rejection
  });

  it('dissolve removes lines, Batch unchanged', async () => {
    const [rose] = await harness.db.insert(stock).values({
      displayName: 'Rose', currentQuantity: 10, typeName: 'Rose',
    }).returning();
    const built = await createPremadeBouquet({
      name: 'B', lines: [{ stockItemId: rose.id, flowerName: 'Rose', quantity: 3, costPricePerUnit: 1, sellPricePerUnit: 5 }],
      createdBy: 'F',
    });
    await returnPremadeBouquetToStock(built.id);
    const [after] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    expect(after.currentQuantity).toBe(10);
    const linesAfter = await harness.db.select().from(premadeBouquetLines).where(eq(premadeBouquetLines.stockId, rose.id));
    expect(linesAfter).toHaveLength(0);
  });

  it('dissolve writes a premade_dissolved audit_log row per affected Batch (F2, 2026-05-31)', async () => {
    const { auditLog } = await import('../db/schema.js');
    const [rose] = await harness.db.insert(stock).values({
      displayName: 'Rose', currentQuantity: 10, typeName: 'Rose',
    }).returning();
    const [peony] = await harness.db.insert(stock).values({
      displayName: 'Peony', currentQuantity: 8, typeName: 'Peony',
    }).returning();
    const built = await createPremadeBouquet({
      name: 'Mixed',
      lines: [
        { stockItemId: rose.id,  flowerName: 'Rose',  quantity: 3, costPricePerUnit: 1, sellPricePerUnit: 5 },
        { stockItemId: peony.id, flowerName: 'Peony', quantity: 2, costPricePerUnit: 2, sellPricePerUnit: 9 },
      ],
      createdBy: 'F',
    });
    await returnPremadeBouquetToStock(built.id, { req: { role: 'owner' } });
    const audits = await harness.db.select()
      .from(auditLog)
      .where(eq(auditLog.action, 'premade_dissolved'));
    expect(audits).toHaveLength(2);
    const byStock = Object.fromEntries(audits.map(a => [a.entityId, a]));
    expect(byStock[rose.id].diff.after).toEqual(expect.objectContaining({
      bouquet_name: 'Mixed', qty: 3,
    }));
    expect(byStock[peony.id].diff.after).toEqual(expect.objectContaining({
      bouquet_name: 'Mixed', qty: 2,
    }));
    expect(byStock[rose.id].actorRole).toBe('owner');
  });

  it('sale routes through standard createOrder (no skipDeduction)', async () => {
    const [rose] = await harness.db.insert(stock).values({
      displayName: 'Rose', currentQuantity: 10, typeName: 'Rose',
    }).returning();
    const built = await createPremadeBouquet({
      name: 'B', lines: [{ stockItemId: rose.id, flowerName: 'Rose', quantity: 4, costPricePerUnit: 1, sellPricePerUnit: 5 }],
      createdBy: 'F',
    });
    // createOrder mock: decrement stock manually to simulate standard allocation
    createOrder.mockImplementationOnce(async (orderData, config) => {
      for (const line of (orderData.orderLines || [])) {
        if (line.stockItemId) {
          await stockRepo.adjustQuantity(line.stockItemId, -line.quantity, { tx: undefined });
        }
      }
      return { order: { id: 'mock-order-id' } };
    });
    await matchPremadeBouquetToOrder(built.id, {
      customerName: 'Test', deliveryType: 'pickup', orderDate: '2026-05-10',
    }, defaultConfig);
    const [after] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    expect(after.currentQuantity).toBe(6);                        // 10 - 4 (standard deduction ran)
    const linesAfter = await harness.db.select().from(premadeBouquetLines).where(eq(premadeBouquetLines.stockId, rose.id));
    expect(linesAfter).toHaveLength(0);                           // premade lines deleted
  });

  it('sequential builds against 5-stem pool: first succeeds, second rejects', async () => {
    const [rose] = await harness.db.insert(stock).values({
      displayName: 'Rose', currentQuantity: 5, typeName: 'Rose',
    }).returning();
    await expect(createPremadeBouquet({
      name: 'First', lines: [{ stockItemId: rose.id, flowerName: 'Rose', quantity: 5, costPricePerUnit: 1, sellPricePerUnit: 5 }],
      createdBy: 'F',
    })).resolves.toBeDefined();
    await expect(createPremadeBouquet({
      name: 'Second', lines: [{ stockItemId: rose.id, flowerName: 'Rose', quantity: 5, costPricePerUnit: 1, sellPricePerUnit: 5 }],
      createdBy: 'F',
    })).rejects.toThrow(/Insufficient free stems/);
    const allLines = await harness.db.select().from(premadeBouquetLines);
    expect(allLines).toHaveLength(1);
    const [after] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    expect(after.currentQuantity).toBe(5);
  });
});

// ── #330: editPremadeBouquetLines under flag-on must NOT touch Batch qty ──
import { editPremadeBouquetLines } from '../services/premadeBouquetService.js';

describe('editPremadeBouquetLines flag-on (STOCK_Y_MODEL=true) — issue #330', () => {
  let flagSpy;
  beforeEach(() => { flagSpy = vi.spyOn(configService, 'getStockYModelEnabled').mockReturnValue(true); });
  afterEach(() => { flagSpy.mockRestore(); });

  async function seedBouquetWithLine(stockId, qty) {
    const [bq] = await harness.db.insert(premadeBouquets).values({ name: 'Edit-test' }).returning();
    const [ln] = await harness.db.insert(premadeBouquetLines).values({
      bouquetId: bq.id, stockId, flowerName: 'X', quantity: qty,
      costPricePerUnit: '1', sellPricePerUnit: '5',
    }).returning();
    return { bouquet: bq, line: ln };
  }

  it('adding a new line leaves Batch qty unchanged + writes the reservation row', async () => {
    const [rose] = await harness.db.insert(stock).values({ displayName: 'Rose', currentQuantity: 10, typeName: 'Rose' }).returning();
    const [bq] = await harness.db.insert(premadeBouquets).values({ name: 'B' }).returning();
    await editPremadeBouquetLines(bq.id, {
      lines: [{ stockItemId: rose.id, flowerName: 'Rose', quantity: 3, costPricePerUnit: 1, sellPricePerUnit: 5 }],
    });
    const [after] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    expect(after.currentQuantity).toBe(10);
    const lines = await harness.db.select().from(premadeBouquetLines).where(eq(premadeBouquetLines.bouquetId, bq.id));
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(3);
  });

  it('increasing line qty leaves Batch qty unchanged + updates the reservation row', async () => {
    const [rose] = await harness.db.insert(stock).values({ displayName: 'Rose', currentQuantity: 10, typeName: 'Rose' }).returning();
    const { bouquet, line } = await seedBouquetWithLine(rose.id, 3);
    await editPremadeBouquetLines(bouquet.id, {
      lines: [{ id: line.id, stockItemId: rose.id, flowerName: 'X', quantity: 5, _originalQty: 3 }],
    });
    const [after] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    expect(after.currentQuantity).toBe(10);
    const [updatedLine] = await harness.db.select().from(premadeBouquetLines).where(eq(premadeBouquetLines.id, line.id));
    expect(updatedLine.quantity).toBe(5);
  });

  it('decreasing line qty leaves Batch qty unchanged + updates the reservation row', async () => {
    const [rose] = await harness.db.insert(stock).values({ displayName: 'Rose', currentQuantity: 10, typeName: 'Rose' }).returning();
    const { bouquet, line } = await seedBouquetWithLine(rose.id, 5);
    await editPremadeBouquetLines(bouquet.id, {
      lines: [{ id: line.id, stockItemId: rose.id, flowerName: 'X', quantity: 2, _originalQty: 5 }],
    });
    const [after] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    expect(after.currentQuantity).toBe(10);
    const [updatedLine] = await harness.db.select().from(premadeBouquetLines).where(eq(premadeBouquetLines.id, line.id));
    expect(updatedLine.quantity).toBe(2);
  });

  it('removing a line leaves Batch qty unchanged + deletes the reservation row', async () => {
    const [rose] = await harness.db.insert(stock).values({ displayName: 'Rose', currentQuantity: 10, typeName: 'Rose' }).returning();
    const { bouquet, line } = await seedBouquetWithLine(rose.id, 3);
    await editPremadeBouquetLines(bouquet.id, {
      removedLines: [{ lineId: line.id, stockItemId: rose.id, quantity: 3 }],
    });
    const [after] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    expect(after.currentQuantity).toBe(10);
    const lines = await harness.db.select().from(premadeBouquetLines).where(eq(premadeBouquetLines.bouquetId, bouquet.id));
    expect(lines).toHaveLength(0);
  });

  it('adding a line that exceeds free qty throws + Batch + lines unchanged', async () => {
    const [rose] = await harness.db.insert(stock).values({ displayName: 'Rose', currentQuantity: 5, typeName: 'Rose' }).returning();
    const { bouquet } = await seedBouquetWithLine(rose.id, 4);
    await expect(editPremadeBouquetLines(bouquet.id, {
      lines: [{ stockItemId: rose.id, flowerName: 'Rose', quantity: 3, costPricePerUnit: 1, sellPricePerUnit: 5 }],
    })).rejects.toThrow(/Insufficient free stems/);
    const [after] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    expect(after.currentQuantity).toBe(5);
    const lines = await harness.db.select().from(premadeBouquetLines).where(eq(premadeBouquetLines.bouquetId, bouquet.id));
    expect(lines).toHaveLength(1);
  });

  it('increasing qty past free qty throws + Batch unchanged', async () => {
    const [rose] = await harness.db.insert(stock).values({ displayName: 'Rose', currentQuantity: 5, typeName: 'Rose' }).returning();
    const { bouquet, line } = await seedBouquetWithLine(rose.id, 4);
    await expect(editPremadeBouquetLines(bouquet.id, {
      lines: [{ id: line.id, stockItemId: rose.id, flowerName: 'X', quantity: 10, _originalQty: 4 }],
    })).rejects.toThrow(/Insufficient free stems/);
    const [after] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    expect(after.currentQuantity).toBe(5);
    const [unchanged] = await harness.db.select().from(premadeBouquetLines).where(eq(premadeBouquetLines.id, line.id));
    expect(unchanged.quantity).toBe(4);
  });
});
