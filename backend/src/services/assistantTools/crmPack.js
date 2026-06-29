// backend/src/services/assistantTools/crmPack.js
//
// CRM domain pack — two customer re-activation tools.
//
// lapsed_customers: delegates to customerRepo.list({ withAggregates: true }) —
//   the same source the CRM tab uses for RFM aggregates (_agg.lastOrderDate).
//   Filters to customers whose last order is older than sinceDays; excludes
//   customers who have never ordered (lastOrderDate null).
//
// upcoming_occasions: delegates to customerRepo.listKeyPeopleWithDates() and
//   computes the NEXT annual occurrence of each person's importantDate (MM-DD),
//   filtering to those within withinDays of today.

import * as customerRepo from '../../repos/customerRepo.js';

const DEFAULT_SINCE_DAYS = 60;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DEFAULT_WITHIN_DAYS = 14;

/**
 * Pure helper — given an "MM-DD" string and today's ISO date (YYYY-MM-DD),
 * returns the next calendar occurrence of that month-day as YYYY-MM-DD.
 * If MM-DD has already passed this year, returns the date in the next year.
 *
 * Exported for deterministic unit testing of year-boundary math.
 *
 * @param {string} mmdd       - e.g. "08-15"
 * @param {string} todayISO   - e.g. "2026-06-29"
 * @returns {string}          - YYYY-MM-DD
 */
export function nextOccurrence(mmdd, todayISO) {
  const year = Number(todayISO.slice(0, 4));
  const candidate = `${year}-${mmdd}`;
  // String comparison is correct here: both are YYYY-MM-DD format.
  return candidate >= todayISO ? candidate : `${year + 1}-${mmdd}`;
}

/**
 * Return customers who have not placed an order in the last sinceDays days.
 * Customers who have never ordered are excluded.
 *
 * @param {{ sinceDays?: number, limit?: number }} input
 */
export async function lapsedCustomersHandler(input = {}) {
  const sinceDays = Number(input.sinceDays ?? DEFAULT_SINCE_DAYS);
  const limit = Math.min(Number(input.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const today = new Date().toISOString().slice(0, 10);

  // Compute the cutoff date in UTC to match Postgres date strings.
  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - sinceDays);
  const cutoffISO = cutoffDate.toISOString().slice(0, 10);

  const rows = await customerRepo.list({ withAggregates: true });

  // A customer is lapsed if they have a lastOrderDate AND it is before the cutoff.
  // Lexicographic comparison is correct for ISO YYYY-MM-DD strings.
  const lapsed = rows
    .filter(c => c._agg?.lastOrderDate != null && c._agg.lastOrderDate < cutoffISO)
    .map(c => {
      const daysSinceLastOrder = Math.floor(
        (new Date(today) - new Date(c._agg.lastOrderDate)) / (1000 * 60 * 60 * 24),
      );
      return {
        name:               c.Name || c.Nickname || '—',
        phone:              c.Phone ?? null,
        segment:            c.Segment ?? null,
        lastOrderDate:      c._agg.lastOrderDate,
        daysSinceLastOrder,
        orderCount:         c._agg.orderCount,
        totalSpend:         c._agg.totalSpend,
      };
    })
    // Sort ascending by lastOrderDate so the most-lapsed customer is first.
    .sort((a, b) => a.lastOrderDate.localeCompare(b.lastOrderDate));

  const matchedCount = lapsed.length;
  const shown = lapsed.slice(0, limit);
  return {
    sinceDays,
    asOf: today,
    matchedCount,
    truncated: matchedCount > shown.length,
    shown: shown.length,
    customers: shown,
  };
}

/**
 * Return key people whose importantDate (month + day) falls within withinDays
 * of today, computing the NEXT annual occurrence so birthdays/anniversaries
 * wrap correctly across the year boundary.
 *
 * @param {{ withinDays?: number }} input
 */
export async function upcomingOccasionsHandler(input = {}) {
  const withinDays = Number(input.withinDays ?? DEFAULT_WITHIN_DAYS);
  const today = new Date().toISOString().slice(0, 10);

  const people = await customerRepo.listKeyPeopleWithDates();

  const occasions = people
    .map(p => {
      // importantDate is YYYY-MM-DD; only month-day repeats annually.
      const mmdd = p.importantDate.slice(5); // extract "MM-DD"
      const nextDate = nextOccurrence(mmdd, today);
      const daysUntil = Math.round(
        (new Date(nextDate) - new Date(today)) / (1000 * 60 * 60 * 24),
      );
      return {
        personName:    p.personName,
        label:         p.label ?? null,
        date:          nextDate,
        daysUntil,
        customerName:  p.customerName,
        customerPhone: p.customerPhone ?? null,
      };
    })
    .filter(o => o.daysUntil >= 0 && o.daysUntil <= withinDays)
    .sort((a, b) => a.daysUntil - b.daysUntil);

  return {
    withinDays,
    asOf: today,
    matchedCount: occasions.length,
    occasions,
  };
}
