import { describe, it, expect } from 'vitest';
import { _internals } from '../services/telegram.js';

const { parseSlot, punctualityLabel, formatMinDiff, krakowMinutes } = _internals;

describe('parseSlot', () => {
  it('parses HH:MM-HH:MM with a regular hyphen', () => {
    expect(parseSlot('14:00-16:00')).toEqual({ start: 14 * 60, end: 16 * 60 });
  });

  it('parses HH:MM–HH:MM with an en-dash', () => {
    expect(parseSlot('09:30–11:00')).toEqual({ start: 9 * 60 + 30, end: 11 * 60 });
  });

  it('trims whitespace around the times', () => {
    expect(parseSlot(' 08:00 - 10:00 ')).toEqual({ start: 8 * 60, end: 10 * 60 });
  });

  it('returns null for empty / unparseable input', () => {
    expect(parseSlot('')).toBeNull();
    expect(parseSlot(null)).toBeNull();
    expect(parseSlot('anytime')).toBeNull();
    expect(parseSlot('14:00')).toBeNull();       // missing end
    expect(parseSlot('14:xx-16:00')).toBeNull(); // garbage start
  });
});

describe('formatMinDiff', () => {
  it('stays in minutes under 60', () => {
    expect(formatMinDiff(5)).toBe('5m');
    expect(formatMinDiff(59)).toBe('59m');
  });

  it('rolls up to hours on the hour', () => {
    expect(formatMinDiff(60)).toBe('1h');
    expect(formatMinDiff(120)).toBe('2h');
  });

  it('shows hours + minutes when both are non-zero', () => {
    expect(formatMinDiff(75)).toBe('1h 15m');
    expect(formatMinDiff(185)).toBe('3h 5m');
  });
});

describe('krakowMinutes', () => {
  it('converts a UTC ISO timestamp to Europe/Warsaw minutes-since-midnight', () => {
    // 2026-07-15 (summer, CEST, UTC+2): 13:00 UTC → 15:00 Warsaw
    expect(krakowMinutes('2026-07-15T13:00:00.000Z')).toBe(15 * 60);
  });

  it('respects the winter offset (CET, UTC+1)', () => {
    // 2026-01-15: 13:00 UTC → 14:00 Warsaw
    expect(krakowMinutes('2026-01-15T13:00:00.000Z')).toBe(14 * 60);
  });

  it('returns null for invalid input', () => {
    expect(krakowMinutes('not-a-date')).toBeNull();
    expect(krakowMinutes(null)).toBeNull();
  });
});

describe('punctualityLabel', () => {
  // All tests use summer (CEST = UTC+2) so 13:00 UTC = 15:00 Warsaw
  const SLOT_14_16 = '14:00-16:00';

  it('reports on-time when delivery falls inside the slot', () => {
    // 13:30 UTC → 15:30 Warsaw — inside 14:00-16:00
    expect(punctualityLabel(SLOT_14_16, '2026-07-15T13:30:00.000Z')).toBe('✅ on time');
  });

  it('reports on-time at the slot start boundary', () => {
    // 12:00 UTC → 14:00 Warsaw — at the start
    expect(punctualityLabel(SLOT_14_16, '2026-07-15T12:00:00.000Z')).toBe('✅ on time');
  });

  it('reports on-time at the slot end boundary', () => {
    // 14:00 UTC → 16:00 Warsaw — at the end
    expect(punctualityLabel(SLOT_14_16, '2026-07-15T14:00:00.000Z')).toBe('✅ on time');
  });

  it('reports late when delivered after the slot ends', () => {
    // 14:42 UTC → 16:42 Warsaw — 42m past end
    expect(punctualityLabel(SLOT_14_16, '2026-07-15T14:42:00.000Z')).toBe('⚠ late by 42m');
  });

  it('reports early when delivered before the slot starts', () => {
    // 11:45 UTC → 13:45 Warsaw — 15m before start
    expect(punctualityLabel(SLOT_14_16, '2026-07-15T11:45:00.000Z')).toBe('⚡ early by 15m');
  });

  it('formats hour-plus late with hours and minutes', () => {
    // 15:30 UTC → 17:30 Warsaw — 1h 30m past 16:00 end
    expect(punctualityLabel(SLOT_14_16, '2026-07-15T15:30:00.000Z')).toBe('⚠ late by 1h 30m');
  });

  it('returns null when the slot is missing or unparseable', () => {
    expect(punctualityLabel('', '2026-07-15T13:30:00.000Z')).toBeNull();
    expect(punctualityLabel('whenever', '2026-07-15T13:30:00.000Z')).toBeNull();
  });

  it('returns null when the delivery timestamp is missing', () => {
    expect(punctualityLabel(SLOT_14_16, null)).toBeNull();
    expect(punctualityLabel(SLOT_14_16, '')).toBeNull();
  });
});
