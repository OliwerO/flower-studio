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

  it('tags firstPo on earliest purchase and firstDemand on earliest order across multiple batches', async () => {
    const customer = await seedCustomer();

    // Two batches — different receive dates
    const batch1 = await seedBatch({ displayName: 'Rose Pink 60 (01.May.)', currentQuantity: 20, date: '2026-05-01' });
    const batch2 = await seedBatch({ displayName: 'Rose Pink 60 (10.May.)', currentQuantity: 15, date: '2026-05-10' });

    // Earlier purchase on batch1, later purchase on batch2
    await seedPurchase(batch1.id, 20, '2026-05-01');
    await seedPurchase(batch2.id, 15, '2026-05-10');

    // Earlier order on batch1 (2026-05-03), later order on batch2 (2026-05-12)
    const ord1 = await seedOrder(customer.id, '2026-05-03');
    await seedOrderLine(ord1.id, batch1.id, 3);
    const ord2 = await seedOrder(customer.id, '2026-05-12');
    await seedOrderLine(ord2.id, batch2.id, 5);

    const result = await stockRepo.getUsageByVarietyKey('Rose|Pink|60|');
    const events = result.events;

    // Exactly one firstPo marker
    const posWithFirstPo = events.filter(e => e.firstPo === true);
    expect(posWithFirstPo).toHaveLength(1);
    // Must be the 2026-05-01 purchase (earliest)
    expect(posWithFirstPo[0].type).toBe('purchase');
    expect(posWithFirstPo[0].date).toBe('2026-05-01');

    // Exactly one firstDemand marker
    const ordersWithFirstDemand = events.filter(e => e.firstDemand === true);
    expect(ordersWithFirstDemand).toHaveLength(1);
    // Must be the 2026-05-03 order (earliest)
    expect(ordersWithFirstDemand[0].type).toBe('order');
    expect(ordersWithFirstDemand[0].date).toBe('2026-05-03');

    // The later purchase/order must NOT have the markers
    const otherPurchases = events.filter(e => e.type === 'purchase' && !e.firstPo);
    expect(otherPurchases).toHaveLength(1);
    const otherOrders = events.filter(e => e.type === 'order' && !e.firstDemand);
    expect(otherOrders).toHaveLength(1);

    // Markers must not affect quantity values (balance unperturbed)
    const totalQty = events.reduce((s, e) => s + (Number(e.quantity) || 0), 0);
    expect(totalQty).toBe(result.unaccountedStems);
  });

  it('produces no firstPo when a Variety has no purchase events', async () => {
    const customer = await seedCustomer();
    const batch = await seedBatch({ displayName: 'Rose Pink 60 (05.May.)', currentQuantity: 10, date: '2026-05-05' });
    const ord = await seedOrder(customer.id, '2026-05-06');
    await seedOrderLine(ord.id, batch.id, 2);
    // No seedPurchase call

    const result = await stockRepo.getUsageByVarietyKey('Rose|Pink|60|');
    const events = result.events;

    expect(events.some(e => e.firstPo === true)).toBe(false);
    // firstDemand is still tagged on the single order
    expect(events.filter(e => e.firstDemand === true)).toHaveLength(1);
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

// ── S6 drift tests ────────────────────────────────────────────────────────────

describe('S6 — getUsageByVarietyKey drift computation', () => {
  it('drift is 0 when events reconcile with on-hand stock', async () => {
    // purchase +20, order −5, writeoff −3 → unaccountedStems=12; on-hand=12 → drift=0
    const batch1 = await seedBatch({ displayName: 'Tulip Red 40', currentQuantity: 12, typeName: 'Tulip', colour: 'Red', sizeCm: 40 });
    await seedPurchase(batch1.id, 20, '2026-06-01');
    const customer = await seedCustomer();
    const ord = await seedOrder(customer.id, '2026-06-10');
    await seedOrderLine(ord.id, batch1.id, 5, 'Tulip Red');
    await seedWriteOff(batch1.id, 3, '2026-06-05');

    const result = await stockRepo.getUsageByVarietyKey('Tulip|Red|40|');
    // unaccountedStems = +20 − 5 − 3 = 12; reservedStems = 0; onHand = 12; drift = 0
    expect(result.unaccountedStems).toBe(12);
    expect(result.reservedStems).toBe(0);
    expect(result.onHand).toBe(12);
    expect(result.drift).toBe(0);
  });

  it('drift is > 0 when on-hand is below what events predict (stems vanished)', async () => {
    // purchase +30; on-hand only 20 (10 stems unrecorded loss) → drift = 10
    const batch1 = await seedBatch({ displayName: 'Iris Purple 50', currentQuantity: 20, typeName: 'Iris', colour: 'Purple', sizeCm: 50 });
    await seedPurchase(batch1.id, 30, '2026-06-01');

    const result = await stockRepo.getUsageByVarietyKey('Iris|Purple|50|');
    // unaccountedStems = +30; reservedStems = 0; onHand = 20; drift = 30 − 20 = 10
    expect(result.unaccountedStems).toBe(30);
    expect(result.reservedStems).toBe(0);
    expect(result.onHand).toBe(20);
    expect(result.drift).toBe(10);
  });

  it('drift is 0 for a premade-reserved Variety (reservedStems excluded from physical)', async () => {
    // purchase +28, writeoff −10, premade −6; physical on-hand = 18 (premade does not move stock)
    // unaccountedStems = 28 − 10 − 6 = 12; reservedStems = 6; onHand = 18; drift = 12+6−18 = 0
    const batch1 = await seedBatch({ displayName: 'Hydrangea Blue 30', currentQuantity: 18, typeName: 'Hydrangea', colour: 'Blue', sizeCm: 30 });
    await seedPurchase(batch1.id, 28, '2026-06-10');
    await seedWriteOff(batch1.id, 10, '2026-06-11');
    await seedPremade(batch1.id, 6);

    const result = await stockRepo.getUsageByVarietyKey('Hydrangea|Blue|30|');
    expect(result.unaccountedStems).toBe(12);  // 28 − 10 − 6
    expect(result.reservedStems).toBe(6);
    expect(result.onHand).toBe(18);
    expect(result.drift).toBe(0);
  });

  it('drift fields are present and zero for an unknown key', async () => {
    const result = await stockRepo.getUsageByVarietyKey('Unknown|Green|99|');
    expect(result.drift).toBe(0);
    expect(result.reservedStems).toBe(0);
    expect(result.onHand).toBe(0);
  });

  it('B2: openingBalance = the pre-record stock that keeps the running balance from going negative', async () => {
    // Orders + a write-off happen BEFORE the first purchase (the post-cutover
    // shape: consumption on legacy stock, no purchase-history event). Running
    // balance from 0: −5, −6, −13, then +30 → +17. min = −13 → opening = 13.
    const batch1 = await seedBatch({ displayName: 'Peony Pink 60', currentQuantity: 17, typeName: 'Peony', colour: 'Pink', sizeCm: 60 });
    const customer = await seedCustomer();
    const o1 = await seedOrder(customer.id, '2026-06-03');
    await seedOrderLine(o1.id, batch1.id, 5, 'Peony Pink');
    await seedWriteOff(batch1.id, 1, '2026-06-03');
    const o2 = await seedOrder(customer.id, '2026-06-04');
    await seedOrderLine(o2.id, batch1.id, 7, 'Peony Pink');
    await seedPurchase(batch1.id, 30, '2026-06-05');

    const result = await stockRepo.getUsageByVarietyKey('Peony|Pink|60|');
    expect(result.openingBalance).toBe(13);
  });

  it('B2: openingBalance is 0 when the balance never dips below zero', async () => {
    // Purchase first (+20), then a −5 order → never negative → opening 0.
    const batch1 = await seedBatch({ displayName: 'Tulip Red 40', currentQuantity: 15, typeName: 'Tulip', colour: 'Red', sizeCm: 40 });
    await seedPurchase(batch1.id, 20, '2026-06-01');
    const customer = await seedCustomer();
    const ord = await seedOrder(customer.id, '2026-06-10');
    await seedOrderLine(ord.id, batch1.id, 5, 'Tulip Red');

    const result = await stockRepo.getUsageByVarietyKey('Tulip|Red|40|');
    expect(result.openingBalance).toBe(0);
  });
});
