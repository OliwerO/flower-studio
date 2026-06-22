import { useState } from 'react';
import { formatDateDMY } from '../utils/formatDate.js';
import { byDateAsc } from '../utils/sortByDate.js';
import BalanceSparkline from './BalanceSparkline.jsx';

/**
 * VarietyTracePanel — presentational per-Variety usage trail (PRD #324 T5).
 *
 * Sibling of BatchTracePanel, but spans EVERY Stock row in a Variety (all
 * Batches + Demand Entries) rather than one Batch. Data comes from
 * GET /stock/varieties/:key/usage → { variety, events, unaccountedStems, drift }.
 *
 * Props:
 *   events           — array of trail events (already date-asc from the API;
 *                      we re-sort defensively, undated last)
 *   unaccountedStems — signed Σ of all event quantities (kept for callers;
 *                      no longer drives the footer — use `drift` for that).
 *   drift            — TRUE drift: unaccountedStems + reservedStems − onHand.
 *                      Footer renders ONLY when drift > 0 (stems vanished with
 *                      no recorded event). drift ≤ 0 = reconciled, footer hidden.
 *   t                — strings (traceTypeOrder/Writeoff/Purchase/Premade,
 *                      traceEmpty, stems, unaccountedStems)
 *
 * Absorption events are deferred (audit_log has no transaction_id) — they show
 * up inside `unaccountedStems` rather than as paired rows. See the T5 plan.
 */
export default function VarietyTracePanel({ events = [], unaccountedStems = 0, drift = 0, t, onOrderClick }) {
  const hasEvents = events && events.length > 0;

  const sorted = hasEvents ? [...events].sort(byDateAsc) : [];

  // CR-12: the balance graph is OFF by default. Expanding a row shows the
  // consuming-orders list (what the owner asked for); a right-aligned button
  // reveals the graph only when she wants it. Resets each time the row reopens.
  const [showGraph, setShowGraph] = useState(false);

  return (
    <div>
      {hasEvents && (
        <div className="flex justify-end mb-1">
          <button
            type="button"
            data-testid="trace-graph-toggle"
            onClick={(e) => { e.stopPropagation(); setShowGraph(g => !g); }}
            aria-pressed={showGraph}
            className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100 active:bg-indigo-200"
          >
            📈 {showGraph ? (t.hideGraph ?? 'Hide graph') : (t.showGraph ?? 'Show graph')}
          </button>
        </div>
      )}
      {showGraph && <BalanceSparkline events={sorted} t={t} onOrderClick={onOrderClick} />}
      {hasEvents ? (
        <ul className="divide-y divide-gray-50 bg-white rounded-lg border border-gray-100 overflow-hidden max-h-64 overflow-y-auto">
          {sorted.map((entry, i) => (
            <TraceRow key={i} entry={entry} t={t} onOrderClick={onOrderClick} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-400 py-2 text-center">{t.traceEmpty}</p>
      )}

      {drift > 0 && (
        <div
          data-testid="unaccounted-footer"
          className="mt-2 flex items-center justify-between px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs"
        >
          <span className="font-medium text-amber-800">{t.unaccountedStems ?? 'Unaccounted'}</span>
          <span className="font-semibold tabular-nums text-amber-800">
            +{drift} {t.stems}
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
    case 'dissolve': return t.traceTypeDissolve ?? 'Dissolved';
    default:         return entry.type;
  }
}

function typeBadgeClass(type) {
  switch (type) {
    case 'order':    return 'bg-brand-100 text-brand-700';
    case 'writeoff': return 'bg-red-100 text-red-700';
    case 'premade':  return 'bg-indigo-100 text-indigo-700';
    case 'purchase': return 'bg-green-100 text-green-700';
    case 'dissolve': return 'bg-purple-100 text-purple-700';
    default:         return 'bg-gray-100 text-gray-700';
  }
}

function trailDetail(entry, t) {
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
    case 'dissolve': {
      const released = entry.releasedQty ? `+${entry.releasedQty} ${t?.stems ?? 'stems'} freed` : null;
      return [entry.bouquetName, released].filter(Boolean).join(' · ');
    }
    default:         return null;
  }
}

function TraceRow({ entry, t, onOrderClick }) {
  const qty = entry.qty ?? entry.quantity ?? 0;
  const detail = trailDetail(entry, t);
  const clickable = entry.type === 'order' && !!onOrderClick && !!entry.orderRecordId;

  return (
    <li
      data-testid="trace-row"
      data-trace-kind={entry.type}
      className={`flex items-center justify-between px-3 py-2 ${clickable ? 'cursor-pointer hover:bg-brand-50 transition-colors' : ''}`}
      {...(clickable ? {
        role: 'button',
        tabIndex: 0,
        onClick: (e) => { e.stopPropagation(); onOrderClick(entry.orderRecordId, entry); },
        onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOrderClick(entry.orderRecordId, entry); } },
      } : {})}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${typeBadgeClass(entry.type)}`}>
          {typeLabel(entry, t)}
        </span>
        {entry.firstPo && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 bg-sky-100 text-sky-700">
            {t.traceFirstPo ?? 'First PO'}
          </span>
        )}
        {entry.firstDemand && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 bg-amber-100 text-amber-700">
            {t.traceFirstDemand ?? 'First demand'}
          </span>
        )}
        {detail && (
          <span className="text-xs text-gray-700 truncate">{detail}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        {entry.date && (
          <span className="text-[10px] text-gray-400">{formatDateDMY(entry.date)}</span>
        )}
        {entry.type === 'dissolve' ? (
          <span className="text-xs font-semibold tabular-nums text-purple-600">
            +{Number(entry.releasedQty) || 0} {t.stems}
          </span>
        ) : (
          <span className={`text-xs font-semibold tabular-nums ${qty > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {qty > 0 ? '+' : ''}{qty} {t.stems}
          </span>
        )}
      </div>
    </li>
  );
}
