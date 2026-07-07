// orderRepo integration tests — exercise the repo against a REAL Postgres
// (in-process via pglite) instead of mocked Drizzle calls. These tests
// pin the contract that the Phase 4 cutover depends on:
//   • createOrder is fully transactional — any failure rolls back ALL writes
//     including stock adjustments performed via stockRepo({ tx, ... }).
//   • cancelWithStockReturn returns each line's qty to stock atomically and
//     cascades order status → delivery status in the same transaction.
//   • editBouquetLines: add/update/remove lines + stock adjustments roll back
//     together if any step throws.
//   • deleteOrder relies on ON DELETE CASCADE — lines + delivery disappear
//     automatically without explicit unwinding code.
//   • transitionStatus enforces the state machine + cascades to delivery.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, orders, orderLines, deliveries, auditLog } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { ORDER_STATUS, DELIVERY_STATUS } from '../constants/statuses.js';

const dbHolder = { db: null };

vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

vi.mock('../services/configService.js', () => ({
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
import * as stockRepo from '../repos/stockRepo.js';

let harness;
let stockId1, stockId2;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();

  // Seed a couple of stock rows so createOrder has something to deduct from.
  const [s1] = await harness.db.insert(stock).values({
    airtableId: 'recStock1', displayName: 'Red Rose', currentQuantity: 100,
    currentCostPrice: '4.50', currentSellPrice: '15.00', active: true,
  }).returning();
  const [s2] = await harness.db.insert(stock).values({
    airtableId: 'recStock2', displayName: 'White Lily', currentQuantity: 50,
    currentCostPrice: '6.00', currentSellPrice: '22.00', active: true,
  }).returning();
  stockId1 = s1.id;
  stockId2 = s2.id;
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

// ── Test config (mocks orderService's config) ──
let orderIdCounter = 0;
const config = {
  getConfig: (k) => ({ defaultDeliveryFee: 25, driverCostPerDelivery: 10 }[k] ?? 0),
  getDriverOfDay: () => 'Timur',
  generateOrderId: async () => `BLO-TEST-${++orderIdCounter}`,
};

// ─────────────────────────────────────────────────────────────────────
// createOrder — the headline transactional rewrite
// ─────────────────────────────────────────────────────────────────────

describe('createOrder', () => {
  it('inserts order + lines + delivery + adjusts stock atomically', async () => {
    const { order, orderLines: createdLines, delivery } = await orderRepo.createOrder({
      customer: 'recCust1',
      customerRequest: 'Birthday bouquet',
      deliveryType: 'Delivery',
      orderLines: [
        { stockItemId: stockId1, flowerName: 'Red Rose', quantity: 12, sellPricePerUnit: 15, costPricePerUnit: 4.5 },
        { stockItemId: stockId2, flowerName: 'White Lily', quantity: 5, sellPricePerUnit: 22, costPricePerUnit: 6 },
      ],
      delivery: {
        address: 'ul. Floriańska 1', recipientName: 'Maria', recipientPhone: '+48 600 000 000',
        date: '2026-05-01', time: 'morning', driver: 'Timur', fee: 25,
      },
      paymentStatus: 'Paid',
      paymentMethod: 'Cash',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // Order shape
    expect(order.Status).toBe(ORDER_STATUS.NEW);
    expect(order['App Order ID']).toMatch(/^BLO-TEST-/);
    expect(order.Customer).toEqual(['recCust1']);
    expect(order['Order Lines']).toHaveLength(2);
    expect(order.Deliveries).toHaveLength(1);

    // Lines created
    expect(createdLines).toHaveLength(2);
    expect(createdLines[0].Quantity).toBe(12);

    // Delivery created
    expect(delivery['Delivery Address']).toBe('ul. Floriańska 1');
    expect(delivery['Assigned Driver']).toBe('Timur');

    // Stock deducted — the architectural payoff
    const [s1] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    const [s2] = await harness.db.select().from(stock).where(eq(stock.id, stockId2));
    expect(s1.currentQuantity).toBe(88);  // 100 - 12
    expect(s2.currentQuantity).toBe(45);  // 50 - 5

    // Audit rows: order create + 2 stock updates + delivery create = 4
    const audits = await harness.db.select().from(auditLog);
    expect(audits.length).toBeGreaterThanOrEqual(4);
    expect(audits.find(a => a.entityType === 'order' && a.action === 'create')).toBeTruthy();
    expect(audits.find(a => a.entityType === 'delivery' && a.action === 'create')).toBeTruthy();
  });

  it('rolls back EVERYTHING if any line is orphan (no stockItemId)', async () => {
    const stockBefore = await harness.db.select().from(stock);
    const ordersBefore = await harness.db.select().from(orders);

    await expect(orderRepo.createOrder({
      customer: 'recCust1',
      customerRequest: 'Bad bouquet',
      deliveryType: 'Pickup',
      orderLines: [
        { stockItemId: stockId1, flowerName: 'Red Rose', quantity: 5 },
        { stockItemId: null, flowerName: 'Mystery Flower', quantity: 3 },  // orphan
      ],
      paymentStatus: 'Unpaid',
      createdBy: 'florist',
    }, config)).rejects.toMatchObject({ statusCode: 400 });

    // Nothing should have been created or modified.
    const stockAfter = await harness.db.select().from(stock);
    const ordersAfter = await harness.db.select().from(orders);
    const linesAfter = await harness.db.select().from(orderLines);

    expect(stockAfter[0].currentQuantity).toBe(stockBefore[0].currentQuantity);
    expect(ordersAfter.length).toBe(ordersBefore.length);
    expect(linesAfter).toHaveLength(0);
  });

  it('rolls back stock adjustments if a later step throws', async () => {
    // Force a failure mid-transaction by patching one line to deduct from a
    // non-existent stock item. stockRepo.adjustQuantity throws 404, which
    // rolls back the entire createOrder transaction.
    await expect(orderRepo.createOrder({
      customer: 'recCust1',
      customerRequest: 'Doomed order',
      deliveryType: 'Pickup',
      orderLines: [
        { stockItemId: stockId1, flowerName: 'Red Rose', quantity: 5 },
        { stockItemId: 'rec-missing-stock-id', flowerName: 'Phantom', quantity: 2 },
      ],
      paymentStatus: 'Unpaid',
      createdBy: 'florist',
    }, config)).rejects.toMatchObject({ statusCode: 404 });

    // Red Rose qty should be unchanged — the rollback undid the deduction.
    const [s1] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    expect(s1.currentQuantity).toBe(100);

    // No order or lines persisted.
    expect(await harness.db.select().from(orders)).toHaveLength(0);
    expect(await harness.db.select().from(orderLines)).toHaveLength(0);
  });

  it('skipStockDeduction=true creates order without touching stock (premade flow)', async () => {
    await orderRepo.createOrder({
      customer: 'recCust1',
      customerRequest: 'Premade match',
      deliveryType: 'Pickup',
      orderLines: [
        { stockItemId: stockId1, flowerName: 'Red Rose', quantity: 10 },
      ],
      paymentStatus: 'Paid',
      paymentMethod: 'Card',
      createdBy: 'florist',
    }, config, { skipStockDeduction: true });

    // Stock unchanged.
    const [s1] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    expect(s1.currentQuantity).toBe(100);

    // Order + lines created.
    expect(await harness.db.select().from(orders)).toHaveLength(1);
    expect(await harness.db.select().from(orderLines)).toHaveLength(1);
  });

  it('(CR-08) accepts a demand-entry stock row (Y-model, qty 0) as a valid line stockItemId', async () => {
    // Simulate the CR-08 fix: the New-Order wizard POSTs /stock to create a
    // demand-entry row (qty=0, typed Variety), then binds the line to its id.
    // orderRepo.createOrder must accept the line (no orphan rejection) and
    // deepen the DE row's current_quantity by the ordered qty.
    // Insert a demand-entry stock row (qty 0, typed Variety — the Y-model shape).
    const [de] = await harness.db.insert(stock).values({
      airtableId: 'recDE1', displayName: 'Peony Pink',
      typeName: 'Peony', colour: 'Pink',
      currentQuantity: 0, currentCostPrice: '8.00', currentSellPrice: '25.00', active: true,
    }).returning();
    const deId = de.id;

    // (a) createOrder must NOT throw the orphan rejection
    const { order, orderLines: createdLines } = await orderRepo.createOrder({
      customer: 'recCust1',
      customerRequest: 'Peony demand order',
      deliveryType: 'Pickup',
      orderLines: [
        { stockItemId: deId, flowerName: 'Peony Pink', quantity: 3, sellPricePerUnit: 25, costPricePerUnit: 8 },
      ],
      paymentStatus: 'Unpaid',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // (b) order + line are created
    expect(order.Status).toBe(ORDER_STATUS.NEW);
    expect(createdLines).toHaveLength(1);
    expect(createdLines[0].Quantity).toBe(3);

    // (c) DE row's current_quantity is deepened by the ordered quantity
    const [deAfter] = await harness.db.select().from(stock).where(eq(stock.id, deId));
    expect(deAfter.currentQuantity).toBe(-3); // 0 - 3
  });

  it('(C1) deepens a pre-existing negative Demand Entry exactly ONCE — no double-decrement', async () => {
    // Regression for C1. When an order line points at a DE that ALREADY holds
    // demand (qty < 0) for the same Variety + date the order computes, step 3b
    // (getOrCreateDemandEntry) deepens it AND step 4 (adjustQuantity) used to hit
    // the same row again → 2× the line qty. This seed-row assertion is the blind
    // spot the CR-08 test missed: it seeded qty 0, which step 3b skips (>= 0), so
    // the line went through step 4 only and never exercised the double path.
    const demandDate = '2026-07-01';
    const [de] = await harness.db.insert(stock).values({
      airtableId: 'recDEc1', displayName: `Tulip (${demandDate})`,
      typeName: 'Tulip', currentQuantity: -20, date: demandDate, active: true,
    }).returning();
    const deId = de.id;

    await orderRepo.createOrder({
      customer: 'recCust1',
      customerRequest: 'Tulip top-up',
      deliveryType: 'Pickup',
      requiredBy: demandDate,
      orderLines: [
        { stockItemId: deId, flowerName: 'Tulip', quantity: 5, sellPricePerUnit: 4, costPricePerUnit: 1 },
      ],
      paymentStatus: 'Unpaid',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // Demand deepened by EXACTLY the line qty: -20 → -25 (not -30).
    const [deAfter] = await harness.db.select().from(stock).where(eq(stock.id, deId));
    expect(deAfter.currentQuantity).toBe(-25);

    // And no duplicate DE row was spawned for the same Variety + date.
    const sameVariety = await harness.db.select().from(stock)
      .where(and(eq(stock.typeName, 'Tulip'), eq(stock.date, demandDate)));
    expect(sameVariety).toHaveLength(1);
  });

  it('(CR-34) demand for a future order must NOT land on a pre-existing qty-0 DE dated earlier', async () => {
    // Repro: the y-model-guide seeds an Anemone "absorption" Demand Entry at
    // qty 0 dated in the past (06-25). An order needed 07-03 binds its line to
    // that row. Step 3b skips it (qty 0 >= 0 → can't tell DE from Batch), so
    // step 4 decrements it IN PLACE → demand lands on 06-25, not 07-03.
    // CORRECT: the demand must be homed to a DE dated to the order's required-by.
    const oldDate = '2026-06-25';
    const orderDate = '2026-07-03';
    const [de] = await harness.db.insert(stock).values({
      airtableId: 'recDE34', displayName: `Anemone Burgundy 50cm (${oldDate})`,
      typeName: 'Anemone', colour: 'Burgundy', sizeCm: 50,
      currentQuantity: 0, date: oldDate, active: true,
    }).returning();
    const deId = de.id;

    await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'Anemone for 3 Jul', deliveryType: 'Pickup',
      requiredBy: orderDate,
      orderLines: [
        { stockItemId: deId, flowerName: 'Anemone Burgundy 50cm', quantity: 10, sellPricePerUnit: 22, costPricePerUnit: 8 },
      ],
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    const [oldDE] = await harness.db.select().from(stock).where(eq(stock.id, deId));
    const futureDEs = await harness.db.select().from(stock)
      .where(and(eq(stock.typeName, 'Anemone'), eq(stock.date, orderDate)));

    expect(oldDE.currentQuantity).toBe(0);             // old 06-25 DE untouched
    expect(futureDEs).toHaveLength(1);                 // a 07-03 DE was created
    expect(futureDEs[0].currentQuantity).toBe(-10);    // demand homed to 07-03
  });
});

// ─────────────────────────────────────────────────────────────────────
// transitionStatus — state machine + delivery cascade
// ─────────────────────────────────────────────────────────────────────

describe('transitionStatus', () => {
  async function seedOrder() {
    return await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'X', deliveryType: 'Delivery',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 5 }],
      delivery: { address: 'X', date: '2026-05-01', driver: 'Timur', fee: 25 },
      paymentStatus: 'Paid', paymentMethod: 'Cash', createdBy: 'florist',
    }, config);
  }

  it('moves New → Ready successfully', async () => {
    const { order } = await seedOrder();
    const updated = await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);
    expect(updated.Status).toBe(ORDER_STATUS.READY);
  });

  it('rejects illegal transition New → Delivered', async () => {
    const { order } = await seedOrder();
    await expect(
      orderRepo.transitionStatus(order.id, ORDER_STATUS.DELIVERED),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('cascades order Out for Delivery → delivery status', async () => {
    const { order, delivery } = await seedOrder();
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.OUT_FOR_DELIVERY);

    const [d] = await harness.db.select().from(deliveries).where(eq(deliveries.id, delivery._pgId));
    expect(d.status).toBe(DELIVERY_STATUS.OUT_FOR_DELIVERY);
  });

  it('cascades order Delivered → delivery Delivered', async () => {
    const { order, delivery } = await seedOrder();
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.OUT_FOR_DELIVERY);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.DELIVERED);

    const [d] = await harness.db.select().from(deliveries).where(eq(deliveries.id, delivery._pgId));
    expect(d.status).toBe(DELIVERY_STATUS.DELIVERED);
  });
});

// ─────────────────────────────────────────────────────────────────────
// transitionStatus — status revert (owner any→any, florist history-undo)
// Regression for "florist marked the wrong bouquet Delivered, can't undo".
// ─────────────────────────────────────────────────────────────────────

describe('transitionStatus — revert + role', () => {
  const owner   = { actor: { actorRole: 'owner',   actorPinLabel: null } };
  const florist = { actor: { actorRole: 'florist', actorPinLabel: null } };

  async function seedDeliveryOrder() {
    return await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'Revert me', deliveryType: 'Delivery',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 3 }],
      delivery: { address: 'X', date: '2026-05-01', driver: 'Timur', fee: 25 },
      paymentStatus: 'Paid', paymentMethod: 'Cash', createdBy: 'florist',
    }, config);
  }

  it('owner may move Delivered → Ready (any→any) and reverse-cascades the delivery to Pending', async () => {
    const { order, delivery } = await seedDeliveryOrder();
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY, {}, owner);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.DELIVERED, {}, owner);

    const reverted = await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY, {}, owner);
    expect(reverted.Status).toBe(ORDER_STATUS.READY);

    const [d] = await harness.db.select().from(deliveries).where(eq(deliveries.id, delivery._pgId));
    expect(d.status).toBe(DELIVERY_STATUS.PENDING);
    expect(d.deliveredAt).toBeNull();
  });

  it('owner may do an arbitrary forward jump a florist cannot (New → Delivered)', async () => {
    const { order } = await seedDeliveryOrder();
    const jumped = await orderRepo.transitionStatus(order.id, ORDER_STATUS.DELIVERED, {}, owner);
    expect(jumped.Status).toBe(ORDER_STATUS.DELIVERED);
  });

  it('florist may revert Delivered → a status the order previously held (Ready)', async () => {
    const { order } = await seedDeliveryOrder();
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY, {}, florist);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.DELIVERED, {}, florist);

    const reverted = await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY, {}, florist);
    expect(reverted.Status).toBe(ORDER_STATUS.READY);
  });

  it('florist may revert Delivered → New (also previously held)', async () => {
    const { order } = await seedDeliveryOrder();
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY, {}, florist);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.DELIVERED, {}, florist);

    const reverted = await orderRepo.transitionStatus(order.id, ORDER_STATUS.NEW, {}, florist);
    expect(reverted.Status).toBe(ORDER_STATUS.NEW);
  });

  it('florist may NOT revert to a status the order never held (skipped Out for Delivery)', async () => {
    const { order } = await seedDeliveryOrder();
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY, {}, florist);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.DELIVERED, {}, florist); // Ready → Delivered, OOD skipped

    await expect(
      orderRepo.transitionStatus(order.id, ORDER_STATUS.OUT_FOR_DELIVERY, {}, florist),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('getOrderStatusHistory lists distinct previously-held statuses, excluding current', async () => {
    const { order } = await seedDeliveryOrder();
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY, {}, florist);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.OUT_FOR_DELIVERY, {}, florist);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.DELIVERED, {}, florist);

    const hist = await orderRepo.getOrderStatusHistory(order.id);
    expect(hist.current).toBe(ORDER_STATUS.DELIVERED);
    expect(hist.previousStatuses).toEqual(
      expect.arrayContaining([ORDER_STATUS.NEW, ORDER_STATUS.READY, ORDER_STATUS.OUT_FOR_DELIVERY]),
    );
    expect(hist.previousStatuses).not.toContain(ORDER_STATUS.DELIVERED);
  });
});

// ─────────────────────────────────────────────────────────────────────
// cancelWithStockReturn — cancel + N stock returns + delivery cascade
// ─────────────────────────────────────────────────────────────────────

describe('cancelWithStockReturn', () => {
  it('returns each line qty to stock + cancels order + cascades delivery', async () => {
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'Will cancel', deliveryType: 'Delivery',
      orderLines: [
        { stockItemId: stockId1, flowerName: 'Red Rose', quantity: 12 },
        { stockItemId: stockId2, flowerName: 'White Lily', quantity: 5 },
      ],
      delivery: { address: 'X', date: '2026-05-01', driver: 'Timur', fee: 25 },
      paymentStatus: 'Paid', paymentMethod: 'Cash', createdBy: 'florist',
    }, config);

    // Stock should have decreased on creation.
    const [s1Before] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    const [s2Before] = await harness.db.select().from(stock).where(eq(stock.id, stockId2));
    expect(s1Before.currentQuantity).toBe(88);
    expect(s2Before.currentQuantity).toBe(45);

    const result = await orderRepo.cancelWithStockReturn(order.id);
    expect(result.returnedItems).toHaveLength(2);

    // Stock restored.
    const [s1After] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    const [s2After] = await harness.db.select().from(stock).where(eq(stock.id, stockId2));
    expect(s1After.currentQuantity).toBe(100);
    expect(s2After.currentQuantity).toBe(50);

    // Order cancelled.
    const [orderRow] = await harness.db.select().from(orders).where(eq(orders.id, order._pgId));
    expect(orderRow.status).toBe(ORDER_STATUS.CANCELLED);

    // Delivery cascaded.
    const [d] = await harness.db.select().from(deliveries).where(eq(deliveries.orderId, order._pgId));
    expect(d.status).toBe(DELIVERY_STATUS.CANCELLED);
  });

  it('throws 400 when order is already cancelled', async () => {
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'X', deliveryType: 'Pickup',
      orderLines: [{ stockItemId: stockId1, flowerName: 'X', quantity: 1 }],
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config);

    await orderRepo.cancelWithStockReturn(order.id);
    await expect(
      orderRepo.cancelWithStockReturn(order.id),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ─────────────────────────────────────────────────────────────────────
// deleteOrder — hard delete with ON DELETE CASCADE
// ─────────────────────────────────────────────────────────────────────

describe('deleteOrder', () => {
  it('deletes order + cascades lines + delivery via FK', async () => {
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'Will delete', deliveryType: 'Delivery',
      orderLines: [
        { stockItemId: stockId1, flowerName: 'Red Rose', quantity: 5 },
        { stockItemId: stockId2, flowerName: 'White Lily', quantity: 3 },
      ],
      delivery: { address: 'X', date: '2026-05-01', driver: 'Timur', fee: 25 },
      paymentStatus: 'Paid', paymentMethod: 'Cash', createdBy: 'florist',
    }, config);

    await orderRepo.deleteOrder(order.id);

    expect(await harness.db.select().from(orders)).toHaveLength(0);
    expect(await harness.db.select().from(orderLines)).toHaveLength(0);
    expect(await harness.db.select().from(deliveries)).toHaveLength(0);

    // Stock returned because order was non-terminal.
    const [s1] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    const [s2] = await harness.db.select().from(stock).where(eq(stock.id, stockId2));
    expect(s1.currentQuantity).toBe(100);
    expect(s2.currentQuantity).toBe(50);
  });

  it('does NOT return stock for terminal orders (already returned/consumed)', async () => {
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'X', deliveryType: 'Pickup',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 5 }],
      paymentStatus: 'Paid', paymentMethod: 'Cash', createdBy: 'florist',
    }, config);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.PICKED_UP);

    // Stock was deducted when order was created — terminal status means it stays consumed.
    const [s1Before] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    expect(s1Before.currentQuantity).toBe(95);

    await orderRepo.deleteOrder(order.id);

    // Stock unchanged — terminal orders don't trigger return.
    const [s1After] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    expect(s1After.currentQuantity).toBe(95);
  });
});

// ─────────────────────────────────────────────────────────────────────
// editBouquetLines — add / update / remove with stock adjustments
// ─────────────────────────────────────────────────────────────────────

describe('editBouquetLines', () => {
  it('adding a new line deducts stock atomically', async () => {
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'X', deliveryType: 'Pickup',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 5 }],
      paymentStatus: 'Paid', paymentMethod: 'Cash', createdBy: 'florist',
    }, config);

    await orderRepo.editBouquetLines(order.id, {
      lines: [
        { stockItemId: stockId2, flowerName: 'White Lily', quantity: 3, sellPricePerUnit: 22, costPricePerUnit: 6 },
      ],
      removedLines: [],
    }, true);  // isOwner

    const [s2] = await harness.db.select().from(stock).where(eq(stock.id, stockId2));
    expect(s2.currentQuantity).toBe(47);  // 50 - 3
  });

  it('removing a line with action=return puts qty back into stock', async () => {
    const { order, orderLines: lines } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'X', deliveryType: 'Pickup',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 12 }],
      paymentStatus: 'Paid', paymentMethod: 'Cash', createdBy: 'florist',
    }, config);

    await orderRepo.editBouquetLines(order.id, {
      lines: [],
      removedLines: [
        { lineId: lines[0]._pgId, stockItemId: stockId1, quantity: 12, action: 'return' },
      ],
    }, true);

    const [s1] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    expect(s1.currentQuantity).toBe(100);  // returned

    // Line should be deleted.
    expect(await harness.db.select().from(orderLines)).toHaveLength(0);
  });

  it('removing a line WITHOUT an explicit action still returns stock (never silently lose stems)', async () => {
    // Regression: a removedLine with lineId+stockItemId+quantity but no/unknown
    // `action` used to delete the line while crediting nothing back — a silent
    // stock leak. The safe default is RETURN; only an explicit 'writeoff' loses
    // the stems. (Pitfall #5: silent state changes.)
    const { order, orderLines: lines } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'X', deliveryType: 'Pickup',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 8 }],
      paymentStatus: 'Paid', paymentMethod: 'Cash', createdBy: 'florist',
    }, config);

    await orderRepo.editBouquetLines(order.id, {
      lines: [],
      removedLines: [
        { lineId: lines[0]._pgId, stockItemId: stockId1, quantity: 8 },  // NO action
      ],
    }, true);

    const [s1] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    expect(s1.currentQuantity).toBe(100);  // 92 + 8 returned, not leaked
    expect(await harness.db.select().from(orderLines)).toHaveLength(0);
  });

  it('removing a line with action=writeoff does NOT return stock (explicit loss)', async () => {
    const { order, orderLines: lines } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'X', deliveryType: 'Pickup',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 8 }],
      paymentStatus: 'Paid', paymentMethod: 'Cash', createdBy: 'florist',
    }, config);

    await orderRepo.editBouquetLines(order.id, {
      lines: [],
      removedLines: [
        { lineId: lines[0]._pgId, stockItemId: stockId1, quantity: 8, action: 'writeoff' },
      ],
    }, true);

    const [s1] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    expect(s1.currentQuantity).toBe(92);  // 100 - 8, stems written off (not returned)
  });

  it('updating quantity adjusts stock by the delta', async () => {
    const { order, orderLines: lines } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'X', deliveryType: 'Pickup',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 10 }],
      paymentStatus: 'Paid', paymentMethod: 'Cash', createdBy: 'florist',
    }, config);

    // Stock at 90 after creation. Owner edits qty to 6 — should refund 4 to stock.
    await orderRepo.editBouquetLines(order.id, {
      lines: [{
        id: lines[0]._pgId,
        stockItemId: stockId1,
        flowerName: 'Red Rose',
        quantity: 6,
        _originalQty: 10,
      }],
      removedLines: [],
    }, true);

    const [s1] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    expect(s1.currentQuantity).toBe(94);  // 90 + (10 - 6)
  });

  it('auto-reverts Ready → New when owner edits', async () => {
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'X', deliveryType: 'Pickup',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 5 }],
      paymentStatus: 'Paid', paymentMethod: 'Cash', createdBy: 'florist',
    }, config);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);

    await orderRepo.editBouquetLines(order.id, {
      lines: [{ stockItemId: stockId2, flowerName: 'White Lily', quantity: 2, sellPricePerUnit: 22 }],
      removedLines: [],
    }, true);

    const fresh = await orderRepo.getById(order.id);
    expect(fresh.Status).toBe(ORDER_STATUS.NEW);
  });
});

// ─────────────────────────────────────────────────────────────────────
// list + getById
// ─────────────────────────────────────────────────────────────────────

describe('list + getById', () => {
  it('list filters by status', async () => {
    await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'A', deliveryType: 'Pickup',
      orderLines: [{ stockItemId: stockId1, flowerName: 'X', quantity: 1 }],
      paymentStatus: 'Paid', paymentMethod: 'Cash', createdBy: 'florist',
    }, config);
    const { order: o2 } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'B', deliveryType: 'Pickup',
      orderLines: [{ stockItemId: stockId1, flowerName: 'X', quantity: 1 }],
      paymentStatus: 'Paid', paymentMethod: 'Cash', createdBy: 'florist',
    }, config);
    await orderRepo.transitionStatus(o2.id, ORDER_STATUS.READY);

    const newOrders = await orderRepo.list({ pg: { statuses: [ORDER_STATUS.NEW] } });
    const readyOrders = await orderRepo.list({ pg: { statuses: [ORDER_STATUS.READY] } });
    expect(newOrders).toHaveLength(1);
    expect(readyOrders).toHaveLength(1);
  });

  it('getById returns order with lines + delivery populated', async () => {
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'X', deliveryType: 'Delivery',
      orderLines: [
        { stockItemId: stockId1, flowerName: 'Red Rose', quantity: 5 },
        { stockItemId: stockId2, flowerName: 'White Lily', quantity: 2 },
      ],
      delivery: { address: 'X', date: '2026-05-01', driver: 'Timur', fee: 25 },
      paymentStatus: 'Paid', paymentMethod: 'Cash', createdBy: 'florist',
    }, config);

    const fetched = await orderRepo.getById(order.id);
    expect(fetched['Order Lines']).toHaveLength(2);
    expect(fetched.Deliveries).toHaveLength(1);
  });

  it('getById throws 404 when order missing', async () => {
    await expect(orderRepo.getById('rec-does-not-exist')).rejects.toMatchObject({ statusCode: 404 });
  });

  // Regression for #390: the Completed tab's single-date filter must match
  // orders by FULFILMENT date (Required By), not by when they were placed
  // (Order Date) — an order placed on the selected day but delivered on a
  // different day must NOT appear.
  it('pg.completedForDate matches Required By only, not Order Date', async () => {
    // Placed on the 1st, delivered on the 5th — must show up under forDate=5th,
    // NOT under forDate=1st.
    const [placedOn1st] = await harness.db.insert(orders).values({
      appOrderId: 'BLO-390-A', customerId: 'cust-390', orderDate: '2026-06-01',
      requiredBy: '2026-06-05', deliveryType: 'Delivery', status: ORDER_STATUS.DELIVERED,
      paymentStatus: 'Paid',
    }).returning();
    // Placed AND delivered on the 1st — should show up under forDate=1st.
    const [placedAndDeliveredOn1st] = await harness.db.insert(orders).values({
      appOrderId: 'BLO-390-B', customerId: 'cust-390', orderDate: '2026-06-01',
      requiredBy: '2026-06-01', deliveryType: 'Pickup', status: ORDER_STATUS.PICKED_UP,
      paymentStatus: 'Paid',
    }).returning();

    const forJune1 = await orderRepo.list({
      pg: { statuses: [ORDER_STATUS.DELIVERED, ORDER_STATUS.PICKED_UP], completedForDate: '2026-06-01' },
    });
    const ids = forJune1.map(o => o.id);
    expect(ids).toContain(placedAndDeliveredOn1st.id);
    expect(ids).not.toContain(placedOn1st.id);

    const forJune5 = await orderRepo.list({
      pg: { statuses: [ORDER_STATUS.DELIVERED, ORDER_STATUS.PICKED_UP], completedForDate: '2026-06-05' },
    });
    const ids5 = forJune5.map(o => o.id);
    expect(ids5).toContain(placedOn1st.id);
    expect(ids5).not.toContain(placedAndDeliveredOn1st.id);
  });
});

// ─────────────────────────────────────────────────────────────────────
// createOrder — Demand Entry routing (Y-model)
// ─────────────────────────────────────────────────────────────────────
//
// These tests verify that createOrder routes DE-linked lines through
// getOrCreateDemandEntry, collapsing same-(Variety, date) pairs into one
// Demand Entry row.

describe('createOrder — Demand Entry routing (Y-model)', () => {
  // Stock rows with typeName (Y-model rows) at qty < 0 (Demand Entries)
  let deStockId1;   // Peony Pink 60cm Sarah Bernhardt — will be the "existing DE"
  let deStockId2;   // Peony Pink 60cm (no cultivar) — different Variety

  beforeEach(async () => {
    // Seed DE-shaped stock rows (typeName set, qty < 0)
    const [de1] = await harness.db.insert(stock).values({
      displayName: 'Peony Pink 60cm Sarah Bernhardt',
      currentQuantity: -20,
      typeName: 'Peony',
      colour: 'Pink',
      sizeCm: 60,
      cultivar: 'Sarah Bernhardt',
      active: true,
    }).returning();
    const [de2] = await harness.db.insert(stock).values({
      displayName: 'Peony Pink 60cm',
      currentQuantity: -10,
      typeName: 'Peony',
      colour: 'Pink',
      sizeCm: 60,
      cultivar: null,
      active: true,
    }).returning();
    deStockId1 = de1.id;
    deStockId2 = de2.id;
  });

  it('two orders same (Variety, Required By) → single DE row, two order_lines', async () => {
    // Order 1: line pointing at deStockId1 (which has typeName + qty<0)
    const { orderLines: lines1 } = await orderRepo.createOrder({
      customer: 'recCust1',
      customerRequest: 'Order A',
      deliveryType: 'Pickup',
      requiredBy: '2026-05-15',
      orderLines: [
        { stockItemId: deStockId1, flowerName: 'Peony', quantity: 5, sellPricePerUnit: 20 },
      ],
      paymentStatus: 'Unpaid',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // Order 2: same Variety, same Required By
    const { orderLines: lines2 } = await orderRepo.createOrder({
      customer: 'recCust1',
      customerRequest: 'Order B',
      deliveryType: 'Pickup',
      requiredBy: '2026-05-15',
      orderLines: [
        { stockItemId: deStockId1, flowerName: 'Peony', quantity: 3, sellPricePerUnit: 20 },
      ],
      paymentStatus: 'Unpaid',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // Both lines should point to the same DE
    const lineId1 = lines1[0]._pgId;
    const lineId2 = lines2[0]._pgId;
    const [l1] = await harness.db.select().from(orderLines).where(eq(orderLines.id, lineId1));
    const [l2] = await harness.db.select().from(orderLines).where(eq(orderLines.id, lineId2));
    expect(l1.stockItemId).toBe(l2.stockItemId);

    // That DE should have qty -8 (5 + 3)
    const [deRow] = await harness.db.select().from(stock)
      .where(eq(stock.id, l1.stockItemId));
    expect(deRow.currentQuantity).toBe(-8);
    expect(deRow.date).toBe('2026-05-15');
  });

  it('two orders different Required By → two distinct DE rows', async () => {
    const { orderLines: lines1 } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'A',
      deliveryType: 'Pickup',
      requiredBy: '2026-05-15',
      orderLines: [{ stockItemId: deStockId1, flowerName: 'Peony', quantity: 4 }],
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    const { orderLines: lines2 } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'B',
      deliveryType: 'Pickup',
      requiredBy: '2026-05-20',
      orderLines: [{ stockItemId: deStockId1, flowerName: 'Peony', quantity: 4 }],
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    const [l1] = await harness.db.select().from(orderLines).where(eq(orderLines.id, lines1[0]._pgId));
    const [l2] = await harness.db.select().from(orderLines).where(eq(orderLines.id, lines2[0]._pgId));

    // Different DEs
    expect(l1.stockItemId).not.toBe(l2.stockItemId);

    // Each has its own date
    const [de1] = await harness.db.select().from(stock).where(eq(stock.id, l1.stockItemId));
    const [de2] = await harness.db.select().from(stock).where(eq(stock.id, l2.stockItemId));
    expect(de1.date).toBe('2026-05-15');
    expect(de2.date).toBe('2026-05-20');
  });

  it('same Type/Colour/Size, different Cultivar → two distinct DEs', async () => {
    const { orderLines: linesWithCultivar } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'C',
      deliveryType: 'Pickup',
      requiredBy: '2026-05-15',
      orderLines: [{ stockItemId: deStockId1, flowerName: 'Peony', quantity: 3 }],
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    const { orderLines: linesNullCultivar } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'D',
      deliveryType: 'Pickup',
      requiredBy: '2026-05-15',
      orderLines: [{ stockItemId: deStockId2, flowerName: 'Peony', quantity: 3 }],
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    const [l1] = await harness.db.select().from(orderLines)
      .where(eq(orderLines.id, linesWithCultivar[0]._pgId));
    const [l2] = await harness.db.select().from(orderLines)
      .where(eq(orderLines.id, linesNullCultivar[0]._pgId));

    // Two distinct DEs — strict Variety identity
    expect(l1.stockItemId).not.toBe(l2.stockItemId);
  });

  it('Required By fallback — order with orderDate but no requiredBy → DE date = orderDate', async () => {
    const { orderLines: lines } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'E',
      deliveryType: 'Pickup',
      // No requiredBy
      orderLines: [{ stockItemId: deStockId1, flowerName: 'Peony', quantity: 2 }],
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    const [l] = await harness.db.select().from(orderLines)
      .where(eq(orderLines.id, lines[0]._pgId));
    const [deRow] = await harness.db.select().from(stock).where(eq(stock.id, l.stockItemId));

    // DE should have today's date (createOrder sets demandDate from computeDemandDate)
    // The date should be a valid YYYY-MM-DD string
    expect(deRow.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// updateOrder Required By cascade (Y-model)
// ─────────────────────────────────────────────────────────────────────
//
// When Required By changes, each order_line's linked DE should have its
// date updated (sole-owner) or split (shared).

describe('updateOrder Required By cascade (Y-model)', () => {
  let deStockId;  // Y-model DE stock row

  beforeEach(async () => {
    // Seed a Y-model DE stock row
    const [de] = await harness.db.insert(stock).values({
      displayName: 'Peony Pink 60cm Sarah Bernhardt',
      currentQuantity: -30,
      typeName: 'Peony',
      colour: 'Pink',
      sizeCm: 60,
      cultivar: 'Sarah Bernhardt',
      active: true,
    }).returning();
    deStockId = de.id;
  });

  it('changing Required By on sole-owner DE → date updated in place', async () => {
    // Create order with a line pointing at the DE
    const { order, orderLines: lines } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'A',
      deliveryType: 'Pickup',
      requiredBy: '2026-05-15',
      orderLines: [{ stockItemId: deStockId, flowerName: 'Peony', quantity: 4 }],
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // Find which DE the order_line is now pointing at
    const [lineRow] = await harness.db.select().from(orderLines)
      .where(eq(orderLines.id, lines[0]._pgId));
    const originalDeId = lineRow.stockItemId;

    // Now change Required By
    await orderRepo.updateOrder(order.id, { 'Required By': '2026-05-22' }, { actor: { actorRole: 'florist' } });

    // DE date should be updated in place
    const [deRow] = await harness.db.select().from(stock).where(eq(stock.id, originalDeId));
    expect(deRow.date).toBe('2026-05-22');

    // order_line FK should be unchanged
    const [updatedLine] = await harness.db.select().from(orderLines)
      .where(eq(orderLines.id, lines[0]._pgId));
    expect(updatedLine.stockItemId).toBe(originalDeId);
  });

  it('changing Required By on order sharing a DE → new DE created, line FK updated', async () => {
    // Create TWO orders sharing the same DE (same Variety + same Required By)
    const { order: order1, orderLines: lines1 } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'A',
      deliveryType: 'Pickup',
      requiredBy: '2026-05-15',
      orderLines: [{ stockItemId: deStockId, flowerName: 'Peony', quantity: 5 }],
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    const { order: order2, orderLines: lines2 } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'B',
      deliveryType: 'Pickup',
      requiredBy: '2026-05-15',
      orderLines: [{ stockItemId: deStockId, flowerName: 'Peony', quantity: 3 }],
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // Confirm both lines share the same DE
    const [l1before] = await harness.db.select().from(orderLines)
      .where(eq(orderLines.id, lines1[0]._pgId));
    const [l2before] = await harness.db.select().from(orderLines)
      .where(eq(orderLines.id, lines2[0]._pgId));
    expect(l1before.stockItemId).toBe(l2before.stockItemId);
    const sharedDeId = l1before.stockItemId;

    // Change Required By for order1 only
    await orderRepo.updateOrder(order1.id, { 'Required By': '2026-05-22' }, { actor: { actorRole: 'florist' } });

    // order1's line should now point to a new DE
    const [l1after] = await harness.db.select().from(orderLines)
      .where(eq(orderLines.id, lines1[0]._pgId));
    expect(l1after.stockItemId).not.toBe(sharedDeId);

    // order2's line should still point to the original DE
    const [l2after] = await harness.db.select().from(orderLines)
      .where(eq(orderLines.id, lines2[0]._pgId));
    expect(l2after.stockItemId).toBe(sharedDeId);

    // Old DE qty should be decremented by order1's qty (5): original -8 + 5 = -3
    const [oldDe] = await harness.db.select().from(stock).where(eq(stock.id, sharedDeId));
    expect(oldDe.currentQuantity).toBe(-3);
  });

  it('changing Required By on Batch line → no DE affected', async () => {
    // Order with a legacy stock line (no typeName → Batch path)
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'Batch test',
      deliveryType: 'Pickup',
      requiredBy: '2026-05-15',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 5 }],
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // Get stock qty before
    const [before] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    const beforeQty = before.currentQuantity;

    // Change Required By — should not touch DE (no DE linked)
    await orderRepo.updateOrder(order.id, { 'Required By': '2026-05-22' }, { actor: { actorRole: 'florist' } });

    // Stock row unchanged
    const [after] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    expect(after.currentQuantity).toBe(beforeQty);
    expect(after.date).toBeNull(); // no date column for legacy rows
  });

  it('updateOrder with Required By change on a non-DE order → delivery cascade only', async () => {
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'Delivery test',
      deliveryType: 'Delivery',
      requiredBy: '2026-05-15',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 3 }],
      delivery: { address: 'ul. Test 1', date: '2026-05-15', fee: 25, driver: 'Timur' },
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    await orderRepo.updateOrder(order.id, { 'Required By': '2026-05-20' }, { actor: { actorRole: 'florist' } });

    // Delivery date should be cascaded (existing legacy behavior)
    const updated = await orderRepo.getById(order.id);
    expect(updated['Required By']).toBe('2026-05-20');
    // Delivery date should also be updated via the existing cascade
    if (updated._delivery) {
      expect(updated._delivery['Delivery Date']).toBe('2026-05-20');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// updateOrder Delivery→Pickup cascade (#317)
// ─────────────────────────────────────────────────────────────────────
//
// When an order's Delivery Type transitions Delivery → Pickup, the
// linked delivery record must be cancelled inside the same transaction.
// This prevents the driver app from showing a stale Pending delivery.

describe('updateOrder Delivery→Pickup cancel cascade (#317)', () => {
  it('cancels linked Pending delivery when order converts Delivery → Pickup', async () => {
    // Create a delivery-type order with a linked delivery record.
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'Convert test',
      deliveryType: 'Delivery',
      requiredBy: '2026-06-20',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 3 }],
      delivery: { address: 'ul. Floriańska 1', date: '2026-06-20', fee: 25, driver: 'Timur' },
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // Sanity: delivery should exist and be Pending.
    const before = await orderRepo.getById(order.id);
    expect(before['Delivery Type']).toBe('Delivery');
    expect(before._delivery).toBeTruthy();
    expect(before._delivery['Status']).toBe(DELIVERY_STATUS.PENDING);
    const deliveryId = before._delivery.id;

    // Patch: flip Delivery Type to Pickup.
    await orderRepo.updateOrder(order.id, { 'Delivery Type': 'Pickup' }, { actor: { actorRole: 'owner' } });

    // The delivery record should now be Cancelled.
    const [deliveryRow] = await harness.db.select().from(deliveries)
      .where(eq(deliveries.id, deliveryId));
    expect(deliveryRow.status).toBe(DELIVERY_STATUS.CANCELLED);

    // listDeliveries with no filter returns all non-deleted rows —
    // but the driver app only renders Pending/Out-for-Delivery/Delivered.
    // Confirm the cancelled delivery would be excluded from those groups
    // (i.e. its status is Cancelled, not Pending).
    const allDeliveries = await orderRepo.listDeliveries({});
    const found = allDeliveries.find(d => d.id === deliveryId);
    expect(found?.Status).toBe(DELIVERY_STATUS.CANCELLED);

    // Audit trail: a delivery update audit row should exist with Status=Cancelled.
    // audit_log stores { before, after } in the jsonb `diff` column.
    const auditRows = await harness.db.select().from(auditLog)
      .where(eq(auditLog.entityType, 'delivery'));
    const cancelAudit = auditRows.find(
      a => a.entityId === deliveryId && a.action === 'update'
        && a.diff?.after?.Status === DELIVERY_STATUS.CANCELLED
    );
    expect(cancelAudit).toBeTruthy();
  });

  it('does NOT cancel the delivery when patching unrelated fields (Delivery stays Pending)', async () => {
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'Unrelated patch',
      deliveryType: 'Delivery',
      requiredBy: '2026-06-20',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 2 }],
      delivery: { address: 'ul. Test 2', date: '2026-06-20', fee: 25, driver: 'Timur' },
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'owner' } });

    const before = await orderRepo.getById(order.id);
    const deliveryId = before._delivery.id;

    // Patch something unrelated — florist note.
    await orderRepo.updateOrder(order.id, { 'Florist Note': 'Add ribbon' }, { actor: { actorRole: 'owner' } });

    // Delivery must remain Pending.
    const [deliveryRow] = await harness.db.select().from(deliveries)
      .where(eq(deliveries.id, deliveryId));
    expect(deliveryRow.status).toBe(DELIVERY_STATUS.PENDING);
  });

  it('does NOT re-cancel a delivery that is already Cancelled', async () => {
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'Already cancelled',
      deliveryType: 'Delivery',
      requiredBy: '2026-06-20',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 2 }],
      delivery: { address: 'ul. Test 3', date: '2026-06-20', fee: 25, driver: 'Timur' },
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    const before = await orderRepo.getById(order.id);
    const deliveryId = before._delivery.id;

    // Manually cancel the delivery first.
    await harness.db.update(deliveries)
      .set({ status: DELIVERY_STATUS.CANCELLED, updatedAt: new Date() })
      .where(eq(deliveries.id, deliveryId));

    // Patch Delivery Type → Pickup (delivery already Cancelled).
    await orderRepo.updateOrder(order.id, { 'Delivery Type': 'Pickup' }, { actor: { actorRole: 'owner' } });

    // Should still be Cancelled — no extra audit rows for a no-op.
    const [deliveryRow] = await harness.db.select().from(deliveries)
      .where(eq(deliveries.id, deliveryId));
    expect(deliveryRow.status).toBe(DELIVERY_STATUS.CANCELLED);
  });

  it('does NOT touch delivery when converting Pickup → Delivery (no linked delivery exists)', async () => {
    // Pickup order — no delivery record.
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'Pickup order',
      deliveryType: 'Pickup',
      requiredBy: '2026-06-20',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 2 }],
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // Patch Delivery Type → Delivery (the reverse path).
    // convertToDelivery is the proper endpoint for this; updateOrder just stores the field.
    // Either way no linked delivery exists, so nothing should blow up.
    await orderRepo.updateOrder(order.id, { 'Delivery Type': 'Delivery' }, { actor: { actorRole: 'owner' } });

    // No deliveries at all — confirm.
    const allDeliveries = await harness.db.select().from(deliveries);
    expect(allDeliveries).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// transitionStatus — Y-model demand settlement (#3)
//
// When an order enters a fulfilled-terminal state (Delivered / Picked Up) the
// stems have physically shipped, so any Demand Entry the lines still point at
// must be reconciled: FEFO-consume real same-Variety Batches for the stems that
// left, and release the line's demand from the DE (soft-delete at >= 0). A
// delivered order must never leave a floating negative (the 2026-07-06 phantom).
// ─────────────────────────────────────────────────────────────────────

describe('transitionStatus — Y-model demand settlement (#3)', () => {
  // Seed a 0-qty Variety ANCHOR with a stale date. An order line pointing at it is
  // classified as needing a Demand Entry (qty 0 + date ≠ the order's demand date),
  // so createOrder step 3b builds the real dated DE fresh — mirroring prod, where
  // the orders (not a pre-seed) create the DE. The 0-qty anchor contributes 0 to net.
  async function seedAnchor(attrs = {}) {
    const [a] = await harness.db.insert(stock).values({
      displayName: `Peony Pink (anchor)`,
      currentQuantity: 0,
      typeName: 'Peony', colour: 'Pink', sizeCm: null, cultivar: null,
      date: '2000-01-01', active: true, ...attrs,
    }).returning();
    return a.id;
  }
  async function seedBatch(qty, date, attrs = {}) {
    const [b] = await harness.db.insert(stock).values({
      displayName: `Peony Pink batch ${date || ''}`,
      currentQuantity: qty, // positive
      typeName: 'Peony', colour: 'Pink', sizeCm: null, cultivar: null,
      date: date || null, active: true, ...attrs,
    }).returning();
    return b.id;
  }
  // Net effective stock for the Peony/Pink Variety = SUM of all live rows.
  async function peonyNet() {
    const rows = await harness.db.select().from(stock)
      .where(and(eq(stock.typeName, 'Peony'), eq(stock.colour, 'Pink')));
    return rows
      .filter(r => r.deletedAt == null)
      .reduce((n, r) => n + Number(r.currentQuantity), 0);
  }
  async function makeOrder(anchorId, qty, requiredBy = '2026-07-10') {
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'Peony order', deliveryType: 'Pickup',
      requiredBy,
      orderLines: [{ stockItemId: anchorId, flowerName: 'Peony', quantity: qty, sellPricePerUnit: 20 }],
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });
    // Read the persisted line to get its CURRENT binding (rebound to the dated DE).
    const [line] = await harness.db.select().from(orderLines)
      .where(eq(orderLines.orderId, order.id));
    return { order, lineStockId: line.stockItemId };
  }

  it('substitute case (no covering batch): releases the DE, net rises to 0, no batch touched', async () => {
    const anchorId = await seedAnchor();       // Peony Pink Variety, no batch exists
    const { order, lineStockId } = await makeOrder(anchorId, 11);

    expect(await peonyNet()).toBe(-11);        // shortfall standing

    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.PICKED_UP);

    // DE released + soft-deleted; no same-Variety batch to consume.
    const [de] = await harness.db.select().from(stock).where(eq(stock.id, lineStockId));
    expect(de.deletedAt).not.toBeNull();
    expect(await peonyNet()).toBe(0);          // shortfall gone — substitute fulfilled it
  });

  it('batch fully covers (incident post-relabel): consumes the batch, DE gone, net unchanged', async () => {
    const anchorId = await seedAnchor();
    // Order placed with no stock → DE -11. Batch arrives AFTER without absorbing it
    // (the mislabel incident: variety-key mismatch skipped ADR-0002 absorption).
    const { order, lineStockId } = await makeOrder(anchorId, 11);
    const batchId = await seedBatch(15, '2026-07-06');

    expect(await peonyNet()).toBe(4);          // 15 - 11

    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.PICKED_UP);

    const [batch] = await harness.db.select().from(stock).where(eq(stock.id, batchId));
    expect(batch.currentQuantity).toBe(4);     // 15 - 11 consumed
    const [de] = await harness.db.select().from(stock).where(eq(stock.id, lineStockId));
    expect(de.deletedAt).not.toBeNull();       // DE settled + dropped
    expect(await peonyNet()).toBe(4);          // net unchanged — DE was already reserving
  });

  it('partial cover: consumes all of a too-small batch, releases the DE, net rises to 0', async () => {
    const anchorId = await seedAnchor();
    const { order, lineStockId } = await makeOrder(anchorId, 11);
    const batchId = await seedBatch(5, '2026-07-06');   // too-small batch arrives after

    expect(await peonyNet()).toBe(-6);         // 5 - 11

    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.PICKED_UP);

    const [batch] = await harness.db.select().from(stock).where(eq(stock.id, batchId));
    expect(batch.currentQuantity).toBe(0);     // drained, never negative (W2)
    const [de] = await harness.db.select().from(stock).where(eq(stock.id, lineStockId));
    expect(de.deletedAt).not.toBeNull();
    expect(await peonyNet()).toBe(0);          // 6 uncovered → substitute; shortfall cleared
  });

  it('shared DE (two orders same Variety+date): settling one releases only its qty', async () => {
    const anchorId = await seedAnchor();       // orders build the dated DE
    const a = await makeOrder(anchorId, 5, '2026-07-10');
    const b = await makeOrder(anchorId, 3, '2026-07-10');
    const batchId = await seedBatch(10, '2026-07-06');  // batch arrives after both orders
    // Both bind to one dated DE at -8 (5 + 3).
    expect(a.lineStockId).toBe(b.lineStockId);
    const [sharedBefore] = await harness.db.select().from(stock).where(eq(stock.id, a.lineStockId));
    expect(sharedBefore.currentQuantity).toBe(-8);

    // Deliver order A (qty 5).
    await orderRepo.transitionStatus(a.order.id, ORDER_STATUS.READY);
    await orderRepo.transitionStatus(a.order.id, ORDER_STATUS.PICKED_UP);

    const [batch] = await harness.db.select().from(stock).where(eq(stock.id, batchId));
    expect(batch.currentQuantity).toBe(5);     // 10 - 5 consumed for A
    const [sharedAfter] = await harness.db.select().from(stock).where(eq(stock.id, a.lineStockId));
    expect(sharedAfter.currentQuantity).toBe(-3); // B's 3 still owed
    expect(sharedAfter.deletedAt).toBeNull();  // not dropped — still open demand
  });

  it('idempotent: revert out of terminal then re-deliver does not double-consume', async () => {
    const anchorId = await seedAnchor();
    const { order } = await makeOrder(anchorId, 11);
    const batchId = await seedBatch(15, '2026-07-06');   // arrives after order → DE stuck open
    const owner = { actor: { actorRole: 'owner' } };

    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.PICKED_UP, {}, owner);
    let [batch] = await harness.db.select().from(stock).where(eq(stock.id, batchId));
    expect(batch.currentQuantity).toBe(4);

    // Owner reverts, then re-delivers — settlement must not fire again.
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY, {}, owner);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.PICKED_UP, {}, owner);
    [batch] = await harness.db.select().from(stock).where(eq(stock.id, batchId));
    expect(batch.currentQuantity).toBe(4);     // unchanged — no second consume
    expect(await peonyNet()).toBe(4);
  });

  it('delivery cascade: driver marking the DELIVERY Delivered settles the order demand', async () => {
    const anchorId = await seedAnchor();
    // A DELIVERY order (not pickup) → status flips via the delivery→order cascade,
    // NOT transitionStatus. Settlement must fire through that seam too.
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'Peony delivery', deliveryType: 'Delivery',
      requiredBy: '2026-07-10',
      orderLines: [{ stockItemId: anchorId, flowerName: 'Peony', quantity: 11, sellPricePerUnit: 20 }],
      delivery: { address: 'Krakow 1', date: '2026-07-10', driver: 'Timur', fee: 20 },
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });
    const batchId = await seedBatch(15, '2026-07-06');   // arrives after → DE stuck open
    expect(await peonyNet()).toBe(4);

    // Driver marks the linked delivery Delivered.
    const [delivery] = await harness.db.select().from(deliveries)
      .where(eq(deliveries.orderId, order.id));
    await orderRepo.updateDelivery(delivery.id, { Status: DELIVERY_STATUS.DELIVERED },
      { actor: { actorRole: 'driver' } });

    const [batch] = await harness.db.select().from(stock).where(eq(stock.id, batchId));
    expect(batch.currentQuantity).toBe(4);     // consumed via the cascade seam
    expect(await peonyNet()).toBe(4);          // net unchanged — demand reconciled
  });

  it('batch-bound line: terminal transition does not double-decrement (already consumed at create)', async () => {
    // stockId1 (Red Rose, qty 100) is a legacy Batch (no typeName) — consumed at create.
    const { order } = await orderRepo.createOrder({
      customer: 'recCust1', customerRequest: 'Roses', deliveryType: 'Pickup',
      orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 5 }],
      paymentStatus: 'Unpaid', createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });
    let [s] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    expect(s.currentQuantity).toBe(95);

    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.PICKED_UP);

    [s] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    expect(s.currentQuantity).toBe(95);        // no-op — batch not touched again
  });
});
