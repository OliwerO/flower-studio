import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebounceScheduler } from '../hooks/useDebouncedValue.js';

// We test the pure scheduler (no React). The React hook thin-wraps it with
// useState + useEffect — React semantics aren't worth bringing jsdom +
// @testing-library in just for this. Same pattern as useLongPress.

describe('createDebounceScheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('emits the scheduled value after the delay', () => {
    const scheduler = createDebounceScheduler(300);
    const emit = vi.fn();
    scheduler.schedule('hello', emit);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(emit).toHaveBeenCalledWith('hello');
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('does not emit before the delay elapses', () => {
    const scheduler = createDebounceScheduler(300);
    const emit = vi.fn();
    scheduler.schedule('x', emit);
    vi.advanceTimersByTime(299);
    expect(emit).not.toHaveBeenCalled();
  });

  it('collapses rapid schedules into a single emission with the last value', () => {
    const scheduler = createDebounceScheduler(300);
    const emit = vi.fn();
    scheduler.schedule('r', emit);
    vi.advanceTimersByTime(100);
    scheduler.schedule('re', emit);
    vi.advanceTimersByTime(100);
    scheduler.schedule('ros', emit);
    vi.advanceTimersByTime(100);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('ros');
  });

  it('cancel() prevents a scheduled emission', () => {
    const scheduler = createDebounceScheduler(300);
    const emit = vi.fn();
    scheduler.schedule('boom', emit);
    scheduler.cancel();
    vi.advanceTimersByTime(1000);
    expect(emit).not.toHaveBeenCalled();
  });

  it('cancel() is a no-op when no timer is pending', () => {
    const scheduler = createDebounceScheduler(300);
    expect(() => scheduler.cancel()).not.toThrow();
  });

  it('respects a custom delay', () => {
    const scheduler = createDebounceScheduler(50);
    const emit = vi.fn();
    scheduler.schedule('q', emit);
    vi.advanceTimersByTime(50);
    expect(emit).toHaveBeenCalledWith('q');
  });
});
