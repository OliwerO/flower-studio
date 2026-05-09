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

// Airtable layer should NOT fire post-cutover. Stub atomicStockAdjust so the
// regression assertion can confirm the legacy path stays cold.
vi.mock('../services/airtable.js', () => ({
  create: vi.fn(),
  update: vi.fn(),
  deleteRecord: vi.fn(),
  getById: vi.fn(),
  list: vi.fn(),
  atomicStockAdjust: vi.fn(),
}));

vi.mock('../services/notifications.js', () => ({ broadcast: vi.fn() }));
vi.mock('../services/orderService.js', () => ({
  autoMatchStock: vi.fn().mockResolvedValue(0),
  createOrder: vi.fn(),
}));

import * as airtable from '../services/airtable.js';
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

    // Airtable stock-adjust must NOT have fired — Airtable Stock is frozen
    // post-cutover. Bypassing the repo here was the exact 2026-05-04 bug.
    expect(airtable.atomicStockAdjust).not.toHaveBeenCalled();

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
    expect(airtable.atomicStockAdjust).not.toHaveBeenCalled();

    // PG bouquet + line should exist
    const allBouquets = await harness.db.select().from(premadeBouquets);
    expect(allBouquets).toHaveLength(1);
    expect(allBouquets[0].name).toBe('Solo');
    const allLines = await harness.db.select().from(premadeBouquetLines);
    expect(allLines).toHaveLength(1);
    expect(allLines[0].quantity).toBe(4);
  });
});
