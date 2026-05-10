// Verifies getPremadeReservations sums premade_bouquet_lines.quantity per
// Stock Item, keyed on the Stock Item's PG uuid. Mixed-Variety fixture proves
// two Varieties (Rose 50cm vs Rose 60cm — same Type, different Size) are
// keyed separately per ADR-0006 strict identity.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { getPremadeReservations } from '../repos/stockRepo.js';
import { stock, premadeBouquets, premadeBouquetLines } from '../db/schema.js';

const dbHolder = { db: null };

import { vi } from 'vitest';
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('getPremadeReservations (issue #285)', () => {
  it('returns Map<stockId, summed qty> for given stock IDs', async () => {
    const [rose50] = await harness.db.insert(stock).values({
      displayName: 'Rose 50cm', currentQuantity: 20, typeName: 'Rose', sizeCm: 50,
    }).returning();
    const [rose60] = await harness.db.insert(stock).values({
      displayName: 'Rose 60cm', currentQuantity: 15, typeName: 'Rose', sizeCm: 60,
    }).returning();
    const [bq1] = await harness.db.insert(premadeBouquets).values({ name: 'B1' }).returning();
    const [bq2] = await harness.db.insert(premadeBouquets).values({ name: 'B2' }).returning();
    await harness.db.insert(premadeBouquetLines).values([
      { bouquetId: bq1.id, stockId: rose50.id, flowerName: 'Rose 50', quantity: 5 },
      { bouquetId: bq2.id, stockId: rose50.id, flowerName: 'Rose 50', quantity: 7 },
      { bouquetId: bq1.id, stockId: rose60.id, flowerName: 'Rose 60', quantity: 5 },
    ]);

    const result = await getPremadeReservations([rose50.id, rose60.id]);
    expect(result.get(rose50.id)).toBe(12);
    expect(result.get(rose60.id)).toBe(5);
  });

  it('returns empty Map for empty input', async () => {
    expect((await getPremadeReservations([])).size).toBe(0);
  });

  it('skips orphan lines (stockId is null)', async () => {
    const [rose] = await harness.db.insert(stock).values({
      displayName: 'Rose', currentQuantity: 10, typeName: 'Rose',
    }).returning();
    const [bq] = await harness.db.insert(premadeBouquets).values({ name: 'B' }).returning();
    await harness.db.insert(premadeBouquetLines).values([
      { bouquetId: bq.id, stockId: rose.id, flowerName: 'Rose', quantity: 4 },
      { bouquetId: bq.id, stockId: null,    flowerName: 'Orphan', quantity: 9 },
    ]);
    const result = await getPremadeReservations([rose.id]);
    expect(result.get(rose.id)).toBe(4);
    expect(result.size).toBe(1);
  });
});
