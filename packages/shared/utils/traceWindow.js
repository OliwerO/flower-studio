/**
 * traceWindow — scope a stock usage trail to a recent time window (#4b).
 *
 * The owner's complaint: a Variety's trace graph plots the ENTIRE history, so
 * once a flower has months of events the staircase is unreadable and the recent
 * weeks — the part she cares about — are squashed into a few pixels.
 *
 * `windowTrace` clips the trail to a rolling window anchored on the MOST RECENT
 * dated event (not "today" — a flower whose last activity was 3 weeks ago should
 * still show that activity, not an empty window). Events older than the cutoff
 * are folded into the opening balance so the running total in the list + graph
 * stays arithmetically correct — nothing is silently dropped from the maths, it
 * just collapses into the "stock before this window" starting point.
 *
 * Undated events (e.g. premade reservations) are always kept — they carry no
 * date to window against and don't affect the running balance.
 */

// Selectable windows, widest-first in the picker (default = first entry).
export const TRACE_WINDOWS = [
  { key: '2w', days: 14 },
  { key: '1m', days: 30 },
  { key: 'all', days: null },
];

export const DEFAULT_TRACE_WINDOW = '2w';

function isoMinusDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function qtyOf(e) {
  return Number(e.qty ?? e.quantity ?? 0) || 0;
}

/**
 * @param {Array}  events        trail events ({ date?, qty|quantity, ... })
 * @param {string} windowKey     one of TRACE_WINDOWS keys ('2w' | '1m' | 'all')
 * @param {object} opts
 * @param {number} opts.baseOpening  pre-trail opening balance from the API (B2)
 * @returns {{ events, opening, hiddenCount, windowKey }}
 *   events      — events within the window (undated always included)
 *   opening     — baseOpening + Σ(qty of folded older events)
 *   hiddenCount — how many dated events folded into `opening`
 *   windowKey   — the resolved window key (falls back to default when unknown)
 */
export function windowTrace(events = [], windowKey = DEFAULT_TRACE_WINDOW, opts = {}) {
  const baseOpening = Number(opts.baseOpening) || 0;
  const win = TRACE_WINDOWS.find((w) => w.key === windowKey) ?? TRACE_WINDOWS[0];
  const list = Array.isArray(events) ? events : [];

  const dated = list.filter((e) => e && e.date);
  // "All", nothing dated, or a single dated event → no windowing to do.
  if (win.days == null || dated.length === 0) {
    return { events: list, opening: baseOpening, hiddenCount: 0, windowKey: win.key };
  }

  const anchor = dated.reduce((m, e) => (e.date > m ? e.date : m), dated[0].date);
  const cutoff = isoMinusDays(anchor, win.days);

  let opening = baseOpening;
  let hiddenCount = 0;
  const kept = [];
  for (const e of list) {
    if (!e || !e.date) { kept.push(e); continue; } // undated always kept
    if (e.date < cutoff) {
      opening += qtyOf(e);
      hiddenCount += 1;
    } else {
      kept.push(e);
    }
  }

  return { events: kept, opening, hiddenCount, windowKey: win.key };
}
