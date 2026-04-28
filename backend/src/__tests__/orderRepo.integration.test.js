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
import { eq } from 'drizzle-orm';
import { ORDER_STATUS, DELIVERY_STATUS } from '../constants/statuses.js';

const dbHolder = { db: null };

vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

vi.mock('../services/airtable.js', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteRecord: vi.fn(),
  atomicStockAdjust: vi.fn(),
}));

vi.mock('../config/airtable.js', () => ({
  default: {},
  TABLES: { STOCK: 'tblStock', ORDERS: 'tblOrders', ORDER_LINES: 'tblLines', DELIVERIES: 'tblDelivery' },
}));

import * as orderRepo from '../repos/orderRepo.js';
import * as stockRepo from '../repos/stockRepo.js';

let harness;
let stockId1, stockId2;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
  orderRepo._setMode('postgres');
  stockRepo._setMode('postgres');

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

describe('createOrder (postgres mode)', () => {
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
});

// ─────────────────────────────────────────────────────────────────────
// transitionStatus — state machine + delivery cascade
// ─────────────────────────────────────────────────────────────────────

describe('transitionStatus (postgres mode)', () => {
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
// cancelWithStockReturn — cancel + N stock returns + delivery cascade
// ─────────────────────────────────────────────────────────────────────

describe('cancelWithStockReturn (postgres mode)', () => {
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

describe('deleteOrder (postgres mode)', () => {
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

describe('editBouquetLines (postgres mode)', () => {
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

describe('list + getById (postgres mode)', () => {
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
