import { describe, it, expect } from 'vitest';
import {
  WRITE_OFF_PERIODS,
  DEFAULT_WRITE_OFF_PERIOD,
  writeOffPeriodStart,
  isInWriteOffPeriod,
  writeOffPeriodLabel,
  localIsoDate,
} from '../utils/writeOffPeriods.js';

// Anchors used throughout — all constructed via the local-component `Date`
// constructor (year, monthIndex, day) so behavior is identical regardless of
// the test runner's OS timezone (construction + every read in the util both
// happen in the same local frame).
//
//   2026-07-24 → Friday   (mid-month/mid-week — no boundary crossings)
//   2026-07-01 → Wednesday (week floor 2026-06-29 falls in the PREVIOUS month)
//   2026-01-01 → Thursday  (week floor 2025-12-29 falls in the PREVIOUS year)
const FRIDAY_MIDMONTH = new Date(2026, 6, 24);   // 2026-07-24
const WED_MONTH_START = new Date(2026, 6, 1);    // 2026-07-01
const THU_YEAR_START  = new Date(2026, 0, 1);    // 2026-01-01

describe('WRITE_OFF_PERIODS / DEFAULT_WRITE_OFF_PERIOD', () => {
  it('exposes the four selectable periods in picker order, defaulting to week', () => {
    expect(WRITE_OFF_PERIODS.map((p) => p.key)).toEqual(['today', 'week', 'month', 'all']);
    expect(DEFAULT_WRITE_OFF_PERIOD).toBe('week');
  });

  it('pairs every period with a labelKey', () => {
    for (const p of WRITE_OFF_PERIODS) {
      expect(typeof p.labelKey).toBe('string');
      expect(p.labelKey.length).toBeGreaterThan(0);
    }
  });
});

describe('writeOffPeriodStart', () => {
  it('"today" floors to the anchor\'s own local calendar date', () => {
    expect(writeOffPeriodStart('today', FRIDAY_MIDMONTH)).toBe('2026-07-24');
  });

  it('"week" floors to the Monday of the current ISO week', () => {
    expect(writeOffPeriodStart('week', FRIDAY_MIDMONTH)).toBe('2026-07-20');
  });

  it('"week" resolves to the anchor itself when the anchor IS a Monday', () => {
    const monday = new Date(2026, 6, 20); // 2026-07-20, a Monday
    expect(writeOffPeriodStart('week', monday)).toBe('2026-07-20');
  });

  it('"week" crosses a MONTH boundary correctly', () => {
    // 2026-07-01 is a Wednesday; its Monday (2026-06-29) is in June.
    expect(writeOffPeriodStart('week', WED_MONTH_START)).toBe('2026-06-29');
  });

  it('"week" crosses a YEAR boundary correctly', () => {
    // 2026-01-01 is a Thursday; its Monday (2025-12-29) is in the prior year.
    expect(writeOffPeriodStart('week', THU_YEAR_START)).toBe('2025-12-29');
  });

  it('"month" floors to the 1st of the current calendar month', () => {
    expect(writeOffPeriodStart('month', FRIDAY_MIDMONTH)).toBe('2026-07-01');
  });

  it('"month" zero-pads single-digit months (no Jan→"1" off-by-one)', () => {
    expect(writeOffPeriodStart('month', THU_YEAR_START)).toBe('2026-01-01');
  });

  it('"all" has no floor', () => {
    expect(writeOffPeriodStart('all', FRIDAY_MIDMONTH)).toBeNull();
  });

  it('falls back to the default period (week) on an unknown key', () => {
    expect(writeOffPeriodStart('bogus', FRIDAY_MIDMONTH)).toBe(writeOffPeriodStart('week', FRIDAY_MIDMONTH));
  });

  it('ignores time-of-day on the anchor — evening and midnight give the same floor', () => {
    const evening = new Date(2026, 6, 24, 23, 45, 0);
    const midnight = new Date(2026, 6, 24, 0, 0, 0);
    expect(writeOffPeriodStart('week', evening)).toBe(writeOffPeriodStart('week', midnight));
    expect(writeOffPeriodStart('month', evening)).toBe(writeOffPeriodStart('month', midnight));
  });
});

describe('isInWriteOffPeriod', () => {
  describe('"today"', () => {
    it('includes an entry dated the same local day', () => {
      expect(isInWriteOffPeriod('2026-07-24', 'today', FRIDAY_MIDMONTH)).toBe(true);
    });
    it('excludes an entry dated the day before', () => {
      expect(isInWriteOffPeriod('2026-07-23', 'today', FRIDAY_MIDMONTH)).toBe(false);
    });
  });

  describe('"week"', () => {
    it('includes the Monday that starts the week', () => {
      expect(isInWriteOffPeriod('2026-07-20', 'week', FRIDAY_MIDMONTH)).toBe(true);
    });
    it('excludes the Sunday before that Monday', () => {
      expect(isInWriteOffPeriod('2026-07-19', 'week', FRIDAY_MIDMONTH)).toBe(false);
    });
    it('includes the anchor day itself', () => {
      expect(isInWriteOffPeriod('2026-07-24', 'week', FRIDAY_MIDMONTH)).toBe(true);
    });
    it('crosses a month boundary: last two days of June are "this week" when "now" is July 1st', () => {
      expect(isInWriteOffPeriod('2026-06-29', 'week', WED_MONTH_START)).toBe(true);
      expect(isInWriteOffPeriod('2026-06-30', 'week', WED_MONTH_START)).toBe(true);
      expect(isInWriteOffPeriod('2026-06-28', 'week', WED_MONTH_START)).toBe(false); // one day too early
    });
  });

  describe('"month"', () => {
    it('includes the 1st of the current month', () => {
      expect(isInWriteOffPeriod('2026-07-01', 'month', FRIDAY_MIDMONTH)).toBe(true);
    });
    it('excludes the last day of the previous month', () => {
      expect(isInWriteOffPeriod('2026-06-30', 'month', FRIDAY_MIDMONTH)).toBe(false);
    });
    it('draws a stricter floor than "week" for the same month-boundary case', () => {
      // Same dates as the "week" month-crossing test above, but June 29/30 are
      // NOT "this month" when "now" is July 1st — this is the whole point of
      // having two distinct periods.
      expect(isInWriteOffPeriod('2026-06-29', 'month', WED_MONTH_START)).toBe(false);
      expect(isInWriteOffPeriod('2026-06-30', 'month', WED_MONTH_START)).toBe(false);
      expect(isInWriteOffPeriod('2026-07-01', 'month', WED_MONTH_START)).toBe(true);
    });
  });

  describe('"all"', () => {
    it('includes any dated entry, however old', () => {
      expect(isInWriteOffPeriod('2020-01-01', 'all', FRIDAY_MIDMONTH)).toBe(true);
    });
    it('includes an undated entry', () => {
      expect(isInWriteOffPeriod(null, 'all', FRIDAY_MIDMONTH)).toBe(true);
      expect(isInWriteOffPeriod(undefined, 'all', FRIDAY_MIDMONTH)).toBe(true);
      expect(isInWriteOffPeriod('', 'all', FRIDAY_MIDMONTH)).toBe(true);
    });
  });

  describe('undated entries under a bounded period', () => {
    // Mirrors the pre-existing florist WasteLogPage behavior: an entry with
    // no Date never satisfies a floor comparison, so it only ever surfaces
    // under "All", never Today/Week/Month.
    it('never matches "today", "week", or "month"', () => {
      expect(isInWriteOffPeriod(null, 'today', FRIDAY_MIDMONTH)).toBe(false);
      expect(isInWriteOffPeriod(undefined, 'week', FRIDAY_MIDMONTH)).toBe(false);
      expect(isInWriteOffPeriod('', 'month', FRIDAY_MIDMONTH)).toBe(false);
    });
  });

  describe('filtering a realistic entries list', () => {
    const entries = [
      { id: 1, Date: '2026-07-24' }, // today (Friday)
      { id: 2, Date: '2026-07-22' }, // this week, not today
      { id: 3, Date: '2026-07-10' }, // this month, not this week
      { id: 4, Date: '2026-05-01' }, // older than this month
      { id: 5, Date: null },         // undated
    ];

    it('"today" keeps only #1', () => {
      const kept = entries.filter((e) => isInWriteOffPeriod(e.Date, 'today', FRIDAY_MIDMONTH)).map((e) => e.id);
      expect(kept).toEqual([1]);
    });
    it('"week" keeps #1 and #2', () => {
      const kept = entries.filter((e) => isInWriteOffPeriod(e.Date, 'week', FRIDAY_MIDMONTH)).map((e) => e.id);
      expect(kept).toEqual([1, 2]);
    });
    it('"month" keeps #1, #2, #3', () => {
      const kept = entries.filter((e) => isInWriteOffPeriod(e.Date, 'month', FRIDAY_MIDMONTH)).map((e) => e.id);
      expect(kept).toEqual([1, 2, 3]);
    });
    it('"all" keeps everything, including the undated row', () => {
      const kept = entries.filter((e) => isInWriteOffPeriod(e.Date, 'all', FRIDAY_MIDMONTH)).map((e) => e.id);
      expect(kept).toEqual([1, 2, 3, 4, 5]);
    });
  });
});

describe('writeOffPeriodLabel', () => {
  const t = {
    wastePeriodToday: 'Сегодня',
    wastePeriodWeek: 'Неделя',
    wastePeriodMonth: 'Месяц',
    wastePeriodAll: 'Всё',
  };

  it('resolves each period key to its translated label', () => {
    expect(writeOffPeriodLabel(t, 'today')).toBe('Сегодня');
    expect(writeOffPeriodLabel(t, 'week')).toBe('Неделя');
    expect(writeOffPeriodLabel(t, 'month')).toBe('Месяц');
    expect(writeOffPeriodLabel(t, 'all')).toBe('Всё');
  });

  it('falls back to the raw key when the translation is missing', () => {
    expect(writeOffPeriodLabel({}, 'week')).toBe('week');
  });

  it('falls back to the raw (unknown) key when the period itself is unrecognized', () => {
    expect(writeOffPeriodLabel(t, 'bogus')).toBe('bogus');
  });
});

// Regression lock (review follow-up, issue #193): the 31 tests above are all
// built on the local-component `new Date(y, m, d, ...)` constructor, which
// reads back identically under ANY process timezone (construction and every
// internal read happen in the same local frame) — so on their own they could
// never catch a revert back to `.toISOString()`. These two tests instead
// anchor on a bare ISO date-TIME string with NO offset designator (no `Z`,
// no `+HH:MM`) — per the JS Date spec that's parsed as LOCAL time, i.e.
// relative to `process.env.TZ`, which packages/shared/vitest.config.js now
// forces to 'Europe/Warsaw' (UTC+2 in July). Local 2026-07-20T00:30 is
// 2026-07-19T22:30 UTC, so a `.toISOString()`-based implementation would
// answer "2026-07-19" here (wrong day) while the correct local-component
// read answers "2026-07-20". Without the forced TZ, this test would be
// meaningless — see the vitest.config.js comment for why.
describe('TZ regression lock (issue #193 review follow-up)', () => {
  it('"today" resolves from the LOCAL calendar day, not the UTC day, at a time where they diverge', () => {
    const localLateNight = new Date('2026-07-20T00:30:00'); // no offset — parsed against TZ
    expect(writeOffPeriodStart('today', localLateNight)).toBe('2026-07-20');
  });

  it('localIsoDate reads the same local-not-UTC calendar day', () => {
    const localLateNight = new Date('2026-07-20T00:30:00');
    expect(localIsoDate(localLateNight)).toBe('2026-07-20');
  });
});
