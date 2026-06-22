// orderRepo DE-family lifecycle tests — A1 (overnight ultracode audit).
//
// Invariant: a Demand Entry's quantity is the single source of truth for unmet
// demand. Every lifecycle op must apply a line's demand exactly once and reverse
// it exactly once, through the correct path. These tests pin the four findings:
//
//   C5  — cancel / delete of a DE-bound line releases the demand (+qty toward 0)
//         and SOFT-DELETES the DE when it reaches 0, so it never becomes a
//         phantom 0-qty FEFO candidate (FEFO selects currentQuantity >= 0).
//   C19 — write-off of a DE-bound removed line RELEASES the demand (a DE is
//         future demand, not physical stems — nothing to lose). Previously the
//         write-off branch only logged a loss and the demand leaked forever.
//   C25 — edit add-line against a DE routes the demand to the canonical dated DE
//         for THIS order's Required By (via getOrCreateDemandEntry), not a raw
//         adjustQuantity on whatever (possibly wrong-dated) DE id was passed.
//   C4  — clearing Required By de-schedules the DE in place (date → NULL),
//         conserving the demand quantity (no split on a clear).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, orders, orderLines } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { ORDER_STATUS } from '../constants/statuses.js';

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

const actor = { actor: { actorRole: 'florist', actorPinLabel: null } };

let harness;
let seq = 0;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  yModelFlag.enabled = true;
  seq = 0;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

// Seed a Demand Entry + an order whose single line points straight at it, with
// the DE magnitude under our exact control (bypasses createOrder's deepen so we
// can drive the DE to a known value).
async function seedDeBoundOrder({ deQty, lineQty, requiredBy = '2026-07-01', variety = { typeName: 'Tulip' }, status = ORDER_STATUS.NEW }) {
  const [de] = await harness.db.insert(stock).values({
    displayName:     `${variety.typeName} (${requiredBy})`,
    typeName:        variety.typeName,
    colour:          variety.colour ?? null,
    sizeCm:          variety.sizeCm ?? null,
    cultivar:        variety.cultivar ?? null,
    currentQuantity: deQty,
    date:            requiredBy,
    active:          true,
  }).returning();
  const [order] = await harness.db.insert(orders).values({
    appOrderId:    `BLO-DE-${++seq}`,
    customerId:    'recCust1',
    deliveryType:  'Pickup',
    requiredBy,
    status,
    paymentStatus: 'Unpaid',
  }).returning();
  const [line] = await harness.db.insert(orderLines).values({
    orderId:     order.id,
    stockItemId: de.id,
    flowerName:  variety.typeName,
    quantity:    lineQty,
  }).returning();
  return { de, order, line };
}

const liveDe = (id) => harness.db.select().from(stock)
  .where(and(eq(stock.id, id), isNull(stock.deletedAt))).then(r => r[0] ?? null);
const anyDe = (id) => harness.db.select().from(stock).where(eq(stock.id, id)).then(r => r[0]);

describe('(C5) cancel / delete release DE demand + soft-delete at zero', () => {
  it('cancel: sole-consumer DE released to 0 → soft-deleted (no phantom)', async () => {
    const { de, order } = await seedDeBoundOrder({ deQty: -5, lineQty: 5 });

    await orderRepo.cancelWithStockReturn(order.id, actor);

    const row = await anyDe(de.id);
    expect(row.currentQuantity).toBe(0);  // demand released
    expect(row.deletedAt).not.toBeNull(); // soft-deleted → invisible to FEFO + grouping
  });

  it('cancel: partial release leaves DE negative and LIVE', async () => {
    const { de, order } = await seedDeBoundOrder({ deQty: -10, lineQty: 4 });

    await orderRepo.cancelWithStockReturn(order.id, actor);

    const row = await liveDe(de.id);
    expect(row).not.toBeNull();
    expect(row.currentQuantity).toBe(-6); // -10 + 4
  });

  it('delete: sole-consumer DE released to 0 → soft-deleted', async () => {
    const { de, order } = await seedDeBoundOrder({ deQty: -3, lineQty: 3 });

    await orderRepo.deleteOrder(order.id, actor);

    const row = await anyDe(de.id);
    expect(row.currentQuantity).toBe(0);
    expect(row.deletedAt).not.toBeNull();
  });

  it('shared DE: cancelling one consumer keeps it live; the last consumer soft-deletes it', async () => {
    // One DE (-8) shared by two orders (5 + 3). Releasing one leaves the DE
    // negative + live; only the LAST consumer's release drives it to 0 →
    // soft-delete. Proves the multi-consumer path never soft-deletes early and
    // never strands live demand (refutes the multi-consumer phantom RISK).
    const d = '2026-07-01';
    const [de] = await harness.db.insert(stock).values({
      displayName: `Tulip (${d})`, typeName: 'Tulip', currentQuantity: -8, date: d, active: true,
    }).returning();
    const mkOrder = async (qty) => {
      const [o] = await harness.db.insert(orders).values({
        appOrderId: `BLO-DE-${++seq}`, customerId: 'recCust1', deliveryType: 'Pickup',
        requiredBy: d, status: ORDER_STATUS.NEW, paymentStatus: 'Unpaid',
      }).returning();
      await harness.db.insert(orderLines).values({
        orderId: o.id, stockItemId: de.id, flowerName: 'Tulip', quantity: qty,
      });
      return o;
    };
    const o1 = await mkOrder(5);
    const o2 = await mkOrder(3);

    await orderRepo.cancelWithStockReturn(o1.id, actor);
    let row = await anyDe(de.id);
    expect(row.currentQuantity).toBe(-3); // -8 + 5
    expect(row.deletedAt).toBeNull();     // still owed to o2 — live

    await orderRepo.cancelWithStockReturn(o2.id, actor);
    row = await anyDe(de.id);
    expect(row.currentQuantity).toBe(0);  // -3 + 3
    expect(row.deletedAt).not.toBeNull(); // last consumer released → soft-deleted
  });
});

describe('(C19) write-off of a DE-bound removed line releases the demand', () => {
  it('write-off releases the DE instead of leaking it forever', async () => {
    const { de, order, line } = await seedDeBoundOrder({ deQty: -5, lineQty: 5 });

    await orderRepo.editBouquetLines(order.id, {
      lines: [],
      removedLines: [{ lineId: line.id, stockItemId: de.id, quantity: 5, action: 'writeoff' }],
    }, true, actor);

    const row = await anyDe(de.id);
    expect(row.currentQuantity).toBe(0);  // released (was: stayed -5, demand leaked)
    expect(row.deletedAt).not.toBeNull(); // soft-deleted at zero
  });
});

describe('(C25) edit add-line routes demand to the canonical dated DE', () => {
  it('binds the new line to the order Required-By DE, not the passed wrong-dated DE', async () => {
    const d1 = '2026-07-01';
    const d2 = '2026-08-01';
    // A DE for d1 exists; the new order is for d2 and the picker passes the d1 DE id.
    const [deD1] = await harness.db.insert(stock).values({
      displayName: `Tulip (${d1})`, typeName: 'Tulip', currentQuantity: -5, date: d1, active: true,
    }).returning();
    const [order] = await harness.db.insert(orders).values({
      appOrderId: `BLO-DE-X`, customerId: 'recCust1', deliveryType: 'Pickup',
      requiredBy: d2, status: ORDER_STATUS.NEW, paymentStatus: 'Unpaid',
    }).returning();

    await orderRepo.editBouquetLines(order.id, {
      lines: [{ stockItemId: deD1.id, flowerName: 'Tulip', quantity: 3, sellPricePerUnit: 4, costPricePerUnit: 1 }],
      removedLines: [],
    }, true, actor);

    // d1 DE untouched; demand routed to a NEW d2 DE at exactly -3 (applied once).
    const d1After = await anyDe(deD1.id);
    expect(d1After.currentQuantity).toBe(-5);

    const d2Rows = await harness.db.select().from(stock)
      .where(and(eq(stock.typeName, 'Tulip'), eq(stock.date, d2), isNull(stock.deletedAt)));
    expect(d2Rows).toHaveLength(1);
    expect(d2Rows[0].currentQuantity).toBe(-3);

    // The new order line points at the d2 DE.
    const lines = await harness.db.select().from(orderLines)
      .where(and(eq(orderLines.orderId, order.id), isNull(orderLines.deletedAt)));
    expect(lines).toHaveLength(1);
    expect(lines[0].stockItemId).toBe(d2Rows[0].id);
  });
});

describe('(C4) clearing Required By de-schedules the DE in place', () => {
  it('clear → DE date NULL, demand quantity conserved', async () => {
    const { de, order } = await seedDeBoundOrder({ deQty: -5, lineQty: 5, requiredBy: '2026-07-01' });

    await orderRepo.updateOrder(order.id, { 'Required By': null }, actor);

    const row = await liveDe(de.id);
    expect(row.date).toBeNull();          // de-scheduled in place (was: stayed pinned)
    expect(row.currentQuantity).toBe(-5); // demand preserved
  });

  it('re-date to a real date still updates the sole-owner DE in place', async () => {
    const { de, order } = await seedDeBoundOrder({ deQty: -5, lineQty: 5, requiredBy: '2026-07-01' });

    await orderRepo.updateOrder(order.id, { 'Required By': '2026-07-15' }, actor);

    const row = await liveDe(de.id);
    expect(row.date).toBe('2026-07-15');
    expect(row.currentQuantity).toBe(-5);
  });

  it('clearing on a SHARED DE de-schedules it in place (no split), demand conserved', async () => {
    // Documented decision: clearing one order's Required By on a shared DE sets
    // the DE date to NULL in place for all co-owners — splitting needs a target
    // date, and a clear is a de-scheduling, not a re-dating. Demand is conserved.
    const d = '2026-07-01';
    const [de] = await harness.db.insert(stock).values({
      displayName: `Tulip (${d})`, typeName: 'Tulip', currentQuantity: -8, date: d, active: true,
    }).returning();
    const mkOrder = async (qty) => {
      const [o] = await harness.db.insert(orders).values({
        appOrderId: `BLO-DE-${++seq}`, customerId: 'recCust1', deliveryType: 'Pickup',
        requiredBy: d, status: ORDER_STATUS.NEW, paymentStatus: 'Unpaid',
      }).returning();
      await harness.db.insert(orderLines).values({
        orderId: o.id, stockItemId: de.id, flowerName: 'Tulip', quantity: qty,
      });
      return o;
    };
    const o1 = await mkOrder(5);
    await mkOrder(3);

    await orderRepo.updateOrder(o1.id, { 'Required By': null }, actor);

    const row = await liveDe(de.id);
    expect(row.date).toBeNull();          // de-scheduled in place
    expect(row.currentQuantity).toBe(-8); // full demand conserved (no split)
  });
});
