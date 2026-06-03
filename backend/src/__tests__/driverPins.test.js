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

import { resolveRoleByPin, isValidPin } from '../utils/driverPins.js';
import { setBackupDriverName } from '../services/driverState.js';

describe('resolveRoleByPin', () => {
  const origOwner = process.env.PIN_OWNER;
  const origFlorist = process.env.PIN_FLORIST;
  beforeEach(() => {
    process.env.PIN_OWNER = '9999';
    process.env.PIN_FLORIST = '2580';
    process.env.PIN_DRIVER_NIKITA = '5678';
    process.env.PIN_DRIVER_BACKUP = '4321';
  });
  afterEach(() => {
    process.env.PIN_OWNER = origOwner;
    process.env.PIN_FLORIST = origFlorist;
    setBackupDriverName(null);
  });

  it('resolves the owner PIN to the owner role', () => {
    expect(resolveRoleByPin('9999')).toEqual({ role: 'owner' });
  });
  it('resolves the florist PIN to the florist role', () => {
    expect(resolveRoleByPin('2580')).toEqual({ role: 'florist' });
  });
  it('resolves a driver PIN to the driver role with the driver name', () => {
    expect(resolveRoleByPin('5678')).toEqual({ role: 'driver', driverName: 'Nikita' });
  });
  it('resolves the Backup driver PIN to the owner-set backup name', () => {
    setBackupDriverName('Andrei');
    expect(resolveRoleByPin('4321')).toEqual({ role: 'driver', driverName: 'Andrei' });
  });
  it('returns null for an unknown or empty PIN', () => {
    expect(resolveRoleByPin('0000')).toBeNull();
    expect(resolveRoleByPin('')).toBeNull();
    expect(resolveRoleByPin(undefined)).toBeNull();
  });
  it('prefers owner over florist when their PINs collide', () => {
    process.env.PIN_FLORIST = '9999';
    expect(resolveRoleByPin('9999')).toEqual({ role: 'owner' });
  });
});

describe('isValidPin', () => {
  beforeEach(() => {
    process.env.PIN_OWNER = '9999';
    process.env.PIN_FLORIST = '2580';
    process.env.PIN_DRIVER_NIKITA = '5678';
  });
  it('is true for any recognised role PIN', () => {
    expect(isValidPin('9999')).toBe(true);
    expect(isValidPin('2580')).toBe(true);
    expect(isValidPin('5678')).toBe(true);
  });
  it('is false for an unknown or empty PIN', () => {
    expect(isValidPin('0000')).toBe(false);
    expect(isValidPin('')).toBe(false);
    expect(isValidPin(undefined)).toBe(false);
  });
});
