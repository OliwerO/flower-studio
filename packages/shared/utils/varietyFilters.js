// Variety-level filter model for the florist By-Variety Stock list (E1b).
// The dashboard Flat table filters flattened sell-tier rows (stockFilters); the
// florist list is grouped by Variety, so it filters on Variety-level dimensions
// instead: Type / Variety text / status (short·tight·free) / net range. All
// client-side (the grouped set is already loaded), like stockFilters.
import { getVarietyTotals } from './stockMath.js';

export const EMPTY_VARIETY_FILTER = {
  typeQuery: '',    // Type — contains
  varietyQuery: '', // colour / cultivar / size — contains
  status: '',       // '' | 'short' | 'tight' | 'free'
  netMin: null,     // net range
  netMax: null,
};

export function clearVarietyFilter() {
  return { ...EMPTY_VARIETY_FILTER };
}

function contains(haystack, needle) {
  if (!needle) return true;
  const h = haystack == null ? '' : String(haystack);
  return h.toLowerCase().includes(String(needle).toLowerCase());
}

// Status mirrors VarietyListItem: short = net<0; tight = net===0 with demand;
// free = everything else (net>0, or net 0 with no demand).
function statusOf(net, planned, reserved) {
  if (net < 0) return 'short';
  if (net === 0 && (planned > 0 || reserved > 0)) return 'tight';
  return 'free';
}

export function varietyMatchesFilter(group, reservations = new Map(), filter) {
  const f = filter || EMPTY_VARIETY_FILTER;
  if (!contains(group.type_name, f.typeQuery)) return false;
  if (f.varietyQuery) {
    const hay = [group.colour, group.cultivar, group.size_cm].filter(v => v != null).join(' ');
    if (!contains(hay, f.varietyQuery)) return false;
  }
  const { net, planned, reservedForPremades } = getVarietyTotals(group.rows, reservations);
  if (f.status && statusOf(net, planned, reservedForPremades) !== f.status) return false;
  if (f.netMin != null && net < f.netMin) return false;
  if (f.netMax != null && net > f.netMax) return false;
  return true;
}

export function activeVarietyFilterCount(filter) {
  const f = filter || EMPTY_VARIETY_FILTER;
  let n = 0;
  if (f.typeQuery) n++;
  if (f.varietyQuery) n++;
  if (f.status) n++;
  if (f.netMin != null || f.netMax != null) n++;
  return n;
}
