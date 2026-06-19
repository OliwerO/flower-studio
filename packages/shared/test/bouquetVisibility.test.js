import { describe, it, expect } from 'vitest';
import { shouldShowBouquetSection } from '../utils/bouquetVisibility.js';

describe('shouldShowBouquetSection', () => {
  it('shows when the order has lines (any status / role)', () => {
    expect(shouldShowBouquetSection({ hasLines: true, isTerminal: true, isOwner: false })).toBe(true);
    expect(shouldShowBouquetSection({ hasLines: true, isTerminal: false, isOwner: false })).toBe(true);
  });

  // The regression case: an emptied, still-editable order MUST keep its section
  // (and thus its "Edit bouquet" entry point) so flowers can be added back.
  it('shows an empty order while it is still editable (non-terminal)', () => {
    expect(shouldShowBouquetSection({ hasLines: false, isTerminal: false, isOwner: false })).toBe(true);
  });

  it('shows an empty terminal order to the owner', () => {
    expect(shouldShowBouquetSection({ hasLines: false, isTerminal: true, isOwner: true })).toBe(true);
  });

  it('hides only an empty, terminal, non-owner order (nothing to show, cannot edit)', () => {
    expect(shouldShowBouquetSection({ hasLines: false, isTerminal: true, isOwner: false })).toBe(false);
  });

  it('treats missing falsy inputs as not-present (empty non-terminal → show)', () => {
    expect(shouldShowBouquetSection({})).toBe(true); // isTerminal undefined → !undefined === true
    expect(shouldShowBouquetSection()).toBe(true);
  });
});
