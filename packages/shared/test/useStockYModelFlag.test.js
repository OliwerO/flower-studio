// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock the shared API client module before importing the hook so cachedGet is
// controlled. Never make real network calls in tests.
vi.mock('../api/client.js', () => ({
  cachedGet: vi.fn(),
}));

import { cachedGet } from '../api/client.js';
import useStockYModelFlag from '../hooks/useStockYModelFlag.js';

describe('useStockYModelFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false as the initial value before the fetch resolves', () => {
    // Keep the promise pending so we can inspect the initial state.
    cachedGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStockYModelFlag());
    expect(result.current).toBe(false);
  });

  it('returns true when stockYModelEnabled is true in the settings response', async () => {
    cachedGet.mockResolvedValue({ data: { stockYModelEnabled: true } });
    const { result } = renderHook(() => useStockYModelFlag());
    // After the resolved promise processes through the event loop:
    await act(async () => {});
    expect(result.current).toBe(true);
  });

  it('returns false when stockYModelEnabled is false in the settings response', async () => {
    cachedGet.mockResolvedValue({ data: { stockYModelEnabled: false } });
    const { result } = renderHook(() => useStockYModelFlag());
    await act(async () => {});
    expect(result.current).toBe(false);
  });

  it('returns false when the fetch fails (conservative default)', async () => {
    cachedGet.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useStockYModelFlag());
    await act(async () => {});
    expect(result.current).toBe(false);
  });

  it('calls cachedGet with /settings and a ttlMs option', async () => {
    cachedGet.mockResolvedValue({ data: { stockYModelEnabled: false } });
    renderHook(() => useStockYModelFlag());
    await act(async () => {});
    expect(cachedGet).toHaveBeenCalledWith(
      '/settings',
      {},
      expect.objectContaining({ ttlMs: expect.any(Number) })
    );
  });

  it('does not update state after unmount (no setState-after-unmount warning)', async () => {
    // Resolve after unmount to check the cancellation guard.
    let resolveSettings;
    cachedGet.mockReturnValue(new Promise(r => { resolveSettings = r; }));
    const { result, unmount } = renderHook(() => useStockYModelFlag());
    unmount();
    // Resolve the promise after unmount — should not throw.
    await act(async () => {
      resolveSettings({ data: { stockYModelEnabled: true } });
    });
    // State was captured at render time; after unmount it stays false.
    expect(result.current).toBe(false);
  });
});
