import { describe, it, expect } from 'vitest';
import { windowTrace, TRACE_WINDOWS, DEFAULT_TRACE_WINDOW } from '../utils/traceWindow.js';

// Anchor is the LATEST dated event, not "today". These events span 2026-06-01
// (oldest) → 2026-07-05 (newest), a 34-day range.
const events = [
  { date: '2026-06-01', qty: 10, type: 'purchase' }, // oldest
  { date: '2026-06-15', qty: -3, type: 'order' },
  { date: '2026-06-28', qty: -2, type: 'order' },
  { date: '2026-07-05', qty: -1, type: 'order' },    // newest (anchor)
];

describe('windowTrace', () => {
  it('exposes the selectable windows and a default', () => {
    expect(TRACE_WINDOWS.map((w) => w.key)).toEqual(['2w', '1m', 'all']);
    expect(DEFAULT_TRACE_WINDOW).toBe('2w');
  });

  it('"all" returns every event untouched with no folding', () => {
    const r = windowTrace(events, 'all', { baseOpening: 4 });
    expect(r.events).toHaveLength(4);
    expect(r.opening).toBe(4);
    expect(r.hiddenCount).toBe(0);
  });

  it('2-week window keeps only events within 14 days of the newest', () => {
    // Anchor 2026-07-05 → cutoff 2026-06-21. Keeps 06-28 and 07-05.
    const r = windowTrace(events, '2w');
    expect(r.events.map((e) => e.date)).toEqual(['2026-06-28', '2026-07-05']);
    expect(r.hiddenCount).toBe(2);
  });

  it('folds older events into the opening balance so the running total stays correct', () => {
    // Folded: +10 (06-01) and -3 (06-15) = +7, plus baseOpening 0 = 7.
    const r = windowTrace(events, '2w');
    expect(r.opening).toBe(7);
  });

  it('adds folded qty on top of the API-supplied opening balance', () => {
    const r = windowTrace(events, '2w', { baseOpening: 5 });
    expect(r.opening).toBe(12); // 5 base + 7 folded
  });

  it('1-month window uses a 30-day cutoff', () => {
    // Anchor 2026-07-05 → cutoff 2026-06-05. Folds only 06-01 (+10).
    const r = windowTrace(events, '1m');
    expect(r.events.map((e) => e.date)).toEqual(['2026-06-15', '2026-06-28', '2026-07-05']);
    expect(r.opening).toBe(10);
    expect(r.hiddenCount).toBe(1);
  });

  it('always keeps the anchor (newest) event even in the tightest window', () => {
    const r = windowTrace(events, '2w');
    expect(r.events.at(-1).date).toBe('2026-07-05');
  });

  it('keeps undated events regardless of window and never folds them', () => {
    const withUndated = [...events, { qty: 5, type: 'premade' }];
    const r = windowTrace(withUndated, '2w');
    expect(r.events.some((e) => !e.date)).toBe(true);
    // undated qty (5) must NOT leak into the folded opening (still 7).
    expect(r.opening).toBe(7);
  });

  it('reads either qty or quantity for the folded sum', () => {
    const alt = [
      { date: '2026-06-01', quantity: 8, type: 'purchase' },
      { date: '2026-07-05', quantity: -1, type: 'order' },
    ];
    const r = windowTrace(alt, '2w');
    expect(r.opening).toBe(8);
  });

  it('handles empty / undated-only input without throwing', () => {
    expect(windowTrace([], '2w')).toEqual({ events: [], opening: 0, hiddenCount: 0, windowKey: '2w' });
    const undatedOnly = [{ qty: 3, type: 'premade' }];
    const r = windowTrace(undatedOnly, '2w');
    expect(r.events).toHaveLength(1);
    expect(r.hiddenCount).toBe(0);
  });

  it('falls back to the default window on an unknown key', () => {
    const r = windowTrace(events, 'bogus');
    expect(r.windowKey).toBe('2w');
  });
});
