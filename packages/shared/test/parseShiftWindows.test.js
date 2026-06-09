import { describe, it, expect } from 'vitest';
import { parseShiftWindows, formatShiftWindows, shiftWindowsLabel } from '../utils/parseShiftWindows.js';

describe('parseShiftWindows', () => {
  it('returns empty for null / blank input', () => {
    expect(parseShiftWindows(null)).toEqual({ windows: [], note: '' });
    expect(parseShiftWindows('')).toEqual({ windows: [], note: '' });
    expect(parseShiftWindows('   ')).toEqual({ windows: [], note: '' });
  });

  it('parses a single window', () => {
    expect(parseShiftWindows('10:30-15:30')).toEqual({
      windows: [{ from: '10:30', to: '15:30' }],
      note: '',
    });
  });

  it('parses a split shift (multiple windows)', () => {
    expect(parseShiftWindows('10:30-15:30, 16:30-18:30')).toEqual({
      windows: [
        { from: '10:30', to: '15:30' },
        { from: '16:30', to: '18:30' },
      ],
      note: '',
    });
  });

  it('separates windows from a trailing free-form note', () => {
    expect(parseShiftWindows('10:30-15:30, 16:30-18:30 | covered for Anya')).toEqual({
      windows: [
        { from: '10:30', to: '15:30' },
        { from: '16:30', to: '18:30' },
      ],
      note: 'covered for Anya',
    });
  });

  it('keeps a note that itself contains a pipe', () => {
    expect(parseShiftWindows('09:00-17:00 | wedding | overtime')).toEqual({
      windows: [{ from: '09:00', to: '17:00' }],
      note: 'wedding | overtime',
    });
  });

  it('treats a note with no leading windows as pure note', () => {
    expect(parseShiftWindows('Sick day, half pay')).toEqual({
      windows: [],
      note: 'Sick day, half pay',
    });
  });

  it('does not partially parse a mixed first segment', () => {
    // If the leading segment is not entirely valid windows, treat the whole string as a note.
    expect(parseShiftWindows('10:30-15:30, lunch break')).toEqual({
      windows: [],
      note: '10:30-15:30, lunch break',
    });
  });

  it('tolerates whitespace around the dash', () => {
    expect(parseShiftWindows('9:00 - 17:00')).toEqual({
      windows: [{ from: '9:00', to: '17:00' }],
      note: '',
    });
  });
});

describe('formatShiftWindows', () => {
  it('joins windows with an en-dash and comma', () => {
    expect(formatShiftWindows([{ from: '10:30', to: '15:30' }, { from: '16:30', to: '18:30' }]))
      .toBe('10:30–15:30, 16:30–18:30');
  });

  it('returns empty string for no windows', () => {
    expect(formatShiftWindows([])).toBe('');
    expect(formatShiftWindows(undefined)).toBe('');
  });
});

describe('shiftWindowsLabel', () => {
  it('turns a notes string straight into a display label', () => {
    expect(shiftWindowsLabel('10:30-15:30, 16:30-18:30 | note')).toBe('10:30–15:30, 16:30–18:30');
  });

  it('returns empty when there are no windows', () => {
    expect(shiftWindowsLabel('Sick day')).toBe('');
    expect(shiftWindowsLabel('')).toBe('');
  });
});
