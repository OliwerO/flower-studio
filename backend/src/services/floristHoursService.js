// Florist Hours service — payroll math (rate resolution + earnings) shared by
// the /summary and /payroll routes so the fallback logic can never drift.
//
// All functions are pure: they take wire-format records (as produced by
// hoursRepo.toWire) plus the configured rates map and return plain data.

// Resolve the effective hourly rate for a single entry.
// Order: the rate stored on the record (if > 0) wins; otherwise fall back to
// the per-florist config rate, keyed by Rate Type when the config is an object,
// or a flat number when the florist has a single rate.
export function resolveHourlyRate(record, configuredRates = {}) {
  const recordRate = Number(record['Hourly Rate'] || 0);
  if (recordRate > 0) return recordRate;

  const rateType = record['Rate Type'] || '';
  const floristRates = configuredRates[record.Name];
  if (typeof floristRates === 'object' && floristRates !== null && rateType) {
    return Number(floristRates[rateType] || 0);
  }
  if (typeof floristRates === 'number') return floristRates;
  return 0;
}

// Daily earnings = hours * rate + bonus - deduction.
export function computeEarnings(record, rate) {
  return (Number(record.Hours || 0) * rate)
    + Number(record.Bonus || 0)
    - Number(record.Deduction || 0);
}

// Build a per-day payroll breakdown (sorted ascending by date) with a totals row.
// Each day row carries the resolved hourly rate + computed earnings so the
// frontends stay dumb renderers (no config access, no fallback logic).
export function buildPayroll(records = [], configuredRates = {}) {
  const days = records.map((r) => {
    const hourlyRate = resolveHourlyRate(r, configuredRates);
    return {
      id: r.id,
      name: r.Name,
      date: r.Date,
      hours: Number(r.Hours || 0),
      rateType: r['Rate Type'] || '',
      hourlyRate,
      bonus: Number(r.Bonus || 0),
      deduction: Number(r.Deduction || 0),
      earnings: computeEarnings(r, hourlyRate),
      deliveryCount: Number(r['Delivery Count'] || 0),
      notes: r.Notes || '',
    };
  }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const totals = days.reduce((acc, d) => {
    acc.hours += d.hours;
    acc.earnings += d.earnings;
    acc.bonus += d.bonus;
    acc.deduction += d.deduction;
    acc.deliveries += d.deliveryCount;
    acc.days += 1;
    return acc;
  }, { hours: 0, earnings: 0, bonus: 0, deduction: 0, deliveries: 0, days: 0 });

  return { days, totals };
}
