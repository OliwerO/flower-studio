import { describe, it, expect } from 'vitest';
import { formatDateDMY } from '../utils/formatDate.js';

describe('formatDateDMY', () => {
  it('formats an ISO date as DD.MM.YYYY', () => {
    expect(formatDateDMY('2026-05-07')).toBe('07.05.2026');
    expect(formatDateDMY('2026-12-31')).toBe('31.12.2026');
  });

  it('truncates an ISO timestamp to the date part', () => {
    expect(formatDateDMY('2026-05-07T10:00:00Z')).toBe('07.05.2026');
  });

  it('returns empty string for null/undefined/empty', () => {
    expect(formatDateDMY(null)).toBe('');
    expect(formatDateDMY(undefined)).toBe('');
    expect(formatDateDMY('')).toBe('');
  });

  it('returns the input unchanged when not a recognisable ISO date', () => {
    expect(formatDateDMY('14.May.')).toBe('14.May.');
    expect(formatDateDMY('not a date')).toBe('not a date');
  });
});
