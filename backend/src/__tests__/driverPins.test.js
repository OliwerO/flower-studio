import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('resolveDriverByPin', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.PIN_DRIVER_NIKITA = '5678';
    process.env.PIN_DRIVER_TIMUR = '1234';
  });

  it('maps a driver PIN to the capitalised driver name', async () => {
    const { resolveDriverByPin } = await import('../utils/driverPins.js');
    expect(resolveDriverByPin('5678')).toBe('Nikita');
    expect(resolveDriverByPin('1234')).toBe('Timur');
  });

  it('returns null for an unknown or empty PIN', async () => {
    const { resolveDriverByPin } = await import('../utils/driverPins.js');
    expect(resolveDriverByPin('0000')).toBeNull();
    expect(resolveDriverByPin('')).toBeNull();
    expect(resolveDriverByPin(undefined)).toBeNull();
  });
});
