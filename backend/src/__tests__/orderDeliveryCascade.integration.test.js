// orderDeliveryCascade integration tests — lock the order↔delivery cascade
// rules documented in root CLAUDE.md "Cascade Rules", against a REAL
// Postgres (in-process via pglite), same pattern as orderRepo.integration.test.js.
//
// This file targets scenarios NOT already exercised by orderRepo.integration.test.js:
//   • PATCH order 'Delivery Time' → linked delivery's Delivery Time updates
//     (orderRepo.integration.test.js only covers 'Required By' → 'Delivery Date').
//   • Order status → Cancelled cascades to delivery Cancelled via transitionStatus
//     directly (existing coverage of Cancelled only goes through
//     cancelWithStockReturn, a different code path).
//   • Delivery status → order status cascade for Out for Delivery AND Cancelled
//     via updateDelivery (existing coverage only exercises Delivered, incidentally,
//     inside the Y-model demand-settlement describe block).
//   • Pickup → Delivery conversion (convertToDelivery) creates a linked, Pending
//     delivery record and flips the order's Delivery Type — untested anywhere.
//
// Scenarios ALREADY locked elsewhere and intentionally NOT duplicated here:
//   • Required By → linked delivery date cascade (legacy + Y-model DE date):
//     orderRepo.integration.test.js "updateOrder Required By cascade (STOCK_Y_MODEL)".
//   • Order status → delivery cascade for Out for Delivery / Delivered:
//     orderRepo.integration.test.js "transitionStatus" describe block.
//   • Delivery → Pickup conversion cancels the linked delivery (#317/#401):
//     orderRepo.integration.test.js "updateOrder Delivery→Pickup cancel cascade (#317)".

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, orders, deliveries, auditLog } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
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
  getStockYModelEnabled: () => false,
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
let stockId1;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();

  const [s1] = await harness.db.insert(stock).values({
    airtableId: 'recStockCascade1', displayName: 'Red Rose', currentQuantity: 100,
    currentCostPrice: '4.50', currentSellPrice: '15.00', active: true,
  }).returning();
  stockId1 = s1.id;
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

let orderIdCounter = 0;
const config = {
  getConfig: (k) => ({ defaultDeliveryFee: 25, driverCostPerDelivery: 10 }[k] ?? 0),
  getDriverOfDay: () => 'Timur',
  generateOrderId: async () => `BLO-CASCADE-TEST-${++orderIdCounter}`,
};

async function seedDeliveryOrder(overrides = {}) {
  return await orderRepo.createOrder({
    customer: 'recCust1', customerRequest: 'Cascade test', deliveryType: 'Delivery',
    orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 3 }],
    delivery: { address: 'ul. Floriańska 1', date: '2026-05-01', time: 'morning', driver: 'Timur', fee: 25 },
    paymentStatus: 'Paid', paymentMethod: 'Cash', createdBy: 'florist',
    ...overrides,
  }, config, { actor: { actorRole: 'florist' } });
}

async function seedPickupOrder(overrides = {}) {
  return await orderRepo.createOrder({
    customer: 'recCust1', customerRequest: 'Pickup order', deliveryType: 'Pickup',
    orderLines: [{ stockItemId: stockId1, flowerName: 'Red Rose', quantity: 2 }],
    paymentStatus: 'Unpaid', createdBy: 'florist',
    ...overrides,
  }, config, { actor: { actorRole: 'florist' } });
}

// ─────────────────────────────────────────────────────────────────────
// 1. PATCH order 'Delivery Time' → linked delivery time updates
// ─────────────────────────────────────────────────────────────────────

describe('updateOrder Delivery Time cascade', () => {
  it('cascades Delivery Time onto the linked delivery record in the same transaction', async () => {
    const { order, delivery } = await seedDeliveryOrder();
    expect(delivery['Delivery Time']).toBe('morning');

    await orderRepo.updateOrder(order.id, { 'Delivery Time': 'evening' }, { actor: { actorRole: 'florist' } });

    const [d] = await harness.db.select().from(deliveries).where(eq(deliveries.id, delivery._pgId));
    expect(d.deliveryTime).toBe('evening');

    // Order-level echo also updated.
    const fresh = await orderRepo.getById(order.id);
    expect(fresh['Delivery Time']).toBe('evening');
  });

  it('cascades Required By AND Delivery Time together in one PATCH', async () => {
    const { order, delivery } = await seedDeliveryOrder();

    await orderRepo.updateOrder(order.id, {
      'Required By': '2026-05-10',
      'Delivery Time': 'afternoon',
    }, { actor: { actorRole: 'florist' } });

    const [d] = await harness.db.select().from(deliveries).where(eq(deliveries.id, delivery._pgId));
    expect(d.deliveryDate).toBe('2026-05-10');
    expect(d.deliveryTime).toBe('afternoon');
  });

  it('does NOT touch delivery time when patching an unrelated field', async () => {
    const { order, delivery } = await seedDeliveryOrder();

    await orderRepo.updateOrder(order.id, { 'Florist Note': 'Extra ribbon' }, { actor: { actorRole: 'florist' } });

    const [d] = await harness.db.select().from(deliveries).where(eq(deliveries.id, delivery._pgId));
    expect(d.deliveryTime).toBe('morning'); // unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Order status → Cancelled cascades to delivery Cancelled
//    (via transitionStatus directly — NOT cancelWithStockReturn)
// ─────────────────────────────────────────────────────────────────────

describe('transitionStatus — order Cancelled cascades to delivery Cancelled', () => {
  it('cascades New → Cancelled to a Pending delivery', async () => {
    const { order, delivery } = await seedDeliveryOrder();

    const updated = await orderRepo.transitionStatus(order.id, ORDER_STATUS.CANCELLED, {}, { actor: { actorRole: 'owner' } });
    expect(updated.Status).toBe(ORDER_STATUS.CANCELLED);

    const [d] = await harness.db.select().from(deliveries).where(eq(deliveries.id, delivery._pgId));
    expect(d.status).toBe(DELIVERY_STATUS.CANCELLED);
  });

  it('cascades Out for Delivery → Cancelled to the delivery record', async () => {
    const { order, delivery } = await seedDeliveryOrder();
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.OUT_FOR_DELIVERY);

    await orderRepo.transitionStatus(order.id, ORDER_STATUS.CANCELLED, {}, { actor: { actorRole: 'owner' } });

    const [d] = await harness.db.select().from(deliveries).where(eq(deliveries.id, delivery._pgId));
    expect(d.status).toBe(DELIVERY_STATUS.CANCELLED);
  });

  it('reopening Cancelled → New pulls the delivery back to Pending', async () => {
    const { order, delivery } = await seedDeliveryOrder();
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.CANCELLED, {}, { actor: { actorRole: 'owner' } });

    const reopened = await orderRepo.transitionStatus(order.id, ORDER_STATUS.NEW, {}, { actor: { actorRole: 'owner' } });
    expect(reopened.Status).toBe(ORDER_STATUS.NEW);

    const [d] = await harness.db.select().from(deliveries).where(eq(deliveries.id, delivery._pgId));
    expect(d.status).toBe(DELIVERY_STATUS.PENDING);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Delivery status → order status cascade (updateDelivery)
//    Out for Delivery + Cancelled — Delivered is already covered by the
//    Y-model demand-settlement suite in orderRepo.integration.test.js.
// ─────────────────────────────────────────────────────────────────────

describe('updateDelivery — delivery status cascades to order status', () => {
  it('cascades delivery Out for Delivery → order Out for Delivery', async () => {
    const { order, delivery } = await seedDeliveryOrder();
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);

    const { delivery: updated, linkedOrderId } = await orderRepo.updateDelivery(
      delivery._pgId, { Status: DELIVERY_STATUS.OUT_FOR_DELIVERY }, { actor: { actorRole: 'driver' } },
    );
    expect(updated.Status).toBe(DELIVERY_STATUS.OUT_FOR_DELIVERY);
    expect(linkedOrderId).toBeTruthy();

    const [o] = await harness.db.select().from(orders).where(eq(orders.id, order._pgId));
    expect(o.status).toBe(ORDER_STATUS.OUT_FOR_DELIVERY);
  });

  it('cascades delivery Cancelled → order Cancelled', async () => {
    const { order, delivery } = await seedDeliveryOrder();

    await orderRepo.updateDelivery(
      delivery._pgId, { Status: DELIVERY_STATUS.CANCELLED }, { actor: { actorRole: 'owner' } },
    );

    const [o] = await harness.db.select().from(orders).where(eq(orders.id, order._pgId));
    expect(o.status).toBe(ORDER_STATUS.CANCELLED);
  });

  it('is a no-op on the order when the delivery is already at the cascaded status', async () => {
    const { order, delivery } = await seedDeliveryOrder();
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);
    await orderRepo.transitionStatus(order.id, ORDER_STATUS.OUT_FOR_DELIVERY);

    const auditsBefore = await harness.db.select().from(auditLog)
      .where(and(eq(auditLog.entityType, 'order'), eq(auditLog.entityId, order._pgId)));

    // Delivery is already Out for Delivery via the order→delivery cascade above.
    // PATCHing the delivery to the SAME status must not re-fire the order cascade.
    await orderRepo.updateDelivery(
      delivery._pgId, { Status: DELIVERY_STATUS.OUT_FOR_DELIVERY, 'Driver Notes': 'left at door' },
      { actor: { actorRole: 'driver' } },
    );

    const auditsAfter = await harness.db.select().from(auditLog)
      .where(and(eq(auditLog.entityType, 'order'), eq(auditLog.entityId, order._pgId)));
    expect(auditsAfter.length).toBe(auditsBefore.length); // no extra order audit row
  });

  it('does NOT cascade on unrelated delivery field changes (e.g. Driver Notes)', async () => {
    const { order, delivery } = await seedDeliveryOrder();

    await orderRepo.updateDelivery(
      delivery._pgId, { 'Driver Notes': 'Ring the bell twice' }, { actor: { actorRole: 'driver' } },
    );

    const [o] = await harness.db.select().from(orders).where(eq(orders.id, order._pgId));
    expect(o.status).toBe(ORDER_STATUS.NEW); // unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Pickup → Delivery conversion (convertToDelivery)
// ─────────────────────────────────────────────────────────────────────

describe('convertToDelivery — Pickup → Delivery conversion', () => {
  it('creates a Pending delivery record linked to the order and flips Delivery Type', async () => {
    const { order } = await seedPickupOrder();

    const before = await orderRepo.getById(order.id);
    expect(before['Delivery Type']).toBe('Pickup');
    expect(before._delivery).toBeFalsy();

    const delivery = await orderRepo.convertToDelivery(order.id, {
      'Delivery Address': 'ul. Nowa 5',
      'Recipient Name': 'Anna',
      'Recipient Phone': '+48 600 111 222',
      'Delivery Date': '2026-06-01',
      'Delivery Time': 'morning',
      'Assigned Driver': 'Timur',
      'Delivery Fee': 25,
      Status: DELIVERY_STATUS.PENDING,
    }, { actor: { actorRole: 'florist' } });

    expect(delivery['Delivery Address']).toBe('ul. Nowa 5');
    expect(delivery['Linked Order']).toEqual([order.id]);

    const [d] = await harness.db.select().from(deliveries)
      .where(and(eq(deliveries.orderId, order._pgId), isNull(deliveries.deletedAt)));
    expect(d).toBeTruthy();
    expect(d.status).toBe(DELIVERY_STATUS.PENDING);
    expect(d.deliveryAddress).toBe('ul. Nowa 5');

    // Order flips to Delivery type + carries the fee.
    const [o] = await harness.db.select().from(orders).where(eq(orders.id, order._pgId));
    expect(o.deliveryType).toBe('Delivery');
    expect(Number(o.deliveryFee)).toBe(25);

    const fresh = await orderRepo.getById(order.id);
    expect(fresh['Delivery Type']).toBe('Delivery');
    expect(fresh._delivery).toBeTruthy();
    expect(fresh._delivery['Status']).toBe(DELIVERY_STATUS.PENDING);
  });

  it('refuses to convert when a (non-deleted) delivery record already exists', async () => {
    const { order } = await seedDeliveryOrder(); // already Delivery type w/ a delivery record

    await expect(
      orderRepo.convertToDelivery(order.id, {
        'Delivery Address': 'ul. Druga 2', Status: DELIVERY_STATUS.PENDING,
      }, { actor: { actorRole: 'florist' } }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 404 for a non-existent order', async () => {
    await expect(
      orderRepo.convertToDelivery('rec-does-not-exist', { 'Delivery Address': 'X' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
