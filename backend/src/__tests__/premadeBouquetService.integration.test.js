// premadeBouquetService integration tests — exercise the stock-adjustment
// path against a real Postgres (via pglite) to prove writes land in PG, not
// Airtable. Backstops the 2026-05-04 bug where return-to-stock incremented
// Airtable (frozen post-cutover) while the dashboard read from PG.
//
// Premade bouquet records themselves still live on Airtable (no PG migration
// for that table yet), so those calls remain mocked. Only the stock side is
// real-SQL.

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

// Airtable layer — premade bouquet table operations stay on Airtable; only
// stub deleteRecord + getById since those are the only premade-side calls
// the return-to-stock flow makes.
vi.mock('../services/airtable.js', () => ({
  create: vi.fn(),
  update: vi.fn(),
  deleteRecord: vi.fn().mockResolvedValue({ deleted: true }),
  getById: vi.fn(),
  list: vi.fn(),
  atomicStockAdjust: vi.fn(),
}));

vi.mock('../config/airtable.js', () => ({
  default: {},
  TABLES: {
    PREMADE_BOUQUETS: 'tblPremadeBouquets',
    PREMADE_BOUQUET_LINES: 'tblPremadeBouquetLines',
    STOCK: 'tblStock',
  },
}));

vi.mock('../utils/batchQuery.js', () => ({ listByIds: vi.fn() }));
vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));
vi.mock('../services/orderService.js', () => ({
  autoMatchStock: vi.fn().mockResolvedValue(0),
  createOrder: vi.fn(),
}));

import * as airtable from '../services/airtable.js';
import { listByIds } from '../utils/batchQuery.js';
import * as stockRepo from '../repos/stockRepo.js';
import {
  returnPremadeBouquetToStock,
  createPremadeBouquet,
} from '../services/premadeBouquetService.js';

let harness;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
  airtable.deleteRecord.mockResolvedValue({ deleted: true });
  stockRepo._setMode('postgres');
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

describe('returnPremadeBouquetToStock — postgres mode (regression for 2026-05-04 bug)', () => {
  it('increments PG stock quantities, not Airtable', async () => {
    // Seed two stock rows in PG with the qty AFTER the premade was created
    // (i.e. already deducted by 3 and 2 stems respectively).
    const rose = await seedStockRow('Rose', 7);        // started at 10, 3 in bouquet
    const euca = await seedStockRow('Eucalyptus', 8);  // started at 10, 2 in bouquet

    airtable.getById.mockResolvedValue({
      id: 'recBouquet1',
      Name: 'Spring Pink',
      Lines: ['recLine1', 'recLine2'],
    });
    listByIds.mockResolvedValue([
      { id: 'recLine1', 'Stock Item': [rose.airtableId], 'Flower Name': 'Rose', Quantity: 3 },
      { id: 'recLine2', 'Stock Item': [euca.airtableId], 'Flower Name': 'Eucalyptus', Quantity: 2 },
    ]);

    const result = await returnPremadeBouquetToStock('recBouquet1');

    // PG rows should be back to their pre-bouquet quantities.
    const [roseAfter] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    const [eucaAfter] = await harness.db.select().from(stock).where(eq(stock.id, euca.id));
    expect(roseAfter.currentQuantity).toBe(10);
    expect(eucaAfter.currentQuantity).toBe(10);

    // Airtable stock-adjust must NOT have fired — Airtable Stock is the
    // frozen legacy snapshot post-cutover. Bypassing the repo here was the
    // exact bug owner hit on 2026-05-04.
    expect(airtable.atomicStockAdjust).not.toHaveBeenCalled();

    // Service still reports per-line summary so the toast can name what came back.
    expect(result.returnedItems).toHaveLength(2);
    expect(result.returnedItems[0]).toMatchObject({ flowerName: 'Rose', quantityReturned: 3, newStockQty: 10 });
  });

  it('handles a line whose Stock Item link is missing without aborting other returns', async () => {
    const rose = await seedStockRow('Rose', 7);

    airtable.getById.mockResolvedValue({
      id: 'recBouquet2',
      Name: 'Mixed',
      Lines: ['recLine1', 'recLine2'],
    });
    listByIds.mockResolvedValue([
      { id: 'recLine1', 'Stock Item': [rose.airtableId], 'Flower Name': 'Rose', Quantity: 3 },
      { id: 'recLine2', 'Stock Item': [], 'Flower Name': 'Mystery', Quantity: 2 },
    ]);

    const result = await returnPremadeBouquetToStock('recBouquet2');

    const [roseAfter] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    expect(roseAfter.currentQuantity).toBe(10);
    expect(result.returnedItems).toHaveLength(1);
    expect(result.returnedItems[0].flowerName).toBe('Rose');
  });
});

describe('createPremadeBouquet — postgres mode', () => {
  it('decrements PG stock when the bouquet is composed', async () => {
    const rose = await seedStockRow('Rose', 10);

    airtable.create
      .mockResolvedValueOnce({ id: 'recBouquet1', Name: 'Solo' })
      .mockResolvedValueOnce({ id: 'recLine1' });
    airtable.getById.mockResolvedValue({
      id: 'recBouquet1', Name: 'Solo', Lines: ['recLine1'],
    });
    listByIds.mockResolvedValue([
      { id: 'recLine1', 'Flower Name': 'Rose', Quantity: 4, 'Sell Price Per Unit': 10, 'Cost Price Per Unit': 4 },
    ]);

    await createPremadeBouquet({
      name: 'Solo',
      lines: [
        { stockItemId: rose.airtableId, flowerName: 'Rose', quantity: 4, costPricePerUnit: 4, sellPricePerUnit: 10 },
      ],
      createdBy: 'Florist',
    });

    const [roseAfter] = await harness.db.select().from(stock).where(eq(stock.id, rose.id));
    expect(roseAfter.currentQuantity).toBe(6);
    expect(airtable.atomicStockAdjust).not.toHaveBeenCalled();
  });
});
