// Ask Blossom — hours/payroll tool pack.
// hours_summary: hours + earnings per florist over a date range. Thin adapter over
// hoursRepo.list + floristHoursService.buildPayroll (the SAME payroll math the owner
// payroll route uses — never re-derived). computeAnalytics does not cover hours.
import * as hoursRepo from '../../repos/hoursRepo.js';
import { buildPayroll } from '../../services/floristHoursService.js';
import { getConfig } from '../../services/configService.js';

const round = (n) => Math.round(n * 100) / 100;

export async function hoursSummaryHandler(input = {}) {
  const { from, to, name } = input;
  const records = await hoursRepo.list({ dateFrom: from, dateTo: to, name });
  const allRates = getConfig('floristRates') || {};
  // Scope the rate model to one florist when the caller asked about a specific person.
  const rates = name
    ? (allRates[name] != null ? { [name]: allRates[name] } : {})
    : allRates;
  const { days, totals } = buildPayroll(records, allRates);
  const byFlorist = {};
  for (const d of days) {
    const f = byFlorist[d.name] || (byFlorist[d.name] = { name: d.name, hours: 0, earnings: 0, deliveries: 0, days: 0 });
    f.hours += d.hours || 0;
    f.earnings += d.earnings || 0;
    f.deliveries += d.deliveryCount || 0;
    f.days += 1;
  }
  // Surface configured pay rates so "what are the florist pay rates" / "what is
  // Sasha's rate" is answerable even for florists with no logged hours in range.
  // A florist's rate is either a flat number or a per-Rate-Type map
  // ({ Standard, Wedding, Holidays, ... }) — see floristHoursService.resolveHourlyRate.
  for (const n of Object.keys(rates)) {
    if (!byFlorist[n]) byFlorist[n] = { name: n, hours: 0, earnings: 0, deliveries: 0, days: 0 };
  }
  const florists = Object.values(byFlorist).map(f => ({
    ...f,
    hours: round(f.hours),
    earnings: round(f.earnings),
    rates: allRates[f.name] ?? null,
  }));
  return {
    period: { from: from || null, to: to || null },
    rates,
    florists,
    totals: {
      hours: round(totals?.hours || 0),
      earnings: round(totals?.earnings || 0),
      deliveries: totals?.deliveries || 0,
      days: totals?.days || 0,
    },
  };
}
