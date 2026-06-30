// backend/src/__tests__/assistantTools.dataQueryPack.integration.test.js
//
// pglite integration tests for dataQueryPack:
//   - validateSpec: rejects unknown field / unknown operator
//   - queryRecordsHandler: filter + aggregate parity, default Cancelled-exclude, ROW_CAP/truncated
//   - ordersNeedingShortStockHandler: only short-stock orders returned

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { orders, orderLines, stock, customers } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

// Import after the mock is set up
import { validateSpec, queryRecordsHandler, ordersNeedingShortStockHandler } from '../services/assistantTools/dataQueryPack.js';

let harness;
beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

// ── validateSpec ────────────────────────────────────────────────────────────────

describe('dataQueryPack.validateSpec', () => {
  it('accepts a valid simple spec', () => {
    const r = validateSpec({ entity: 'orders', filters: [{ field: 'status', op: 'eq', value: 'New' }] });
    expect(r.ok).toBe(true);
  });

  it('rejects an unknown entity', () => {
    const r = validateSpec({ entity: 'invoices' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown entity/);
  });

  it('rejects an unknown field in filters', () => {
    const r = validateSpec({ entity: 'orders', filters: [{ field: 'notAField', op: 'eq', value: 'x' }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown field "notAField"/);
  });

  it('rejects an unknown operator', () => {
    const r = validateSpec({ entity: 'orders', filters: [{ field: 'status', op: 'contains', value: 'New' }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown operator "contains"/);
  });

  it('rejects an unknown join', () => {
    const r = validateSpec({ entity: 'orders', join: ['invoices'] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown join "invoices"/);
  });

  it('rejects an unknown aggregate fn', () => {
    const r = validateSpec({ entity: 'orders', aggregate: [{ fn: 'median', field: 'price', as: 'med' }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown aggregate function "median"/);
  });

  it('rejects aggregate missing as alias', () => {
    const r = validateSpec({ entity: 'orders', aggregate: [{ fn: 'count' }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/alias/);
  });
});

// ── queryRecordsHandler ─────────────────────────────────────────────────────────

describe('dataQueryPack.queryRecordsHandler — basic filter', () => {
  beforeEach(async () => {
    await harness.db.insert(orders).values([
      { appOrderId: 'BLO-1', customerId: 'cust-1', orderDate: '2026-06-01', requiredBy: '2026-06-02', deliveryType: 'Delivery', status: 'New',       paymentStatus: 'Unpaid' },
      { appOrderId: 'BLO-2', customerId: 'cust-1', orderDate: '2026-06-03', requiredBy: '2026-06-04', deliveryType: 'Pickup',   status: 'Picked Up', paymentStatus: 'Paid'   },
      { appOrderId: 'BLO-3', customerId: 'cust-1', orderDate: '2026-06-05', requiredBy: '2026-06-06', deliveryType: 'Delivery', status: 'Cancelled', paymentStatus: 'Unpaid' },
    ]);
  });

  it('returns all non-cancelled orders by default', async () => {
    const r = await queryRecordsHandler({ entity: 'orders' });
    expect(r.error).toBeUndefined();
    expect(r.matchedCount).toBe(2); // BLO-1, BLO-2 (BLO-3 Cancelled excluded)
    expect(r.truncated).toBe(false);
  });

  it('includes Cancelled when includeCancelled=true', async () => {
    const r = await queryRecordsHandler({ entity: 'orders', includeCancelled: true });
    expect(r.error).toBeUndefined();
    expect(r.matchedCount).toBe(3);
  });

  it('filters by status eq', async () => {
    const r = await queryRecordsHandler({
      entity: 'orders',
      filters: [{ field: 'status', op: 'eq', value: 'New' }],
      includeCancelled: true,
    });
    expect(r.error).toBeUndefined();
    expect(r.matchedCount).toBe(1);
    expect(r.rows[0].appOrderId ?? r.rows[0].app_order_id).toBe('BLO-1');
  });

  it('filters by orderDate range', async () => {
    const r = await queryRecordsHandler({
      entity: 'orders',
      filters: [
        { field: 'orderDate', op: 'gte', value: '2026-06-01' },
        { field: 'orderDate', op: 'lte', value: '2026-06-03' },
      ],
    });
    expect(r.error).toBeUndefined();
    // BLO-1 (Jun 1) + BLO-2 (Jun 3), BLO-3 is Cancelled so excluded
    expect(r.matchedCount).toBe(2);
  });

  it('returns an error for an invalid spec (never throws)', async () => {
    const r = await queryRecordsHandler({ entity: 'orders', filters: [{ field: 'bogus', op: 'eq', value: 'x' }] });
    expect(r.error).toBeDefined();
    expect(typeof r.error).toBe('string');
  });
});

describe('dataQueryPack.queryRecordsHandler — aggregate', () => {
  beforeEach(async () => {
    await harness.db.insert(orders).values([
      { appOrderId: 'A-1', customerId: 'cust-1', orderDate: '2026-06-01', requiredBy: '2026-06-02', deliveryType: 'Delivery', status: 'New',       paymentStatus: 'Unpaid', priceOverride: '100.00' },
      { appOrderId: 'A-2', customerId: 'cust-1', orderDate: '2026-06-02', requiredBy: '2026-06-03', deliveryType: 'Pickup',   status: 'Picked Up', paymentStatus: 'Paid',   priceOverride: '150.00' },
      { appOrderId: 'A-3', customerId: 'cust-1', orderDate: '2026-06-03', requiredBy: '2026-06-04', deliveryType: 'Delivery', status: 'Delivered', paymentStatus: 'Paid',   priceOverride: '200.00' },
    ]);
  });

  it('count(*) aggregate matches matchedCount', async () => {
    const r = await queryRecordsHandler({
      entity: 'orders',
      aggregate: [{ fn: 'count', as: 'total' }],
    });
    expect(r.error).toBeUndefined();
    // 3 non-cancelled rows
    expect(r.matchedCount).toBe(3);
    expect(Number(r.rows[0].total)).toBe(3);
  });

  it('groupBy paymentStatus returns correct counts', async () => {
    const r = await queryRecordsHandler({
      entity: 'orders',
      groupBy: ['paymentStatus'],
      aggregate: [{ fn: 'count', as: 'cnt' }],
      sort: [{ field: 'paymentStatus', dir: 'asc' }],
    });
    expect(r.error).toBeUndefined();
    // Paid=2 (A-2 Picked Up, A-3 Delivered), Unpaid=1 (A-1 New)
    const paid   = r.rows.find(row => (row.paymentStatus ?? row.payment_status) === 'Paid');
    const unpaid = r.rows.find(row => (row.paymentStatus ?? row.payment_status) === 'Unpaid');
    expect(Number(paid?.cnt)).toBe(2);
    expect(Number(unpaid?.cnt)).toBe(1);
  });
});

describe('dataQueryPack.queryRecordsHandler — ROW_CAP truncation', () => {
  beforeEach(async () => {
    // Insert 5 orders but request limit=3
    const rows = Array.from({ length: 5 }, (_, i) => ({
      appOrderId: `CAP-${i}`,
      customerId: 'cust-1',
      orderDate: '2026-06-10',
      requiredBy: '2026-06-11',
      deliveryType: 'Delivery',
      status: 'New',
      paymentStatus: 'Unpaid',
    }));
    await harness.db.insert(orders).values(rows);
  });

  it('respects limit and sets truncated=true when matchedCount > limit', async () => {
    const r = await queryRecordsHandler({ entity: 'orders', limit: 3 });
    expect(r.error).toBeUndefined();
    expect(r.matchedCount).toBe(5);
    expect(r.rows.length).toBe(3);
    expect(r.truncated).toBe(true);
  });
});

// ── ordersNeedingShortStockHandler ─────────────────────────────────────────────

describe('dataQueryPack.ordersNeedingShortStockHandler', () => {
  let shortStockId;
  let plentifulStockId;

  beforeEach(async () => {
    // Create two stock items: one short, one plentiful
    const [shortRow] = await harness.db
      .insert(stock)
      .values({ displayName: 'Rose Red', currentQuantity: -5, active: true })
      .returning({ id: stock.id });
    shortStockId = shortRow.id;

    const [plentifulRow] = await harness.db
      .insert(stock)
      .values({ displayName: 'Tulip Yellow', currentQuantity: 10, active: true })
      .returning({ id: stock.id });
    plentifulStockId = plentifulRow.id;

    // Order 1: uses short stock — should appear in result
    const [order1] = await harness.db
      .insert(orders)
      .values({
        appOrderId: 'SHORT-1',
        customerId: 'cust-1',
        orderDate: '2026-06-10',
        requiredBy: '2026-06-11',
        deliveryType: 'Delivery',
        status: 'New',
        paymentStatus: 'Unpaid',
      })
      .returning({ id: orders.id });

    await harness.db.insert(orderLines).values({
      orderId:    order1.id,
      stockItemId: shortStockId,
      flowerName: 'Rose Red',
      quantity:   3,
    });

    // Order 2: uses plentiful stock — should NOT appear
    const [order2] = await harness.db
      .insert(orders)
      .values({
        appOrderId: 'PLENTIFUL-1',
        customerId: 'cust-1',
        orderDate: '2026-06-10',
        requiredBy: '2026-06-11',
        deliveryType: 'Pickup',
        status: 'Ready',
        paymentStatus: 'Paid',
      })
      .returning({ id: orders.id });

    await harness.db.insert(orderLines).values({
      orderId:    order2.id,
      stockItemId: plentifulStockId,
      flowerName: 'Tulip Yellow',
      quantity:   2,
    });

    // Order 3: Cancelled order using short stock — should NOT appear (non-open)
    const [order3] = await harness.db
      .insert(orders)
      .values({
        appOrderId: 'CANCELLED-1',
        customerId: 'cust-1',
        orderDate: '2026-06-09',
        requiredBy: '2026-06-10',
        deliveryType: 'Delivery',
        status: 'Cancelled',
        paymentStatus: 'Unpaid',
      })
      .returning({ id: orders.id });

    await harness.db.insert(orderLines).values({
      orderId:    order3.id,
      stockItemId: shortStockId,
      flowerName: 'Rose Red',
      quantity:   1,
    });
  });

  it('returns only open orders using short-stock flowers', async () => {
    const r = await ordersNeedingShortStockHandler();
    expect(r.error).toBeUndefined();
    expect(r.count).toBe(1);
    const o = r.orders[0];
    expect(o.appOrderId).toBe('SHORT-1');
    expect(o.shortFlowers).toContain('Rose Red');
  });

  it('excludes the plentiful-stock order', async () => {
    const r = await ordersNeedingShortStockHandler();
    const ids = r.orders.map(o => o.appOrderId);
    expect(ids).not.toContain('PLENTIFUL-1');
  });

  it('excludes the Cancelled order', async () => {
    const r = await ordersNeedingShortStockHandler();
    const ids = r.orders.map(o => o.appOrderId);
    expect(ids).not.toContain('CANCELLED-1');
  });
});
