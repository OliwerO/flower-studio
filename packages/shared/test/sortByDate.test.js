import { describe, it, expect } from 'vitest';
import { byDateAsc, byDateDesc } from '../utils/sortByDate.js';

describe('byDateAsc', () => {
  it('sorts dated rows earliest-first', () => {
    const rows = [
      { date: '2026-06-20' },
      { date: '2026-06-09' },
      { date: '2026-06-15' },
    ];
    const sorted = [...rows].sort(byDateAsc);
    expect(sorted.map((r) => r.date)).toEqual(['2026-06-09', '2026-06-15', '2026-06-20']);
  });

  it('null date sorts LAST', () => {
    const rows = [
      { date: null },
      { date: '2026-06-09' },
      { date: '2026-06-20' },
    ];
    const sorted = [...rows].sort(byDateAsc);
    expect(sorted.map((r) => r.date)).toEqual(['2026-06-09', '2026-06-20', null]);
  });

  it('both null → returns 0 (equal)', () => {
    expect(byDateAsc({ date: null }, { date: null })).toBe(0);
  });

  it('null a sorts after non-null b', () => {
    expect(byDateAsc({ date: null }, { date: '2026-06-09' })).toBeGreaterThan(0);
  });

  it('non-null a sorts before null b', () => {
    expect(byDateAsc({ date: '2026-06-09' }, { date: null })).toBeLessThan(0);
  });
});

describe('byDateDesc', () => {
  it('sorts dated rows latest-first', () => {
    const rows = [
      { date: '2026-06-09' },
      { date: '2026-06-20' },
      { date: '2026-06-15' },
    ];
    const sorted = [...rows].sort(byDateDesc);
    expect(sorted.map((r) => r.date)).toEqual(['2026-06-20', '2026-06-15', '2026-06-09']);
  });

  it('null date sorts LAST (even in desc)', () => {
    const rows = [
      { date: null },
      { date: '2026-06-20' },
      { date: '2026-06-09' },
    ];
    const sorted = [...rows].sort(byDateDesc);
    expect(sorted.map((r) => r.date)).toEqual(['2026-06-20', '2026-06-09', null]);
  });

  it('both null → returns 0 (equal)', () => {
    expect(byDateDesc({ date: null }, { date: null })).toBe(0);
  });

  it('null a sorts after non-null b', () => {
    expect(byDateDesc({ date: null }, { date: '2026-06-09' })).toBeGreaterThan(0);
  });

  it('non-null a sorts before null b', () => {
    expect(byDateDesc({ date: '2026-06-09' }, { date: null })).toBeLessThan(0);
  });
});
