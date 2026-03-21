import { describe, it, expect } from 'vitest';
import { ALLOWED_TRANSITIONS } from '../services/orderService.js';
import { ORDER_STATUS } from '../constants/statuses.js';

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
