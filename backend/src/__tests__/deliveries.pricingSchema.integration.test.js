import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { orders, deliveries } from '../db/schema.js';

describe('deliveries pricing schema (migration 0025)', () => {
  let harness;
  let db;

  beforeAll(async () => { harness = await setupPgHarness(); db = harness.db; });
  afterAll(async () => { await teardownPgHarness(harness); });

  it('a new delivery row defaults driver_payment_status to Unpaid and accepts the new columns', async () => {
    const [order] = await db.insert(orders).values({
      appOrderId: 'TEST-1', customerId: '11111111-1111-4111-8111-111111111111',
      status: 'New', deliveryType: 'Delivery',
      orderDate: new Date().toISOString().slice(0, 10),
    }).returning();

    const [delivery] = await db.insert(deliveries).values({
      orderId: order.id,
      deliveryAddress: 'ul. Testowa 1',
      distanceKm: '4.20',
      distanceBand: { upToKm: 5, price: 35 },
      taxiCost: '10.00',
      deliveryResult: 'Success',
    }).returning();

    expect(delivery.driverPaymentStatus).toBe('Unpaid');
    expect(Number(delivery.distanceKm)).toBe(4.2);
    expect(delivery.distanceBand).toEqual({ upToKm: 5, price: 35 });
    expect(Number(delivery.taxiCost)).toBe(10);
    expect(delivery.deliveryResult).toBe('Success');
  });
});
