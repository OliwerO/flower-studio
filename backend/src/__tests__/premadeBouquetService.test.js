// Tests for premadeBouquetService — create / return / match flows.
//
// Phase 7: persistence is now via premadeBouquetRepo (not airtable.js).
// These tests mock the repo and the order service's createOrder so we can
// assert the business logic without touching real Postgres.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the premade bouquet repo ──
vi.mock('../repos/premadeBouquetRepo.js', () => ({
  list:                vi.fn(),
  getById:             vi.fn(),
  create:              vi.fn(),
  update:              vi.fn(),
  deleteById:          vi.fn(),
  createLine:          vi.fn(),
  getLineById:         vi.fn(),
  getLinesByBouquetId: vi.fn(),
  getLinesByStockId:   vi.fn(),
  updateLine:          vi.fn(),
  deleteLineById:      vi.fn(),
}));

// ── Mock stockRepo (post-cutover stock adjustments route through here) ──
vi.mock('../repos/stockRepo.js', () => ({
  adjustQuantity: vi.fn(),
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

import * as premadeBouquetRepo from '../repos/premadeBouquetRepo.js';
import * as stockRepo from '../repos/stockRepo.js';
import { broadcast } from '../services/notifications.js';
import { createOrder } from '../services/orderService.js';
import {
  createPremadeBouquet,
  matchPremadeBouquetToOrder,
} from '../services/premadeBouquetService.js';

beforeEach(() => {
  vi.clearAllMocks();
  premadeBouquetRepo.deleteById.mockResolvedValue(undefined);
  premadeBouquetRepo.deleteLineById.mockResolvedValue(undefined);
});

// Stock-affecting behavior (build reserves not deducts, dissolve/sale under the
// reservation model) is covered against a real pglite harness in
// premadeBouquetService.integration.test.js. These unit tests cover the
// flag-agnostic validation + match-wiring seams.
describe('createPremadeBouquet', () => {
  it('rejects when name is missing', async () => {
    await expect(createPremadeBouquet({
      name: '',
      lines: [{ stockItemId: 'x', flowerName: 'Rose', quantity: 1 }],
    })).rejects.toThrow(/name is required/);
    expect(premadeBouquetRepo.create).not.toHaveBeenCalled();
  });

  it('rejects when lines array is empty', async () => {
    await expect(createPremadeBouquet({
      name: 'Test',
      lines: [],
    })).rejects.toThrow(/at least one flower line/);
    expect(premadeBouquetRepo.create).not.toHaveBeenCalled();
  });

  it('rejects when a line quantity is not positive', async () => {
    await expect(createPremadeBouquet({
      name: 'Test',
      lines: [{ stockItemId: 'x', flowerName: 'Rose', quantity: 0 }],
    })).rejects.toThrow(/quantity must be a positive number/);
    expect(premadeBouquetRepo.create).not.toHaveBeenCalled();
  });
});

describe('matchPremadeBouquetToOrder', () => {
  it('creates an order from premade lines, then deletes the premade', async () => {
    premadeBouquetRepo.getById.mockResolvedValue({
      id: 'recBouquet1', _pgId: 'uuid-bouquet-1', Name: 'Spring Pink', 'Price Override': null,
    });
    premadeBouquetRepo.getLinesByBouquetId.mockResolvedValue([
      { id: 'recLine1', _pgId: 'uuid-line-1', 'Stock Item': ['recStock1'], 'Flower Name': 'Rose', Quantity: 3, 'Cost Price Per Unit': 4, 'Sell Price Per Unit': 10 },
      { id: 'recLine2', _pgId: 'uuid-line-2', 'Stock Item': ['recStock2'], 'Flower Name': 'Eucalyptus', Quantity: 2, 'Cost Price Per Unit': 2, 'Sell Price Per Unit': 5 },
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

    // Sale routes through standard createOrder allocation (reservation model —
    // no skipStockDeduction; the order allocates against Batch normally).
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'recCustomer1',
        orderLines: [
          expect.objectContaining({ stockItemId: 'recStock1', flowerName: 'Rose', quantity: 3 }),
          expect.objectContaining({ stockItemId: 'recStock2', flowerName: 'Eucalyptus', quantity: 2 }),
        ],
      }),
      expect.any(Object),
    );

    // Premade cleanup — bouquet deleted (CASCADE removes lines)
    expect(premadeBouquetRepo.deleteById).toHaveBeenCalledWith('uuid-bouquet-1');

    // Match flow makes no direct stock adjustments (createOrder owns allocation)
    expect(stockRepo.adjustQuantity).not.toHaveBeenCalled();

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
    premadeBouquetRepo.getById.mockResolvedValue({
      id: 'recBouquet1', _pgId: 'uuid-bouquet-1', Name: 'Spring Pink', 'Price Override': 150,
    });
    premadeBouquetRepo.getLinesByBouquetId.mockResolvedValue([
      { id: 'recLine1', _pgId: 'uuid-line-1', 'Stock Item': ['recStock1'], 'Flower Name': 'Rose', Quantity: 3, 'Cost Price Per Unit': 4, 'Sell Price Per Unit': 10 },
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
    );
  });

  it('rejects when the premade has no lines', async () => {
    premadeBouquetRepo.getById.mockResolvedValue({
      id: 'recBouquet1', _pgId: 'uuid-bouquet-1',
    });
    premadeBouquetRepo.getLinesByBouquetId.mockResolvedValue([]);

    await expect(matchPremadeBouquetToOrder(
      'recBouquet1',
      { customer: 'recCustomer1', deliveryType: 'Pickup' },
      { getConfig: () => null, getDriverOfDay: () => null, generateOrderId: () => Promise.resolve('ORD-1') },
    )).rejects.toThrow(/no lines/);

    expect(createOrder).not.toHaveBeenCalled();
  });
});
