import { formatDateDMY } from '../utils/formatDate.js';

/**
 * BalanceSparkline — step-chart rendering of stock balance over time.
 *
 * Replaces the old diagonal-line sparkline in BatchTracePanel and
 * VarietyTracePanel. Key corrections:
 *   1. Stock HOLDS its level until an event fires — staircase, not diagonal.
 *   2. X axis is time-proportional (3 days wide = 3x a 1-day column), not
 *      evenly spaced by event index.
 *   3. Y axis always includes 0. Zero line always rendered (dashed gray).
 *   4. Axis labels: max balance (top-left) + 0 label + date ticks.
 *   5. Event markers: green = purchase/in, red = consume/out, gray = dissolve.
 *   6. Order markers are clickable via onOrderClick.
 *
 * Props
 *   events      — raw event array (same shape as /stock/:id/usage,
 *                 /stock/varieties/:key/usage). Undated events are ignored.
 *   t           — translation strings (stems, traceTypeOrder, traceTypeWriteoff,
 *                 traceTypePurchase, traceTypePremade, traceTypeDissolve)
 *   onOrderClick — optional (orderRecordId, event) => void — fires when an
 *                  order-type marker is clicked.
 *   asOf        — optional ISO date string for "now"; defaults to the last
 *                 dated event's date.
 */
export default function BalanceSparkline({ events = [], t = {}, onOrderClick, asOf }) {
  // --- 1. Prepare dated events -------------------------------------------
  const dated = (events || [])
    .filter((e) => e.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (dated.length < 1) return null;

  // --- 2. Running balance ---------------------------------------------------
  let running = 0;
  const points = dated.map((e) => {
    const qty = e.qty ?? e.quantity ?? 0;
    running += qty;
    return { event: e, balance: running };
  });

  const lastPoint = points[points.length - 1];
  const lastBal = lastPoint.balance;

  // --- 3. Layout constants ---------------------------------------------------
  const W = 320;
  const H = 130;
  const padLeft = 28;   // room for y-axis labels
  const padRight = 6;
  const padTop = 14;    // room for max-balance label
  const padBottom = 18; // room for x-axis date ticks

  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  // --- 4. Scale: time → x ---------------------------------------------------
  const firstDate = dated[0].date;
  const lastDate = asOf ?? lastPoint.event.date;
  const t0 = new Date(firstDate).getTime();
  const t1 = new Date(lastDate).getTime();
  const tRange = Math.max(t1 - t0, 1); // avoid divide-by-zero for single events

  function xOf(dateStr) {
    const ms = new Date(dateStr).getTime();
    return padLeft + ((ms - t0) / tRange) * plotW;
  }

  // --- 5. Scale: balance → y ------------------------------------------------
  const allBals = [0, ...points.map((p) => p.balance)];
  const yMin = Math.min(...allBals);
  const yMax = Math.max(...allBals);
  const yRange = Math.max(1, yMax - yMin);

  function yOf(val) {
    // Inverted: higher balance = higher on chart = smaller SVG y
    return padTop + plotH - ((val - yMin) / yRange) * plotH;
  }

  const zeroY = yOf(0);

  // --- 6. Staircase path ----------------------------------------------------
  // Start at first event's x, at balance=0 (before the event lands)
  // Then jump vertically to balance after first event,
  // then for each subsequent event: H-segment (hold) then V-segment (jump).
  // Finally trail horizontal to asOf.
  const pathParts = [];

  const x0 = xOf(firstDate);
  const y0 = yOf(0);
  pathParts.push(`M ${x0.toFixed(1)} ${y0.toFixed(1)}`);           // start at zero
  pathParts.push(`L ${x0.toFixed(1)} ${yOf(points[0].balance).toFixed(1)}`); // jump after first event

  for (let i = 1; i < points.length; i++) {
    const xi = xOf(points[i].event.date);
    const prevBal = points[i - 1].balance;
    const currBal = points[i].balance;
    pathParts.push(`L ${xi.toFixed(1)} ${yOf(prevBal).toFixed(1)}`);  // hold
    pathParts.push(`L ${xi.toFixed(1)} ${yOf(currBal).toFixed(1)}`);  // jump
  }

  // Trail to asOf
  const xEnd = xOf(lastDate);
  pathParts.push(`L ${xEnd.toFixed(1)} ${yOf(lastBal).toFixed(1)}`);

  const pathD = pathParts.join(' ');

  // --- 7. X-axis tick labels ------------------------------------------------
  // Show tick under each event date if ≤6 dated events, else first/middle/last.
  const tickDates = (() => {
    if (dated.length <= 6) {
      return [...new Set(dated.map((e) => e.date))];
    }
    const all = [...new Set(dated.map((e) => e.date))];
    const mid = all[Math.floor(all.length / 2)];
    return [all[0], mid, all[all.length - 1]];
  })();

  // --- 8. Marker helpers ----------------------------------------------------
  function typeLabelFor(type) {
    switch (type) {
      case 'order':    return t.traceTypeOrder    ?? 'Order';
      case 'writeoff': return t.traceTypeWriteoff ?? 'Write-off';
      case 'purchase': return t.traceTypePurchase ?? 'Purchase';
      case 'premade':  return t.traceTypePremade  ?? 'Premade';
      case 'dissolve': return t.traceTypeDissolve ?? 'Dissolved';
      default:         return type;
    }
  }

  function trailDetailFor(ev) {
    switch (ev.type) {
      case 'order': {
        const oid = ev.orderId ?? null;
        const customer = ev.customer ?? null;
        if (oid && customer) return `${oid} — ${customer}`;
        return oid ?? customer ?? null;
      }
      case 'writeoff': return ev.reason ?? null;
      case 'purchase': return ev.supplier ?? null;
      case 'premade':  return ev.bouquetName ?? null;
      case 'dissolve': {
        const released = ev.releasedQty ? `+${ev.releasedQty} ${t.stems ?? 'stems'} freed` : null;
        return [ev.bouquetName, released].filter(Boolean).join(' · ') || null;
      }
      default: return null;
    }
  }

  function markerFill(ev) {
    const qty = ev.qty ?? ev.quantity ?? 0;
    if (ev.type === 'dissolve') return '#9ca3af'; // gray
    return qty > 0 ? '#10b981' : '#ef4444';
  }

  // --- 9. Y-axis labels: max + 0 -------------------------------------------
  const maxBalStr = `${yMax > 0 ? '+' : ''}${yMax}`;
  const maxY = yOf(yMax);

  // --- Render -----------------------------------------------------------------
  return (
    <div
      data-testid="trace-sparkline"
      className="bg-gradient-to-b from-blue-50/40 to-white px-3 py-2 border-b border-gray-100"
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-gray-500 mb-1">
        <span>{t.traceBalance ?? 'Balance'}</span>
        <span className={`tabular-nums font-semibold ${lastBal < 0 ? 'text-red-600' : 'text-gray-700'}`}>
          {lastBal} {t.stems}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: H }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Y-axis: max balance label */}
        <text
          x={padLeft - 3}
          y={maxY + 3}
          textAnchor="end"
          fontSize="8"
          fill="#9ca3af"
          data-testid="y-label-max"
        >
          {maxBalStr}
        </text>

        {/* Y-axis: faint gridline at max */}
        <line
          x1={padLeft} x2={W - padRight}
          y1={maxY} y2={maxY}
          stroke="#f3f4f6" strokeWidth="1"
        />

        {/* Zero line — ALWAYS rendered */}
        <line
          data-testid="zero-line"
          x1={padLeft} x2={W - padRight}
          y1={zeroY} y2={zeroY}
          stroke="#e5e7eb" strokeWidth="1" strokeDasharray="3 3"
        />

        {/* Zero label */}
        <text
          x={padLeft - 3}
          y={zeroY + 3}
          textAnchor="end"
          fontSize="8"
          fill="#9ca3af"
          data-testid="y-label-zero"
        >
          0
        </text>

        {/* Staircase line */}
        <path
          d={pathD}
          fill="none"
          stroke={lastBal < 0 ? '#ef4444' : '#10b981'}
          strokeWidth="1.5"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />

        {/* Event markers */}
        {points.map((p, i) => {
          const cx = xOf(p.event.date);
          const cy = yOf(p.balance);
          const ev = p.event;
          const qty = ev.qty ?? ev.quantity ?? 0;
          const detail = trailDetailFor(ev);
          const label = typeLabelFor(ev.type);
          const qtyStr = qty > 0 ? `+${qty}` : `${qty}`;
          const titleText = `${label} · ${qtyStr} ${t.stems ?? 'stems'} · ${formatDateDMY(ev.date)}${detail ? ` · ${detail}` : ''}`;
          const isOrderClickable = ev.type === 'order' && !!onOrderClick && !!ev.orderRecordId;
          const r = isOrderClickable ? 4 : 3;
          const fill = markerFill(ev);

          return (
            <circle
              key={i}
              data-testid={`marker-${ev.type}`}
              cx={cx.toFixed(1)}
              cy={cy.toFixed(1)}
              r={r}
              fill={fill}
              {...(isOrderClickable ? {
                role: 'button',
                style: { cursor: 'pointer' },
                onClick: (e) => { e.stopPropagation(); onOrderClick(ev.orderRecordId, ev); },
              } : {})}
            >
              <title>{titleText}</title>
            </circle>
          );
        })}

        {/* X-axis date ticks */}
        {tickDates.map((d) => {
          const tx = xOf(d);
          const label = formatDateDMY(d).slice(0, 5); // DD.MM only
          return (
            <text
              key={d}
              x={tx.toFixed(1)}
              y={H - 3}
              textAnchor="middle"
              fontSize="7"
              fill="#9ca3af"
              data-testid={`x-tick-${d}`}
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
