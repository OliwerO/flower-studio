// Pure functions for per-column filtering of the Y-model Stock Flat table.
// Consumed by the dashboard StockTab (BatchArrivalList per-column popovers) and
// the florist StockPanelPage (filter drawer) — one model, two presentations,
// mirroring the orderFilters util for the Orders list.
//
// Unlike orders, the grouped stock set is already fully loaded on the client
// (GET /stock?grouped=true), so EVERY dimension is applied in memory — there are
// no server-side params. Rows are the flattened BatchArrivalList shape:
//   { type, colour, size_cm, cultivar, variety, qty, cost, sell, markup,
//     arrived, supplier }.

// Canonical empty filter — every field present so callers can spread + set one.
export const EMPTY_STOCK_FILTER = {
  typeQuery: '',      // Type — contains
  varietyQuery: '',   // Variety (colour/size/cultivar/label) — contains
  supplierQuery: '',  // Supplier — contains
  qtyMin: null,       // Available (on-hand) range
  qtyMax: null,
  costMin: null,
  costMax: null,
  sellMin: null,
  sellMax: null,
  markupMin: null,
  markupMax: null,
  arrivedFrom: '',    // YYYY-MM-DD — newest-receive date range
  arrivedTo: '',
};

export function clearStockFilter() {
  return { ...EMPTY_STOCK_FILTER };
}

function contains(haystack, needle) {
  if (!needle) return true;
  const h = haystack == null ? '' : String(haystack);
  return h.toLowerCase().includes(String(needle).toLowerCase());
}

// A numeric column passes when it is a real number within [min, max]. A null
// value (no cost / no sell / no markup) FAILS any active bound — an unpriced row
// isn't "0", it's unknown, so a "cost ≥ 5" filter shouldn't surface it.
function numInRange(value, min, max) {
  if (min == null && max == null) return true;
  if (value == null || !isFinite(Number(value))) return false;
  const n = Number(value);
  if (min != null && n < min) return false;
  if (max != null && n > max) return false;
  return true;
}

function dateInRange(value, from, to) {
  if (!from && !to) return true;
  if (!value) return false;
  const d = String(value).slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

// Variety text matches the composed label OR any of its parts, so "pink",
// "sarah", "60" all hit the right rows.
function varietyHaystack(row) {
  return [row.variety, row.colour, row.cultivar, row.size_cm].filter(v => v != null).join(' ');
}

export function stockRowMatchesFilter(row, filter) {
  const f = filter || EMPTY_STOCK_FILTER;
  if (!contains(row.type, f.typeQuery)) return false;
  if (!contains(varietyHaystack(row), f.varietyQuery)) return false;
  if (!contains(row.supplier, f.supplierQuery)) return false;
  if (!numInRange(row.qty, f.qtyMin, f.qtyMax)) return false;
  if (!numInRange(row.cost, f.costMin, f.costMax)) return false;
  if (!numInRange(row.sell, f.sellMin, f.sellMax)) return false;
  if (!numInRange(row.markup, f.markupMin, f.markupMax)) return false;
  if (!dateInRange(row.arrived, f.arrivedFrom, f.arrivedTo)) return false;
  return true;
}

// Count active (non-default) dimensions — drives the "Фильтры (n)" badge + the
// reset affordance. A min/max pair or a from/to pair counts as ONE dimension.
export function activeStockFilterCount(filter) {
  const f = filter || EMPTY_STOCK_FILTER;
  let n = 0;
  if (f.typeQuery) n++;
  if (f.varietyQuery) n++;
  if (f.supplierQuery) n++;
  if (f.qtyMin != null || f.qtyMax != null) n++;
  if (f.costMin != null || f.costMax != null) n++;
  if (f.sellMin != null || f.sellMax != null) n++;
  if (f.markupMin != null || f.markupMax != null) n++;
  if (f.arrivedFrom || f.arrivedTo) n++;
  return n;
}
