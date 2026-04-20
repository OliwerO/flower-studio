// CustomerTimeline — merged legacy + app order history, expandable per row.
// Every row can be clicked to reveal every field the backend returned in
// `raw`. For app orders, a "View full details" button cross-tab-navigates
// to the Orders tab with the orderId filter applied, so the owner can see
// order lines / delivery / payment / margin without leaving the dashboard.

import { useState, useMemo } from 'react';
import t from '../translations.js';

const TYPES = [
  { key: 'all',    labelKey: 'allEvents' },
  { key: 'app',    labelKey: 'appOrder' },
  { key: 'legacy', labelKey: 'legacyOrder' },
];

// Which raw fields to show per source, in display order. Anything outside
// this list is still shown at the bottom under "Other fields" so no data
// from the backend payload is silently dropped — that's the whole point.
const LEGACY_FIELD_ORDER = [
  'Oder Number',
  'Order Number',
  'Order Delivery Date',
  'Order date',
  'Flowers+Details of order',
  'Order Reason',
  'Price (with Delivery)',
];
const APP_FIELD_ORDER = [
  'Order Date',
  'Status',
  'Delivery Type',
  'Delivery Date',
  'Delivery Time',
  'Payment Status',
  'Customer Request',
  'Bouquet Summary',
  'Price Override',
  'Final Price',
  'Order Lines',
];

// Status → pill color. Same palette as OrdersTab so the owner reads the same
// colors everywhere on the dashboard. Unknown statuses fall back to gray.
const STATUS_COLORS = {
  New:               'bg-indigo-100 text-indigo-700',
  Ready:             'bg-amber-100 text-amber-700',
  'Out for Delivery':'bg-sky-100 text-sky-700',
  Delivered:         'bg-emerald-100 text-emerald-700',
  'Picked Up':       'bg-teal-100 text-teal-700',
  Cancelled:         'bg-rose-100 text-rose-700',
};

// Best-effort description for the collapsed row. Falls through a chain so
// orders never show "—" when the backend actually has something useful.
function rowDescription(order) {
  if (order.description) return order.description;
  const r = order.raw || {};
  if (order.source === 'app') {
    if (r['Bouquet Summary']) return r['Bouquet Summary'];
    if (r['Customer Request']) return r['Customer Request'];
    const lineCount = Array.isArray(r['Order Lines']) ? r['Order Lines'].length : 0;
    if (lineCount > 0) return `${lineCount} \u00D7 ${lineCount === 1 ? 'line item' : 'line items'}`;
  } else {
    if (r['Flowers+Details of order']) return r['Flowers+Details of order'];
    if (r['Order Reason']) return r['Order Reason'];
    if (r['Oder Number'] || r['Order Number']) return r['Oder Number'] || r['Order Number'];
  }
  return '\u2014';
}

export default function CustomerTimeline({ orders, onNavigate }) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  const counts = useMemo(() => ({
    all:    orders.length,
    app:    orders.filter(o => o.source === 'app').length,
    legacy: orders.filter(o => o.source === 'legacy').length,
  }), [orders]);

  const filtered = useMemo(
    () => typeFilter === 'all' ? orders : orders.filter(o => o.source === typeFilter),
    [orders, typeFilter]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide">
          {t.timeline} ({orders.length})
        </p>
        <div className="flex gap-1">
          {TYPES.map(tp => (
            <button
              key={tp.key}
              onClick={() => setTypeFilter(tp.key)}
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                typeFilter === tp.key
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 text-ios-secondary hover:bg-gray-200'
              }`}
            >
              {t[tp.labelKey] || tp.labelKey} {counts[tp.key]}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-ios-tertiary py-4 text-center">{t.noResults}</p>
      ) : (
        <div className="bg-white/40 rounded-xl overflow-hidden border border-white/50">
          {filtered.map(o => (
            <TimelineRow
              key={o.id}
              order={o}
              expanded={expandedId === o.id}
              onToggle={() => setExpandedId(expandedId === o.id ? null : o.id)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TimelineRow({ order, expanded, onToggle, onNavigate }) {
  const { source, date, amount, status, raw = {} } = order;
  const isLegacy = source === 'legacy';
  const description = rowDescription(order);
  const deliveryType = raw['Delivery Type'];
  const paymentStatus = raw['Payment Status'];
  const isUnpaid = paymentStatus === 'Unpaid';
  const fulfilmentIcon = deliveryType === 'Delivery' ? '\uD83D\uDE97' : deliveryType === 'Pickup' ? '\uD83C\uDFEA' : null;

  return (
    <div className="border-b border-white/30 last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-white/40 transition-colors"
      >
        <span className="text-ios-tertiary text-xs w-4 text-center shrink-0">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="text-xs text-ios-tertiary whitespace-nowrap w-24 shrink-0">
          {date || '—'}
        </span>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${
          isLegacy ? 'bg-gray-200 text-gray-600' : 'bg-brand-100 text-brand-700'
        }`}>
          {isLegacy ? t.legacyOrder : t.appOrder}
        </span>
        {fulfilmentIcon && (
          <span className="text-sm shrink-0" title={deliveryType}>{fulfilmentIcon}</span>
        )}
        <span className="text-sm text-ios-label truncate flex-1 min-w-0">
          {description}
        </span>
        {isUnpaid && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 shrink-0 uppercase tracking-wide">
            {t.unpaid || 'Unpaid'}
          </span>
        )}
        {status && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${
            STATUS_COLORS[status] || 'bg-gray-100 text-gray-600'
          }`}>
            {status}
          </span>
        )}
        <span className="text-sm font-medium text-ios-label shrink-0 w-20 text-right">
          {amount ? `${amount.toFixed(0)} ${t.zl}` : '—'}
        </span>
      </button>

      {expanded && (
        <ExpandedDetail order={order} onNavigate={onNavigate} />
      )}
    </div>
  );
}

function ExpandedDetail({ order, onNavigate }) {
  const { source, raw } = order;
  const fieldOrder = source === 'legacy' ? LEGACY_FIELD_ORDER : APP_FIELD_ORDER;

  // Build the list of key-value pairs to display. Show ordered fields first,
  // then any leftover fields the backend included (future-proofs against
  // backend additions — nothing ever silently hides).
  const orderedPairs = [];
  const seen = new Set(['id']);
  for (const key of fieldOrder) {
    if (raw[key] != null && raw[key] !== '') {
      orderedPairs.push([key, raw[key]]);
      seen.add(key);
    }
  }
  const otherPairs = Object.entries(raw)
    .filter(([k, v]) => !seen.has(k) && v != null && v !== '')
    .filter(([, v]) => !(Array.isArray(v) && v.length === 0));

  return (
    <div className="bg-white/60 px-4 py-3 border-t border-white/40">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {orderedPairs.map(([key, value]) => (
          <DetailRow key={key} label={key} value={value} />
        ))}
      </div>
      {otherPairs.length > 0 && (
        <div className="mt-3 pt-2 border-t border-white/40">
          <p className="text-[10px] uppercase tracking-wide text-ios-tertiary mb-1">
            {t.otherFields}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            {otherPairs.map(([key, value]) => (
              <DetailRow key={key} label={key} value={value} compact />
            ))}
          </div>
        </div>
      )}
      {source === 'app' && onNavigate && (
        <div className="mt-3 pt-2 border-t border-white/40">
          <button
            onClick={() => onNavigate({
              tab: 'orders',
              filter: { orderId: order.id, dateFrom: '2020-01-01', dateTo: '2099-12-31' },
            })}
            className="text-xs text-brand-700 hover:text-brand-800 font-medium inline-flex items-center gap-1"
          >
            {t.openInOrdersTab} →
          </button>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, compact }) {
  let display;
  if (Array.isArray(value)) {
    display = value.length === 0 ? '—' : value.join(', ');
  } else if (typeof value === 'object') {
    display = JSON.stringify(value);
  } else {
    display = String(value);
  }
  return (
    <div className={compact ? 'text-[11px]' : 'text-xs'}>
      <span className="text-ios-tertiary">{label}:</span>{' '}
      <span className="text-ios-label break-words">{display}</span>
    </div>
  );
}
