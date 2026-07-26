import { describe, it, expect } from 'vitest';
import { isDeliveryOrder } from '../utils/deliveryGate.js';

describe('isDeliveryOrder', () => {
  it('is true only for an order whose current Delivery Type is Delivery', () => {
    expect(isDeliveryOrder({ 'Delivery Type': 'Delivery' })).toBe(true);
    expect(isDeliveryOrder({ 'Delivery Type': 'Pickup' })).toBe(false);
  });

  it('is false when the type is missing or the order is absent', () => {
    // Fail closed: an unknown type must never unlock a delivery-only read.
    expect(isDeliveryOrder({})).toBe(false);
    expect(isDeliveryOrder(null)).toBe(false);
    expect(isDeliveryOrder(undefined)).toBe(false);
  });

  it('ignores the presence of a delivery sub-record', () => {
    // The whole point of the gate: a cancelled delivery is not a deleted
    // delivery, so `_delivery` existing proves nothing about the order type.
    expect(isDeliveryOrder({
      'Delivery Type': 'Pickup',
      _delivery: { Status: 'Cancelled', 'Delivery Fee': 40 },
    })).toBe(false);
  });
});
