// FEFO routing inside orderRepo.createOrder — closes #319.
//
// When STOCK_Y_MODEL=true and a Variety has multiple positive Batches,
// the line's stockItemId is rerouted to the oldest Batch that can fully
// cover the line, regardless of which Batch the picker initially passed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, orderLines } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

const yModelFlag = { enabled: true };
vi.mock('../services/configService.js', () => ({
  getStockYModelEnabled: () => yModelFlag.enabled,
  getStockXModelEnabled: () => false,
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  generateOrderId: vi.fn(),
  getDriverOfDay: vi.fn(),
  isPastCutoff: vi.fn(),
  getActiveSeasonalCategory: vi.fn(),
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

import * as orderRepo from '../repos/orderRepo.js';

let harness;
let orderIdCounter = 0;
const config = {
  getConfig: (k) => ({ defaultDeliveryFee: 25, driverCostPerDelivery: 10 }[k] ?? 0),
  getDriverOfDay: () => 'Timur',
  generateOrderId: async () => `BLO-FEFO-${++orderIdCounter}`,
};

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  yModelFlag.enabled = true;
  orderIdCounter = 0;
  vi.clearAllMocks();
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

async function seedBatch({ qty, date, typeName = 'Hydrangea', colour = 'White', sizeCm = null, cultivar = null }) {
  const [row] = await harness.db.insert(stock).values({
    displayName: `${typeName} ${colour ?? ''} (${date ?? 'undated'})`.trim(),
    currentQuantity: qty,
    active: true,
    typeName,
    colour,
    sizeCm,
    cultivar,
    date,
  }).returning();
  return row;
}

describe('createOrder FEFO routing (#319)', () => {
  it('reroutes line FK from newer Batch to older Batch with full cover', async () => {
    const oldBatch = await seedBatch({ qty: 5, date: '2026-05-16' });
    const newBatch = await seedBatch({ qty: 2, date: '2026-05-18' });

    const { orderLines: createdLines } = await orderRepo.createOrder({
      customer: 'recCust1',
      deliveryType: 'Pickup',
      orderLines: [
        { stockItemId: newBatch.id, flowerName: 'Hydrangea White', quantity: 3, sellPricePerUnit: 15, costPricePerUnit: 4 },
      ],
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // Decrement landed on the OLD batch (FEFO), not the picker's newer batch.
    const [oldAfter] = await harness.db.select().from(stock).where(eq(stock.id, oldBatch.id));
    const [newAfter] = await harness.db.select().from(stock).where(eq(stock.id, newBatch.id));
    expect(oldAfter.currentQuantity).toBe(2);  // 5 - 3
    expect(newAfter.currentQuantity).toBe(2);  // untouched

    // Line FK was rebound to the old Batch.
    const [line] = await harness.db.select().from(orderLines).where(eq(orderLines.id, createdLines[0].id));
    expect(line.stockItemId).toBe(oldBatch.id);
  });

  it('when no Batch fully covers, routes shortfall to a Demand Entry — Batches never go negative (Option A)', async () => {
    // Under Option A (2026-07 dup-key incident) a Batch is never driven negative:
    // an under-covering line routes its whole demand to a dated Demand Entry so a
    // negative Batch can't collide with a same-(variety,date) DE on the unique
    // index. Both Batches keep their physical qty; the shortfall lives on the DE.
    const oldBatch = await seedBatch({ qty: 1, date: '2026-05-16' });
    const newBatch = await seedBatch({ qty: 2, date: '2026-05-18' });

    await orderRepo.createOrder({
      customer: 'recCust1',
      deliveryType: 'Pickup',
      orderLines: [
        { stockItemId: newBatch.id, flowerName: 'Hydrangea White', quantity: 5 },
      ],
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    const [oldAfter] = await harness.db.select().from(stock).where(eq(stock.id, oldBatch.id));
    const [newAfter] = await harness.db.select().from(stock).where(eq(stock.id, newBatch.id));
    expect(oldAfter.currentQuantity).toBe(1);   // untouched — no longer driven negative
    expect(newAfter.currentQuantity).toBe(2);   // untouched

    // A Demand Entry now carries the full order demand; Variety net = 1+2-5 = -2.
    const all = await harness.db.select().from(stock)
      .where(and(eq(stock.typeName, 'Hydrangea'), eq(stock.colour, 'White')));
    const net = all.reduce((s, r) => s + Number(r.currentQuantity), 0);
    expect(net).toBe(-2);
    const de = all.find(r => Number(r.currentQuantity) < 0);
    expect(de).toBeTruthy();
    expect(Number(de.currentQuantity)).toBe(-5);
  });

  it('prefers newer full-cover Batch over older short Batch', async () => {
    const oldBatch = await seedBatch({ qty: 2, date: '2026-05-16' });
    const newBatch = await seedBatch({ qty: 10, date: '2026-05-18' });

    await orderRepo.createOrder({
      customer: 'recCust1',
      deliveryType: 'Pickup',
      orderLines: [
        { stockItemId: oldBatch.id, flowerName: 'Hydrangea White', quantity: 5 },
      ],
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    const [oldAfter] = await harness.db.select().from(stock).where(eq(stock.id, oldBatch.id));
    const [newAfter] = await harness.db.select().from(stock).where(eq(stock.id, newBatch.id));
    expect(oldAfter.currentQuantity).toBe(2);   // untouched
    expect(newAfter.currentQuantity).toBe(5);   // 10 - 5
  });

  it('does not reroute when only one Batch exists for the Variety', async () => {
    const only = await seedBatch({ qty: 10, date: '2026-05-16' });

    await orderRepo.createOrder({
      customer: 'recCust1',
      deliveryType: 'Pickup',
      orderLines: [
        { stockItemId: only.id, flowerName: 'Hydrangea White', quantity: 3 },
      ],
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    const [after] = await harness.db.select().from(stock).where(eq(stock.id, only.id));
    expect(after.currentQuantity).toBe(7);
  });

  it('skips FEFO when STOCK_Y_MODEL=false (legacy path unchanged)', async () => {
    yModelFlag.enabled = false;
    const oldBatch = await seedBatch({ qty: 10, date: '2026-05-16' });
    const newBatch = await seedBatch({ qty: 5, date: '2026-05-18' });

    await orderRepo.createOrder({
      customer: 'recCust1',
      deliveryType: 'Pickup',
      orderLines: [
        { stockItemId: newBatch.id, flowerName: 'Hydrangea White', quantity: 2 },
      ],
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    const [oldAfter] = await harness.db.select().from(stock).where(eq(stock.id, oldBatch.id));
    const [newAfter] = await harness.db.select().from(stock).where(eq(stock.id, newBatch.id));
    // Legacy: decrement lands on whatever picker passed.
    expect(oldAfter.currentQuantity).toBe(10);
    expect(newAfter.currentQuantity).toBe(3);
  });

  it('reproduces #319 shape: 3 rows, oldest negative, picks middle (full cover)', async () => {
    const drained = await seedBatch({ qty: -2, date: '2026-05-12' });  // already short, excluded
    const mid     = await seedBatch({ qty: 5,  date: '2026-05-16' });
    const newest  = await seedBatch({ qty: 2,  date: '2026-05-18' });

    await orderRepo.createOrder({
      customer: 'recCust1',
      deliveryType: 'Pickup',
      orderLines: [
        { stockItemId: newest.id, flowerName: 'Hydrangea White', quantity: 3 },
      ],
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    const [drainedAfter] = await harness.db.select().from(stock).where(eq(stock.id, drained.id));
    const [midAfter]     = await harness.db.select().from(stock).where(eq(stock.id, mid.id));
    const [newestAfter]  = await harness.db.select().from(stock).where(eq(stock.id, newest.id));
    expect(drainedAfter.currentQuantity).toBe(-2); // untouched (excluded — qty < 0)
    expect(midAfter.currentQuantity).toBe(2);      // 5 - 3 (FEFO target)
    expect(newestAfter.currentQuantity).toBe(2);   // untouched
  });
});

describe('editBouquetLines FEFO routing (#319)', () => {
  it('reroutes a NEW line added during edit to the older Batch', async () => {
    const oldBatch = await seedBatch({ qty: 5, date: '2026-05-16' });
    const newBatch = await seedBatch({ qty: 8, date: '2026-05-18' });

    // Seed an order via createOrder with an unrelated Variety so we can edit it.
    const filler = await seedBatch({ qty: 20, date: '2026-05-10', typeName: 'Rose', colour: 'Red' });
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1',
      deliveryType: 'Pickup',
      orderLines: [
        { stockItemId: filler.id, flowerName: 'Red Rose', quantity: 2 },
      ],
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // Now edit-add a Hydrangea line; picker passes the NEW Batch.
    await orderRepo.editBouquetLines(order.id, {
      lines: [
        { stockItemId: newBatch.id, flowerName: 'Hydrangea White', quantity: 3 },
      ],
      removedLines: [],
    }, /* isOwner */ false, { actor: { actorRole: 'florist' } });

    const [oldAfter] = await harness.db.select().from(stock).where(eq(stock.id, oldBatch.id));
    const [newAfter] = await harness.db.select().from(stock).where(eq(stock.id, newBatch.id));
    expect(oldAfter.currentQuantity).toBe(2);  // 5 - 3 (FEFO)
    expect(newAfter.currentQuantity).toBe(8);  // untouched
  });

  it('does NOT reroute existing-line quantity changes (preserves audit trail)', async () => {
    const oldBatch = await seedBatch({ qty: 10, date: '2026-05-16' });
    const newBatch = await seedBatch({ qty: 10, date: '2026-05-18' });

    // Create order against newBatch — FEFO routes to oldBatch at create time.
    const { order, orderLines: created } = await orderRepo.createOrder({
      customer: 'recCust1',
      deliveryType: 'Pickup',
      orderLines: [
        { stockItemId: newBatch.id, flowerName: 'Hydrangea White', quantity: 2 },
      ],
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // Confirm create-time FEFO landed on oldBatch.
    expect((await harness.db.select().from(stock).where(eq(stock.id, oldBatch.id)))[0].currentQuantity).toBe(8);

    // Edit increases qty on the existing line. Should adjust against same batch the line already points at — NOT reroute.
    await orderRepo.editBouquetLines(order.id, {
      lines: [
        { id: created[0].id, stockItemId: oldBatch.id, flowerName: 'Hydrangea White', quantity: 4, _originalQty: 2 },
      ],
      removedLines: [],
    }, false, { actor: { actorRole: 'florist' } });

    const [oldAfter] = await harness.db.select().from(stock).where(eq(stock.id, oldBatch.id));
    const [newAfter] = await harness.db.select().from(stock).where(eq(stock.id, newBatch.id));
    // _originalQty=2, new qty=4 → delta = 2-4 = -2; adjust by -2 on oldBatch → 8 - 2 = 6.
    expect(oldAfter.currentQuantity).toBe(6);
    expect(newAfter.currentQuantity).toBe(10); // untouched
  });
});
