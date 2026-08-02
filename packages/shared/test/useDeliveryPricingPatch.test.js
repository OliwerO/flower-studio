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
});
