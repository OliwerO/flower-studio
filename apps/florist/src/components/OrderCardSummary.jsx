import t from '../translations.js';
import fmtDate from '../utils/formatDate.js';
import { CallButton } from '@flower-studio/shared';

const STATUS_STYLES = {
  'New':              { label: 'bg-indigo-50 text-indigo-600' },
  'In Progress':      { label: 'bg-orange-50 text-orange-600' },
  'Ready':            { label: 'bg-amber-50 text-amber-700' },
  'Out for Delivery': { label: 'bg-sky-50 text-sky-700' },
  'Delivered':        { label: 'bg-emerald-50 text-emerald-700' },
  'Picked Up':        { label: 'bg-teal-50 text-teal-700' },
  'Cancelled':        { label: 'bg-rose-50 text-rose-600' },
};

const STATUS_LABELS = {
  'New':              () => t.statusNew,
  'In Progress':      () => t.statusInProgress,
  'Ready':            () => t.statusReady,
  'Out for Delivery': () => t.statusOutForDelivery,
  'Delivered':        () => t.statusDelivered,
  'Picked Up':        () => t.statusPickedUp,
  'Cancelled':        () => t.statusCancelled,
};

const ALLOWED_TRANSITIONS = {
  'New':              ['Ready', 'Cancelled'],
  'In Progress':      ['Ready', 'Cancelled'],
  'Ready':            ['Delivered', 'Picked Up', 'Cancelled'],
  'Out for Delivery': ['Delivered', 'Cancelled'],
  'Delivered':        [],
  'Picked Up':        [],
  'Cancelled':        ['New'],
};

export { STATUS_STYLES, STATUS_LABELS, ALLOWED_TRANSITIONS };

function statusLabel(s) {
  return STATUS_LABELS[s]?.() || s;
}

export default function OrderCardSummary({ order, d, currentStatus, currentPaid, currentPrice, isDelivery, isTerminal, expanded, saving, needsComposition, stockShortfalls = {}, onPatch }) {
  const request = order['Customer Request'] || '';
  const styles  = STATUS_STYLES[currentStatus] || STATUS_STYLES['New'];

  return (
    <>
      {/* Unpaid warning — prominent banner for pickup orders */}
      {!currentPaid && !isDelivery && currentStatus !== 'Cancelled' && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 flex items-center gap-2">
          <span className="text-red-500 text-sm">⚠</span>
          <span className="text-xs font-semibold text-red-700">{t.collectPayment || 'Collect payment before handing over'}</span>
        </div>
      )}

      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {order['App Order ID'] && (
            <span className="text-[11px] font-mono text-ios-tertiary">#{order['App Order ID']}</span>
          )}
          <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${styles.label}`}>
            {statusLabel(currentStatus)}
          </span>
          <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
            isDelivery ? 'bg-purple-50 text-purple-600' : 'bg-teal-50 text-teal-700'
          }`}>
            {isDelivery ? t.delivery : t.pickup}
          </span>
          <span className={`text-xs px-2.5 py-0.5 rounded-full ${
            currentPaid ? 'bg-green-50 text-green-700'
              : (d['Payment Status'] === 'Partial' ? 'bg-orange-50 text-orange-600' : 'bg-red-50 text-red-500')
          }`}>
            {currentPaid ? t.paid : (d['Payment Status'] === 'Partial' ? (t.partial || 'Partial') : t.unpaid)}
          </span>
          {needsComposition && (
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-700">
              {t.intake?.needsComposition || '🌸 Compose'}
            </span>
          )}
        </div>
        {currentPrice > 0 && (
          <span className={`text-sm font-bold shrink-0 px-3 py-1 rounded-full ${
            currentPaid
              ? 'bg-green-100 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-600 border border-red-200'
          }`}>{currentPrice} zł</span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-base font-semibold text-ios-label">{d['Customer Name'] || order['Customer Name'] || '—'}</p>
        <CallButton phone={order['Customer Phone']} label={t.callCustomer} variant="subtle" />
      </div>
      {request && (
        <p className={`text-sm text-ios-tertiary mt-0.5 ${expanded ? '' : 'line-clamp-1'}`}>{request}</p>
      )}
      {order['Bouquet Summary'] && (
        <p className="text-xs text-brand-600/70 mt-1 line-clamp-1">🌸 {order['Bouquet Summary']}</p>
      )}
      {/* Stock shortage indicator — show flowers that are short for this order */}
      {order['Bouquet Summary'] && (() => {
        const parts = (order['Bouquet Summary'] || '').split(',').map(s => s.trim()).filter(Boolean);
        const shortItems = [];
        for (const part of parts) {
          const match = part.match(/^(\d+)\s*[×x]\s*(.+)$/i);
          if (!match) continue;
          const name = match[2].trim();
          const shortfall = Object.values(stockShortfalls).find(s => s.name === name && s.effective < 0);
          if (shortfall) shortItems.push({ name, shortage: Math.abs(shortfall.effective) });
        }
        if (shortItems.length === 0) return null;
        return (
          <div className="mt-1 flex flex-wrap gap-1">
            {shortItems.map((item, i) => (
              <span key={i} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
                {item.name}: -{item.shortage}
              </span>
            ))}
          </div>
        );
      })()}
      {(order['Delivery Date'] || order['Required By']) && (
        <p className="text-sm text-ios-label font-semibold mt-1">
          {fmtDate(order['Delivery Date'] || order['Required By'])}
          {order['Delivery Time'] ? ` · ${order['Delivery Time']}` : ''}
        </p>
      )}
      {/* Florist note — owner-authored guidance to the florist */}
      {!expanded && order['Florist Note'] && (
        <div className="mt-2 bg-green-50 dark:bg-green-900/30 border-l-4 border-green-500 rounded-lg px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-green-700 dark:text-green-300 mb-0.5">
            🌸 {t.floristNote}
          </p>
          <p className="text-sm text-ios-label dark:text-gray-200 leading-snug whitespace-pre-wrap line-clamp-2">
            {order['Florist Note']}
          </p>
        </div>
      )}
      {/* Customer note — original request from the buyer */}
      {!expanded && (order['Notes Original'] || order['Notes Translated']) && (
        <div className="mt-2 bg-blue-50 dark:bg-blue-900/30 border-l-4 border-blue-400 rounded-lg px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300 mb-0.5">
            📝 {t.customerNote || t.note || 'Note'}
          </p>
          <p className="text-sm text-ios-label dark:text-gray-200 leading-snug whitespace-pre-wrap line-clamp-2">
            {order['Notes Translated'] || order['Notes Original']}
          </p>
        </div>
      )}
      {/* Card message — clearly distinct from florist note */}
      {!expanded && order['Greeting Card Text'] && (
        <div className="relative mt-2 bg-amber-50 dark:bg-amber-900/30 rounded-lg px-3 py-1.5 overflow-hidden" style={{ maxHeight: '2.2em' }}>
          <p className="text-sm text-ios-label dark:text-gray-200 leading-snug whitespace-pre-wrap">
            ✉ {order['Greeting Card Text']}
          </p>
          <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-amber-50 dark:from-amber-900/30 to-transparent" />
        </div>
      )}

      {/* Quick status transition button on collapsed card */}
      {!expanded && !isTerminal && (() => {
        const nextStatuses = ALLOWED_TRANSITIONS[currentStatus] || [];
        const primary = nextStatuses.find(s => s !== 'Cancelled');
        if (!primary) return null;
        const labelMap = {
          'Ready': t.markReady,
          'Delivered': t.markDelivered,
          'Picked Up': t.markPickedUp,
        };
        return (
          <div className="mt-2 pt-2 border-t border-gray-100">
            <button
              onClick={e => { e.stopPropagation(); onPatch({ 'Status': primary }); }}
              disabled={saving}
              className="w-full py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold active-scale disabled:opacity-40"
            >
              {labelMap[primary] || primary}
            </button>
          </div>
        );
      })()}
    </>
  );
}
