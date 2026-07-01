import { useId } from 'react';
import { formatDateDMY } from '../utils/formatDate.js';

/**
 * BalanceSparkline — stock balance over time, redesigned for at-a-glance reading
 * (owner feedback C round-2: the old chart crammed a balance + delta + identity
 * label onto EVERY event → tiny, overlapping, clipped text).
 *
 * The rule now (fintech balance-chart pattern — Robinhood / Monzo / NN-g
 * "clutter-free charts"): the chart shows the SHAPE + a few anchor values; the
 * per-event detail lives in the list below. Concretely:
 *   1. A big headline CURRENT balance (the answer) sits above the plot.
 *   2. The running balance is a HOLD-then-jump staircase (stock holds until an
 *      event fires), time-proportional on X.
 *   3. Only three things are direct-labelled: opening (start), peak/floor
 *      (y-axis), and 0. No per-event text — it clipped and shrank.
 *   4. The area fill is split at the zero baseline: green above, red below, so a
 *      negative balance ("buy stems") is a visible signal, not decoration.
 *   5. Events are bare coloured dots (green = in, red = out, gray = dissolve);
 *      order dots stay clickable via onOrderClick. Legend maps colour → meaning.
 *
 * Props
 *   events      — raw event array (same shape as /stock/:id/usage,
 *                 /stock/varieties/:key/usage). Undated events are ignored.
 *   t           — translation strings (stems, traceBalance, traceTypeOrder,
 *                 traceTypeWriteoff, traceTypePurchase, traceTypePremade,
 *                 traceTypeDissolve, traceLegendIn, traceLegendOut, traceOpening)
 *   onOrderClick — optional (orderRecordId, event) => void — fires when an
 *                  order-type marker is clicked.
 *   asOf        — optional ISO date string for "now"; defaults to the last
 *                 dated event's date.
 *   opening     — stems that existed BEFORE the first recorded event (B2). The
 *                 running balance starts here instead of 0, so pre-cutover stock
 *                 keeps the line from diving below zero.
 */
export default function BalanceSparkline({ events = [], t = {}, onOrderClick, asOf, opening = 0 }) {
  const uid = useId();

  // --- 1. Prepare dated events -------------------------------------------
  const dated = (events || [])
    .filter((e) => e.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (dated.length < 1) return null;

  // --- 2. Running balance ---------------------------------------------------
  const openingBal = Number(opening) || 0;
  let running = openingBal;
  const points = dated.map((e) => {
    const qty = e.qty ?? e.quantity ?? 0;
    running += qty;
    return { event: e, balance: running, delta: qty };
  });

  const lastPoint = points[points.length - 1];
  const lastBal = lastPoint.balance;

  // --- 3. Layout ------------------------------------------------------------
  // viewBox is kept close to the real render width (~340–480px) so text renders
  // near 1:1 instead of being shrunk to illegibility. aspect-ratio + w-full lets
  // the height follow the width, so nothing is letterboxed or downscaled.
  const W = 360;
  const H = 176;
  const padLeft = 30;   // y-axis anchor labels
  const padRight = 18;  // room for the endpoint dot + labels (no clipping)
  const padTop = 16;
  const padBottom = 26; // x-axis date ticks

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
  const allBals = [0, openingBal, ...points.map((p) => p.balance)];
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
  const y0 = yOf(openingBal);
  pathParts.push(`M ${x0.toFixed(1)} ${y0.toFixed(1)}`);                       // start at opening balance
  pathParts.push(`L ${x0.toFixed(1)} ${yOf(points[0].balance).toFixed(1)}`);  // jump after first event

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

  // Area between the staircase and the zero baseline, split at zero via two
  // clip rects → green fill above zero, red below.
  const areaD = `${pathD} L ${xEnd.toFixed(1)} ${zeroY.toFixed(1)} L ${x0.toFixed(1)} ${zeroY.toFixed(1)} Z`;
  const plotBottom = padTop + plotH;

  // --- 7. X-axis tick labels (start / mid / now — at most 3) ----------------
  const tickDates = (() => {
    const all = [...new Set(dated.map((e) => e.date))];
    if (all.length <= 3) return all;
    return [all[0], all[Math.floor(all.length / 2)], all[all.length - 1]];
  })();

  // --- 8. Helpers -----------------------------------------------------------
  function markerFill(ev) {
    const qty = ev.qty ?? ev.quantity ?? 0;
    if (ev.type === 'dissolve') return '#9ca3af'; // gray
    return qty > 0 ? '#10b981' : '#ef4444';
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

  // --- 9. Anchor y-labels: max / 0 / min ------------------------------------
  const maxBalStr = `${yMax > 0 ? '+' : ''}${yMax}`;
  const maxY = yOf(yMax);
  const minY = yOf(yMin);
  const showMin = yMin < 0; // only label a negative floor; 0 already labelled

  // Opening label: keep it inside the plot (flip below the dot if it's near top).
  const openingLabelBelow = y0 - padTop < 14;

  // --- Render ---------------------------------------------------------------
  return (
    <div
      data-testid="trace-sparkline"
      className="bg-white px-3 pt-2 pb-2 border-b border-gray-100"
    >
      {/* Hero: the current balance is the answer; the chart is context. */}
      <div className="leading-none mb-1">
        <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">
          {t.traceBalance ?? 'Balance'}
        </div>
        <div className="mt-1">
          <span
            data-testid="balance-current"
            className={`text-3xl font-bold tabular-nums ${lastBal < 0 ? 'text-red-600' : 'text-emerald-600'}`}
          >
            {lastBal}
          </span>
          <span className="ml-1 text-sm text-gray-400">{t.stems}</span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 'auto', aspectRatio: `${W} / ${H}`, display: 'block' }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <clipPath id={`${uid}-above`}>
            <rect x="0" y={padTop} width={W} height={Math.max(0, zeroY - padTop)} />
          </clipPath>
          <clipPath id={`${uid}-below`}>
            <rect x="0" y={zeroY} width={W} height={Math.max(0, plotBottom - zeroY)} />
          </clipPath>
        </defs>

        {/* Sign-split area fill: green above zero, red below. */}
        <path d={areaD} fill="#10b981" fillOpacity="0.14" stroke="none" clipPath={`url(#${uid}-above)`} />
        <path d={areaD} fill="#ef4444" fillOpacity="0.14" stroke="none" clipPath={`url(#${uid}-below)`} />

        {/* Zero baseline — the only gridline. */}
        <line
          data-testid="zero-line"
          x1={padLeft}
          x2={W - padRight}
          y1={zeroY}
          y2={zeroY}
          stroke="#d1d5db"
          strokeWidth="1"
          strokeDasharray="3 3"
        />

        {/* Anchor y-labels (peak / floor / zero) — replace the gridlines. */}
        <text x={padLeft - 5} y={maxY + 4} textAnchor="end" fontSize="11" fill="#9ca3af" className="tabular-nums" data-testid="y-label-max">
          {maxBalStr}
        </text>
        <text x={padLeft - 5} y={zeroY + 4} textAnchor="end" fontSize="11" fill="#9ca3af" className="tabular-nums" data-testid="y-label-zero">
          0
        </text>
        {showMin && (
          <text x={padLeft - 5} y={minY + 4} textAnchor="end" fontSize="11" fill="#ef4444" className="tabular-nums" data-testid="y-label-min">
            {yMin}
          </text>
        )}

        {/* Staircase line — neutral slate so the fill/colour carry the meaning. */}
        <path
          d={pathD}
          fill="none"
          stroke="#334155"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Opening balance anchor (B2): where the pre-record stock starts. */}
        {openingBal > 0 && (
          <g data-testid="opening-marker">
            <circle cx={x0.toFixed(1)} cy={y0.toFixed(1)} r="3.5" fill="#6366f1" stroke="#ffffff" strokeWidth="1.25" />
            <text
              x={(x0 + 6).toFixed(1)}
              y={(openingLabelBelow ? y0 + 13 : y0 - 7).toFixed(1)}
              textAnchor="start"
              fontSize="11"
              fontWeight="600"
              fill="#6366f1"
              className="tabular-nums"
            >
              {t.traceOpening ?? 'opening'} {openingBal}
            </text>
          </g>
        )}

        {/* Event dots — bare (no per-event text). Order dots are clickable. */}
        {points.map((p, i) => {
          const cx = xOf(p.event.date);
          const cy = yOf(p.balance);
          const ev = p.event;
          const qty = ev.qty ?? ev.quantity ?? 0;
          const qtyStr = qty > 0 ? `+${qty}` : `${qty}`;
          const detail = trailDetailFor(ev, t);
          const titleText = `${typeLabelFor(ev.type)} · ${qtyStr} ${t.stems ?? 'stems'} · ${formatDateDMY(ev.date)}${detail ? ` · ${detail}` : ''}`;
          const isOrderClickable = ev.type === 'order' && !!onOrderClick && !!ev.orderRecordId;
          const r = isOrderClickable ? 4.5 : 3.5;
          return (
            <circle
              key={i}
              data-testid={`marker-${ev.type}`}
              cx={cx.toFixed(1)}
              cy={cy.toFixed(1)}
              r={r}
              fill={markerFill(ev)}
              stroke="#ffffff"
              strokeWidth="1.25"
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

        {/* Current-balance endpoint — enlarged hero dot on the line. */}
        <circle
          data-testid="endpoint-marker"
          cx={xEnd.toFixed(1)}
          cy={yOf(lastBal).toFixed(1)}
          r="5"
          fill={lastBal < 0 ? '#ef4444' : '#10b981'}
          stroke="#ffffff"
          strokeWidth="1.75"
        />

        {/* X-axis date ticks — start / mid / now. */}
        {tickDates.map((d) => {
          const tx = xOf(d);
          const label = formatDateDMY(d).slice(0, 5); // DD.MM only
          // Keep the first/last tick text from spilling past the plot edges.
          const anchor = tx <= padLeft + 2 ? 'start' : tx >= W - padRight - 2 ? 'end' : 'middle';
          return (
            <text
              key={d}
              x={tx.toFixed(1)}
              y={H - 8}
              textAnchor={anchor}
              fontSize="11"
              fill="#9ca3af"
              className="tabular-nums"
              data-testid={`x-tick-${d}`}
            >
              {label}
            </text>
          );
        })}
      </svg>

      {/* Legend (HTML, crisp text — colour → meaning). */}
      <div className="mt-1 flex items-center gap-4 text-[11px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#10b981' }} />
          {t.traceLegendIn ?? 'in'}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#ef4444' }} />
          {t.traceLegendOut ?? 'out'}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#9ca3af' }} />
          {t.traceTypeDissolve ?? 'dissolved'}
        </span>
      </div>
    </div>
  );
}

function trailDetailFor(ev, t) {
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
