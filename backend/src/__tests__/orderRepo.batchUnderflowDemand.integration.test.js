// Regression: an over-consumed Batch must NOT be driven negative — the shortfall
// belongs on the dated Demand Entry (Y-model invariant, Option A, 2026-07).
//
// Prod incident (dup-key 500s, 2026-07-03 / 07-06): the cutover parked many
// legacy Batches on one shared date (2026-06-29). When order consumption pushed
// a second same-(variety,date) row negative via the raw adjustQuantity in
// orderRepo step 4, it collided with the existing negative Demand Entry on the
// partial unique index `stock_demand_variety_date_idx` (UNIQUE on
// type_name,colour,size_cm,cultivar,date WHERE current_quantity < 0). Order
// creation 500'd and rolled back.
//
// Invariant proven here: Batches never go negative. A line whose Batch can't
// fully cover routes the WHOLE line's demand to a Demand Entry dated to the
// order's need date (create-or-sum), leaving the Batch at its physical qty.
// Net inventory is unchanged; the collision is impossible by construction.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, orderLines } from '../db/schema.js';
import { eq, and, sql, isNull } from 'drizzle-orm';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

vi.mock('../services/configService.js', () => ({
  getConfig: (k) => ({ defaultDeliveryFee: 25, driverCostPerDelivery: 10 }[k] ?? 0),
  updateConfig: vi.fn(),
  generateOrderId: vi.fn(async () => `BLO-UF-${Math.floor(performance.now())}`),
  getDriverOfDay: () => 'Timur',
  isPastCutoff: vi.fn(),
  getActiveSeasonalCategory: vi.fn(),
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

import * as orderRepo from '../repos/orderRepo.js';

const config = {
  getConfig: (k) => ({ defaultDeliveryFee: 25, driverCostPerDelivery: 10 }[k] ?? 0),
  getDriverOfDay: () => 'Timur',
  generateOrderId: async () => `BLO-UF-${Math.floor(performance.now())}`,
};

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

async function seedRow({ qty, date, typeName = 'Hydrangea', colour = 'White' }) {
  const [row] = await harness.db.insert(stock).values({
    displayName: `${typeName} ${colour} (${date})`,
    currentQuantity: qty, active: true, typeName, colour, date,
  }).returning();
  return row;
}

// All Demand Entries (qty<0) for the Variety.
async function demandEntries(typeName = 'Hydrangea', colour = 'White') {
  return harness.db.select().from(stock).where(and(
    eq(stock.typeName, typeName), eq(stock.colour, colour),
    sql`${stock.currentQuantity} < 0`, isNull(stock.deletedAt),
  ));
}

describe('createOrder — over-consumed Batch routes shortfall to a Demand Entry (no dup-key collision)', () => {
  it('does not throw when a Batch shares (variety,date) with an existing negative DE', async () => {
    // The exact prod collision setup: a positive Batch and a negative Demand
    // Entry on the SAME (variety, date).
    const batch = await seedRow({ qty: 1, date: '2026-06-29' });
    const existingDe = await seedRow({ qty: -3, date: '2026-06-29' });

    // Pickup order (no required_by) needing 5 → demand date = today (a DIFFERENT
    // plan date than the 06-29 DE, so it must NOT merge into it).
    await expect(orderRepo.createOrder({
      customer: 'recCust1',
      deliveryType: 'Pickup',
      orderLines: [{ stockItemId: batch.id, flowerName: 'Hydrangea White', quantity: 5 }],
      paymentStatus: 'Unpaid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } })).resolves.toBeTruthy();

    // Batch never went negative — kept its physical qty.
    const [batchAfter] = await harness.db.select().from(stock).where(eq(stock.id, batch.id));
    expect(batchAfter.currentQuantity).toBe(1);

    // The pre-existing 06-29 plan DE is untouched (need-date routing → new DE).
    const [deAfter] = await harness.db.select().from(stock).where(eq(stock.id, existingDe.id));
    expect(deAfter.currentQuantity).toBe(-3);

    // A new DE holds the full order demand (5) at the order's need date.
    const des = await demandEntries();
    const total = des.reduce((s, r) => s + Number(r.currentQuantity), 0);
    expect(total).toBe(-8); // -3 (existing plan) + -5 (this order)
    // Net inventory across the Variety = 1 (batch) + (-8) demand = -7.
  });

  it('same need-date sums into the existing DE instead of creating a duplicate', async () => {
    const batch = await seedRow({ qty: 2, date: '2026-07-20' });
    await seedRow({ qty: -3, date: '2026-07-20' });

    await orderRepo.createOrder({
      customer: 'recCust1',
      deliveryType: 'Delivery',
      requiredBy: '2026-07-20',
      deliveryAddress: 'ul. Test 1', recipientName: 'X', recipientPhone: '1',
      orderLines: [{ stockItemId: batch.id, flowerName: 'Hydrangea White', quantity: 6 }],
      paymentStatus: 'Unpaid', paymentMethod: 'Cash', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // Batch untouched; single DE at 2026-07-20 summed to -9 (no duplicate row).
    const [batchAfter] = await harness.db.select().from(stock).where(eq(stock.id, batch.id));
    expect(batchAfter.currentQuantity).toBe(2);
    const des = await demandEntries();
    expect(des).toHaveLength(1);
    expect(Number(des[0].currentQuantity)).toBe(-9); // -3 + -6
  });
});
