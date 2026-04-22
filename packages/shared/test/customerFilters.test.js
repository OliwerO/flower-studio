import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  matchesSearch,
  matchesFilters,
  EMPTY_FILTERS,
  serializeFilters,
  deserializeFilters,
  activeFilterCount,
} from '../utils/customerFilters.js';

// Fixtures — a small cast of customer records covering the main shapes the
// filter logic has to handle. Shared across suites so tests read like small
// scenarios against a known population.
const alice = {
  id: 'c1',
  Name: 'Alice Smith',
  Nickname: 'alicesmith_inst',
  Phone: '+48 123 456',
  Email: 'alice@example.com',
  Link: 'https://instagram.com/alicesmith_inst',
  Segment: 'Constant',
  Language: 'RUS',
  'Communication method': 'Instagram',
  _agg: { lastOrderDate: '2026-04-15', orderCount: 5, totalSpend: 1500 },
};

const bob = {
  id: 'c2',
  Name: 'Bob Jones',
  Segment: 'Rare',
  Language: 'PL',
  _agg: { lastOrderDate: '2023-01-01', orderCount: 2, totalSpend: 200 },
};

const carol = {
  id: 'c3',
  Name: 'Carol White',
  Segment: 'DO NOT CONTACT',
  _agg: { lastOrderDate: null, orderCount: 0, totalSpend: 0 },
};

const dmitri = {
  id: 'c4',
  Name: 'Dmitri Ivanov',
  'Key person 1': 'Daria Petrova',
  _agg: { lastOrderDate: '2026-04-20', orderCount: 1, totalSpend: 100 },
};

describe('matchesSearch', () => {
  it('returns true for empty or null query', () => {
    expect(matchesSearch(alice, '')).toBe(true);
    expect(matchesSearch(alice, null)).toBe(true);
    expect(matchesSearch(alice, '   ')).toBe(true);
  });

  it('matches substring on Name', () => {
    expect(matchesSearch(alice, 'alice')).toBe(true);
    expect(matchesSearch(alice, 'smith')).toBe(true);
  });

  it('matches substring on Nickname (Instagram handle)', () => {
    expect(matchesSearch(alice, 'alicesmith_inst')).toBe(true);
  });

  it('matches substring on Email', () => {
    expect(matchesSearch(alice, '@example.com')).toBe(true);
  });

  it('matches substring on Link', () => {
    expect(matchesSearch(alice, 'instagram.com')).toBe(true);
  });

  it('matches substring on Key person field (even nested person names)', () => {
    expect(matchesSearch(dmitri, 'petrova')).toBe(true);
    expect(matchesSearch(dmitri, 'daria')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesSearch(alice, 'ALICE')).toBe(true);
    expect(matchesSearch(alice, 'AlIcE')).toBe(true);
  });

  it('multi-word query is AND (every word must match at least one field)', () => {
    expect(matchesSearch(alice, 'alice smith')).toBe(true);
    // "bob" never appears in alice's fields, so the whole query fails
    expect(matchesSearch(alice, 'alice bob')).toBe(false);
  });

  it('matches ISO prefix of _agg.lastOrderDate', () => {
    expect(matchesSearch(alice, '2026-04')).toBe(true);
    expect(matchesSearch(bob, '2023-01')).toBe(true);
  });

  it('non-matching query returns false', () => {
    expect(matchesSearch(alice, 'nonexistent_string_xyz')).toBe(false);
  });

  it('handles customers with mostly null/undefined fields', () => {
    expect(matchesSearch(carol, 'carol')).toBe(true);
    expect(matchesSearch(carol, 'zzz')).toBe(false);
  });
});

describe('matchesFilters', () => {
  it('returns true for null filters (no constraints)', () => {
    expect(matchesFilters(alice, null)).toBe(true);
  });

  it('returns true for EMPTY_FILTERS (all dimensions empty)', () => {
    expect(matchesFilters(alice, EMPTY_FILTERS)).toBe(true);
    expect(matchesFilters(carol, EMPTY_FILTERS)).toBe(true);
  });

  it('segment multi-select matches when customer segment is in the set', () => {
    const f = { ...EMPTY_FILTERS, segments: new Set(['Constant']) };
    expect(matchesFilters(alice, f)).toBe(true);
    expect(matchesFilters(bob, f)).toBe(false);
  });

  it('empty multi-select Set is "no constraint" — both customers pass', () => {
    const f = { ...EMPTY_FILTERS, segments: new Set() };
    expect(matchesFilters(alice, f)).toBe(true);
    expect(matchesFilters(bob, f)).toBe(true);
  });

  it('multi-select AND across dimensions — all must match', () => {
    const both = {
      ...EMPTY_FILTERS,
      segments: new Set(['Constant']),
      languages: new Set(['RUS']),
    };
    expect(matchesFilters(alice, both)).toBe(true);
    // Alice is RUS, not PL — now excluded
    const mismatched = {
      ...EMPTY_FILTERS,
      segments: new Set(['Constant']),
      languages: new Set(['PL']),
    };
    expect(matchesFilters(alice, mismatched)).toBe(false);
  });

  it('hasPhone toggle — excludes customers without Phone', () => {
    const f = { ...EMPTY_FILTERS, hasPhone: true };
    expect(matchesFilters(alice, f)).toBe(true);
    expect(matchesFilters(carol, f)).toBe(false);
  });

  it('hasInstagram toggle — gates on Link field', () => {
    const f = { ...EMPTY_FILTERS, hasInstagram: true };
    expect(matchesFilters(alice, f)).toBe(true);
    expect(matchesFilters(bob, f)).toBe(false);
  });

  it('hasKeyPerson toggle — matches if either slot is filled', () => {
    const f = { ...EMPTY_FILTERS, hasKeyPerson: true };
    expect(matchesFilters(dmitri, f)).toBe(true);
    expect(matchesFilters(bob, f)).toBe(false);
  });

  it('minOrderCount gate', () => {
    const f = { ...EMPTY_FILTERS, minOrderCount: 3 };
    expect(matchesFilters(alice, f)).toBe(true); // 5 orders
    expect(matchesFilters(bob, f)).toBe(false); // 2 orders
  });

  it('minTotalSpend gate', () => {
    const f = { ...EMPTY_FILTERS, minTotalSpend: 1000 };
    expect(matchesFilters(alice, f)).toBe(true); // 1500 PLN
    expect(matchesFilters(bob, f)).toBe(false); // 200 PLN
  });

  it('doNotContactOnly shortcut', () => {
    const f = { ...EMPTY_FILTERS, doNotContactOnly: true };
    expect(matchesFilters(carol, f)).toBe(true);
    expect(matchesFilters(alice, f)).toBe(false);
  });

  it('lastOrderBefore — strict less-than against ISO date', () => {
    const f = { ...EMPTY_FILTERS, lastOrderBefore: '2024-01-01' };
    expect(matchesFilters(bob, f)).toBe(true); // 2023-01-01 < 2024-01-01
    expect(matchesFilters(alice, f)).toBe(false); // 2026-04-15 not before
    expect(matchesFilters(carol, f)).toBe(false); // no date
  });

  it('rfmSegment + rfmLabelByCustomer — only matches labeled customers', () => {
    const f = {
      ...EMPTY_FILTERS,
      rfmSegment: 'Champions',
      rfmLabelByCustomer: { c1: 'Champions', c2: 'Loyal' },
    };
    expect(matchesFilters(alice, f)).toBe(true); // c1 → Champions
    expect(matchesFilters(bob, f)).toBe(false); // c2 → Loyal
    expect(matchesFilters(dmitri, f)).toBe(false); // c4 unlabeled
  });

  describe('time-dependent predicates (fake timer)', () => {
    beforeEach(() => {
      // Fix "now" at 2026-04-22 so recency tests are deterministic — matches
      // the project's "today" at the time these tests were written.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-22T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('lastOrderWithinDays = 30 — recent orders pass, stale orders fail', () => {
      const f = { ...EMPTY_FILTERS, lastOrderWithinDays: 30 };
      expect(matchesFilters(alice, f)).toBe(true); // 2026-04-15 (7 days ago)
      expect(matchesFilters(bob, f)).toBe(false); // 2023-01-01
      expect(matchesFilters(carol, f)).toBe(false); // no date
    });

    it('churnRisk — 2+ orders AND last order >60 days ago', () => {
      const f = { ...EMPTY_FILTERS, churnRisk: true };
      expect(matchesFilters(bob, f)).toBe(true); // 2 orders, 3+ years old
      expect(matchesFilters(alice, f)).toBe(false); // 5 orders but 7 days ago
      expect(matchesFilters(carol, f)).toBe(false); // 0 orders
      expect(matchesFilters(dmitri, f)).toBe(false); // 1 order only
    });
  });
});

describe('serialize / deserialize round trip', () => {
  it('preserves Sets across serialize → deserialize', () => {
    const filters = {
      ...EMPTY_FILTERS,
      segments: new Set(['Constant', 'New']),
      languages: new Set(['RUS']),
      hasPhone: true,
      minOrderCount: 5,
    };
    const restored = deserializeFilters(serializeFilters(filters));
    expect(restored.segments).toEqual(new Set(['Constant', 'New']));
    expect(restored.languages).toEqual(new Set(['RUS']));
    expect(restored.hasPhone).toBe(true);
    expect(restored.minOrderCount).toBe(5);
  });

  it('deserialize with null input returns empty filters', () => {
    const r = deserializeFilters(null);
    expect(r.segments).toEqual(new Set());
    expect(r.hasPhone).toBe(false);
    expect(r.minOrderCount).toBeNull();
  });

  it('deserialize with invalid JSON returns empty filters', () => {
    const r = deserializeFilters('not valid JSON{');
    expect(r.segments).toEqual(new Set());
  });

  it('deserialize with wrong version number resets to empty — prevents stale localStorage shape', () => {
    const raw = JSON.stringify({ version: 99, segments: ['X'], hasPhone: true });
    const r = deserializeFilters(raw);
    expect(r.segments).toEqual(new Set());
    expect(r.hasPhone).toBe(false);
  });
});

describe('activeFilterCount', () => {
  it('returns 0 for EMPTY_FILTERS', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('each active dimension adds 1', () => {
    const one = { ...EMPTY_FILTERS, segments: new Set(['Constant']) };
    expect(activeFilterCount(one)).toBe(1);

    const three = {
      ...EMPTY_FILTERS,
      segments: new Set(['Constant']),
      hasPhone: true,
      minOrderCount: 5,
    };
    expect(activeFilterCount(three)).toBe(3);
  });

  it('empty Sets and null numeric filters do NOT count', () => {
    const f = {
      ...EMPTY_FILTERS,
      segments: new Set(), // empty
      minOrderCount: null, // null
      minTotalSpend: null,
    };
    expect(activeFilterCount(f)).toBe(0);
  });
});
