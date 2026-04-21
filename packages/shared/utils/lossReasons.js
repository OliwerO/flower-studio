// Single source of truth for stock loss reason values.
// Must match backend/src/constants/statuses.js LOSS_REASON exactly — these strings
// are written to the Airtable "Reason" field (case-sensitive).

export const LOSS_REASONS = [
  'Wilted',
  'Damaged',
  'Arrived Broken',
  'Overstock',
  'Other',
];

// Maps reason value to the translation key already used across apps.
// Callers pass their app's `t` object and get back localized labels.
export const REASON_KEYS = {
  'Wilted':         'reasonWilted',
  'Damaged':        'reasonDamaged',
  'Arrived Broken': 'arrivedBroken',
  'Overstock':      'reasonOverstock',
  'Other':          'reasonOther',
};

export function reasonLabel(t, reason) {
  const key = REASON_KEYS[reason];
  return (key && t[key]) || reason;
}

// Color classes for reason badges (Tailwind). Consistent across apps.
export const REASON_COLORS = {
  'Wilted':         'bg-amber-100 text-amber-700',
  'Damaged':        'bg-red-100 text-red-700',
  'Arrived Broken': 'bg-red-100 text-red-700',
  'Overstock':      'bg-blue-100 text-blue-700',
  'Other':          'bg-gray-100 text-gray-700',
};

export function reasonBadgeClass(reason) {
  return REASON_COLORS[reason] || REASON_COLORS.Other;
}
