// backend/src/services/assistantTools/customersPack.js
//
// Customers domain pack — two read-only thin adapters.
//
// customer_insights: delegates to analyticsService.computeAnalytics({ from, to })
//   and returns its .customers subset. Never recomputes (parity-pinned to analyticsService).
//
// customer_lookup: delegates to customerRepo.list({ search, withAggregates: true }).
//   _agg fields: { lastOrderDate, orderCount, totalSpend }
//   _keyPeople in list(): always [] (only getById() populates key people from DB).
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
  // _keyPeople: list() always passes [] to _pgCustomerToResponse, so _keyPeople is always [].
  // Only getById() fetches actual key people rows — keyPeople is [] here, noted by design.
  const shown = rows.slice(0, cap).map((c) => ({
    id: c.id,
    name: c.Name || c.Nickname || '—',
    phone: c.Phone ?? null,
    segment: c.Segment ?? null,
    orderCount: c._agg?.orderCount ?? 0,
    totalSpend: c._agg?.totalSpend ?? 0,
    lastOrderDate: c._agg?.lastOrderDate ?? null,
    keyPeople: (c._keyPeople || []).map((kp) => ({
      name: kp.name ?? kp.Name ?? null,
      importantDate: kp.important_date ?? kp.importantDate ?? null,
    })),
  }));
  return { matchedCount, truncated: matchedCount > shown.length, shown: shown.length, customers: shown };
}
