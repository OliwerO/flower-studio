import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAvailableSlots, getCourierSlots } from '../utils/timeSlots.js';

describe('getCourierSlots — 1h courier slots within a client window', () => {
  it('splits a 2h window into two 1h slots', () => {
    expect(getCourierSlots('10:00-12:00')).toEqual(['10:00-11:00', '11:00-12:00']);
  });

  it('splits an all-day-style 08:00-20:00 client window into 1h slots', () => {
    expect(getCourierSlots('08:00-20:00')).toEqual([
      '08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00',
      '12:00-13:00', '13:00-14:00', '14:00-15:00', '15:00-16:00',
      '16:00-17:00', '17:00-18:00', '18:00-19:00', '19:00-20:00',
    ]);
  });

  it('returns the window itself when it is already 1h', () => {
    expect(getCourierSlots('14:00-15:00')).toEqual(['14:00-15:00']);
  });

  it('includes a trailing partial slot so no time in the window is unreachable', () => {
    expect(getCourierSlots('10:00-12:30')).toEqual(['10:00-11:00', '11:00-12:00', '12:00-12:30']);
  });

  it('handles half-hour-aligned windows', () => {
    expect(getCourierSlots('10:30-12:30')).toEqual(['10:30-11:30', '11:30-12:30']);
  });

  it('every returned slot lies within the source window', () => {
    const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
    const window = '09:00-18:00';
    const [ws, we] = window.split('-').map(toMin);
    for (const slot of getCourierSlots(window)) {
      const [s, e] = slot.split('-').map(toMin);
      expect(s).toBeGreaterThanOrEqual(ws);
      expect(e).toBeLessThanOrEqual(we);
      expect(e).toBeGreaterThan(s);
    }
  });

  it('tolerates surrounding whitespace around the dash', () => {
    expect(getCourierSlots('10:00 - 12:00')).toEqual(['10:00-11:00', '11:00-12:00']);
  });

  it.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['no dash', '10:00'],
    ['garbage', 'not-a-window'],
    ['end before start', '12:00-10:00'],
    ['zero-length window', '10:00-10:00'],
  ])('returns [] for invalid input: %s', (_label, input) => {
    expect(getCourierSlots(input)).toEqual([]);
  });
});

describe('getAvailableSlots — lead-time availability', () => {
  afterEach(() => vi.useRealTimers());

  it('returns [] for empty input', () => {
    expect(getAvailableSlots([], '2026-07-03')).toEqual([]);
    expect(getAvailableSlots(null, '2026-07-03')).toEqual([]);
  });

  it('marks all slots available and sorted on a future date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T09:00:00'));
    const res = getAvailableSlots(['14:00-16:00', '10:00-12:00'], '2026-07-03');
    expect(res).toEqual([
      { slot: '10:00-12:00', available: true },
      { slot: '14:00-16:00', available: true },
    ]);
  });

  it('disables slots whose start is within the lead-time buffer today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T11:00:00'));
    const res = getAvailableSlots(['10:00-12:00', '14:00-16:00'], '2026-07-03', 30);
    expect(res.find(s => s.slot === '10:00-12:00').available).toBe(false);
    expect(res.find(s => s.slot === '14:00-16:00').available).toBe(true);
  });
});
