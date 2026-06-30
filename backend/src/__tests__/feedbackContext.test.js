import { describe, it, expect } from 'vitest';
import { getAreaContext } from '../services/feedbackContext.js';

describe('getAreaContext', () => {
  it('returns dashboard context for "dashboard"', () => {
    const ctx = getAreaContext('dashboard');
    expect(ctx).toContain('Dashboard');
    expect(ctx.length).toBeGreaterThan(20);
  });

  it('returns florist context for "florist"', () => {
    const ctx = getAreaContext('florist');
    expect(ctx).toContain('Florist');
    expect(ctx.length).toBeGreaterThan(20);
  });

  it('returns delivery context for "delivery"', () => {
    const ctx = getAreaContext('delivery');
    expect(ctx).toContain('Delivery');
    expect(ctx.length).toBeGreaterThan(20);
  });

  it('returns fallback for unknown area', () => {
    const ctx = getAreaContext('unknown');
    expect(ctx.length).toBeGreaterThan(0);
  });

  it('returns fallback for null', () => {
    const ctx = getAreaContext(null);
    expect(ctx.length).toBeGreaterThan(0);
  });

  it('returns fallback for undefined', () => {
    const ctx = getAreaContext(undefined);
    expect(ctx.length).toBeGreaterThan(0);
  });
});
