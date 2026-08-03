import { describe, it, expect, beforeEach } from 'vitest';
import { resolveDistance, normaliseAddressKey, __clearDistanceCacheForTests } from '../services/distanceService.js';

describe('normaliseAddressKey', () => {
  it('treats two spellings of one address as the same key', () => {
    expect(normaliseAddressKey('  ul.  Kwiatowa 1, Kraków '))
      .toBe(normaliseAddressKey('ul. Kwiatowa 1, Kraków'));
  });

  it('is case-insensitive', () => {
    expect(normaliseAddressKey('UL. KWIATOWA 1')).toBe(normaliseAddressKey('ul. kwiatowa 1'));
  });
});

describe('resolveDistance', () => {
  beforeEach(() => __clearDistanceCacheForTests());

  it('returns the resolved distance from the provider', async () => {
    const stub = async () => ({ distanceKm: 4.2, resolvedAddress: 'ul. Kwiatowa 1, Kraków' });
    const result = await resolveDistance('ul. Kwiatowa 1', {
      fetchDistanceKm: stub,
      originAddress: 'studio address',
    });
    expect(result).toEqual({ distanceKm: 4.2, resolvedAddress: 'ul. Kwiatowa 1, Kraków' });
  });

  it('returns null for an address the provider cannot resolve', async () => {
    const stub = async () => null;
    const result = await resolveDistance('not a real place', {
      fetchDistanceKm: stub,
      originAddress: 'studio address',
    });
    expect(result).toBeNull();
  });

  it('returns null (never throws) when the provider errors', async () => {
    const stub = async () => { throw new Error('ORS 500'); };
    const result = await resolveDistance('ul. Kwiatowa 1', {
      fetchDistanceKm: stub,
      originAddress: 'studio address',
    });
    expect(result).toBeNull();
  });

  it('returns null when there is no address', async () => {
    const stub = async () => ({ distanceKm: 1, resolvedAddress: 'x' });
    expect(await resolveDistance('', { fetchDistanceKm: stub, originAddress: 'studio' })).toBeNull();
    expect(await resolveDistance(null, { fetchDistanceKm: stub, originAddress: 'studio' })).toBeNull();
  });

  it('returns null when no studio origin address is configured', async () => {
    const stub = async () => ({ distanceKm: 1, resolvedAddress: 'x' });
    const result = await resolveDistance('ul. Kwiatowa 1', { fetchDistanceKm: stub, originAddress: '' });
    expect(result).toBeNull();
  });

  it('a cache hit avoids a second provider call', async () => {
    let calls = 0;
    const stub = async () => { calls++; return { distanceKm: 4.2, resolvedAddress: 'ul. Kwiatowa 1' }; };
    const opts = { fetchDistanceKm: stub, originAddress: 'studio address' };

    await resolveDistance('ul. Kwiatowa 1', opts);
    await resolveDistance('UL. KWIATOWA 1', opts); // same address, different casing

    expect(calls).toBe(1);
  });

  it('a changed studio origin busts the cache instead of reusing a stale distance', async () => {
    let calls = 0;
    const stub = async () => { calls++; return { distanceKm: 4.2, resolvedAddress: 'ul. Kwiatowa 1' }; };

    await resolveDistance('ul. Kwiatowa 1', { fetchDistanceKm: stub, originAddress: 'studio address A' });
    await resolveDistance('ul. Kwiatowa 1', { fetchDistanceKm: stub, originAddress: 'studio address B' });

    expect(calls).toBe(2);
  });
});
