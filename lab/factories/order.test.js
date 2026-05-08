// lab/factories/order.test.js
//
// TDD coverage for makeOrder and makeOrderLine factories.
// Tests were written BEFORE the factory implementations (red phase).

import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { makeCustomer, makeStockItem } from './index.js';
import { makeOrder, ORDER_STATUSES } from './order.js';
import { makeOrderLine } from './orderLine.js';

describe('makeOrder', () => {
  beforeEach(() => faker.seed(42));

  it('returns a uuid id', () => {
    const o = makeOrder();
    expect(o.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('returns an order linked to a customer with default status New', () => {
    const customer = makeCustomer();
    const o = makeOrder({ customerId: customer.id });
    expect(o.customer_id).toBe(customer.id);
    expect(o.status).toBe('New');
    expect(['Delivery', 'Pickup']).toContain(o.delivery_type);
  });

  it('honours explicit status + delivery_type', () => {
    const o = makeOrder({ status: 'Ready', delivery_type: 'Pickup' });
    expect(o.status).toBe('Ready');
    expect(o.delivery_type).toBe('Pickup');
  });

  it('has a non-empty app_order_id', () => {
    const o = makeOrder();
    expect(typeof o.app_order_id).toBe('string');
    expect(o.app_order_id.length).toBeGreaterThan(0);
  });

  it('has Unpaid payment_status by default', () => {
    const o = makeOrder();
    expect(o.payment_status).toBe('Unpaid');
  });

  it('has timestamps', () => {
    const o = makeOrder();
    expect(o.created_at).toBeInstanceOf(Date);
    expect(o.updated_at).toBeInstanceOf(Date);
    expect(o.deleted_at).toBeNull();
  });

  it('produces unique app_order_id across calls', () => {
    // app_order_id is counter-based (like configService.generateOrderId), not faker-seeded.
    // Two calls should yield different IDs regardless of faker seed.
    const a = makeOrder();
    const b = makeOrder();
    expect(a.app_order_id).not.toBe(b.app_order_id);
  });

  it('accepts customerId shorthand that maps to customer_id', () => {
    const o = makeOrder({ customerId: 'cust-abc' });
    expect(o.customer_id).toBe('cust-abc');
    expect(o.customerId).toBeUndefined();
  });

  it('exports ORDER_STATUSES with all expected values', () => {
    expect(ORDER_STATUSES).toContain('New');
    expect(ORDER_STATUSES).toContain('Ready');
    expect(ORDER_STATUSES).toContain('Out for Delivery');
    expect(ORDER_STATUSES).toContain('Delivered');
    expect(ORDER_STATUSES).toContain('Picked Up');
    expect(ORDER_STATUSES).toContain('Cancelled');
  });
});

describe('makeOrderLine', () => {
  beforeEach(() => faker.seed(42));

  it('returns a uuid id', () => {
    const line = makeOrderLine({ flower_name: 'Red Roses' });
    expect(line.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('snapshots cost + sell from the source stock item using actual column names', () => {
    const stock = makeStockItem({ current_cost_price: 5, current_sell_price: 15 });
    const order = makeOrder();
    const line = makeOrderLine({
      orderId: order.id,
      stockItemId: stock.id,
      flower_name: stock.display_name,
      quantity: 3,
      costSnapshot: 5,
      sellSnapshot: 15,
    });
    expect(line.order_id).toBe(order.id);
    expect(line.stock_item_id).toBe(stock.id);
    expect(line.quantity).toBe(3);
    expect(line.cost_price_per_unit).toBe(5);
    expect(line.sell_price_per_unit).toBe(15);
  });

  it('does not leak factory-only keys into the row', () => {
    const line = makeOrderLine({
      orderId: 'order-1',
      stockItemId: 'stock-1',
      flower_name: 'Peonies',
      costSnapshot: 10,
      sellSnapshot: 25,
    });
    expect(line.orderId).toBeUndefined();
    expect(line.stockItemId).toBeUndefined();
    expect(line.costSnapshot).toBeUndefined();
    expect(line.sellSnapshot).toBeUndefined();
  });

  it('has flower_name (required column) set when passed', () => {
    const line = makeOrderLine({ flower_name: 'Gypsophila' });
    expect(line.flower_name).toBe('Gypsophila');
  });

  it('defaults quantity to 1 and snapshots to 0', () => {
    const line = makeOrderLine({ flower_name: 'Carnations' });
    expect(line.quantity).toBe(1);
    expect(line.cost_price_per_unit).toBe(0);
    expect(line.sell_price_per_unit).toBe(0);
  });

  it('has timestamps', () => {
    const line = makeOrderLine({ flower_name: 'Tulips' });
    expect(line.created_at).toBeInstanceOf(Date);
    expect(line.updated_at).toBeInstanceOf(Date);
    expect(line.deleted_at).toBeNull();
  });
});
