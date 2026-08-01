// Unit tests for the Variety identity primitives (#562).
//
// These pin the two tolerances that stop duplicate flower cards (case and
// whitespace) without loosening the strict null-aware 4-tuple that ADR-0006
// defines — a blank Colour must never behave as a wildcard, or `Peony` would
// swallow `Peony / Pink`.

import { describe, it, expect } from 'vitest';
import {
  isDatedBatchName,
  normaliseIdentityValue,
  normaliseSize,
  sameVariety,
  pickCanonical,
} from '../utils/varietyIdentity.js';

describe('normaliseIdentityValue', () => {
  it('lowercases and trims', () => {
    expect(normaliseIdentityValue('  Sarah Bernhardt ')).toBe('sarah bernhardt');
  });

  it('treats null, undefined, empty and whitespace-only as the same absence', () => {
    for (const blank of [null, undefined, '', '   ']) {
      expect(normaliseIdentityValue(blank)).toBeNull();
    }
  });
});

describe('normaliseSize', () => {
  it('accepts numbers and numeric strings alike', () => {
    expect(normaliseSize(60)).toBe(60);
    expect(normaliseSize('60')).toBe(60);
  });

  it('maps blanks and non-numbers to null', () => {
    expect(normaliseSize('')).toBeNull();
    expect(normaliseSize(null)).toBeNull();
    expect(normaliseSize('tall')).toBeNull();
  });
});

describe('sameVariety', () => {
  const peonyPink60 = { Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null };

  it('matches across case and whitespace drift', () => {
    expect(sameVariety(peonyPink60, { Type: ' peony', Colour: 'PINK ', Size: '60', Cultivar: '' })).toBe(true);
  });

  it('a blank attribute is its own identity, not a wildcard', () => {
    expect(sameVariety(peonyPink60, { Type: 'Peony', Colour: null, Size: 60, Cultivar: null })).toBe(false);
    expect(sameVariety(
      { Type: 'Peony', Colour: null, Size: null, Cultivar: null },
      { Type: 'Peony', Colour: null, Size: null, Cultivar: null },
    )).toBe(true);
  });

  it('separates sizes and cultivars', () => {
    expect(sameVariety(peonyPink60, { ...peonyPink60, Size: 70 })).toBe(false);
    expect(sameVariety(peonyPink60, { ...peonyPink60, Cultivar: 'Sarah Bernhardt' })).toBe(false);
  });
});

describe('isDatedBatchName', () => {
  it('recognises the receive-path batch suffix', () => {
    expect(isDatedBatchName('Peony Pink (24.Jul.)')).toBe(true);
    expect(isDatedBatchName('Peony Pink (4.Jul)')).toBe(true);
  });

  it('leaves canonical names alone', () => {
    expect(isDatedBatchName('Peony Pink')).toBe(false);
    expect(isDatedBatchName('Peony (large)')).toBe(false);
    expect(isDatedBatchName('')).toBe(false);
  });
});

describe('pickCanonical', () => {
  // Order-based by contract: the caller supplies preference order, because the
  // wire row carries no creation timestamp to sort by. `findVarietyMatch` gets
  // that order from `ORDER BY created_at ASC` in SQL.
  it('ignores dated Batches and returns the first canonical card in the given order', () => {
    const rows = [
      { id: 'batch', 'Display Name': 'Peony Pink (24.Jul.)' },
      { id: 'older', 'Display Name': 'Peony Pink' },
      { id: 'newer', 'Display Name': 'Peony Pink' },
    ];
    expect(pickCanonical(rows).id).toBe('older');
  });

  it('returns null when only dated Batches carry the identity', () => {
    expect(pickCanonical([{ id: 'b', 'Display Name': 'Peony Pink (24.Jul.)' }])).toBeNull();
    expect(pickCanonical([])).toBeNull();
    expect(pickCanonical(undefined)).toBeNull();
  });
});
