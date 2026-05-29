// Format an ISO date (YYYY-MM-DD) as day-month-year with dot separators —
// the convention used across the Blossom UI (matches the batch tag style
// "14.May."). Returns the input unchanged if it is not a recognisable ISO date.
//
// Examples:
//   formatDateDMY('2026-05-07') → '07.05.2026'
//   formatDateDMY('2026-05-07T10:00:00Z') → '07.05.2026'
//   formatDateDMY(null) → ''
export function formatDateDMY(value) {
  if (!value) return '';
  const iso = String(value).slice(0, 10);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(value);
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export default formatDateDMY;
