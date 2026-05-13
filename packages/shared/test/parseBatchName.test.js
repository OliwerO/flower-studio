import { describe, it, expect } from 'vitest';
import parseBatchName from '../utils/parseBatchName.js';

describe('parseBatchName', () => {
  it('extracts short batch tag', () => {
    expect(parseBatchName('Rose Red (14.Mar.)')).toEqual({ name: 'Rose Red', batch: '14.Mar.' });
  });

  it('handles short tag without trailing period', () => {
    expect(parseBatchName('Tulip Yellow (3.Sep)')).toEqual({ name: 'Tulip Yellow', batch: '3.Sep' });
  });

  it('converts ISO date to short tag form', () => {
    expect(parseBatchName('Peony Pink 50cm (2026-05-13)')).toEqual({
      name: 'Peony Pink 50cm',
      batch: '13.May.',
    });
  });

  it('handles ISO single-digit day', () => {
    expect(parseBatchName('Lisianthus Lilac 60cm (2026-05-07)')).toEqual({
      name: 'Lisianthus Lilac 60cm',
      batch: '7.May.',
    });
  });

  it('returns null batch when no parenthesised date', () => {
    expect(parseBatchName('Rose Red')).toEqual({ name: 'Rose Red', batch: null });
  });

  it('handles empty + nullish inputs', () => {
    expect(parseBatchName('')).toEqual({ name: '', batch: null });
    expect(parseBatchName(null)).toEqual({ name: '', batch: null });
    expect(parseBatchName(undefined)).toEqual({ name: '', batch: null });
  });

  it('leaves malformed ISO date untouched (no false-positive parse)', () => {
    expect(parseBatchName('Rose Red (2026-13-99)')).toEqual({
      name: 'Rose Red',
      batch: '99.13.',
    });
  });
});
