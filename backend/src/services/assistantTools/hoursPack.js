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
  const rates = getConfig('floristRates') || {};
  const { days, totals } = buildPayroll(records, rates);
  const byFlorist = {};
  for (const d of days) {
    const f = byFlorist[d.name] || (byFlorist[d.name] = { name: d.name, hours: 0, earnings: 0, deliveries: 0, days: 0 });
    f.hours += d.hours || 0;
    f.earnings += d.earnings || 0;
    f.deliveries += d.deliveryCount || 0;
    f.days += 1;
  }
  const florists = Object.values(byFlorist).map(f => ({ ...f, hours: round(f.hours), earnings: round(f.earnings) }));
  return {
    period: { from: from || null, to: to || null },
    florists,
    totals: {
      hours: round(totals?.hours || 0),
      earnings: round(totals?.earnings || 0),
      deliveries: totals?.deliveries || 0,
      days: totals?.days || 0,
    },
  };
}
