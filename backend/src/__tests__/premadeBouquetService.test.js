// Tests for premadeBouquetService — create/return/match flows.
//
// These tests mock the Airtable layer (services/airtable.js) and the order
// service's createOrder so we can assert the business logic without touching
// the real Airtable base.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub TABLES so the service sees real string IDs for our new tables even
// when env vars aren't set in the test environment.
vi.mock('../config/airtable.js', () => ({
  default: {},
  TABLES: {
    PREMADE_BOUQUETS: 'tblPremadeBouquets',
    PREMADE_BOUQUET_LINES: 'tblPremadeBouquetLines',
    STOCK: 'tblStock',
    ORDERS: 'tblOrders',
    ORDER_LINES: 'tblOrderLines',
    DELIVERIES: 'tblDeliveries',
    CUSTOMERS: 'tblCustomers',
  },
}));

// ── Mock the database layer ──
vi.mock('../services/airtable.js', () => ({
  create: vi.fn(),
  update: vi.fn(),
  deleteRecord: vi.fn(),
  getById: vi.fn(),
  list: vi.fn(),
  atomicStockAdjust: vi.fn(),
}));

// ── Mock batchQuery (listByIds) ──
vi.mock('../utils/batchQuery.js', () => ({
  listByIds: vi.fn(),
}));

// ── Mock notifications ──
vi.mock('../services/notifications.js', () => ({
  broadcast: vi.fn(),
}));

// ── Mock orderService — we re-export autoMatchStock and createOrder from it ──
vi.mock('../services/orderService.js', () => ({
  autoMatchStock: vi.fn().mockResolvedValue(0),
  createOrder: vi.fn(),
}));

import * as db from '../services/airtable.js';
import { listByIds } from '../utils/batchQuery.js';
import { broadcast } from '../services/notifications.js';
import { createOrder } from '../services/orderService.js';
import {
  createPremadeBouquet,
  returnPremadeBouquetToStock,
  matchPremadeBouquetToOrder,
} from '../services/premadeBouquetService.js';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: deleteRecord returns a resolved promise so `.catch()` chains don't blow up.
  db.deleteRecord.mockResolvedValue({ deleted: true });
});

describe('createPremadeBouquet', () => {
  it('creates the bouquet, lines, and deducts stock', async () => {
    db.create
      .mockResolvedValueOnce({ id: 'recBouquet1', Name: 'Spring Pink' })   // parent
      .mockResolvedValueOnce({ id: 'recLine1' })                            // line 1
      .mockResolvedValueOnce({ id: 'recLine2' });                           // line 2
    db.atomicStockAdjust.mockResolvedValue({ stockId: 'x', previousQty: 10, newQty: 7 });
    db.getById.mockResolvedValue({
      id: 'recBouquet1', Name: 'Spring Pink', Lines: ['recLine1', 'recLine2'],
    });
    listByIds.mockResolvedValue([
      { id: 'recLine1', 'Flower Name': 'Rose', Quantity: 3, 'Sell Price Per Unit': 10, 'Cost Price Per Unit': 4 },
      { id: 'recLine2', 'Flower Name': 'Eucalyptus', Quantity: 2, 'Sell Price Per Unit': 5, 'Cost Price Per Unit': 2 },
    ]);

    const result = await createPremadeBouquet({
      name: 'Spring Pink',
      lines: [
        { stockItemId: 'recStock1', flowerName: 'Rose', quantity: 3, costPricePerUnit: 4, sellPricePerUnit: 10 },
        { stockItemId: 'recStock2', flowerName: 'Eucalyptus', quantity: 2, costPricePerUnit: 2, sellPricePerUnit: 5 },
      ],
      createdBy: 'Florist',
    });

    // Parent + 2 lines created
    expect(db.create).toHaveBeenCalledTimes(3);
    // Stock deducted twice, with negative deltas
    expect(db.atomicStockAdjust).toHaveBeenCalledWith('recStock1', -3);
    expect(db.atomicStockAdjust).toHaveBeenCalledWith('recStock2', -2);
    // Broadcast fired
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'premade_bouquet_created',
      bouquetId: 'recBouquet1',
    }));
    // Returned bouquet has enriched totals
    expect(result['Computed Sell Total']).toBe(3 * 10 + 2 * 5);
    expect(result['Computed Cost Total']).toBe(3 * 4 + 2 * 2);
  });

  it('rejects when name is missing', async () => {
    await expect(createPremadeBouquet({
      name: '',
      lines: [{ stockItemId: 'x', flowerName: 'Rose', quantity: 1 }],
    })).rejects.toThrow(/name is required/);
    expect(db.create).not.toHaveBeenCalled();
  });

  it('rejects when lines array is empty', async () => {
    await expect(createPremadeBouquet({
      name: 'Test',
      lines: [],
    })).rejects.toThrow(/at least one flower line/);
    expect(db.create).not.toHaveBeenCalled();
  });

  it('rejects when a line quantity is not positive', async () => {
    await expect(createPremadeBouquet({
      name: 'Test',
      lines: [{ stockItemId: 'x', flowerName: 'Rose', quantity: 0 }],
    })).rejects.toThrow(/quantity must be a positive number/);
    expect(db.create).not.toHaveBeenCalled();
  });

  it('rolls back stock and deletes records on failure', async () => {
    db.create
      .mockResolvedValueOnce({ id: 'recBouquet1' })  // parent created
      .mockResolvedValueOnce({ id: 'recLine1' })     // line 1 created
      .mockRejectedValueOnce(new Error('airtable exploded')); // line 2 fails
    db.atomicStockAdjust.mockResolvedValue({ stockId: 'x', previousQty: 10, newQty: 9 });

    await expect(createPremadeBouquet({
      name: 'Boom',
      lines: [
        { stockItemId: 'recStock1', flowerName: 'Rose', quantity: 1, costPricePerUnit: 4, sellPricePerUnit: 10 },
        { stockItemId: 'recStock2', flowerName: 'Eucalyptus', quantity: 1, costPricePerUnit: 2, sellPricePerUnit: 5 },
      ],
    })).rejects.toThrow(/airtable exploded/);

    // Note: stock deduction happens after all lines are created, so in this
    // scenario (line 2 creation fails) there were no stock adjustments to undo.
    // But the created parent + line 1 should be deleted as cleanup.
    expect(db.deleteRecord).toHaveBeenCalledWith(expect.anything(), 'recLine1');
    expect(db.deleteRecord).toHaveBeenCalledWith(expect.anything(), 'recBouquet1');
  });
});

describe('returnPremadeBouquetToStock', () => {
  it('increments stock for each line and deletes records', async () => {
    db.getById.mockResolvedValue({
      id: 'recBouquet1', Name: 'Spring Pink', Lines: ['recLine1', 'recLine2'],
    });
    listByIds.mockResolvedValue([
      { id: 'recLine1', 'Stock Item': ['recStock1'], 'Flower Name': 'Rose', Quantity: 3 },
      { id: 'recLine2', 'Stock Item': ['recStock2'], 'Flower Name': 'Eucalyptus', Quantity: 2 },
    ]);
    db.atomicStockAdjust.mockResolvedValue({ stockId: 'x', previousQty: 0, newQty: 3 });

    const result = await returnPremadeBouquetToStock('recBouquet1');

    // Stock adjusted with POSITIVE deltas (returning to inventory)
    expect(db.atomicStockAdjust).toHaveBeenCalledWith('recStock1', 3);
    expect(db.atomicStockAdjust).toHaveBeenCalledWith('recStock2', 2);
    // Lines deleted
    expect(db.deleteRecord).toHaveBeenCalledWith(expect.anything(), 'recLine1');
    expect(db.deleteRecord).toHaveBeenCalledWith(expect.anything(), 'recLine2');
    // Bouquet deleted
    expect(db.deleteRecord).toHaveBeenCalledWith(expect.anything(), 'recBouquet1');
    // Broadcast
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'premade_bouquet_returned',
      bouquetId: 'recBouquet1',
    }));
    // Response summary lists both returns
    expect(result.returnedItems).toHaveLength(2);
  });
});

describe('matchPremadeBouquetToOrder', () => {
  it('creates an order from premade lines WITHOUT re-deducting stock, then deletes premade', async () => {
    // First call: getPremadeBouquet() inside matchPremadeBouquetToOrder
    db.getById.mockResolvedValue({
      id: 'recBouquet1',
      Name: 'Spring Pink',
      Lines: ['recLine1', 'recLine2'],
      'Price Override': null,
    });
    listByIds.mockResolvedValue([
      { id: 'recLine1', 'Stock Item': ['recStock1'], 'Flower Name': 'Rose', Quantity: 3, 'Cost Price Per Unit': 4, 'Sell Price Per Unit': 10 },
      { id: 'recLine2', 'Stock Item': ['recStock2'], 'Flower Name': 'Eucalyptus', Quantity: 2, 'Cost Price Per Unit': 2, 'Sell Price Per Unit': 5 },
    ]);
    createOrder.mockResolvedValue({
      order: { id: 'recOrder1' },
      orderLines: [{ id: 'recNewLine1' }, { id: 'recNewLine2' }],
      delivery: null,
    });

    const result = await matchPremadeBouquetToOrder(
      'recBouquet1',
      {
        customer: 'recCustomer1',
        deliveryType: 'Pickup',
        paymentStatus: 'Paid',
      },
      { getConfig: () => null, getDriverOfDay: () => null, generateOrderId: () => Promise.resolve('ORD-1') },
    );

    // createOrder was called with skipStockDeduction: true
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'recCustomer1',
        orderLines: [
          expect.objectContaining({ stockItemId: 'recStock1', flowerName: 'Rose', quantity: 3 }),
          expect.objectContaining({ stockItemId: 'recStock2', flowerName: 'Eucalyptus', quantity: 2 }),
        ],
      }),
      expect.any(Object),
      { skipStockDeduction: true },
    );

    // Premade cleanup — lines and parent deleted
    expect(db.deleteRecord).toHaveBeenCalledWith(expect.anything(), 'recLine1');
    expect(db.deleteRecord).toHaveBeenCalledWith(expect.anything(), 'recLine2');
    expect(db.deleteRecord).toHaveBeenCalledWith(expect.anything(), 'recBouquet1');

    // No stock adjustments made directly from match flow
    expect(db.atomicStockAdjust).not.toHaveBeenCalled();

    // Broadcast fired
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'premade_bouquet_matched',
      bouquetId: 'recBouquet1',
      orderId: 'recOrder1',
    }));

    // Return value wires through orderId
    expect(result.order.id).toBe('recOrder1');
    expect(result.premadeBouquetId).toBe('recBouquet1');
  });

  it('carries the premade price override into the order when caller did not supply one', async () => {
    db.getById.mockResolvedValue({
      id: 'recBouquet1', Name: 'Spring Pink', Lines: ['recLine1'], 'Price Override': 150,
    });
    listByIds.mockResolvedValue([
      { id: 'recLine1', 'Stock Item': ['recStock1'], 'Flower Name': 'Rose', Quantity: 3, 'Cost Price Per Unit': 4, 'Sell Price Per Unit': 10 },
    ]);
    createOrder.mockResolvedValue({ order: { id: 'recOrder1' }, orderLines: [], delivery: null });

    await matchPremadeBouquetToOrder(
      'recBouquet1',
      { customer: 'recCustomer1', deliveryType: 'Pickup' }, // no priceOverride passed
      { getConfig: () => null, getDriverOfDay: () => null, generateOrderId: () => Promise.resolve('ORD-1') },
    );

    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ priceOverride: 150 }),
      expect.any(Object),
      { skipStockDeduction: true },
    );
  });

  it('rejects when the premade has no lines', async () => {
    db.getById.mockResolvedValue({ id: 'recBouquet1', Lines: [] });
    listByIds.mockResolvedValue([]);

    await expect(matchPremadeBouquetToOrder(
      'recBouquet1',
      { customer: 'recCustomer1', deliveryType: 'Pickup' },
      { getConfig: () => null, getDriverOfDay: () => null, generateOrderId: () => Promise.resolve('ORD-1') },
    )).rejects.toThrow(/no lines/);

    expect(createOrder).not.toHaveBeenCalled();
  });
});
