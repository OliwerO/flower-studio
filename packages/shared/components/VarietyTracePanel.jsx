import { formatDateDMY } from '../utils/formatDate.js';

/**
 * VarietyTracePanel — presentational per-Variety usage trail (PRD #324 T5).
 *
 * Sibling of BatchTracePanel, but spans EVERY Stock row in a Variety (all
 * Batches + Demand Entries) rather than one Batch. Data comes from
 * GET /stock/varieties/:key/usage → { variety, events, unaccountedStems }.
 *
 * Props:
 *   events           — array of trail events (already date-asc from the API;
 *                      we re-sort defensively, undated last)
 *   unaccountedStems — signed Σ of all event quantities. Non-zero = drift
 *                      (e.g. a deferred absorption, or a qty change with no
 *                      emitting event). Surfaces a footer only when non-zero.
 *   t                — strings (traceTypeOrder/Writeoff/Purchase/Premade,
 *                      traceEmpty, stems, unaccountedStems)
 *
 * Absorption events are deferred (audit_log has no transaction_id) — they show
 * up inside `unaccountedStems` rather than as paired rows. See the T5 plan.
 */
export default function VarietyTracePanel({ events = [], unaccountedStems = 0, t }) {
  const hasEvents = events && events.length > 0;

  const sorted = hasEvents
    ? [...events].sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      })
    : [];

  return (
    <div>
      {hasEvents ? (
        <ul className="divide-y divide-gray-50 bg-white rounded-lg border border-gray-100 overflow-hidden max-h-64 overflow-y-auto">
          {sorted.map((entry, i) => (
            <TraceRow key={i} entry={entry} t={t} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-400 py-2 text-center">{t.traceEmpty}</p>
      )}

      {unaccountedStems !== 0 && (
        <div
          data-testid="unaccounted-footer"
          className="mt-2 flex items-center justify-between px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs"
        >
          <span className="font-medium text-amber-800">{t.unaccountedStems ?? 'Unaccounted'}</span>
          <span className="font-semibold tabular-nums text-amber-800">
            {unaccountedStems > 0 ? '+' : ''}{unaccountedStems} {t.stems}
          </span>
        </div>
      )}
    </div>
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
