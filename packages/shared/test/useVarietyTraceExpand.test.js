// @vitest-environment jsdom
// packages/shared/test/useVarietyTraceExpand.test.js
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useVarietyTraceExpand } from '../hooks/useVarietyTraceExpand.js';

const payload = { events: [{ type: 'order', qty: -5, orderId: '#1' }], unaccountedStems: 0 };

describe('useVarietyTraceExpand', () => {
  it('opens a row, lazy-fetches once, caches by variety key, and closes on re-toggle', async () => {
    const fetchVarietyUsage = vi.fn().mockResolvedValue(payload);
    const { result } = renderHook(() => useVarietyTraceExpand(fetchVarietyUsage));

    expect(result.current.openId).toBe(null);
    expect(result.current.getTrace('K').loaded).toBe(false);

    // open row "K@2026-06-22" for variety key "K"
    act(() => result.current.toggle('K@2026-06-22', 'K'));
    expect(result.current.isOpen('K@2026-06-22')).toBe(true);
    expect(result.current.getTrace('K').loading).toBe(true);

    await waitFor(() => expect(result.current.getTrace('K').loaded).toBe(true));
    expect(result.current.getTrace('K').events).toHaveLength(1);
    expect(fetchVarietyUsage).toHaveBeenCalledTimes(1);

    // open a SECOND row of the SAME variety key — no refetch (cache hit)
    act(() => result.current.toggle('K@2026-06-25', 'K'));
    expect(result.current.isOpen('K@2026-06-25')).toBe(true);
    expect(fetchVarietyUsage).toHaveBeenCalledTimes(1);

    // re-toggle the open row → closes
    act(() => result.current.toggle('K@2026-06-25', 'K'));
    expect(result.current.openId).toBe(null);
  });

  it('on fetch error leaves a loaded-but-empty trace (graceful, no throw)', async () => {
    const fetchVarietyUsage = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useVarietyTraceExpand(fetchVarietyUsage));
    act(() => result.current.toggle('K@d', 'K'));
    await waitFor(() => expect(result.current.getTrace('K').loaded).toBe(true));
    expect(result.current.getTrace('K').events).toEqual([]);
    expect(result.current.getTrace('K').loading).toBe(false);
  });
});
