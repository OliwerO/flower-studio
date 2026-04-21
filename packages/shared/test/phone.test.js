import { describe, it, expect } from 'vitest';
import { cleanPhone, telHref } from '../utils/phone.js';

describe('cleanPhone', () => {
  it('strips whitespace', () => {
    expect(cleanPhone('+48 123 456 789')).toBe('+48123456789');
  });

  it('returns empty string for falsy input', () => {
    expect(cleanPhone(null)).toBe('');
    expect(cleanPhone(undefined)).toBe('');
    expect(cleanPhone('')).toBe('');
  });

  it('coerces non-string input to string', () => {
    expect(cleanPhone(123456)).toBe('123456');
  });

  it('passes already-clean E.164 through unchanged', () => {
    expect(cleanPhone('+48123456789')).toBe('+48123456789');
  });
});

describe('telHref', () => {
  it('produces a tel: link from a formatted phone', () => {
    expect(telHref('+48 123 456 789')).toBe('tel:+48123456789');
  });

  it('returns null for empty input', () => {
    expect(telHref(null)).toBeNull();
    expect(telHref('')).toBeNull();
    expect(telHref(undefined)).toBeNull();
  });
});
