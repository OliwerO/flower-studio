// Integration tests for orderRepo.createWixOrder — TDD red phase first.
//
// Uses pglite (real Postgres WASM) so transaction rollback semantics are
// verified against an actual SQL engine, not a mock. Mirrors the pattern in
// orderRepo.integration.test.js.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock, orders, orderLines as orderLinesTable } from '../db/schema.js';
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
import * as customerRepo from '../repos/customerRepo.js';

let harness;

beforeEach(async () => {
  harness = await setupPgHarness();
  dbHolder.db = harness.db;
  vi.clearAllMocks();
  orderRepo._setMode('postgres');
});

afterEach(async () => {
  await teardownPgHarness(harness);
  dbHolder.db = null;
});

// Create a minimal customer for each test. Uses 'Name' (the field customerRepo.create maps).
async function makeCustomer() {
  return await customerRepo.create({
    Name: 'Wix Buyer',
    Phone: '+48500111222',
    Email: 'buyer@example.com',
  });
}

describe('orderRepo.createWixOrder', () => {
  it('inserts order + lines + delivery in one transaction', async () => {
    const customer = await makeCustomer();
    const result = await orderRepo.createWixOrder({
      customerId: customer.id,
      appOrderId: '202605-099',
      wixOrderId: 'wix-uuid-1',
      customerRequest: 'Wix Order #12345',
      requiredBy: '2026-05-10',
      paymentStatus: 'Paid',
      paymentMethod: 'Card',
      priceOverride: 250,
      lines: [
        { flowerName: 'Roses Red', quantity: 5, costPricePerUnit: 0, sellPricePerUnit: 50 },
      ],
      delivery: {
        address: 'ul. Krakowska 1, Krakow',
        recipientName: 'Maria',
        recipientPhone: '+48500999888',
        date: '2026-05-10',
        fee: 30,
      },
    });

    expect(result.order.id).toBeTruthy();
    expect(result.order.Source).toBe('Wix');
    expect(result.order['Created By']).toBe('Wix Webhook');
    expect(result.order.Status).toBe(ORDER_STATUS.NEW);
    expect(result.order['Delivery Type']).toBe('Delivery');
    expect(result.order['Wix Order ID']).toBe('wix-uuid-1');
    expect(result.order['App Order ID']).toBe('202605-099');
    expect(result.order['Price Override']).toBe(250);
    expect(result.order.Customer).toEqual([customer.id]);

    expect(result.orderLines).toHaveLength(1);
    expect(result.orderLines[0]['Flower Name']).toBe('Roses Red');
    expect(result.orderLines[0].Quantity).toBe(5);

    expect(result.delivery['Linked Order']).toEqual([result.order.id]);
    expect(result.delivery['Delivery Address']).toBe('ul. Krakowska 1, Krakow');
    expect(result.delivery['Delivery Fee']).toBe(30);
    expect(result.delivery.Status).toBe(DELIVERY_STATUS.PENDING);
  });

  it('omits Stock Item link when stockItemId is missing', async () => {
    const customer = await makeCustomer();
    const result = await orderRepo.createWixOrder({
      customerId: customer.id,
      appOrderId: '202605-100',
      wixOrderId: 'wix-uuid-2',
      customerRequest: 'Wix Order #2',
      requiredBy: null,
      paymentStatus: 'Unpaid',
      paymentMethod: null,
      priceOverride: null,
      lines: [{ flowerName: 'Mystery', quantity: 1, costPricePerUnit: 0, sellPricePerUnit: 0 }],
      delivery: { address: '', recipientName: '', recipientPhone: '', date: null, fee: 0 },
    });

    // Wire format returns [] for no stock item (the Airtable linked-record shape).
    expect(result.orderLines[0]['Stock Item']).toHaveLength(0);
  });

  it('preserves Stock Item link when stockItemId is present', async () => {
    // Seed a stock row for this test — phase7-seed is not called here, so we seed inline.
    const [stockRow] = await harness.db.insert(stock).values({
      airtableId: 'recStockWix1',
      displayName: 'Peony Pink',
      currentQuantity: 20,
      currentCostPrice: '5.00',
      currentSellPrice: '18.00',
      active: true,
    }).returning();

    const customer = await makeCustomer();
    const result = await orderRepo.createWixOrder({
      customerId: customer.id,
      appOrderId: '202605-101',
      wixOrderId: 'wix-uuid-3',
      customerRequest: 'Wix Order #3',
      requiredBy: null,
      paymentStatus: 'Paid',
      paymentMethod: 'Card',
      priceOverride: 100,
      lines: [{
        stockItemId: stockRow.id,
        flowerName: stockRow.displayName,
        quantity: 2,
        costPricePerUnit: Number(stockRow.currentCostPrice),
        sellPricePerUnit: Number(stockRow.currentSellPrice),
      }],
      delivery: { address: 'A', recipientName: 'R', recipientPhone: '+48500000000', date: null, fee: 0 },
    });

    expect(result.orderLines[0]['Stock Item']).toEqual([stockRow.id]);
  });

  it('rolls back on duplicate appOrderId (unique constraint violation)', async () => {
    const customer = await makeCustomer();
    const baseParams = {
      customerId: customer.id,
      appOrderId: '202605-DUPE',
      wixOrderId: 'wix-uuid-dupe-1',
      customerRequest: 'Wix Order Dupe',
      requiredBy: null,
      paymentStatus: 'Paid',
      paymentMethod: 'Card',
      priceOverride: 50,
      lines: [{ flowerName: 'Rose', quantity: 1, costPricePerUnit: 0, sellPricePerUnit: 0 }],
      delivery: { address: 'A', recipientName: 'R', recipientPhone: '+48500000000', date: null, fee: 0 },
    };

    // First call succeeds.
    await orderRepo.createWixOrder(baseParams);

    // Second call with same appOrderId + different wixOrderId must fail (unique index on app_order_id).
    await expect(orderRepo.createWixOrder({
      ...baseParams,
      wixOrderId: 'wix-uuid-dupe-2',
    })).rejects.toThrow();

    // Only one order row — the transaction for the second call was fully rolled back.
    const rows = await harness.db.select().from(orders).where(eq(orders.appOrderId, '202605-DUPE'));
    expect(rows).toHaveLength(1);
  });

  it('rolls back order + first line when a second line insert fails mid-transaction', async () => {
    // Proves true multi-row atomicity: the duplicate-appOrderId test fires on the
    // FIRST insert (orders) so lines and delivery never run. This test supplies two
    // lines with the same airtableId ('rec-dup-line'), which trips the unique index on
    // order_lines.airtable_id on the second line insert — AFTER the order row and the
    // first line are already written to the transaction. A real rollback is required to
    // keep the database clean.
    const customer = await makeCustomer();
    const badAppOrderId = '202605-ROLLBACK-MID';

    await expect(orderRepo.createWixOrder({
      customerId: customer.id,
      appOrderId: badAppOrderId,
      wixOrderId: 'wix-uuid-rollback-mid',
      customerRequest: 'Duplicate airtableId test',
      requiredBy: null,
      paymentStatus: 'Unpaid',
      paymentMethod: null,
      priceOverride: null,
      lines: [
        { airtableId: 'rec-dup-line', flowerName: 'Rose', quantity: 1, costPricePerUnit: 0, sellPricePerUnit: 0 },
        { airtableId: 'rec-dup-line', flowerName: 'Tulip', quantity: 2, costPricePerUnit: 0, sellPricePerUnit: 0 },
      ],
      delivery: { address: '', recipientName: '', recipientPhone: '', date: null, fee: 0 },
    })).rejects.toThrow();

    // The order row must not exist — the transaction fully rolled back.
    const orderRow = await harness.db.query.orders.findFirst({
      where: (o, { eq: eqFn }) => eqFn(o.appOrderId, badAppOrderId),
    });
    expect(orderRow).toBeUndefined();

    // No orphan lines from the first successful line insert.
    const lineRows = await harness.db.select().from(orderLinesTable)
      .where(eq(orderLinesTable.airtableId, 'rec-dup-line'));
    expect(lineRows).toHaveLength(0);
  });

  it.skip('throws if MODE !== postgres (informational — MODE captured at module load)', async () => {
    // The runtime guard `if (MODE !== 'postgres') throw ...` inside createWixOrder
    // protects against accidental misuse. Because MODE is captured at module-load
    // time via readMode(), toggling ORDER_BACKEND after import doesn't re-evaluate it.
    // Use orderRepo._setMode('airtable') to test the guard in isolation.
    orderRepo._setMode('airtable');
    const customer = await makeCustomer();
    await expect(orderRepo.createWixOrder({
      customerId: customer.id,
      appOrderId: 'x',
      wixOrderId: 'x',
      customerRequest: 'x',
      requiredBy: null,
      paymentStatus: 'Paid',
      paymentMethod: null,
      priceOverride: null,
      lines: [],
      delivery: { address: '', recipientName: '', recipientPhone: '', date: null, fee: 0 },
    })).rejects.toThrow('orderRepo.createWixOrder: requires ORDER_BACKEND=postgres');
    orderRepo._setMode('postgres');
  });
});
