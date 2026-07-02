// pglite integration tests for deep-join chain EXECUTION (Explorer v2 Wave 2,
// ADR-0011). A `chain` walks an ordered edge path and flattens every hop into one
// denormalized row (Drizzle nests joined tables by table name). Cross-type joins
// (stock.id uuid ↔ order_lines.stock_item_id text) must not abort, and a "many"
// hop sets a fan-out flag so the UI can warn.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { orders, orderLines, stock, customers, keyPeople } from '../db/schema.js';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import { queryRecordsHandler } from '../services/assistantTools/dataQueryPack.js';

let harness;
let ctx;

// Seed the flagship path: customer → key person, customer → order → line → stock.
async function seedPath() {
  const [cust] = await harness.db.insert(customers)
    .values({ name: 'Anna K', phone: '+48111222333', segment: 'VIP' })
    .returning({ id: customers.id });
  await harness.db.insert(keyPeople).values({ customerId: cust.id, name: 'Mom', importantDate: '2026-08-01' });
  const [stk] = await harness.db.insert(stock)
    .values({ displayName: 'Peony White', currentQuantity: 40, typeName: 'Peony' })
    .returning({ id: stock.id });
  const [ord] = await harness.db.insert(orders)
    .values({ appOrderId: 'CHAIN-1', customerId: cust.id, orderDate: '2026-06-10', requiredBy: '2026-06-11', deliveryType: 'Delivery', status: 'Delivered', paymentStatus: 'Paid' })
    .returning({ id: orders.id });
  await harness.db.insert(orderLines).values({ orderId: ord.id, stockItemId: stk.id, flowerName: 'Peony White', quantity: 5 });
  return { custId: cust.id, stockId: stk.id, orderId: ord.id };
}

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  ctx = await seedPath();
});
afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

describe('dataQueryPack — deep-join chain execution', () => {
  it('flattens the flagship 4-hop path (stock → line → order → customer → key person)', async () => {
    const r = await queryRecordsHandler({ entity: 'stock', chain: ['lines', 'order', 'customer', 'keyPeople'] });
    expect(r.error).toBeUndefined();
    expect(r.rows.length).toBe(1);
    const row = r.rows[0];
    // Each hop nested under its table name.
    expect(row['stock']?.displayName).toBe('Peony White');
    expect(row['order_lines']?.flowerName).toBe('Peony White');
    expect(row['orders']?.appOrderId).toBe('CHAIN-1');
    expect(row['customers']?.name).toBe('Anna K');
    expect(row['key_people']?.name).toBe('Mom');
  });

  it('flattens a 2-hop chain along existing edges (orders → customer → key person)', async () => {
    const r = await queryRecordsHandler({ entity: 'orders', chain: ['customer', 'keyPeople'] });
    expect(r.error).toBeUndefined();
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]['customers']?.name).toBe('Anna K');
    expect(r.rows[0]['key_people']?.name).toBe('Mom');
  });

  it('flags fan-out when the chain contains a "many" hop, not when all hops are "one"', async () => {
    const many = await queryRecordsHandler({ entity: 'orders', chain: ['lines'] });   // orders→order_lines is many
    expect(many.fanOut).toBe(true);
    const one = await queryRecordsHandler({ entity: 'orders', chain: ['customer'] }); // orders→customers is one
    expect(one.fanOut).toBe(false);
  });

  it('applies a filter that resolves against a downstream chain entity', async () => {
    const hit = await queryRecordsHandler({ entity: 'orders', chain: ['customer'], filters: [{ field: 'segment', op: 'eq', value: 'VIP' }] });
    expect(hit.rows.length).toBe(1);
    const miss = await queryRecordsHandler({ entity: 'orders', chain: ['customer'], filters: [{ field: 'segment', op: 'eq', value: 'Regular' }] });
    expect(miss.rows.length).toBe(0);
  });

  it('returns matchedCount + truncated like a plain query', async () => {
    const r = await queryRecordsHandler({ entity: 'orders', chain: ['customer'] });
    expect(r.matchedCount).toBe(1);
    expect(r.truncated).toBe(false);
  });

  it("runs the owner's Peony case: chain + qualified sort/columns execute end-to-end", async () => {
    const r = await queryRecordsHandler({
      entity: 'order_lines',
      chain: ['order', 'customer'],
      columns: ['order_lines.flowerName', 'orders.orderDate', 'customers.name'],
      sort: [{ field: 'orders.orderDate', dir: 'desc' }], // qualified sort — used to fail
      filters: [{ field: 'order_lines.flowerName', op: 'like', value: 'Peony' }], // qualified filter
    });
    expect(r.error).toBeUndefined();
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]['order_lines']?.flowerName).toBe('Peony White');
    expect(r.rows[0]['customers']?.name).toBe('Anna K');
  });

  it('returns { error } for an invalid chain (unknown edge) instead of throwing', async () => {
    const r = await queryRecordsHandler({ entity: 'orders', chain: ['bogus'] });
    expect(r.error).toBeTypeOf('string');
    expect(r.rows).toBeUndefined();
  });
});
