import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useDeliveryPricingPatch from '../hooks/useDeliveryPricingPatch.js';

describe('useDeliveryPricingPatch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not call onCommit on mount, even though a stored value exists', () => {
    const onCommit = vi.fn();
    renderHook(() => useDeliveryPricingPatch({ fee: 50, cost: 35 }, onCommit));
    act(() => vi.advanceTimersByTime(1000));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('debounces edits and commits once, with the wire-shaped final value', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(
      ({ stored }) => useDeliveryPricingPatch(stored, onCommit),
      { initialProps: { stored: { fee: 50, cost: 35 } } },
    );

    act(() => result.current.onChange({ fee: 60 }));
    act(() => vi.advanceTimersByTime(300));
    act(() => result.current.onChange({ fee: 65 }));
    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).not.toHaveBeenCalled(); // still within the debounce window each time

    act(() => vi.advanceTimersByTime(800));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ 'Delivery Fee': 65 });
  });

  it('commits multiple changed fields together (a cost override clears distanceKm/band)', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDeliveryPricingPatch({ fee: 50, cost: 35, distanceKm: 4.2, band: { upToKm: 5, price: 35 } }, onCommit),
    );

    act(() => result.current.onChange({ cost: 45, distanceKm: null, band: null }));
    act(() => vi.advanceTimersByTime(800));

    expect(onCommit).toHaveBeenCalledWith({
      'Driver Payout': 45, 'Distance (km)': null, 'Distance Band': null,
    });
  });

  it('re-syncs the local buffer when the stored value changes externally, without committing', () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(
      ({ stored }) => useDeliveryPricingPatch(stored, onCommit),
      { initialProps: { stored: { fee: 50, cost: 35 } } },
    );

    rerender({ stored: { fee: 70, cost: 40 } });
    expect(result.current.value).toEqual({ fee: 70, cost: 40 });
    act(() => vi.advanceTimersByTime(1000));
    expect(onCommit).not.toHaveBeenCalled();
  });

  // Regression test for a Critical bug found in review: OrderDetailPanel
  // fetches `order` asynchronously, so storedValue starts all-null and only
  // becomes real once the fetch resolves. DeliveryPricingFields mounts for
  // the FIRST time on that same render (its isDelivery && o.delivery gate
  // just turned true) and seeds a one-time mount guard from `value` via a
  // useRef initializer. If this hook exposed the stale all-null value on
  // that exact render — which an effect-based resync necessarily does,
  // since effects run one render/commit AFTER the state change — the child
  // would seed wrong forever, fire a live re-quote, and silently PATCH a
  // fabricated cost/distance/band over the real stored value. This test
  // mimics the real sequence (mount with no stored value, then rerender
  // with the first real one) and asserts the corrected value is visible
  // synchronously, on the very render it first arrives.
  it('never exposes a stale value to a consumer reading it on the same render the stored value first arrives', () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(
      ({ stored }) => useDeliveryPricingPatch(stored, onCommit),
      { initialProps: { stored: { fee: null, cost: null, distanceKm: null, band: null } } },
    );

    expect(result.current.value).toEqual({ fee: null, cost: null });

    // Simulates the order finishing its async load — storedValue arrives
    // non-null for the first time.
    rerender({ stored: { fee: 50, cost: 42, distanceKm: 5, band: { upToKm: 5, price: 42 } } });

    // Must be correct on THIS exact render, synchronously — not one tick
    // later via an effect, since a child mounting on this same render (like
    // DeliveryPricingFields, which seeds a one-time ref from `value` on its
    // own first render) would otherwise capture stale null.
    expect(result.current.value).toEqual({ fee: 50, cost: 42 });
  });
});
