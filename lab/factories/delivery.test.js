// lab/factories/delivery.test.js
//
// TDD coverage for makeDelivery factory.
// Tests were written BEFORE the factory implementation (red phase).

import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { makeOrder } from './order.js';
import { makeDelivery } from './delivery.js';

describe('makeDelivery', () => {
  beforeEach(() => faker.seed(42));

  it('returns a uuid id', () => {
    const d = makeDelivery({ orderId: 'order-1' });
    expect(d.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('links to an order with default Pending status', () => {
    const order = makeOrder({ delivery_type: 'Delivery' });
    const d = makeDelivery({ orderId: order.id });
    expect(d.order_id).toBe(order.id);
    expect(d.status).toBe('Pending');
  });

  it('has recipient_name and recipient_phone', () => {
    const d = makeDelivery({ orderId: 'order-x' });
    expect(typeof d.recipient_name).toBe('string');
    expect(d.recipient_name.length).toBeGreaterThan(0);
    expect(d.recipient_phone).toMatch(/^\+48/);
  });

  it('has a delivery_address', () => {
    const d = makeDelivery({ orderId: 'order-x' });
    expect(typeof d.delivery_address).toBe('string');
    expect(d.delivery_address.length).toBeGreaterThan(0);
  });

  it('honours explicit status', () => {
    const d = makeDelivery({ orderId: 'order-x', status: 'Delivered' });
    expect(d.status).toBe('Delivered');
  });

  it('does not leak factory-only orderId key into the row', () => {
    const d = makeDelivery({ orderId: 'order-x' });
    expect(d.orderId).toBeUndefined();
    expect(d.order_id).toBe('order-x');
  });

  it('has timestamps', () => {
    const d = makeDelivery({ orderId: 'order-x' });
    expect(d.created_at).toBeInstanceOf(Date);
    expect(d.updated_at).toBeInstanceOf(Date);
    expect(d.deleted_at).toBeNull();
  });

  it('is deterministic under the same faker seed', () => {
    faker.seed(42);
    const a = makeDelivery({ orderId: 'order-x' });
    faker.seed(42);
    const b = makeDelivery({ orderId: 'order-x' });
    expect(a).toEqual(b);
  });

  it('accepts order_id directly as well as orderId shorthand', () => {
    const d = makeDelivery({ order_id: 'order-direct' });
    expect(d.order_id).toBe('order-direct');
    expect(d.orderId).toBeUndefined();
  });
});
