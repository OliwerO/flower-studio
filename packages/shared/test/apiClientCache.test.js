import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCachedGet } from '../api/client.js';

describe('createCachedGet', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('deduplicates matching in-flight GET requests', async () => {
    let resolveRequest;
    const requestGet = vi.fn(() => new Promise(resolve => {
      resolveRequest = resolve;
    }));
    const { cachedGet } = createCachedGet(requestGet);

    const first = cachedGet('/stock', { params: { includeEmpty: true } });
    const second = cachedGet('/stock', { params: { includeEmpty: true } });

    expect(requestGet).toHaveBeenCalledTimes(1);
    resolveRequest({ data: ['roses'] });

    await expect(first).resolves.toEqual({ data: ['roses'] });
    await expect(second).resolves.toEqual({ data: ['roses'] });
  });

  it('serves a fulfilled response from cache within the TTL', async () => {
    const requestGet = vi.fn()
      .mockResolvedValueOnce({ data: ['first'] })
      .mockResolvedValueOnce({ data: ['second'] });
    const { cachedGet } = createCachedGet(requestGet);

    await expect(cachedGet('/settings', {}, { ttlMs: 1000 })).resolves.toEqual({ data: ['first'] });
    await expect(cachedGet('/settings', {}, { ttlMs: 1000 })).resolves.toEqual({ data: ['first'] });

    expect(requestGet).toHaveBeenCalledTimes(1);
  });

  it('refetches after the TTL expires', async () => {
    const requestGet = vi.fn()
      .mockResolvedValueOnce({ data: ['first'] })
      .mockResolvedValueOnce({ data: ['second'] });
    const { cachedGet } = createCachedGet(requestGet);

    await cachedGet('/settings', {}, { ttlMs: 1000 });
    vi.advanceTimersByTime(1001);
    await expect(cachedGet('/settings', {}, { ttlMs: 1000 })).resolves.toEqual({ data: ['second'] });

    expect(requestGet).toHaveBeenCalledTimes(2);
  });

  it('does not cache rejected requests', async () => {
    const requestGet = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ data: ['recovered'] });
    const { cachedGet } = createCachedGet(requestGet);

    await expect(cachedGet('/stock')).rejects.toThrow('boom');
    await expect(cachedGet('/stock')).resolves.toEqual({ data: ['recovered'] });

    expect(requestGet).toHaveBeenCalledTimes(2);
  });

  it('separates cache entries by scope and sorted params', async () => {
    let scope = 'owner';
    const requestGet = vi.fn()
      .mockResolvedValueOnce({ data: 'owner' })
      .mockResolvedValueOnce({ data: 'florist' });
    const { cachedGet } = createCachedGet(requestGet, { getScope: () => scope });

    await expect(cachedGet('/stock', { params: { b: 2, a: 1 } })).resolves.toEqual({ data: 'owner' });
    await expect(cachedGet('/stock', { params: { a: 1, b: 2 } })).resolves.toEqual({ data: 'owner' });
    scope = 'florist';
    await expect(cachedGet('/stock', { params: { a: 1, b: 2 } })).resolves.toEqual({ data: 'florist' });

    expect(requestGet).toHaveBeenCalledTimes(2);
  });
});
