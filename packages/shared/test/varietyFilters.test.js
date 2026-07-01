import { describe, it, expect } from 'vitest';
import {
  EMPTY_VARIETY_FILTER,
  clearVarietyFilter,
  varietyMatchesFilter,
  activeVarietyFilterCount,
} from '../utils/varietyFilters.js';

// Variety group shape (as consumed by VarietyListItem): identity + rows.
function group({ type = 'Peony', colour = 'Pink', cultivar = null, size = 60, rows }) {
  return { key: `${type}|${colour}|${size}|${cultivar ?? ''}`, type_name: type, colour, cultivar, size_cm: size, rows };
}
// net = onHand − planned − reserved
const free = group({ type: 'Peony', colour: 'Pink', cultivar: 'Sarah Bernhardt', rows: [{ id: 'a', current_quantity: 20 }] });          // net +20 → free
const short = group({ type: 'Rose', colour: 'Red', rows: [{ id: 'b', current_quantity: 5 }, { id: 'c', current_quantity: -9 }] });        // net −4 → short
const tight = group({ type: 'Tulip', colour: 'White', rows: [{ id: 'd', current_quantity: 10 }, { id: 'e', current_quantity: -10 }] });   // net 0, planned>0 → tight
const noRes = new Map();

describe('varietyFilters — empty / clear', () => {
  it('EMPTY matches everything', () => {
    expect(activeVarietyFilterCount(EMPTY_VARIETY_FILTER)).toBe(0);
    expect(varietyMatchesFilter(free, noRes, EMPTY_VARIETY_FILTER)).toBe(true);
    expect(varietyMatchesFilter(short, noRes, null)).toBe(true);
  });
  it('clearVarietyFilter returns a fresh copy', () => {
    const f = clearVarietyFilter();
    expect(f).toEqual(EMPTY_VARIETY_FILTER);
    expect(f).not.toBe(EMPTY_VARIETY_FILTER);
  });
});

describe('varietyFilters — text', () => {
  it('typeQuery contains (case-insensitive)', () => {
    expect(varietyMatchesFilter(free, noRes, { ...EMPTY_VARIETY_FILTER, typeQuery: 'peo' })).toBe(true);
    expect(varietyMatchesFilter(free, noRes, { ...EMPTY_VARIETY_FILTER, typeQuery: 'rose' })).toBe(false);
  });
  it('varietyQuery matches colour / cultivar / size', () => {
    expect(varietyMatchesFilter(free, noRes, { ...EMPTY_VARIETY_FILTER, varietyQuery: 'sarah' })).toBe(true);
    expect(varietyMatchesFilter(free, noRes, { ...EMPTY_VARIETY_FILTER, varietyQuery: 'pink' })).toBe(true);
    expect(varietyMatchesFilter(free, noRes, { ...EMPTY_VARIETY_FILTER, varietyQuery: 'blue' })).toBe(false);
  });
});

describe('varietyFilters — status (short / tight / free)', () => {
  it('short = net < 0', () => {
    expect(varietyMatchesFilter(short, noRes, { ...EMPTY_VARIETY_FILTER, status: 'short' })).toBe(true);
    expect(varietyMatchesFilter(free, noRes, { ...EMPTY_VARIETY_FILTER, status: 'short' })).toBe(false);
  });
  it('tight = net 0 with demand', () => {
    expect(varietyMatchesFilter(tight, noRes, { ...EMPTY_VARIETY_FILTER, status: 'tight' })).toBe(true);
    expect(varietyMatchesFilter(free, noRes, { ...EMPTY_VARIETY_FILTER, status: 'tight' })).toBe(false);
  });
  it('free = net > 0 (or net 0 with no demand)', () => {
    expect(varietyMatchesFilter(free, noRes, { ...EMPTY_VARIETY_FILTER, status: 'free' })).toBe(true);
    expect(varietyMatchesFilter(short, noRes, { ...EMPTY_VARIETY_FILTER, status: 'free' })).toBe(false);
  });
});

describe('varietyFilters — net range', () => {
  it('netMin / netMax bound the net', () => {
    expect(varietyMatchesFilter(free, noRes, { ...EMPTY_VARIETY_FILTER, netMin: 10 })).toBe(true);   // net 20
    expect(varietyMatchesFilter(free, noRes, { ...EMPTY_VARIETY_FILTER, netMin: 25 })).toBe(false);
    expect(varietyMatchesFilter(short, noRes, { ...EMPTY_VARIETY_FILTER, netMax: 0 })).toBe(true);   // net −4
  });
});

describe('varietyFilters — activeVarietyFilterCount', () => {
  it('counts each dimension once (range pair = 1)', () => {
    const f = { ...EMPTY_VARIETY_FILTER, typeQuery: 'peony', varietyQuery: 'pink', status: 'short', netMin: 0, netMax: 50 };
    expect(activeVarietyFilterCount(f)).toBe(4);
  });
});
