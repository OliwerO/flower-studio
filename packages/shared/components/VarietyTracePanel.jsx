import { formatDateDMY } from '../utils/formatDate.js';
import { byDateAsc } from '../utils/sortByDate.js';

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
export default function VarietyTracePanel({ events = [], unaccountedStems = 0, t, onOrderClick }) {
  const hasEvents = events && events.length > 0;

  const sorted = hasEvents ? [...events].sort(byDateAsc) : [];

  const dated = sorted.filter((e) => e.date);
  let running = 0;
  const balancePts = dated.length
    ? [{ balance: 0 }, ...dated.map((e) => { running += (e.qty ?? e.quantity ?? 0); return { balance: running }; })]
    : [];

  return (
    <div>
      <BalanceSparkline points={balancePts} t={t} />
      {hasEvents ? (
        <ul className="divide-y divide-gray-50 bg-white rounded-lg border border-gray-100 overflow-hidden max-h-64 overflow-y-auto">
          {sorted.map((entry, i) => (
            <TraceRow key={i} entry={entry} t={t} onOrderClick={onOrderClick} />
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

function BalanceSparkline({ points, t }) {
  if (!points || points.length < 2) return null;
  const W = 320, H = 64, PAD = 6;
  const ys = points.map((p) => p.balance);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(0, ...ys);
  const yRange = Math.max(1, yMax - yMin);
  const xStep = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const px = (i) => PAD + xStep * i;
  const py = (v) => PAD + (1 - (v - yMin) / yRange) * (H - PAD * 2);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(1)} ${py(p.balance).toFixed(1)}`).join(' ');
  const zeroY = py(0);
  const lastBal = ys[ys.length - 1];
  return (
    <div data-testid="trace-sparkline" className="bg-gradient-to-b from-blue-50/40 to-white px-3 py-2 border-b border-gray-100">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-gray-500 mb-1">
        <span>{t.traceBalance ?? 'Balance'}</span>
        <span className={`tabular-nums font-semibold ${lastBal < 0 ? 'text-red-600' : 'text-gray-700'}`}>{lastBal} {t.stems}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
        {yMin < 0 && yMax >= 0 && (<line x1={PAD} x2={W - PAD} y1={zeroY} y2={zeroY} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="3 3" />)}
        <path d={path} fill="none" stroke={lastBal < 0 ? '#ef4444' : '#10b981'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (<circle key={i} cx={px(i)} cy={py(p.balance)} r="2" fill={p.balance < 0 ? '#ef4444' : '#10b981'} />))}
      </svg>
    </div>
  );
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
