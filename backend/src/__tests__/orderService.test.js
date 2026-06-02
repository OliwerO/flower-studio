import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks for createOrder side-effect dependencies ──
vi.mock('../repos/orderRepo.js', () => ({
  createOrder: vi.fn(),
  transitionStatus: vi.fn(),
  getById: vi.fn(),
  getDeliveryById: vi.fn(),
  getLinesByIds: vi.fn(),
  getLinesForOrders: vi.fn(),
  cancelWithStockReturn: vi.fn(),
  deleteOrder: vi.fn(),
  editBouquetLines: vi.fn(),
  findByWixOrderId: vi.fn(),
  list: vi.fn(),
}));
vi.mock('../repos/customerRepo.js', () => ({
  update: vi.fn().mockResolvedValue(undefined),
  findMany: vi.fn().mockResolvedValue([]),
}));
vi.mock('../repos/stockRepo.js', () => ({
  list: vi.fn(),
  adjustQuantity: vi.fn(),
}));
vi.mock('../services/notifications.js', () => ({
  broadcast: vi.fn(),
}));
vi.mock('../services/telegram.js', () => ({
  notifyNewOrder: vi.fn().mockResolvedValue(undefined),
  notifyDeliveryComplete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/floristNotifyService.js', () => ({
  notifyFloristNewOrder: vi.fn().mockResolvedValue(undefined),
}));

import { ALLOWED_TRANSITIONS, createOrder } from '../services/orderService.js';
import { ORDER_STATUS } from '../constants/statuses.js';
import { notifyFloristNewOrder } from '../services/floristNotifyService.js';
import * as orderRepo from '../repos/orderRepo.js';

// ── ALLOWED_TRANSITIONS state machine ──

describe('ALLOWED_TRANSITIONS', () => {
  it('New can go to Ready or Cancelled', () => {
    expect(ALLOWED_TRANSITIONS[ORDER_STATUS.NEW]).toEqual([
      ORDER_STATUS.READY,
      ORDER_STATUS.CANCELLED,
    ]);
  });

  it('Ready can go to Out for Delivery, Delivered, Picked Up, or Cancelled', () => {
    expect(ALLOWED_TRANSITIONS[ORDER_STATUS.READY]).toEqual([
      ORDER_STATUS.OUT_FOR_DELIVERY,
      ORDER_STATUS.DELIVERED,
      ORDER_STATUS.PICKED_UP,
      ORDER_STATUS.CANCELLED,
    ]);
  });

  it('Out for Delivery can go to Delivered or Cancelled', () => {
    expect(ALLOWED_TRANSITIONS[ORDER_STATUS.OUT_FOR_DELIVERY]).toEqual([
      ORDER_STATUS.DELIVERED,
      ORDER_STATUS.CANCELLED,
    ]);
  });

  it('Delivered is terminal (no transitions)', () => {
    expect(ALLOWED_TRANSITIONS[ORDER_STATUS.DELIVERED]).toEqual([]);
  });

  it('Picked Up is terminal (no transitions)', () => {
    expect(ALLOWED_TRANSITIONS[ORDER_STATUS.PICKED_UP]).toEqual([]);
  });

  it('Cancelled can reopen to New', () => {
    expect(ALLOWED_TRANSITIONS[ORDER_STATUS.CANCELLED]).toEqual([
      ORDER_STATUS.NEW,
    ]);
  });

  it('In Progress (legacy) can exit to Ready or Cancelled', () => {
    expect(ALLOWED_TRANSITIONS[ORDER_STATUS.IN_PROGRESS]).toEqual([
      ORDER_STATUS.READY,
      ORDER_STATUS.CANCELLED,
    ]);
  });

  // Guard: no transition allows going backward to a non-terminal state
  // (except Cancelled → New which is intentional "reopen")
  it('Delivered cannot go back to Ready', () => {
    expect(ALLOWED_TRANSITIONS[ORDER_STATUS.DELIVERED]).not.toContain(ORDER_STATUS.READY);
  });

  it('Picked Up cannot go back to Ready', () => {
    expect(ALLOWED_TRANSITIONS[ORDER_STATUS.PICKED_UP]).not.toContain(ORDER_STATUS.READY);
  });

  it('covers all defined statuses', () => {
    const definedStatuses = Object.values(ORDER_STATUS);
    const transitionKeys = Object.keys(ALLOWED_TRANSITIONS);

    // Every status that appears in the workflow should have a transition entry
    for (const status of definedStatuses) {
      // IN_PREPARATION is a frontend-only status (florist app), not in backend transitions
      if (status === ORDER_STATUS.IN_PREPARATION) continue;
      expect(transitionKeys).toContain(status);
    }
  });
});

// ── ORDER_STATUS constants ──

describe('ORDER_STATUS', () => {
  it('has correct string values matching Airtable', () => {
    expect(ORDER_STATUS.NEW).toBe('New');
    expect(ORDER_STATUS.READY).toBe('Ready');
    expect(ORDER_STATUS.DELIVERED).toBe('Delivered');
    expect(ORDER_STATUS.PICKED_UP).toBe('Picked Up');
    expect(ORDER_STATUS.CANCELLED).toBe('Cancelled');
    expect(ORDER_STATUS.OUT_FOR_DELIVERY).toBe('Out for Delivery');
  });
});

// ── createOrder fires florist notification seam ──

describe('createOrder — florist notification seam', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls notifyFloristNewOrder once with the created App Order ID', async () => {
    const fakeOrder = {
      id: 'uuid-1',
      'App Order ID': 'TEST-001',
      'Required By': '2026-06-05',
      'Delivery Time': '10:00-12:00',
      'Customer Request': 'Пионы',
    };
    orderRepo.createOrder.mockResolvedValue({ order: fakeOrder, orderLines: [], delivery: null });

    const params = {
      customer: 'cust-1',
      source: 'In-store',
      customerRequest: 'Пионы',
      deliveryType: 'Pickup',
      lines: [],
    };
    const config = { generateOrderId: () => 'TEST-001', getConfig: () => ({}), getDriverOfDay: () => null };

    await createOrder(params, config);

    expect(notifyFloristNewOrder).toHaveBeenCalledTimes(1);
    const callArg = notifyFloristNewOrder.mock.calls[0][0];
    expect(callArg.order['App Order ID']).toBe('TEST-001');
  });
});
