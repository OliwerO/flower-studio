// packages/shared/test/productPricing.test.js
import { describe, it, expect } from 'vitest';
import { suggestedMonoPrice } from '../utils/productPricing.js';

const stockMap = { s1: { 'Current Sell Price': 12 } };

describe('suggestedMonoPrice', () => {
  it('returns null for mix products', () => {
    expect(suggestedMonoPrice({ 'Min Stems': 5, 'Key Flower': ['s1'] }, stockMap, 'mix')).toBe(null);
  });
  it('returns null when min stems is 0 or missing', () => {
    expect(suggestedMonoPrice({ 'Key Flower': ['s1'] }, stockMap, 'mono')).toBe(null);
  });
  it('returns null when the key flower is not in stockMap', () => {
    expect(suggestedMonoPrice({ 'Min Stems': 5, 'Key Flower': ['nope'] }, stockMap, 'mono')).toBe(null);
  });
  it('computes minStems * sell price (array key flower)', () => {
    expect(suggestedMonoPrice({ 'Min Stems': 5, 'Key Flower': ['s1'] }, stockMap, 'mono')).toBe(60);
  });
  it('accepts a scalar key flower id', () => {
    expect(suggestedMonoPrice({ 'Min Stems': 3, 'Key Flower': 's1' }, stockMap, 'mono')).toBe(36);
  });
});
