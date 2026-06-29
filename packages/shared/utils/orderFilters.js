// Pure functions for filtering the Orders list. Consumed by the dashboard
// OrdersTab (per-column popovers) and the florist OrderListPage (filter
// drawer) — one model, two presentations.
// See docs/superpowers/specs/2026-06-29-orders-per-field-filters-design.md.
//
// Responsibility split:
//   buildOrderQueryParams     → server-supported fields → GET /orders params
//   orderMatchesClientFilter  → client-only fields (text contains, price range)

// Canonical empty filter. Every field present so callers can spread + set one.
export const EMPTY_ORDER_FILTER = {
  // server-side (mapped to GET /orders params)
  status: '',            // single ORDER_STATUS value, or ''
  source: '',            // source name, 'Other', or ''
  deliveryType: '',      // 'Delivery' | 'Pickup' | ''
  paymentStatus: '',     // 'Paid' | 'Unpaid' | 'Partial' | ''
  paymentMethod: '',     // method name, 'Not recorded', or ''
  excludeCancelled: false,
  orderDateFrom: '',     // YYYY-MM-DD (order/submission date)
  orderDateTo: '',
  requiredByFrom: '',    // YYYY-MM-DD (fulfilment date)
  requiredByTo: '',
  // client-side (applied in memory on the fetched set)
  orderIdQuery: '',      // App Order ID — contains
  customerQuery: '',     // Customer Name — contains
  bouquetQuery: '',      // Customer Request — contains
  priceMin: null,        // number | null
  priceMax: null,        // number | null
};

export function clearOrderFilter() {
  return { ...EMPTY_ORDER_FILTER };
}

// Map the server-supported subset to GET /orders query params. Only non-empty
// values are included so the backend's "absent = no constraint" semantics hold.
export function buildOrderQueryParams(filter) {
  const f = filter || EMPTY_ORDER_FILTER;
  const params = {};
  if (f.status) params.status = f.status;
  if (f.source) params.source = f.source;
  if (f.deliveryType) params.deliveryType = f.deliveryType;
  if (f.paymentStatus) params.paymentStatus = f.paymentStatus;
  if (f.paymentMethod) params.paymentMethod = f.paymentMethod;
  if (f.excludeCancelled) params.excludeCancelled = '1';
  if (f.orderDateFrom) params.dateFrom = f.orderDateFrom;
  if (f.orderDateTo) params.dateTo = f.orderDateTo;
  if (f.requiredByFrom) params.requiredByFrom = f.requiredByFrom;
  if (f.requiredByTo) params.requiredByTo = f.requiredByTo;
  return params;
}

// Order total — mirrors the row price resolution in OrdersTab.jsx:
// Final Price ‖ Price Override ‖ Sell Total.
function orderTotal(order) {
  return Number(order['Final Price'] || order['Price Override'] || order['Sell Total'] || 0);
}

function contains(haystack, needle) {
  if (!needle) return true;
  const h = haystack == null ? '' : String(haystack);
  return h.toLowerCase().includes(String(needle).toLowerCase());
}

// Predicate for the CLIENT-only fields. Server fields are already applied by
// the fetch query, so this only checks columns the backend can't filter.
export function orderMatchesClientFilter(order, filter) {
  const f = filter || EMPTY_ORDER_FILTER;
  if (!contains(order['App Order ID'], f.orderIdQuery)) return false;
  if (!contains(order['Customer Name'], f.customerQuery)) return false;
  if (!contains(order['Customer Request'], f.bouquetQuery)) return false;
  if (f.priceMin != null || f.priceMax != null) {
    const total = orderTotal(order);
    if (f.priceMin != null && total < f.priceMin) return false;
    if (f.priceMax != null && total > f.priceMax) return false;
  }
  return true;
}

// Count active (non-default) filter dimensions — drives the "Фильтры (n)"
// badge and whether the reset-all affordance shows. A from/to date pair or a
// min/max price pair each count as one dimension.
export function activeOrderFilterCount(filter) {
  const f = filter || EMPTY_ORDER_FILTER;
  let n = 0;
  if (f.status) n++;
  if (f.source) n++;
  if (f.deliveryType) n++;
  if (f.paymentStatus) n++;
  if (f.paymentMethod) n++;
  if (f.excludeCancelled) n++;
  if (f.orderDateFrom || f.orderDateTo) n++;
  if (f.requiredByFrom || f.requiredByTo) n++;
  if (f.orderIdQuery) n++;
  if (f.customerQuery) n++;
  if (f.bouquetQuery) n++;
  if (f.priceMin != null || f.priceMax != null) n++;
  return n;
}
