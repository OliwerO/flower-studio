import { useState } from 'react';
import { formatDateDMY } from '../utils/formatDate.js';
import { byDateAsc } from '../utils/sortByDate.js';
import { windowTrace, DEFAULT_TRACE_WINDOW } from '../utils/traceWindow.js';
import BalanceSparkline from './BalanceSparkline.jsx';
import TraceWindowPills from './TraceWindowPills.jsx';

/**
 * BatchTracePanel — presentational component rendering the per-batch usage trail.
 * Used directly by dashboard (inline). Mounted inside BatchTraceModal by florist.
 *
 * Props:
 *   trail  — array of trace events from /stock/:id/usage response
 *   t      — translation strings (traceTypeOrder, traceTypeWriteoff, traceTypePurchase,
 *             traceTypePremade, traceEmpty, traceReservations, traceBalance, stems)
 *
 * Dated events render chronologically (oldest → newest) with a running balance
 * column so the operator can see the Batch's stem count after each event.
 * Undated premade reservations group at the bottom under a "Reserved" header —
 * reservations don't change the Batch's `current_quantity` under the Y-model
 * reservation model (issue #285), so they're excluded from the running balance.
 */
export default function BatchTracePanel({ trail = [], t, onOrderClick }) {
  // CR-12 parity: the trail (traceability) is the primary content; the balance
  // graph is secondary and OFF by default behind a "Show graph" toggle — the
  // owner opens the list to see WHERE stems went, not a chart.
  const [showGraph, setShowGraph] = useState(false);
  // #4b: scope the trail to a recent window (older events fold into the opening
  // balance so the running total stays correct).
  const [windowKey, setWindowKey] = useState(DEFAULT_TRACE_WINDOW);

  if (!trail || trail.length === 0) {
    return (
      <p className="text-xs text-gray-400 py-2 text-center">{t.traceEmpty}</p>
    );
  }

  const allDated = [];
  const reserved = [];
  for (const e of trail) {
    if (e.type === 'premade' || !e.date) reserved.push(e);
    else allDated.push(e);
  }
  allDated.sort(byDateAsc);

  const scoped = windowTrace(allDated, windowKey);
  const dated = scoped.events;

  // Running balance starts from the folded-away opening so a windowed view
  // still shows the true stem count after each shown event.
  let balance = scoped.opening;
  const withBalance = dated.map((entry) => {
    const qty = entry.qty ?? entry.quantity ?? 0;
    balance += qty;
    return { entry, balance };
  });

  return (
    <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
      {allDated.length > 0 && (
        <div className="flex items-center justify-between px-2 pt-1 gap-2">
          <TraceWindowPills windowKey={windowKey} onChange={setWindowKey} t={t} />
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
      {showGraph && <BalanceSparkline events={dated} t={t} onOrderClick={onOrderClick} opening={scoped.opening} />}
      {scoped.hiddenCount > 0 && (
        <div
          data-testid="trace-window-folded"
          className="px-3 py-1.5 bg-indigo-50/60 border-b border-indigo-100 text-[11px] text-indigo-700 flex items-center justify-between"
        >
          <span>{scoped.hiddenCount} {t.traceWindowFolded ?? 'earlier events folded in'}</span>
          <span className="tabular-nums font-semibold">= {scoped.opening} {t.stems}</span>
        </div>
      )}
      <ul className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
        {withBalance.map(({ entry, balance: bal }, i) => (
          <TraceRow key={`d-${i}`} entry={entry} balance={bal} t={t} onOrderClick={onOrderClick} />
        ))}
      </ul>
      {reserved.length > 0 && (
        <>
          <div className="px-3 py-1.5 bg-indigo-50/60 border-t border-indigo-100 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
            {t.traceReservations ?? 'Premade (no date)'}
          </div>
          <ul className="divide-y divide-gray-50">
            {reserved.map((entry, i) => (
              <TraceRow key={`r-${i}`} entry={entry} balance={null} t={t} onOrderClick={onOrderClick} />
            ))}
          </ul>
        </>
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
    case 'dissolve': {
      const released = entry.releasedQty ? `+${entry.releasedQty} ${t?.stems ?? 'stems'} freed` : null;
      return [entry.bouquetName, released].filter(Boolean).join(' · ');
    }
    default:         return null;
  }
}

function TraceRow({ entry, balance, t, onOrderClick }) {
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
        {detail && (
          <span className="text-xs text-gray-700 truncate">{detail}</span>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-2">
        {entry.date && (
          <span className="text-[10px] text-gray-400 tabular-nums">{formatDateDMY(entry.date)}</span>
        )}
        {entry.type === 'dissolve' ? (
          <span className="text-xs font-semibold tabular-nums w-16 text-right text-purple-600">
            +{Number(entry.releasedQty) || 0} {t.stems}
          </span>
        ) : (
          <span className={`text-xs font-semibold tabular-nums w-16 text-right ${qty > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {qty > 0 ? '+' : ''}{qty} {t.stems}
          </span>
        )}
        {balance != null && (
          <span
            data-testid="trace-balance"
            className={`text-[10px] tabular-nums w-14 text-right ${balance < 0 ? 'text-red-500 font-medium' : 'text-gray-500'}`}
            title={t.traceBalance ?? 'Balance after this event'}
          >
            = {balance}
          </span>
        )}
      </div>
    </li>
  );
}
