// Ask Blossom — open_orders_view signal tool.
// Not a DB read: this handler is pure and synchronous. It normalizes whatever
// filter fields the model supplied against the canonical order-filter key
// set (mirrors packages/shared/utils/orderFilters.js's EMPTY_ORDER_FILTER —
// backend duplicates this small map inline to stay self-contained; backend
// does not import from packages/shared/, same convention as the
// _varietyKey() mirror in stockRepo.js) and echoes them back so the panel
// can render an "Open in Orders" action. The panel treats this tool's
// `output` as an action trigger (see AskBlossomPanel.jsx) — no other tool
// should reuse the `view` key.

// Key -> default value, mirroring EMPTY_ORDER_FILTER's shape exactly (key set
// and per-key type). Keep in lockstep with packages/shared/utils/orderFilters.js.
const EMPTY_ORDER_FILTER = {
  status: '',
  source: '',
  deliveryType: '',
  paymentStatus: '',
  paymentMethod: '',
  excludeCancelled: false,
  orderDateFrom: '',
  orderDateTo: '',
  requiredByFrom: '',
  requiredByTo: '',
  orderIdQuery: '',
  customerQuery: '',
  bouquetQuery: '',
  priceMin: null,
  priceMax: null,
};

const DEFAULT_LABEL = 'Отфильтрованные заказы';
const DEFAULT_LABEL_EN = 'Filtered orders';

const pickLabel = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

export function openOrdersViewHandler(input = {}) {
  const filter = {};
  for (const key of Object.keys(EMPTY_ORDER_FILTER)) {
    if (input[key] === undefined || input[key] === null) continue;
    const defaultValue = EMPTY_ORDER_FILTER[key];
    if (typeof defaultValue === 'boolean') {
      filter[key] = Boolean(input[key]);
    } else if (typeof defaultValue === 'number' || defaultValue === null) {
      // priceMin/priceMax default to null but hold numbers when set.
      const n = Number(input[key]);
      if (!Number.isNaN(n)) filter[key] = n;
    } else {
      filter[key] = String(input[key]);
    }
  }
  // Both labels so the panel can follow the app language (Explorer v2 #497):
  // `label` (Russian) when the app is in Russian, `labelEn` when in English.
  const label = pickLabel(input.label, DEFAULT_LABEL);
  const labelEn = pickLabel(input.labelEn, DEFAULT_LABEL_EN);
  return { view: 'orders', filter, label, labelEn };
}
