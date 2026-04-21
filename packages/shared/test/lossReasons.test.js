import { describe, it, expect } from 'vitest';
import {
  LOSS_REASONS,
  REASON_KEYS,
  reasonLabel,
  REASON_COLORS,
  reasonBadgeClass,
} from '../utils/lossReasons.js';

describe('LOSS_REASONS', () => {
  it('contains all five canonical reasons', () => {
    expect(LOSS_REASONS).toEqual(['Wilted', 'Damaged', 'Arrived Broken', 'Overstock', 'Other']);
  });

  it('has a translation key for every reason', () => {
    for (const reason of LOSS_REASONS) {
      expect(REASON_KEYS[reason]).toBeDefined();
    }
  });

  it('has a color class for every reason', () => {
    for (const reason of LOSS_REASONS) {
      expect(REASON_COLORS[reason]).toBeDefined();
    }
  });
});

describe('reasonLabel', () => {
  it('returns translated label when key present in t', () => {
    const t = { reasonWilted: 'Завяли' };
    expect(reasonLabel(t, 'Wilted')).toBe('Завяли');
  });

  it('falls back to raw reason when translation missing', () => {
    expect(reasonLabel({}, 'Wilted')).toBe('Wilted');
  });

  it('falls back to raw reason for unknown reason', () => {
    expect(reasonLabel({}, 'Mystery')).toBe('Mystery');
  });
});

describe('reasonBadgeClass', () => {
  it('returns the color class for known reason', () => {
    expect(reasonBadgeClass('Wilted')).toContain('amber');
    expect(reasonBadgeClass('Damaged')).toContain('red');
    expect(reasonBadgeClass('Overstock')).toContain('blue');
  });

  it('falls back to Other for unknown reason', () => {
    expect(reasonBadgeClass('Unknown')).toBe(REASON_COLORS.Other);
  });
});
