import { describe, it, expect } from 'vitest';
import { resolveHourlyRate, computeEarnings, buildPayroll, extractWorkWindows } from '../services/floristHoursService.js';

// Wire-format record (matches hoursRepo.toWire output)
function rec(over = {}) {
  return {
    id: over.id || 'r1',
    Name: over.Name || 'Anya',
    Date: over.Date || '2026-05-01',
    Hours: over.Hours ?? 8,
    'Hourly Rate': over['Hourly Rate'] ?? 0,
    'Rate Type': over['Rate Type'] ?? 'Standard',
    Bonus: over.Bonus ?? 0,
    Deduction: over.Deduction ?? 0,
    Notes: over.Notes ?? '',
    'Delivery Count': over['Delivery Count'] ?? 0,
  };
}

describe('resolveHourlyRate', () => {
  it('prefers the record rate when > 0', () => {
    const rate = resolveHourlyRate(rec({ 'Hourly Rate': 35, 'Rate Type': 'Standard' }), { Anya: { Standard: 30 } });
    expect(rate).toBe(35);
  });

  it('falls back to config rate keyed by rate type when record rate is 0', () => {
    const rate = resolveHourlyRate(rec({ 'Hourly Rate': 0, 'Rate Type': 'Wedding' }), { Anya: { Standard: 30, Wedding: 45 } });
    expect(rate).toBe(45);
  });

  it('falls back to a flat numeric config rate', () => {
    const rate = resolveHourlyRate(rec({ Name: 'Daria', 'Hourly Rate': 0 }), { Daria: 25 });
    expect(rate).toBe(25);
  });

  it('returns 0 when neither record nor config has a rate', () => {
    expect(resolveHourlyRate(rec({ 'Hourly Rate': 0 }), {})).toBe(0);
    expect(resolveHourlyRate(rec({ 'Hourly Rate': 0, 'Rate Type': '' }), { Anya: { Standard: 30 } })).toBe(0);
  });
});

describe('computeEarnings', () => {
  it('is hours * rate + bonus - deduction', () => {
    expect(computeEarnings(rec({ Hours: 8, Bonus: 50, Deduction: 20 }), 30)).toBe(8 * 30 + 50 - 20);
  });

  it('handles zero rate', () => {
    expect(computeEarnings(rec({ Hours: 8, Bonus: 0, Deduction: 0 }), 0)).toBe(0);
  });
});

describe('extractWorkWindows', () => {
  it('pulls a single HH:MM-HH:MM window from the notes prefix', () => {
    expect(extractWorkWindows('10:30-15:30')).toBe('10:30-15:30');
  });

  it('pulls multiple windows in order', () => {
    expect(extractWorkWindows('10:30-15:30, 16:30-18:30')).toBe('10:30-15:30, 16:30-18:30');
  });

  it('ignores the freeform note appended after the windows', () => {
    expect(extractWorkWindows('09:00-17:00 | covered for Daria')).toBe('09:00-17:00');
  });

  it('returns empty string when no canonical window is present', () => {
    expect(extractWorkWindows('10-18')).toBe('');       // imported/freeform short form
    expect(extractWorkWindows('day off')).toBe('');
    expect(extractWorkWindows('')).toBe('');
    expect(extractWorkWindows(null)).toBe('');
    expect(extractWorkWindows(undefined)).toBe('');
  });
});

describe('buildPayroll', () => {
  it('returns daily rows sorted ascending by date with resolved rate + earnings', () => {
    const records = [
      rec({ id: 'b', Date: '2026-05-03', Hours: 5, 'Hourly Rate': 0, 'Rate Type': 'Standard' }),
      rec({ id: 'a', Date: '2026-05-01', Hours: 8, 'Hourly Rate': 40, 'Rate Type': 'Wedding', Bonus: 10 }),
    ];
    const { days } = buildPayroll(records, { Anya: { Standard: 30, Wedding: 45 } });
    expect(days.map(d => d.id)).toEqual(['a', 'b']); // sorted by date asc
    expect(days[0]).toMatchObject({ date: '2026-05-01', hours: 8, hourlyRate: 40, earnings: 8 * 40 + 10 });
    expect(days[1]).toMatchObject({ date: '2026-05-03', hours: 5, hourlyRate: 30, earnings: 5 * 30 });
  });

  it('sums totals across days', () => {
    const records = [
      rec({ id: 'a', Date: '2026-05-01', Hours: 8, 'Hourly Rate': 30, Bonus: 10, Deduction: 5, 'Delivery Count': 2 }),
      rec({ id: 'b', Date: '2026-05-02', Hours: 4, 'Hourly Rate': 30, Bonus: 0, Deduction: 0, 'Delivery Count': 1 }),
    ];
    const { totals } = buildPayroll(records, {});
    expect(totals.hours).toBe(12);
    expect(totals.bonus).toBe(10);
    expect(totals.deduction).toBe(5);
    expect(totals.deliveries).toBe(3);
    expect(totals.days).toBe(2);
    expect(totals.earnings).toBe((8 * 30 + 10 - 5) + (4 * 30));
  });

  it('returns empty days + zero totals for no records', () => {
    const { days, totals } = buildPayroll([], {});
    expect(days).toEqual([]);
    expect(totals).toEqual({ hours: 0, earnings: 0, bonus: 0, deduction: 0, deliveries: 0, days: 0 });
  });

  it('carries name, rate type, notes and delivery count through to each row', () => {
    const { days } = buildPayroll([rec({ Name: 'Daria', 'Rate Type': 'Holidays', Notes: '10-18', 'Delivery Count': 4 })], {});
    expect(days[0]).toMatchObject({ name: 'Daria', rateType: 'Holidays', notes: '10-18', deliveryCount: 4 });
  });

  it('derives the work-window string from notes onto each row', () => {
    const { days } = buildPayroll([
      rec({ id: 'a', Date: '2026-05-01', Notes: '10:30-15:30, 16:30-18:30 | extra note' }),
      rec({ id: 'b', Date: '2026-05-02', Notes: 'sick day' }),
    ], {});
    expect(days[0].windows).toBe('10:30-15:30, 16:30-18:30');
    expect(days[1].windows).toBe('');
  });
});
