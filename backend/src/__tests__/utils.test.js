import { describe, it, expect } from 'vitest';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { pickAllowed } from '../utils/fields.js';
import { safeEqual } from '../utils/auth.js';

// ── sanitizeFormulaValue ──

describe('sanitizeFormulaValue', () => {
  it('returns empty string for non-string input', () => {
    expect(sanitizeFormulaValue(null)).toBe('');
    expect(sanitizeFormulaValue(undefined)).toBe('');
    expect(sanitizeFormulaValue(123)).toBe('');
  });

  it('passes through safe strings unchanged', () => {
    expect(sanitizeFormulaValue('hello')).toBe('hello');
    expect(sanitizeFormulaValue('2026-03-21')).toBe('2026-03-21');
    expect(sanitizeFormulaValue('Anna Kowalska')).toBe('Anna Kowalska');
  });

  it('strips single quotes (formula injection)', () => {
    expect(sanitizeFormulaValue("test', BLANK()) //")).toBe('test BLANK //');
  });

  it('strips backslashes', () => {
    expect(sanitizeFormulaValue('path\\to\\file')).toBe('pathtofile');
  });

  it('strips parentheses and commas', () => {
    expect(sanitizeFormulaValue('OR(1,2)')).toBe('OR12');
  });

  it('strips curly braces (field reference injection)', () => {
    expect(sanitizeFormulaValue('{Status}')).toBe('Status');
  });
});

// ── pickAllowed ──

describe('pickAllowed', () => {
  const ALLOWED = ['Name', 'Phone', 'Email'];

  it('picks only allowed fields', () => {
    const body = { Name: 'Anna', Phone: '123', Hack: 'malicious' };
    expect(pickAllowed(body, ALLOWED)).toEqual({ Name: 'Anna', Phone: '123' });
  });

  it('returns empty object when no fields match', () => {
    expect(pickAllowed({ Hack: 'x' }, ALLOWED)).toEqual({});
  });

  it('preserves falsy values (empty string, 0, null)', () => {
    const body = { Name: '', Phone: 0, Email: null };
    expect(pickAllowed(body, ALLOWED)).toEqual({ Name: '', Phone: 0, Email: null });
  });

  it('returns empty object for empty body', () => {
    expect(pickAllowed({}, ALLOWED)).toEqual({});
  });
});

// ── safeEqual ──

describe('safeEqual', () => {
  it('returns true for equal strings', () => {
    expect(safeEqual('1234', '1234')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(safeEqual('1234', '5678')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(safeEqual('123', '1234')).toBe(false);
  });

  it('returns false for non-string inputs', () => {
    expect(safeEqual(null, '1234')).toBe(false);
    expect(safeEqual('1234', undefined)).toBe(false);
    expect(safeEqual(123, 123)).toBe(false);
  });
});
