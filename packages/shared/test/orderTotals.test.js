import { describe, it, expect } from 'vitest';
import { resolveDeliveryFee } from '../utils/orderTotals.js';

const delivery = (fee) => ({ 'Delivery Fee': fee, 'Driver Payout': 35 });

describe('resolveDeliveryFee', () => {
  it('returns 0 for a Pickup order even when a delivery record still carries a fee', () => {
    // Delivery → Pickup only CANCELS the delivery row (#554 / pitfall
    // cancelled-delivery-leak) — the fee is still sitting on it.
    const order = { 'Delivery Type': 'Pickup', 'Delivery Fee': 35, delivery: delivery(35) };
    expect(resolveDeliveryFee(order)).toBe(0);
  });

  it('prefers the delivery record over the order-level copy', () => {
    const order = { 'Delivery Type': 'Delivery', 'Delivery Fee': 35, delivery: delivery(50) };
    expect(resolveDeliveryFee(order)).toBe(50);
  });

  it('treats a CLEARED fee on the delivery record as free delivery, not as "fall back to the stale copy"', () => {
    // The #644 repro: order-level column still 35 from creation, owner cleared
    // the customer fee on the delivery record.
    const order = { 'Delivery Type': 'Delivery', 'Delivery Fee': 35, delivery: delivery(null) };
    expect(resolveDeliveryFee(order)).toBe(0);
  });

  it('treats an explicit 0 the same way', () => {
    const order = { 'Delivery Type': 'Delivery', 'Delivery Fee': 35, delivery: delivery(0) };
    expect(resolveDeliveryFee(order)).toBe(0);
  });

  it('falls back to the order-level fee when no delivery sub-record is loaded (list rows)', () => {
    const order = { 'Delivery Type': 'Delivery', 'Delivery Fee': 35 };
    expect(resolveDeliveryFee(order)).toBe(35);
  });

  it('accepts an explicitly passed delivery record', () => {
    const order = { 'Delivery Type': 'Delivery', 'Delivery Fee': 35 };
    expect(resolveDeliveryFee(order, delivery(20))).toBe(20);
  });

  it('never lets Driver Payout reach the fee', () => {
    const order = { 'Delivery Type': 'Delivery', 'Delivery Fee': null, delivery: { 'Delivery Fee': null, 'Driver Payout': 500 } };
    expect(resolveDeliveryFee(order)).toBe(0);
  });

  it('is null-safe', () => {
    expect(resolveDeliveryFee(null)).toBe(0);
    expect(resolveDeliveryFee(undefined)).toBe(0);
  });
});
