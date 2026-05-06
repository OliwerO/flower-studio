// pgHarness smoke test — proves the in-process Postgres + Drizzle stack
// boots and that the migrations apply cleanly. Without this passing, none
// of the integration tests on top of the harness would tell us anything
// useful (silent migration failure → empty schema → tests trivially pass).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './pgHarness.js';
import { stock, auditLog, parityLog, systemMeta, orders, orderLines, deliveries } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); });
afterEach(async () => { await teardownPgHarness(harness); });

describe('pglite harness', () => {
  it('boots and reports a Postgres version', async () => {
    const result = await harness.pg.query('SELECT version() AS v');
    expect(result.rows[0].v).toMatch(/PostgreSQL/);
  });

  it('applied all seven tables from the migration set', async () => {
    const { rows } = await harness.pg.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `);
    const tables = rows.map(r => r.tablename);
    expect(tables).toEqual(expect.arrayContaining([
      'system_meta', 'audit_log', 'stock', 'parity_log',
      'orders', 'order_lines', 'deliveries',
    ]));
  });

  it('lets Drizzle round-trip an insert + select on system_meta', async () => {
    await harness.db.insert(systemMeta).values({ key: 'test_key', value: 'hello' });
    const rows = await harness.db.select().from(systemMeta).where(eq(systemMeta.key, 'test_key'));
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('test_key');
  });

  it('lets Drizzle round-trip an insert + select on stock with all column types', async () => {
    const [row] = await harness.db.insert(stock).values({
      airtableId: 'recTest',
      displayName: 'Pink Rose',
      category: 'Roses',
      currentQuantity: 25,
      currentCostPrice: '4.50',
      currentSellPrice: '15.00',
      active: true,
      substituteFor: ['recOther1', 'recOther2'],
    }).returning();

    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);  // UUID
    expect(row.displayName).toBe('Pink Rose');
    expect(row.currentQuantity).toBe(25);
    expect(Number(row.currentCostPrice)).toBe(4.5);
    expect(row.substituteFor).toEqual(['recOther1', 'recOther2']);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('enforces the unique index on stock.airtable_id', async () => {
    await harness.db.insert(stock).values({ airtableId: 'recDup', displayName: 'X' });
    await expect(
      harness.db.insert(stock).values({ airtableId: 'recDup', displayName: 'Y' })
    ).rejects.toThrow(/duplicate|unique/i);
  });

  it('lets audit_log accept jsonb diffs of arbitrary depth', async () => {
    await harness.db.insert(auditLog).values({
      entityType: 'stock',
      entityId: 'recABC',
      action: 'update',
      diff: { before: { qty: 5, nested: { a: 1 } }, after: { qty: 7, nested: { a: 2 } } },
      actorRole: 'owner',
    });
    const rows = await harness.db.select().from(auditLog);
    expect(rows[0].diff.before.nested.a).toBe(1);
    expect(rows[0].diff.after.qty).toBe(7);
  });

  it('lets parity_log accept null airtableValue (missing_pg case)', async () => {
    await harness.db.insert(parityLog).values({
      entityType: 'stock',
      entityId: 'recX',
      kind: 'missing_pg',
      airtableValue: { 'Display Name': 'Lily' },
      postgresValue: null,
      context: { source: 'test' },
    });
    const rows = await harness.db.select().from(parityLog);
    expect(rows[0].kind).toBe('missing_pg');
    expect(rows[0].airtableValue['Display Name']).toBe('Lily');
    expect(rows[0].postgresValue).toBeNull();
  });

  // ── Phase 4 schema smoke tests ──

  it('orders + order_lines + deliveries round-trip with FKs', async () => {
    const [order] = await harness.db.insert(orders).values({
      appOrderId:   'BLO-TEST-1',
      customerId:   'recCust1',
      deliveryType: 'Delivery',
      requiredBy:   '2026-05-01',
      paymentStatus: 'Paid',
    }).returning();

    const [line] = await harness.db.insert(orderLines).values({
      orderId:     order.id,
      flowerName:  'Red Rose',
      quantity:    12,
      sellPricePerUnit: '15.00',
    }).returning();

    const [delivery] = await harness.db.insert(deliveries).values({
      orderId:        order.id,
      deliveryAddress: 'ul. Floriańska 1, Kraków',
      deliveryDate:   '2026-05-01',
      assignedDriver: 'Timur',
      status:         'Pending',
    }).returning();

    expect(line.orderId).toBe(order.id);
    expect(delivery.orderId).toBe(order.id);
    expect(line.quantity).toBe(12);
  });

  it('enforces unique app_order_id', async () => {
    await harness.db.insert(orders).values({
      appOrderId: 'BLO-DUP-1', customerId: 'recA', deliveryType: 'Pickup',
    });
    await expect(
      harness.db.insert(orders).values({
        appOrderId: 'BLO-DUP-1', customerId: 'recB', deliveryType: 'Delivery',
      })
    ).rejects.toThrow(/duplicate|unique/i);
  });

  it('enforces one-delivery-per-order via unique index on order_id', async () => {
    const [o] = await harness.db.insert(orders).values({
      appOrderId: 'BLO-1DEL-1', customerId: 'recA', deliveryType: 'Delivery',
    }).returning();
    await harness.db.insert(deliveries).values({ orderId: o.id, status: 'Pending' });
    await expect(
      harness.db.insert(deliveries).values({ orderId: o.id, status: 'Pending' })
    ).rejects.toThrow(/duplicate|unique/i);
  });

  it('cascades hard-delete from orders to lines + delivery', async () => {
    const [o] = await harness.db.insert(orders).values({
      appOrderId: 'BLO-CASC-1', customerId: 'recA', deliveryType: 'Delivery',
    }).returning();
    await harness.db.insert(orderLines).values({ orderId: o.id, flowerName: 'X', quantity: 1 });
    await harness.db.insert(orderLines).values({ orderId: o.id, flowerName: 'Y', quantity: 2 });
    await harness.db.insert(deliveries).values({ orderId: o.id, status: 'Pending' });

    await harness.db.delete(orders).where(eq(orders.id, o.id));

    const remainingLines = await harness.db.select().from(orderLines).where(eq(orderLines.orderId, o.id));
    const remainingDeliveries = await harness.db.select().from(deliveries).where(eq(deliveries.orderId, o.id));
    expect(remainingLines).toHaveLength(0);
    expect(remainingDeliveries).toHaveLength(0);
  });

  it('rejects an order_lines row referencing a missing order_id (FK enforcement)', async () => {
    await expect(
      harness.db.insert(orderLines).values({
        orderId: '00000000-0000-0000-0000-000000000000',
        flowerName: 'Phantom', quantity: 1,
      })
    ).rejects.toThrow(/foreign key|violates/i);
  });
});
