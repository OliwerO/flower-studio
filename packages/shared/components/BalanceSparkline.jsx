import { formatDateDMY } from '../utils/formatDate.js';

/**
 * BalanceSparkline — step-chart rendering of stock balance over time.
 *
 * Redesigned (CR-18) to be a tool, not decoration: the running balance AND the
 * delta + event identity at each change are legible ON the chart, without hover.
 *   1. Stock HOLDS its level until an event fires — staircase, not diagonal.
 *   2. X axis is time-proportional (3 days wide = 3x a 1-day column).
 *   3. Y axis always includes 0, with min / 0 / max gridlines + value labels.
 *   4. At each event: the running balance (how many we had) + the signed delta
 *      (what changed it), colour-coded; a short identity (order / supplier /
 *      bouquet / reason) under the date when the series is short enough to read.
 *   5. Event markers: green = in, red = out, gray = dissolve. Order markers are
 *      clickable via onOrderClick. A legend maps colour → meaning.
 *
 * Props
 *   events      — raw event array (same shape as /stock/:id/usage,
 *                 /stock/varieties/:key/usage). Undated events are ignored.
 *   t           — translation strings (stems, traceTypeOrder, traceTypeWriteoff,
 *                 traceTypePurchase, traceTypePremade, traceTypeDissolve,
 *                 traceBalance, traceLegendIn, traceLegendOut)
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
    return { event: e, balance: running, delta: qty };
  });

  const lastPoint = points[points.length - 1];
  const lastBal = lastPoint.balance;

  // --- 3. Layout constants ---------------------------------------------------
  const W = 480;
  const H = 230;
  const padLeft = 38;   // room for y-axis value labels
  const padRight = 16;
  const padTop = 30;    // room for top balance label
  const padBottom = 64; // x-axis date ticks + identity + legend

  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  // Show per-event balance/delta labels + identity only when the series is
  // short enough that they don't collide; otherwise the markers + the event
  // list below carry the detail. (~9 points fit at this width.)
  const labelsFit = points.length <= 9;
  const identityFits = points.length <= 6;

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
  const xEnd = xOf(lastDate);
  pathParts.push(`L ${xEnd.toFixed(1)} ${yOf(lastBal).toFixed(1)}`);  // trail to asOf
  const pathD = pathParts.join(' ');

  // Soft fill under the staircase (down to the zero line) for readability.
  const areaD = `${pathD} L ${xEnd.toFixed(1)} ${zeroY.toFixed(1)} L ${x0.toFixed(1)} ${zeroY.toFixed(1)} Z`;

  // --- 7. X-axis tick labels ------------------------------------------------
  const tickDates = (() => {
    if (dated.length <= 6) {
      return [...new Set(dated.map((e) => e.date))];
    }
    const all = [...new Set(dated.map((e) => e.date))];
    const mid = all[Math.floor(all.length / 2)];
    return [all[0], mid, all[all.length - 1]];
  })();

  // --- 8. Marker / label helpers -------------------------------------------
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

  // Short identity shown under the marker's date — "who/what" consumed/added.
  function identityShort(ev) {
    let s = null;
    switch (ev.type) {
      case 'order':    s = ev.customer ?? (ev.orderId ? `#${String(ev.orderId).slice(-3)}` : typeLabelFor('order')); break;
      case 'purchase': s = ev.supplier ?? (ev.poDisplayId ? `PO ${ev.poDisplayId}` : typeLabelFor('purchase')); break;
      case 'writeoff': s = ev.reason ?? typeLabelFor('writeoff'); break;
      case 'premade':  s = ev.bouquetName ?? typeLabelFor('premade'); break;
      case 'dissolve': s = ev.bouquetName ?? typeLabelFor('dissolve'); break;
      default:         s = ev.type;
    }
    if (!s) return null;
    return s.length > 12 ? `${s.slice(0, 11)}…` : s;
  }

  function markerFill(ev) {
    const qty = ev.qty ?? ev.quantity ?? 0;
    if (ev.type === 'dissolve') return '#9ca3af'; // gray
    return qty > 0 ? '#10b981' : '#ef4444';
  }

  function deltaStr(p) {
    if (p.event.type === 'dissolve') {
      const r = Number(p.event.releasedQty) || 0;
      return r ? `+${r}` : '0';
    }
    return p.delta > 0 ? `+${p.delta}` : `${p.delta}`;
  }

  // --- 9. Y-axis value labels: min / 0 / max -------------------------------
  const maxBalStr = `${yMax > 0 ? '+' : ''}${yMax}`;
  const maxY = yOf(yMax);
  const minY = yOf(yMin);
  const showMin = yMin < 0; // only label a negative floor; 0 already labelled

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
        {/* Y gridlines + value labels: max, 0, (min if negative) */}
        <line x1={padLeft} x2={W - padRight} y1={maxY} y2={maxY} stroke="#f3f4f6" strokeWidth="1" />
        <text x={padLeft - 4} y={maxY + 3} textAnchor="end" fontSize="9" fill="#9ca3af" data-testid="y-label-max">
          {maxBalStr}
        </text>

        <line data-testid="zero-line" x1={padLeft} x2={W - padRight} y1={zeroY} y2={zeroY} stroke="#d1d5db" strokeWidth="1" strokeDasharray="3 3" />
        <text x={padLeft - 4} y={zeroY + 3} textAnchor="end" fontSize="9" fill="#9ca3af" data-testid="y-label-zero">
          0
        </text>

        {showMin && (
          <>
            <line x1={padLeft} x2={W - padRight} y1={minY} y2={minY} stroke="#fef2f2" strokeWidth="1" />
            <text x={padLeft - 4} y={minY + 3} textAnchor="end" fontSize="9" fill="#ef4444" data-testid="y-label-min">
              {yMin}
            </text>
          </>
        )}

        {/* Soft area + staircase line */}
        <path d={areaD} fill={lastBal < 0 ? '#ef444415' : '#10b98115'} stroke="none" />
        <path
          d={pathD}
          fill="none"
          stroke={lastBal < 0 ? '#ef4444' : '#10b981'}
          strokeWidth="1.75"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />

        {/* Event markers + on-chart balance / delta labels */}
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
          const r = isOrderClickable ? 4.5 : 3.5;
          const fill = markerFill(ev);
          // Keep labels inside the plot: balance above the marker unless it's
          // near the top, delta just below the marker.
          const balAbove = cy - padTop > 16;
          const balY = balAbove ? cy - 7 : cy + 18;
          const deltaY = balAbove ? cy + 13 : cy - 7;
          const deltaColor = ev.type === 'dissolve' ? '#6b7280' : (p.delta > 0 ? '#059669' : '#dc2626');

          return (
            <g key={i}>
              {labelsFit && (
                <>
                  <text x={cx} y={balY} textAnchor="middle" fontSize="9.5" fontWeight="700" fill={p.balance < 0 ? '#dc2626' : '#374151'} className="tabular-nums">
                    {p.balance}
                  </text>
                  <text x={cx} y={deltaY} textAnchor="middle" fontSize="8.5" fontWeight="600" fill={deltaColor} className="tabular-nums">
                    {deltaStr(p)}
                  </text>
                </>
              )}
              <circle
                data-testid={`marker-${ev.type}`}
                cx={cx.toFixed(1)}
                cy={cy.toFixed(1)}
                r={r}
                fill={fill}
                stroke="#ffffff"
                strokeWidth="1"
                {...(isOrderClickable ? {
                  role: 'button',
                  style: { cursor: 'pointer' },
                  onClick: (e) => { e.stopPropagation(); onOrderClick(ev.orderRecordId, ev); },
                } : {})}
              >
                <title>{titleText}</title>
              </circle>
              {/* Identity ("who/what") under the marker date — only when the series is short */}
              {identityFits && identityShort(ev) && (
                <text
                  x={cx}
                  y={H - padBottom + 26}
                  textAnchor="middle"
                  fontSize="7.5"
                  fill={ev.type === 'order' ? '#dc2626' : '#6b7280'}
                  data-testid={`identity-${i}`}
                >
                  {identityShort(ev)}
                </text>
              )}
            </g>
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
              y={H - padBottom + 14}
              textAnchor="middle"
              fontSize="8"
              fill="#9ca3af"
              data-testid={`x-tick-${d}`}
            >
              {label}
            </text>
          );
        })}

        {/* Legend: colour → meaning */}
        <g transform={`translate(${padLeft}, ${H - 8})`} fontSize="8" fill="#6b7280">
          <circle cx="3" cy="-3" r="3" fill="#10b981" />
          <text x="10" y="0">{t.traceLegendIn ?? 'in'}</text>
          <circle cx="48" cy="-3" r="3" fill="#ef4444" />
          <text x="55" y="0">{t.traceLegendOut ?? 'out'}</text>
          <circle cx="96" cy="-3" r="3" fill="#9ca3af" />
          <text x="103" y="0">{t.traceTypeDissolve ?? 'dissolved'}</text>
        </g>
      </svg>
    </div>
  );
}
