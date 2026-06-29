// backend/src/services/assistantTools/customersPack.js
//
// Customers domain pack — two read-only thin adapters.
//
// customer_insights: delegates to analyticsService.computeAnalytics({ from, to })
//   and returns its .customers subset. Never recomputes (parity-pinned to analyticsService).
//
// customer_lookup: delegates to customerRepo.list({ search, withAggregates: true }) for
//   the search/filter/agg pass, then enriches each shown customer via customerRepo.getById()
//   to deliver actual key people rows.
//   _agg fields: { lastOrderDate, orderCount, totalSpend }
//   _keyPeople from getById(): raw Drizzle rows — camelCase: name, importantDate, importantDateLabel.
//   Wire format uses Airtable-style field names: Name, Phone, Segment.

import { computeAnalytics } from '../analyticsService.js';
import * as customerRepo from '../../repos/customerRepo.js';

const LOOKUP_CAP = 10;

export async function customerInsightsHandler(input) {
  const { from, to } = input;
  const report = await computeAnalytics({ from, to });
  const c = report.customers;
  // Thin adapter: surface the computeAnalytics customers subset; never recompute.
  return {
    period: report.period,
    newCount: c.newCount,
    returningCount: c.returningCount,
    segments: c.segments,
    topSpenders: c.topSpenders, // [{ id, name, spend, segment }]
  };
}

export async function customerLookupHandler(input = {}) {
  const { name, limit } = input;
  if (!name || !String(name).trim()) return { matchedCount: 0, truncated: false, shown: 0, customers: [] };
  const rows = await customerRepo.list({ search: name, withAggregates: true });
  const matchedCount = rows.length;
  const cap = Math.min(limit || LOOKUP_CAP, LOOKUP_CAP);
  // Wire format: _pgCustomerToResponse() maps PG cols to Airtable-style field names (Name, Phone, Segment).
  // _agg fields confirmed: { lastOrderDate, orderCount, totalSpend } (see customerRepo.js EMPTY_AGG).
  // Enrich each shown customer with key people via getById() — list() always returns _keyPeople:[].
  // Cap is ≤10 and typical matches are 1–2, so N getById calls are fine on this owner-only path.
  const slice = rows.slice(0, cap);
  const shown = await Promise.all(slice.map(async (c) => {
    let keyPeople = [];
    try {
      const full = await customerRepo.getById(c.id);
      // _keyPeople: raw Drizzle rows from key_people table — camelCase field names.
      keyPeople = (full._keyPeople || []).map((kp) => ({
        name: kp.name ?? null,
        importantDate: kp.importantDate ?? null,
        label: kp.importantDateLabel ?? null,
      }));
    } catch {
      keyPeople = []; // customer vanished between calls — degrade gracefully, no throw
    }
    return {
      id: c.id,
      name: c.Name || c.Nickname || '—',
      phone: c.Phone ?? null,
      segment: c.Segment ?? null,
      orderCount: c._agg?.orderCount ?? 0,
      totalSpend: c._agg?.totalSpend ?? 0,
      lastOrderDate: c._agg?.lastOrderDate ?? null,
      keyPeople,
    };
  }));
  return { matchedCount, truncated: matchedCount > shown.length, shown: shown.length, customers: shown };
}
