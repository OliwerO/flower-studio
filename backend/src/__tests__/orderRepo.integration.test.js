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

// ── configService mock — controls STOCK_Y_MODEL flag per test ──
// Declared at module level so vi.mock (which is hoisted) can reference it.
const yModelFlag = { enabled: false };
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
    yModelFlag.enabled = true;

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

    yModelFlag.enabled = false;
  });

  it('(C1) deepens a pre-existing negative Demand Entry exactly ONCE — no double-decrement', async () => {
    // Regression for C1. When an order line points at a DE that ALREADY holds
    // demand (qty < 0) for the same Variety + date the order computes, step 3b
    // (getOrCreateDemandEntry) deepens it AND step 4 (adjustQuantity) used to hit
    // the same row again → 2× the line qty. This seed-row assertion is the blind
    // spot the CR-08 test missed: it seeded qty 0, which step 3b skips (>= 0), so
    // the line went through step 4 only and never exercised the double path.
    yModelFlag.enabled = true;

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

    yModelFlag.enabled = false;
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
});

// ─────────────────────────────────────────────────────────────────────
// createOrder flag-on (STOCK_Y_MODEL)
// ─────────────────────────────────────────────────────────────────────
//
// These tests verify that when STOCK_Y_MODEL is on, createOrder routes
// DE-linked lines through getOrCreateDemandEntry, collapsing same-
// (Variety, date) pairs into one Demand Entry row.
//
// The flag is read from getStockYModelEnabled() which reads the env var
// at module load time. We mock configService.js to control it per-test.

describe('createOrder flag-on (STOCK_Y_MODEL)', () => {
  // Stock rows with typeName (Y-model rows) at qty < 0 (Demand Entries)
  let deStockId1;   // Peony Pink 60cm Sarah Bernhardt — will be the "existing DE"
  let deStockId2;   // Peony Pink 60cm (no cultivar) — different Variety

  beforeEach(async () => {
    // Default: flag OFF (regression guard — existing tests unaffected)
    yModelFlag.enabled = false;

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

  it('flag-off: existing stock deduction still works, no DE created per (Variety, date)', async () => {
    yModelFlag.enabled = false;

    await orderRepo.createOrder({
      customer: 'recCust1',
      customerRequest: 'Birthday',
      deliveryType: 'Pickup',
      orderLines: [
        { stockItemId: stockId1, flowerName: 'Red Rose', quantity: 5, sellPricePerUnit: 15 },
      ],
      paymentStatus: 'Unpaid',
      createdBy: 'florist',
    }, config, { actor: { actorRole: 'florist' } });

    // Stock deducted as normal
    const [s] = await harness.db.select().from(stock).where(eq(stock.id, stockId1));
    expect(s.currentQuantity).toBe(95); // started at 100, -5
  });

  it('flag-on: two orders same (Variety, Required By) → single DE row, two order_lines', async () => {
    yModelFlag.enabled = true;

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

  it('flag-on: two orders different Required By → two distinct DE rows', async () => {
    yModelFlag.enabled = true;

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

  it('flag-on: same Type/Colour/Size, different Cultivar → two distinct DEs', async () => {
    yModelFlag.enabled = true;

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

  it('flag-on: Required By fallback — order with orderDate but no requiredBy → DE date = orderDate', async () => {
    yModelFlag.enabled = true;

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
// updateOrder Required By cascade (STOCK_Y_MODEL)
// ─────────────────────────────────────────────────────────────────────
//
// When flag is on and Required By changes, each order_line's linked DE
// should have its date updated (sole-owner) or split (shared).

describe('updateOrder Required By cascade (STOCK_Y_MODEL)', () => {
  let deStockId;  // Y-model DE stock row

  beforeEach(async () => {
    // Default: flag OFF
    yModelFlag.enabled = false;

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

  it('flag-on: changing Required By on sole-owner DE → date updated in place', async () => {
    yModelFlag.enabled = true;

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

  it('flag-on: changing Required By on order sharing a DE → new DE created, line FK updated', async () => {
    yModelFlag.enabled = true;

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

  it('flag-on: changing Required By on Batch line → no DE affected', async () => {
    yModelFlag.enabled = true;

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

  it('flag-off: updateOrder with Required By change → delivery cascade only (legacy)', async () => {
    yModelFlag.enabled = false;

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
