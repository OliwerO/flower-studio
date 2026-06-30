// backend/src/__tests__/assistantTools.dataQueryPack.integration.test.js
//
// pglite integration tests for dataQueryPack:
//   - validateSpec: rejects unknown field / unknown operator / malformed elements
//   - queryRecordsHandler: filter + aggregate parity, default Cancelled-exclude, ROW_CAP/truncated
//   - ordersNeedingShortStockHandler: only short-stock orders returned
//   - Cross-type join safety: recXXX stockItemId + customers↔orders uuid/text pair
//   - Aggregate/groupBy: truncated always false

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

  it('returns ok:false for a null filter element instead of throwing', () => {
    const r = validateSpec({ entity: 'orders', filters: [null] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/filter/i);
  });

  it('returns ok:false for a null sort element instead of throwing', () => {
    const r = validateSpec({ entity: 'orders', sort: [null] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sort/i);
  });

  it('returns ok:false for a null aggregate element instead of throwing', () => {
    const r = validateSpec({ entity: 'orders', aggregate: [null] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/aggregate/i);
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

  it('clamps limit 0 to the default cap — still returns rows', async () => {
    const r = await queryRecordsHandler({ entity: 'orders', limit: 0 });
    expect(r.error).toBeUndefined();
    // 2 non-cancelled rows, limit 0 → clamped to 1 (max(1, 0||cap) = cap); rows returned
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('clamps negative limit to the default cap — still returns rows', async () => {
    const r = await queryRecordsHandler({ entity: 'orders', limit: -5 });
    expect(r.error).toBeUndefined();
    expect(r.rows.length).toBeGreaterThan(0);
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

  it('count(*) aggregate returns correct total and truncated:false', async () => {
    const r = await queryRecordsHandler({
      entity: 'orders',
      aggregate: [{ fn: 'count', as: 'total' }],
    });
    expect(r.error).toBeUndefined();
    // 3 non-cancelled rows
    expect(Number(r.rows[0].total)).toBe(3);
    // Aggregate path must never set truncated:true (ungrouped count != grouped rows)
    expect(r.truncated).toBe(false);
    // matchedCount is intentionally absent for aggregate queries
    expect(r.matchedCount).toBeUndefined();
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

  it('groupBy sets truncated:false even when ungrouped count > row count', async () => {
    // 3 orders → 2 groups (Paid / Unpaid); without this fix, truncated would be true (3 > 2)
    const r = await queryRecordsHandler({
      entity: 'orders',
      groupBy: ['paymentStatus'],
      aggregate: [{ fn: 'count', as: 'cnt' }],
    });
    expect(r.error).toBeUndefined();
    expect(r.truncated).toBe(false);
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

// ── Cross-type join safety: legacy 'recXXX' stockItemId ────────────────────────
//
// In real Postgres, `'recABC123'::uuid` throws and aborts the whole query.
// With the fix (stock.id::text = orderLines.stockItemId), the cast goes uuid→text
// which never throws — recXXX lines simply produce no match.
// pglite is lenient about invalid uuid casts, so these tests assert the query
// succeeds and returns a normal result object (no error key) rather than observing
// a cast exception.

describe('dataQueryPack — cross-type join safety (recXXX stockItemId)', () => {
  let realStockId;
  let orderRow;

  beforeEach(async () => {
    const [s] = await harness.db
      .insert(stock)
      .values({ displayName: 'Peony White', currentQuantity: 10, active: true })
      .returning({ id: stock.id });
    realStockId = s.id;

    const [o] = await harness.db
      .insert(orders)
      .values({
        appOrderId: 'REC-ORDER-1',
        customerId: 'cust-1',
        orderDate: '2026-06-10',
        requiredBy: '2026-06-11',
        deliveryType: 'Delivery',
        status: 'New',
        paymentStatus: 'Unpaid',
      })
      .returning({ id: orders.id });
    orderRow = o;

    // Line with legacy recXXX stockItemId — NOT a uuid
    await harness.db.insert(orderLines).values({
      orderId: orderRow.id,
      stockItemId: 'recABC123',
      flowerName: 'Legacy Flower',
      quantity: 1,
    });
    // Line with real UUID stockItemId
    await harness.db.insert(orderLines).values({
      orderId: orderRow.id,
      stockItemId: realStockId,
      flowerName: 'Peony White',
      quantity: 2,
    });
  });

  it('entity:orders join:lines — recXXX stockItemId appears as data (it is a column value, not the join key)', async () => {
    // orders→lines join uses orderId (uuid=uuid), so recXXX is just a column value.
    // Drizzle returns nested objects keyed by table name: { orders: {...}, order_lines: {...} }
    const r = await queryRecordsHandler({ entity: 'orders', join: ['lines'] });
    expect(r.error).toBeUndefined();
    expect(r).toHaveProperty('rows');
    // Both lines are returned — the join key is orderId, not stockItemId
    expect(r.rows.length).toBe(2);
    const stockItemIds = r.rows.map(row => row['order_lines']?.stockItemId);
    expect(stockItemIds).toContain('recABC123');
  });

  it('entity:order_lines join:stock — recXXX line does not blow up the query', async () => {
    // This join uses stock.id::text = orderLines.stockItemId
    // recABC123 simply won't match any stock.id — but no error
    const r = await queryRecordsHandler({ entity: 'order_lines', join: ['stock'] });
    expect(r.error).toBeUndefined();
    expect(r).toHaveProperty('rows');
    // Only the real-UUID line joins successfully
    expect(r.rows.length).toBe(1);
  });

  it('ordersNeedingShortStockHandler — recXXX line does not throw; order simply not short-stock', async () => {
    // Make the real stock item short
    await harness.db
      .insert(stock)
      .values({ displayName: 'Short Flower', currentQuantity: -2, active: true })
      .returning({ id: stock.id });

    // The order has a recXXX line — it can't join to stock, so won't appear in short list
    const r = await ordersNeedingShortStockHandler();
    expect(r.error).toBeUndefined();
    expect(r).toHaveProperty('orders');
    const ids = r.orders.map(o => o.appOrderId);
    expect(ids).not.toContain('REC-ORDER-1');
  });
});

// ── Cross-type join: customers (uuid) ↔ orders (text customerId) ───────────────

describe('dataQueryPack — cross-type join: customers ↔ orders', () => {
  it('entity:customers join:orders — returns rows without operator error; Cancelled orders excluded from join', async () => {
    // Seed a real customer (UUID id generated by DB)
    const [cust] = await harness.db
      .insert(customers)
      .values({ name: 'Test Customer', phone: '+48123456789', segment: 'Regular' })
      .returning({ id: customers.id });

    // Seed: one New order + one Cancelled order, both linked to the customer
    await harness.db.insert(orders).values([
      {
        appOrderId: 'CUST-NEW-1',
        customerId: cust.id,
        orderDate: '2026-06-10',
        requiredBy: '2026-06-11',
        deliveryType: 'Delivery',
        status: 'New',
        paymentStatus: 'Unpaid',
      },
      {
        appOrderId: 'CUST-CANC-1',
        customerId: cust.id,
        orderDate: '2026-06-10',
        requiredBy: '2026-06-11',
        deliveryType: 'Delivery',
        status: 'Cancelled',
        paymentStatus: 'Unpaid',
      },
    ]);

    // customers→orders join: customers.id (uuid)::text = orders.customerId (text)
    // Drizzle returns nested objects: { customers: {...}, orders: {...} }
    const r = await queryRecordsHandler({ entity: 'customers', join: ['orders'] });
    expect(r.error).toBeUndefined();
    expect(r).toHaveProperty('rows');
    // Cancelled order excluded from join — only 1 row (customer × New order)
    expect(r.rows.length).toBe(1);
    const appIds = r.rows.map(row => row['orders']?.appOrderId);
    expect(appIds).toContain('CUST-NEW-1');
    expect(appIds).not.toContain('CUST-CANC-1');
  });

  it('entity:orders join:customer — returns rows without operator error', async () => {
    const [cust] = await harness.db
      .insert(customers)
      .values({ name: 'Join Customer', phone: '+48987654321', segment: 'VIP' })
      .returning({ id: customers.id });

    await harness.db.insert(orders).values({
      appOrderId: 'ORDER-JOIN-1',
      customerId: cust.id,
      orderDate: '2026-06-10',
      requiredBy: '2026-06-11',
      deliveryType: 'Delivery',
      status: 'New',
      paymentStatus: 'Unpaid',
    });

    // orders→customer join: customers.id (uuid)::text = orders.customerId (text)
    const r = await queryRecordsHandler({ entity: 'orders', join: ['customer'] });
    expect(r.error).toBeUndefined();
    expect(r).toHaveProperty('rows');
    expect(r.rows.length).toBe(1);
  });
});

// ── Aggregate/groupBy: truncated always false ───────────────────────────────────

describe('dataQueryPack — truncated:false for aggregate and groupBy queries', () => {
  beforeEach(async () => {
    await harness.db.insert(orders).values([
      { appOrderId: 'TR-1', customerId: 'c1', orderDate: '2026-06-01', requiredBy: '2026-06-02', deliveryType: 'Delivery', status: 'New',       paymentStatus: 'Unpaid' },
      { appOrderId: 'TR-2', customerId: 'c1', orderDate: '2026-06-02', requiredBy: '2026-06-03', deliveryType: 'Pickup',   status: 'Picked Up', paymentStatus: 'Paid'   },
      { appOrderId: 'TR-3', customerId: 'c1', orderDate: '2026-06-03', requiredBy: '2026-06-04', deliveryType: 'Delivery', status: 'Delivered', paymentStatus: 'Paid'   },
    ]);
  });

  it('count(*) aggregate: truncated=false even though ungrouped count (3) could exceed 1 aggregate row', async () => {
    const r = await queryRecordsHandler({
      entity: 'orders',
      aggregate: [{ fn: 'count', as: 'total' }],
    });
    expect(r.error).toBeUndefined();
    expect(r.truncated).toBe(false);
    expect(Number(r.rows[0].total)).toBe(3);
  });

  it('groupBy paymentStatus (3 orders → 2 groups): truncated=false, not misleadingly true', async () => {
    // Before fix: matchedCount=3 (ungrouped), rows.length=2 (groups) → truncated=true (wrong)
    // After fix: truncated=false for any groupBy path
    const r = await queryRecordsHandler({
      entity: 'orders',
      groupBy: ['paymentStatus'],
      aggregate: [{ fn: 'count', as: 'cnt' }],
    });
    expect(r.error).toBeUndefined();
    expect(r.truncated).toBe(false);
    expect(r.rows.length).toBe(2); // Paid + Unpaid
  });

  it('plain select (no agg/groupBy) still correctly sets truncated=true when limit < matchedCount', async () => {
    const r = await queryRecordsHandler({ entity: 'orders', limit: 1 });
    expect(r.error).toBeUndefined();
    expect(r.matchedCount).toBe(3);
    expect(r.rows.length).toBe(1);
    expect(r.truncated).toBe(true);
  });
});
