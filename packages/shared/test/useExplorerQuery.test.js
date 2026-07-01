// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Control the shared API client. Never make real network calls in tests.
vi.mock('../api/client.js', () => ({
  default: { post: vi.fn() },
  cachedGet: vi.fn(),
}));

import client, { cachedGet } from '../api/client.js';
import useExplorerQuery from '../hooks/useExplorerQuery.js';

const SCHEMA = { entities: [{ key: 'orders', label: 'Заказы', fields: [], drills: [] }] };

describe('useExplorerQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cachedGet.mockResolvedValue({ data: SCHEMA });
  });
  afterEach(() => vi.restoreAllMocks());

  it('loads the schema from GET /explorer/schema on mount', async () => {
    const { result } = renderHook(() => useExplorerQuery());
    expect(result.current.schemaLoading).toBe(true);
    await waitFor(() => expect(result.current.schemaLoading).toBe(false));
    expect(cachedGet).toHaveBeenCalledWith('/explorer/schema', {}, expect.objectContaining({ ttlMs: expect.any(Number) }));
    expect(result.current.schema).toEqual(SCHEMA);
    expect(result.current.schemaError).toBeNull();
  });

  it('surfaces a schema load error', async () => {
    cachedGet.mockRejectedValue({ response: { data: { error: 'boom' } } });
    const { result } = renderHook(() => useExplorerQuery());
    await waitFor(() => expect(result.current.schemaLoading).toBe(false));
    expect(result.current.schemaError).toBe('boom');
    expect(result.current.schema).toBeNull();
  });

  it('run(spec) POSTs the spec and exposes rows/matchedCount/truncated', async () => {
    client.post.mockResolvedValue({ data: { spec: { entity: 'orders' }, rows: [{ id: 1 }, { id: 2 }], matchedCount: 5, truncated: true } });
    const { result } = renderHook(() => useExplorerQuery());
    await waitFor(() => expect(result.current.schemaLoading).toBe(false));

    await act(async () => { await result.current.run({ entity: 'orders' }); });

    expect(client.post).toHaveBeenCalledWith('/explorer/query', { entity: 'orders' });
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.matchedCount).toBe(5);
    expect(result.current.truncated).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('aggregate result (no matchedCount) falls back to row count', async () => {
    client.post.mockResolvedValue({ data: { spec: { entity: 'orders', groupBy: ['status'] }, rows: [{ status: 'New', n: 3 }], truncated: false } });
    const { result } = renderHook(() => useExplorerQuery());
    await waitFor(() => expect(result.current.schemaLoading).toBe(false));
    await act(async () => { await result.current.run({ entity: 'orders', groupBy: ['status'] }); });
    expect(result.current.matchedCount).toBe(1);
  });

  it('surfaces a query error and clears rows', async () => {
    client.post.mockRejectedValue({ response: { data: { error: 'Unknown entity "bogus"' } } });
    const { result } = renderHook(() => useExplorerQuery());
    await waitFor(() => expect(result.current.schemaLoading).toBe(false));
    await act(async () => { await result.current.run({ entity: 'bogus' }); });
    expect(result.current.error).toBe('Unknown entity "bogus"');
    expect(result.current.rows).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('drops a stale response when a newer query started', async () => {
    let resolveFirst;
    const firstPromise = new Promise((res) => { resolveFirst = res; });
    client.post
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce({ data: { spec: { entity: 'orders' }, rows: [{ id: 'new' }], matchedCount: 1, truncated: false } });

    const { result } = renderHook(() => useExplorerQuery());
    await waitFor(() => expect(result.current.schemaLoading).toBe(false));

    await act(async () => {
      const p1 = result.current.run({ entity: 'customers' }); // slow, will be superseded
      const p2 = result.current.run({ entity: 'orders' });    // resolves first
      await p2;
      resolveFirst({ data: { spec: { entity: 'customers' }, rows: [{ id: 'stale' }], matchedCount: 99, truncated: false } });
      await p1;
    });

    // The newer query (orders) wins; the stale customers response is ignored.
    expect(result.current.rows).toEqual([{ id: 'new' }]);
    expect(result.current.matchedCount).toBe(1);
  });
});
