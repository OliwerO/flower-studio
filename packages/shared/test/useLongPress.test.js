import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLongPressHandlers } from '../hooks/useLongPress.js';

// We test the pure state-machine factory (no React). The React hook thin-wraps
// it with useRef for lifecycle management — React semantics aren't worth
// bringing jsdom + @testing-library in just for this.

describe('createLongPressHandlers', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires onLongPress after delay when press is sustained', () => {
    const fn = vi.fn();
    const handlers = createLongPressHandlers(fn, { delay: 500 });
    handlers.onTouchStart({ touches: [{ clientX: 0, clientY: 0 }] });
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not fire if press is released before delay', () => {
    const fn = vi.fn();
    const handlers = createLongPressHandlers(fn, { delay: 500 });
    handlers.onTouchStart({ touches: [{ clientX: 0, clientY: 0 }] });
    vi.advanceTimersByTime(300);
    handlers.onTouchEnd({});
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancels when finger moves beyond tolerance', () => {
    const fn = vi.fn();
    const handlers = createLongPressHandlers(fn, { delay: 500, moveTolerance: 10 });
    handlers.onTouchStart({ touches: [{ clientX: 0, clientY: 0 }] });
    handlers.onTouchMove({ touches: [{ clientX: 20, clientY: 0 }] });
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not cancel when finger moves within tolerance', () => {
    const fn = vi.fn();
    const handlers = createLongPressHandlers(fn, { delay: 500, moveTolerance: 10 });
    handlers.onTouchStart({ touches: [{ clientX: 0, clientY: 0 }] });
    handlers.onTouchMove({ touches: [{ clientX: 5, clientY: 5 }] });
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('works for mouse events too', () => {
    const fn = vi.fn();
    const handlers = createLongPressHandlers(fn, { delay: 500 });
    handlers.onMouseDown({ clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses default delay of 500 ms when not specified', () => {
    const fn = vi.fn();
    const handlers = createLongPressHandlers(fn);
    handlers.onTouchStart({ touches: [{ clientX: 0, clientY: 0 }] });
    vi.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('dispose() clears pending timer', () => {
    const fn = vi.fn();
    const handlers = createLongPressHandlers(fn, { delay: 500 });
    handlers.onTouchStart({ touches: [{ clientX: 0, clientY: 0 }] });
    handlers.dispose();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });
});
