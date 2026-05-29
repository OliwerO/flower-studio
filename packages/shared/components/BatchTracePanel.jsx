import { formatDateDMY } from '../utils/formatDate.js';

/**
 * BatchTracePanel — presentational component rendering the per-batch usage trail.
 * Used directly by dashboard (inline). Mounted inside BatchTraceModal by florist.
 *
 * Props:
 *   trail  — array of trace events from /stock/:id/usage response
 *   t      — translation strings (traceTypeOrder, traceTypeWriteoff, traceTypePurchase,
 *             traceTypePremade, traceEmpty, stems)
 *
 * Sort: chronological oldest → newest so the column reads top-to-bottom as
 * time progresses. Undated events (e.g. ongoing premade reservations) sort to
 * the bottom as "current". Dates render day-month-year (formatDateDMY).
 */
export default function BatchTracePanel({ trail = [], t }) {
  if (!trail || trail.length === 0) {
    return (
      <p className="text-xs text-gray-400 py-2 text-center">{t.traceEmpty}</p>
    );
  }

  const sorted = [...trail].sort((a, b) => {
    // Undated entries last; otherwise ascending by ISO date string.
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });

  return (
    <ul className="divide-y divide-gray-50 bg-white rounded-lg border border-gray-100 overflow-hidden max-h-64 overflow-y-auto">
      {sorted.map((entry, i) => (
        <TraceRow key={i} entry={entry} t={t} />
      ))}
    </ul>
  );
}

function typeLabel(entry, t) {
  switch (entry.type) {
    case 'order':    return t.traceTypeOrder;
    case 'writeoff': return t.traceTypeWriteoff;
    case 'purchase': return t.traceTypePurchase;
    case 'premade':  return t.traceTypePremade;
    default:         return entry.type;
  }
}

function typeBadgeClass(type) {
  switch (type) {
    case 'order':    return 'bg-brand-100 text-brand-700';
    case 'writeoff': return 'bg-red-100 text-red-700';
    case 'premade':  return 'bg-indigo-100 text-indigo-700';
    case 'purchase': return 'bg-green-100 text-green-700';
    default:         return 'bg-gray-100 text-gray-700';
  }
}

function trailDetail(entry) {
  switch (entry.type) {
    case 'order': {
      // Show the human-readable order id alongside the customer so the operator
      // can match the row back to the order list ("Order #202605-00013 — Hayley Abbott").
      const oid = entry.orderId ?? null;
      const customer = entry.customer ?? null;
      if (oid && customer) return `${oid} — ${customer}`;
      return oid ?? customer ?? null;
    }
    case 'writeoff': return entry.reason ?? null;
    case 'purchase': return entry.supplier ?? null;
    case 'premade':  return entry.bouquetName ?? null;
    default:         return null;
  }
}

function TraceRow({ entry, t }) {
  const qty = entry.qty ?? entry.quantity ?? 0;
  const detail = trailDetail(entry);

  return (
    <li
      data-testid="trace-row"
      data-trace-kind={entry.type}
      className="flex items-center justify-between px-3 py-2"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${typeBadgeClass(entry.type)}`}>
          {typeLabel(entry, t)}
        </span>
        {detail && (
          <span className="text-xs text-gray-700 truncate">{detail}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        {entry.date && (
          <span className="text-[10px] text-gray-400">{formatDateDMY(entry.date)}</span>
        )}
        <span className={`text-xs font-semibold tabular-nums ${qty > 0 ? 'text-green-600' : 'text-red-600'}`}>
          {qty > 0 ? '+' : ''}{qty} {t.stems}
        </span>
      </div>
    </li>
  );
}
