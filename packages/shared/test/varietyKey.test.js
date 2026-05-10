import { describe, it, expect } from 'vitest';
import { varietyKey, groupByVariety, varietyDisplayName } from '../utils/varietyKey.js';

describe('varietyKey', () => {
  it('serializes the 4-tuple deterministically', () => {
    expect(varietyKey({ type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null }))
      .toBe('Rose|Pink|60|');
  });
  it('preserves NULL distinct from empty (ADR-0006 strict identity)', () => {
    const a = varietyKey({ type_name: 'Eucalyptus', colour: null, size_cm: null, cultivar: null });
    const b = varietyKey({ type_name: 'Eucalyptus', colour: 'Green', size_cm: null, cultivar: null });
    expect(a).not.toBe(b);
  });
  it('treats empty string as NULL (defensive)', () => {
    const a = varietyKey({ type_name: 'Rose', colour: '', size_cm: null, cultivar: null });
    const b = varietyKey({ type_name: 'Rose', colour: null, size_cm: null, cultivar: null });
    expect(a).toBe(b);
  });
});

describe('groupByVariety', () => {
  it('groups stock rows by 4-tuple', () => {
    const rows = [
      { id: '1', type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null, current_quantity: 10, date: '2026-05-10' },
      { id: '2', type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null, current_quantity: -3, date: '2026-05-12' },
      { id: '3', type_name: 'Rose', colour: 'Red', size_cm: 60, cultivar: null, current_quantity: 5, date: '2026-05-10' },
    ];
    const groups = groupByVariety(rows);
    expect(groups.size).toBe(2);
    expect(groups.get('Rose|Pink|60|').rows).toHaveLength(2);
  });
});

describe('varietyDisplayName', () => {
  it('renders full form with cultivar', () => {
    expect(varietyDisplayName({ type_name: 'Rose', colour: 'White', size_cm: 70, cultivar: "O'Hara" }))
      .toBe("Rose White 70cm O'Hara");
  });
  it('omits cultivar when NULL (ADR-0006 visibility rule)', () => {
    expect(varietyDisplayName({ type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null }))
      .toBe('Rose Pink 60cm');
  });
  it('omits empty colour/size cleanly', () => {
    expect(varietyDisplayName({ type_name: 'Eucalyptus', colour: null, size_cm: null, cultivar: null }))
      .toBe('Eucalyptus');
  });
});
