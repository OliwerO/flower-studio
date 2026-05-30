// Integration tests for T5.2 (getUsageByVarietyKey) and T5.3 (listGroupedByVariety
// qty=0 DE visibility relax when active order consumers exist).
//
// Seed: Rose|Pink|60| Variety with:
//   - 2 dated Batch rows (qty > 0)
//   - 1 Demand-Entry row (qty = 0)
//   - order lines consuming from BOTH Batches
//   - 2 write-offs (one per batch)
//   - 1 premade bouquet line referencing batch1
//
// T5.2 asserts:
//   - getUsageByVarietyKey returns events unioned across all rows
//   - events are sorted by date ascending, undated (premade) last
//   - unaccountedStems equals the signed sum we seeded
//
// T5.3 asserts:
//   - listGroupedByVariety({ includeEmpty: false }) INCLUDES the Variety
//     when totalQty=0 but an active order line still consumes from it
//   - a genuinely-empty Variety (qty=0, no consumers, no premade reservations)
//     is still excluded

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import {
  stock,
  orders,
  orderLines,
  customers,
  stockLossLog,
  stockPurchases,
  premadeBouquets,
  premadeBouquetLines,
} from '../db/schema.js';

const dbHolder = { db: null };

vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import * as stockRepo from '../repos/stockRepo.js';

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

// ── Seed helpers ─────────────────────────────────────────────────────────────

async function seedBatch(overrides = {}) {
  const [row] = await harness.db.insert(stock).values({
    displayName:     overrides.displayName ?? 'Rose Pink 60',
    currentQuantity: overrides.currentQuantity ?? 10,
    active:          true,
    typeName:        overrides.typeName  ?? 'Rose',
    colour:          overrides.colour    ?? 'Pink',
    sizeCm:          overrides.sizeCm    ?? 60,
    cultivar:        overrides.cultivar  ?? null,
    date:            overrides.date      ?? null,
  }).returning();
  return row;
}

async function seedCustomer() {
  const [c] = await harness.db.insert(customers).values({
    name: 'Test Customer',
  }).returning();
  return c;
}

async function seedOrder(customerId, requiredBy) {
  const [o] = await harness.db.insert(orders).values({
    appOrderId:    `ORD-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    customerId:    customerId,
    status:        'New',
    deliveryType:  'Pickup',
    orderDate:     requiredBy ?? '2026-05-20',
    requiredBy:    requiredBy ?? null,
  }).returning();
  return o;
}

async function seedOrderLine(orderId, stockItemId, quantity, flowerName = 'Rose Pink') {
  const [line] = await harness.db.insert(orderLines).values({
    orderId,
    stockItemId,
    flowerName,
    quantity,
  }).returning();
  return line;
}

async function seedWriteOff(stockId, qty, date) {
  const [row] = await harness.db.insert(stockLossLog).values({
    stockId,
    quantity: qty,
    reason:   'Waste',
    date,
  }).returning();
  return row;
}

async function seedPurchase(stockId, qty, purchaseDate) {
  const [row] = await harness.db.insert(stockPurchases).values({
    stockId,
    quantityPurchased: qty,
    purchaseDate,
    supplier: 'TestSupplier',
  }).returning();
  return row;
}

async function seedPremade(stockId, qty, name = 'Wedding Arch') {
  const [bouquet] = await harness.db.insert(premadeBouquets).values({
    name,
    status: 'Active',
  }).returning();
  const [line] = await harness.db.insert(premadeBouquetLines).values({
    bouquetId:  bouquet.id,
    stockId,
    quantity:   qty,
    flowerName: 'Rose Pink',
  }).returning();
  return { bouquet, line };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('T5.2 — getUsageByVarietyKey', () => {
  it('unions events across all rows in the Variety, sorts by date asc (undated last), and computes unaccountedStems', async () => {
    const customer = await seedCustomer();

    // 2 Batches — different receive dates so we can check chronological sort
    const batch1 = await seedBatch({ displayName: 'Rose Pink 60 (15.May.)', currentQuantity: 30, date: '2026-05-15' });
    const batch2 = await seedBatch({ displayName: 'Rose Pink 60 (20.May.)', currentQuantity: 40, date: '2026-05-20' });
    // 1 Demand Entry (qty=0, same Variety)
    const de = await seedBatch({ displayName: 'Rose Pink 60', currentQuantity: 0, date: null });

    // Order consuming from batch1 — required by 2026-05-16
    const ord1 = await seedOrder(customer.id, '2026-05-16');
    await seedOrderLine(ord1.id, batch1.id, 5);   // -5 on batch1

    // Order consuming from batch2 — required by 2026-05-21
    const ord2 = await seedOrder(customer.id, '2026-05-21');
    await seedOrderLine(ord2.id, batch2.id, 8);   // -8 on batch2

    // 2 write-offs
    await seedWriteOff(batch1.id, 3, '2026-05-17'); // -3 on batch1
    await seedWriteOff(batch2.id, 2, '2026-05-22'); // -2 on batch2

    // 1 purchase on batch1 (receipt)
    await seedPurchase(batch1.id, 30, '2026-05-15'); // +30 on batch1
    // 1 purchase on batch2
    await seedPurchase(batch2.id, 40, '2026-05-20'); // +40 on batch2

    // 1 premade line on batch1 (no date)
    await seedPremade(batch1.id, 4); // -4 on batch1, date=null

    const key = 'Rose|Pink|60|';
    const result = await stockRepo.getUsageByVarietyKey(key);

    // Shape checks
    expect(result).toHaveProperty('variety');
    expect(result.variety.key).toBe(key);
    expect(result.variety.type_name).toBe('Rose');
    expect(result.variety.colour).toBe('Pink');
    expect(result.variety.size_cm).toBe(60);
    expect(result.variety.cultivar).toBe(null);

    expect(result).toHaveProperty('events');
    expect(result).toHaveProperty('unaccountedStems');

    const events = result.events;

    // Count check — 2 orders + 2 writeoffs + 2 purchases + 1 premade = 7 events
    expect(events).toHaveLength(7);

    // Type check — all four kinds present
    const types = events.map(e => e.type);
    expect(types.filter(t => t === 'order')).toHaveLength(2);
    expect(types.filter(t => t === 'writeoff')).toHaveLength(2);
    expect(types.filter(t => t === 'purchase')).toHaveLength(2);
    expect(types.filter(t => t === 'premade')).toHaveLength(1);

    // Sort check — date ascending, undated last
    // Dated events in order: 2026-05-15 (purchase), 2026-05-16 (order),
    //   2026-05-17 (writeoff), 2026-05-20 (purchase), 2026-05-21 (order),
    //   2026-05-22 (writeoff), then null (premade)
    const datedEvents = events.filter(e => e.date !== null);
    const undatedEvents = events.filter(e => e.date === null);
    // undated come LAST
    const lastN = events.slice(-undatedEvents.length);
    expect(lastN.every(e => e.date === null)).toBe(true);
    // dated portion is ascending
    for (let i = 1; i < datedEvents.length; i++) {
      expect(datedEvents[i].date >= datedEvents[i - 1].date).toBe(true);
    }

    // unaccountedStems:
    //   purchases: +30 + 40 = +70
    //   orders:    -5  - 8  = -13
    //   writeoffs: -3  - 2  = -5
    //   premades:  -4       = -4
    //   sum = 70 - 13 - 5 - 4 = 48
    expect(result.unaccountedStems).toBe(48);
  });

  it('returns empty events and 0 unaccountedStems for an unknown Variety key', async () => {
    const result = await stockRepo.getUsageByVarietyKey('Unknown|Blue|99|');
    expect(result.events).toHaveLength(0);
    expect(result.unaccountedStems).toBe(0);
    expect(result.variety.key).toBe('Unknown|Blue|99|');
  });
});

describe('T5.3 — listGroupedByVariety includeEmpty=false keeps Variety with active consumers', () => {
  it('includes a qty=0 Variety when an active order line references one of its rows', async () => {
    const customer = await seedCustomer();

    // Variety A: Rose|Pink|60| — qty=0 but has a live order consumer
    const batchA = await seedBatch({ displayName: 'Rose Pink 60', currentQuantity: 0, date: '2026-05-01' });
    const ordA = await seedOrder(customer.id, '2026-05-25');
    await seedOrderLine(ordA.id, batchA.id, 3);

    // Variety B: Lily|White|40| — genuinely empty, no consumers, no premade reservations
    await seedBatch({
      displayName:     'Lily White 40',
      currentQuantity: 0,
      typeName:        'Lily',
      colour:          'White',
      sizeCm:          40,
      cultivar:        null,
      date:            '2026-05-01',
    });

    const groups = await stockRepo.listGroupedByVariety({ includeEmpty: false });

    const keys = groups.map(g => g.key);
    // Variety A must be present (has consumer)
    expect(keys).toContain('Rose|Pink|60|');
    // Variety B must be absent (truly empty)
    expect(keys).not.toContain('Lily|White|40|');
  });

  it('excludes a qty=0 Variety when order line is soft-deleted', async () => {
    const customer = await seedCustomer();

    // Variety: Rose|Pink|60| — qty=0, order line deleted
    const batchC = await seedBatch({ displayName: 'Rose Pink 60 del', currentQuantity: 0, date: '2026-05-01' });
    const ordC = await seedOrder(customer.id, '2026-05-25');
    const [deletedLine] = await harness.db.insert(orderLines).values({
      orderId:     ordC.id,
      stockItemId: batchC.id,
      flowerName:  'Rose Pink',
      quantity:    2,
      deletedAt:   new Date(),
    }).returning();
    // suppress unused-var lint
    void deletedLine;

    const groups = await stockRepo.listGroupedByVariety({ includeEmpty: false });
    const keys = groups.map(g => g.key);
    // Should be excluded — only consumer is deleted
    expect(keys).not.toContain('Rose|Pink|60|');
  });
});
