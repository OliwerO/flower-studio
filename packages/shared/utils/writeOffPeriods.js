/**
 * writeOffPeriods — shared period-filter model for the stock write-off / waste
 * log (issue #193). Both the florist WasteLogPage and the dashboard
 * StockLossSection filter the SAME `/stock-loss` rows client-side by one of
 * four periods; this is the single source of truth for what each period
 * means so the two surfaces can never drift (root CLAUDE.md Cross-App
 * Feature Parity).
 *
 * Boundary convention (floor-only — no ceiling needed since write-off entries
 * are never dated in the future; matches the pre-existing florist behavior of
 * filtering with just a lower bound):
 *   'today' — entries dated today (local calendar day).
 *   'week'  — entries dated on/after the Monday of the current ISO week.
 *             No OTHER "this week" RANGE convention exists elsewhere in the
 *             codebase — `DatePicker.jsx`'s `mondayIndex` only indexes a day
 *             for calendar-grid layout, it doesn't define a week range — so
 *             this follows the documented fallback: ISO Monday-start.
 *   'month' — entries dated on/after the 1st of the current calendar month.
 *             Matches the dashboard `FinancialTab` `thisMonth` preset
 *             (`getPresetRange`: `{ from: '<y>-<m>-01', to: today }`).
 *   'all'   — every entry, no floor.
 *
 * Dates are plain `YYYY-MM-DD` strings (how the API serializes the Postgres
 * `date` column — Drizzle's `date()` column defaults to string mode, and both
 * existing consumers already treat `entry.Date` this way: WasteLogPage does
 * plain string comparison, StockLossSection feeds it straight into an
 * `<input type="date">`). Comparisons stay lexicographic ISO string compares
 * — no Date-parsing on the entry side.
 *
 * The only place a `Date` object enters is the `now` anchor, and every field
 * read off it (`getFullYear`/`getMonth`/`getDate`/`getDay`) is LOCAL-time —
 * never UTC. The pre-existing florist implementation this replaces mixed
 * `setHours(0,0,0,0)` (local) with `.toISOString()` (UTC), which silently
 * shifts the computed floor back a full day in any positive-UTC-offset
 * timezone — confirmed for Europe/Warsaw, the studio's own timezone: local
 * 15:00 CEST produces a `.toISOString()` date of the PREVIOUS UTC calendar
 * day. Reading Y/M/D straight off the local `Date` avoids that class of bug
 * entirely, and — because construction and reading both happen in the same
 * local frame — stays self-consistent under test regardless of the runner's
 * OS timezone.
 */

// Selectable periods, in picker order. `labelKey` is the `t.xxx` translation
// key both apps already define (or now define, for the dashboard) so a
// consumer can render `t[period.labelKey]` identically in either app.
export const WRITE_OFF_PERIODS = [
  { key: 'today', labelKey: 'wastePeriodToday' },
  { key: 'week',  labelKey: 'wastePeriodWeek' },
  { key: 'month', labelKey: 'wastePeriodMonth' },
  { key: 'all',   labelKey: 'wastePeriodAll' },
];

export const DEFAULT_WRITE_OFF_PERIOD = 'week';

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Local calendar date as `YYYY-MM-DD` — never touches UTC/`.toISOString()`.
 * Exported so every "what's today/yesterday's local date" computation in
 * either app routes through the same local-component read this module uses
 * internally, instead of re-deriving a `setHours` + `.toISOString()` version
 * that silently shifts a day in any positive-UTC-offset timezone (see the
 * module doc comment above — this is exactly the bug the florist
 * `WasteLogPage.jsx` day-grouping labels had before being routed through
 * this helper).
 *
 * @param {Date} d
 * @returns {string}
 */
export function localIsoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Date#getDay() is 0=Sun..6=Sat. Shift so Monday=0..Sunday=6 (ISO week start).
function daysSinceMonday(d) {
  return (d.getDay() + 6) % 7;
}

/**
 * Inclusive floor date (`YYYY-MM-DD`) for `periodKey`, anchored at `now`.
 * Returns `null` for 'all' (no floor — everything included). An unrecognized
 * key falls back to `DEFAULT_WRITE_OFF_PERIOD`, matching the `windowTrace` /
 * `TRACE_WINDOWS` precedent elsewhere in this package.
 *
 * @param {string} periodKey  one of WRITE_OFF_PERIODS' keys
 * @param {Date}   now        anchor instant (defaults to the current time)
 * @returns {string|null}
 */
export function writeOffPeriodStart(periodKey, now = new Date()) {
  const known = WRITE_OFF_PERIODS.some((p) => p.key === periodKey);
  const key = known ? periodKey : DEFAULT_WRITE_OFF_PERIOD;
  // Anchor at local midnight so the day/week/month arithmetic below never
  // shifts because of the current time-of-day.
  const anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (key) {
    case 'today':
      return localIsoDate(anchor);
    case 'week': {
      const monday = new Date(anchor);
      monday.setDate(monday.getDate() - daysSinceMonday(anchor));
      return localIsoDate(monday);
    }
    case 'month':
      return `${anchor.getFullYear()}-${pad(anchor.getMonth() + 1)}-01`;
    case 'all':
    default:
      return null;
  }
}

/**
 * Pure inclusion predicate — does `entryDate` (a `YYYY-MM-DD` string, or
 * falsy for an undated entry) fall within `periodKey`, anchored at `now`?
 *
 * An undated entry only ever matches 'all' — mirrors the pre-existing
 * florist WasteLogPage behavior (an entry with no Date never satisfied a
 * bounded floor comparison, so it only ever surfaced under "All").
 *
 * @param {string|null|undefined} entryDate
 * @param {string} periodKey
 * @param {Date}   now
 * @returns {boolean}
 */
export function isInWriteOffPeriod(entryDate, periodKey, now = new Date()) {
  const floor = writeOffPeriodStart(periodKey, now);
  if (floor == null) return true; // 'all'
  return Boolean(entryDate) && entryDate >= floor;
}

/**
 * Localized label for a period key — mirrors `reasonLabel(t, reason)` from
 * `lossReasons.js`. Falls back to the raw key if `t` doesn't carry it (should
 * only happen if a translations.js file is missing a key CI would otherwise
 * catch via the app's own build).
 */
export function writeOffPeriodLabel(t, periodKey) {
  const period = WRITE_OFF_PERIODS.find((p) => p.key === periodKey);
  return (period && t[period.labelKey]) || periodKey;
}
