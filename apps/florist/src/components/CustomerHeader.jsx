// CustomerHeader — top block of the CustomerDetailView.
// Renders the nickname as H1, name as subtitle, segment chip, engagement
// badges (last-order freshness, VIP), and a full-width DO NOT CONTACT ribbon
// when that segment is active.
//
// Ported 2026-04-22 from apps/dashboard/src/components/CustomerHeader.jsx.
// Kept 1:1 so visual parity with the dashboard stays trivial — if the owner
// switches between her phone and laptop, the same customer looks the same.

import t from '../translations.js';

const SEGMENT_COLORS = {
  Constant:         'bg-ios-green/15 text-ios-green',
  New:              'bg-ios-blue/15 text-ios-blue',
  Rare:             'bg-ios-orange/15 text-ios-orange',
  'DO NOT CONTACT': 'bg-ios-red/15 text-ios-red',
};

const VIP_THRESHOLD = 2000; // PLN lifetime spend

function formatFreshness(dateStr) {
  if (!dateStr) return null;
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (isNaN(days)) return null;
  const color =
    days > 365 ? 'bg-rose-100 text-rose-700' :
    days > 120 ? 'bg-rose-50 text-rose-600' :
    days > 60  ? 'bg-amber-50 text-amber-700' :
                 'bg-emerald-50 text-emerald-700';
  const label = days === 0 ? (t.today || 'Today')
    : days < 30 ? `${days}${t.daysShort || 'd'}`
    : days < 365 ? `${Math.floor(days / 30)}${t.monthsShort || 'mo'}`
    : `${Math.floor(days / 365)}${t.yearsShort || 'y'}`;
  return { label, color };
}

export default function CustomerHeader({ cust, orders }) {
  const lastOrderDate = orders.length > 0 ? orders[0].date : null;
  const freshness = formatFreshness(lastOrderDate);
  const totalSpend = orders.reduce((sum, o) => sum + (o.amount || 0), 0);
  const isVip = totalSpend >= VIP_THRESHOLD;
  const isDnc = cust.Segment === 'DO NOT CONTACT';

  const title = cust.Nickname ? `@${cust.Nickname.replace(/^@/, '')}` : cust.Name || '—';
  const subtitle = cust.Nickname && cust.Name ? cust.Name : null;

  return (
    <div className="space-y-2">
      {isDnc && (
        <div className="bg-ios-red/10 border border-ios-red/30 rounded-lg px-3 py-1.5 text-xs text-ios-red font-semibold flex items-center gap-1.5">
          <span>⛔</span> {t.doNotContactRibbon || 'DO NOT CONTACT'}
        </div>
      )}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ios-label truncate">{title}</h1>
          {subtitle && (
            <p className="text-sm text-ios-tertiary mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {cust.Segment && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              SEGMENT_COLORS[cust.Segment] || 'bg-gray-100 text-gray-600'
            }`}>
              {cust.Segment}
            </span>
          )}
          {isVip && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
              ★ VIP
            </span>
          )}
          {freshness && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${freshness.color}`}>
              {t.lastOrderShort || 'Last'}: {freshness.label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
