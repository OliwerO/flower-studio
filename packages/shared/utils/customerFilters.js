// Pure functions for filtering the in-memory customer list.
// Works against the enriched customer records from GET /api/customers
// (each has _agg: { lastOrderDate, orderCount, totalSpend }).

// Every customer field the universal search inspects. Arrays are joined,
// nullable fields are coerced to empty strings. Add to this list when a
// new searchable field appears on the customer record.
const SEARCH_FIELDS = [
  'Name',
  'Nickname',
  'Phone',
  'Email',
  'Link',
  'Home address',
  'Sex / Business',
  'Segment',
  'Communication method',
  'Order Source',
  'Found us from',
  'Connected people',
  'Key person 1',
  'Key person 2',
  'Key person 1 (important DATE)',
  'Key person 2 (important DATE)',
  'Language',
];

function stringifyField(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(' ');
  return String(value);
}

// Universal search: every whitespace-separated word in the query must match
// at least one field (AND across words, OR across fields). Case-insensitive.
// Also checks _agg.lastOrderDate so ISO dates like "2024-02" work.
export function matchesSearch(customer, query) {
  if (!query) return true;
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const haystack = [
    ...SEARCH_FIELDS.map(f => stringifyField(customer[f])),
    stringifyField(customer._agg?.lastOrderDate),
  ].join(' ').toLowerCase();

  return words.every(w => haystack.includes(w));
}

// Daysfresh comparator: returns true if customer's last order was within N days.
function lastOrderWithin(customer, days) {
  const d = customer._agg?.lastOrderDate;
  if (!d) return false;
  const delta = (Date.now() - new Date(d).getTime()) / 86400000;
  return delta <= days;
}

// Composable filter predicate. `filters` is the filter state shape documented
// in the Customer Tab v2.0 plan. Multi-select sets match if the customer's
// value is IN the set. Nulls/empty sets mean "no constraint on this dimension".
export function matchesFilters(customer, filters) {
  if (!filters) return true;

  const has = v => v != null && v !== '' && !(Array.isArray(v) && v.length === 0);

  // Multi-select dimensions
  const ms = (setLike, custValue) => {
    if (!setLike || setLike.size === 0) return true;
    if (Array.isArray(custValue)) {
      // Any overlap
      return custValue.some(v => setLike.has(v));
    }
    return setLike.has(custValue);
  };

  if (!ms(filters.segments, customer.Segment)) return false;
  if (!ms(filters.languages, customer.Language)) return false;
  if (!ms(filters.comms, customer['Communication method'])) return false;
  if (!ms(filters.sources, customer['Order Source'])) return false;
  if (!ms(filters.sexBiz, customer['Sex / Business'])) return false;
  if (!ms(filters.foundUsFrom, customer['Found us from'])) return false;

  // Presence toggles
  if (filters.hasPhone && !has(customer.Phone)) return false;
  if (filters.hasInstagram && !has(customer.Link)) return false;
  if (filters.hasEmail && !has(customer.Email)) return false;
  if (filters.hasKeyPerson && !has(customer['Key person 1']) && !has(customer['Key person 2'])) return false;

  // Recency
  if (filters.lastOrderWithinDays != null) {
    if (!lastOrderWithin(customer, filters.lastOrderWithinDays)) return false;
  }
  if (filters.lastOrderBefore) {
    const d = customer._agg?.lastOrderDate;
    if (!d || d >= filters.lastOrderBefore) return false;
  }

  // Lifetime totals
  if (filters.minOrderCount != null) {
    if ((customer._agg?.orderCount || 0) < filters.minOrderCount) return false;
  }
  if (filters.minTotalSpend != null) {
    if ((customer._agg?.totalSpend || 0) < filters.minTotalSpend) return false;
  }

  // Derived: churn risk = at least 2 orders AND last order >60 days ago
  if (filters.churnRisk) {
    const count = customer._agg?.orderCount || 0;
    if (count < 2) return false;
    const d = customer._agg?.lastOrderDate;
    if (!d) return false;
    const daysSince = (Date.now() - new Date(d).getTime()) / 86400000;
    if (daysSince < 60) return false;
  }

  // DO NOT CONTACT shortcut
  if (filters.doNotContactOnly && customer.Segment !== 'DO NOT CONTACT') return false;

  // RFM segment (set by clicking an insights-bar pill)
  if (filters.rfmSegment && filters.rfmLabelByCustomer) {
    if (filters.rfmLabelByCustomer[customer.id] !== filters.rfmSegment) return false;
  }

  return true;
}

// Empty default filter state. Multi-selects are Sets so membership check is O(1).
// Version tag allows localStorage migration if we change the shape later.
export const EMPTY_FILTERS = {
  version: 1,
  segments: new Set(),
  languages: new Set(),
  comms: new Set(),
  sources: new Set(),
  sexBiz: new Set(),
  foundUsFrom: new Set(),
  hasPhone: false,
  hasInstagram: false,
  hasEmail: false,
  hasKeyPerson: false,
  lastOrderWithinDays: null,
  lastOrderBefore: null,
  minOrderCount: null,
  minTotalSpend: null,
  churnRisk: false,
  doNotContactOnly: false,
  rfmSegment: null,
  rfmLabelByCustomer: null,
};

// Serialize for localStorage: Sets become arrays, rfmLabelByCustomer is
// regenerated from server insights on every load so it's not persisted.
export function serializeFilters(filters) {
  return JSON.stringify({
    version: filters.version,
    segments: [...filters.segments],
    languages: [...filters.languages],
    comms: [...filters.comms],
    sources: [...filters.sources],
    sexBiz: [...filters.sexBiz],
    foundUsFrom: [...filters.foundUsFrom],
    hasPhone: filters.hasPhone,
    hasInstagram: filters.hasInstagram,
    hasEmail: filters.hasEmail,
    hasKeyPerson: filters.hasKeyPerson,
    lastOrderWithinDays: filters.lastOrderWithinDays,
    lastOrderBefore: filters.lastOrderBefore,
    minOrderCount: filters.minOrderCount,
    minTotalSpend: filters.minTotalSpend,
    churnRisk: filters.churnRisk,
    doNotContactOnly: filters.doNotContactOnly,
    rfmSegment: filters.rfmSegment,
  });
}

export function deserializeFilters(raw) {
  if (!raw) return { ...EMPTY_FILTERS };
  try {
    const p = JSON.parse(raw);
    if (p.version !== EMPTY_FILTERS.version) return { ...EMPTY_FILTERS };
    return {
      ...EMPTY_FILTERS,
      segments: new Set(p.segments || []),
      languages: new Set(p.languages || []),
      comms: new Set(p.comms || []),
      sources: new Set(p.sources || []),
      sexBiz: new Set(p.sexBiz || []),
      foundUsFrom: new Set(p.foundUsFrom || []),
      hasPhone: !!p.hasPhone,
      hasInstagram: !!p.hasInstagram,
      hasEmail: !!p.hasEmail,
      hasKeyPerson: !!p.hasKeyPerson,
      lastOrderWithinDays: p.lastOrderWithinDays ?? null,
      lastOrderBefore: p.lastOrderBefore ?? null,
      minOrderCount: p.minOrderCount ?? null,
      minTotalSpend: p.minTotalSpend ?? null,
      churnRisk: !!p.churnRisk,
      doNotContactOnly: !!p.doNotContactOnly,
      rfmSegment: p.rfmSegment ?? null,
    };
  } catch {
    return { ...EMPTY_FILTERS };
  }
}

// Count non-default filter dimensions — used to show "3 filters active".
export function activeFilterCount(filters) {
  let n = 0;
  n += filters.segments.size > 0 ? 1 : 0;
  n += filters.languages.size > 0 ? 1 : 0;
  n += filters.comms.size > 0 ? 1 : 0;
  n += filters.sources.size > 0 ? 1 : 0;
  n += filters.sexBiz.size > 0 ? 1 : 0;
  n += filters.foundUsFrom.size > 0 ? 1 : 0;
  n += filters.hasPhone ? 1 : 0;
  n += filters.hasInstagram ? 1 : 0;
  n += filters.hasEmail ? 1 : 0;
  n += filters.hasKeyPerson ? 1 : 0;
  n += filters.lastOrderWithinDays != null ? 1 : 0;
  n += filters.lastOrderBefore ? 1 : 0;
  n += filters.minOrderCount != null ? 1 : 0;
  n += filters.minTotalSpend != null ? 1 : 0;
  n += filters.churnRisk ? 1 : 0;
  n += filters.doNotContactOnly ? 1 : 0;
  n += filters.rfmSegment ? 1 : 0;
  return n;
}
