import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

import { resolveFloristByPin } from '../utils/driverPins.js';

describe('resolveFloristByPin', () => {
  const orig = process.env.PIN_FLORIST;
  beforeEach(() => { process.env.PIN_FLORIST = '2580'; });
  afterEach(() => { process.env.PIN_FLORIST = orig; });

  it('resolves the florist PIN to "florist"', () => {
    expect(resolveFloristByPin('2580')).toBe('florist');
  });
  it('returns null for a wrong PIN', () => {
    expect(resolveFloristByPin('0000')).toBeNull();
  });
  it('returns null for empty input', () => {
    expect(resolveFloristByPin('')).toBeNull();
    expect(resolveFloristByPin(undefined)).toBeNull();
  });
});
