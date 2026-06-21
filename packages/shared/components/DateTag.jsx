import { formatDateDMY } from '../utils/formatDate.js';

/**
 * DateTag — the single coloured date chip used across every Y-model stock
 * surface (decision D6, 2026-06-12). One component so a date never renders
 * as a raw ISO string or a relative "+Nd" again.
 *
 * Props:
 *   date    — ISO 'YYYY-MM-DD' (or null/'' → undated marker)
 *   kind    — 'arrived' | 'needed' | 'arriving' (drives the colour)
 *   overdue — true → render red regardless of kind (D-E, 2026-06-21).
 *             Overdue arrivals keep their semantic kind but signal urgency in red.
 *   compact — true → DD.MM (drop the year) for tight inline chips;
 *             default → DD.MM.YYYY
 *   t       — strings ({ undatedShort })
 *
 * Colour legend (D6): arrived = grey (batch), needed = red (demand),
 * arriving = blue (incoming PO). When overdue=true, any kind renders red.
 */
const KIND_CLASS = {
  arrived:  'bg-gray-100 text-gray-600',
  needed:   'bg-red-100 text-red-700',
  arriving: 'bg-blue-100 text-blue-700',
};

const OVERDUE_CLASS = 'bg-red-100 text-red-700';

export default function DateTag({ date, kind = 'arrived', overdue = false, compact = false, t = {} }) {
  const full = formatDateDMY(date); // '' when no/invalid date
  const label = !full
    ? (t.undatedShort ?? '—')
    : compact
      ? full.slice(0, 5) // 'DD.MM'
      : full;            // 'DD.MM.YYYY'

  const colour = overdue ? OVERDUE_CLASS : (KIND_CLASS[kind] ?? KIND_CLASS.arrived);

  return (
    <span
      data-testid="date-tag"
      data-kind={kind}
      className={`inline-flex items-baseline px-1.5 py-0.5 rounded text-[11px] font-medium tabular-nums ${colour}`}
    >
      {label}
    </span>
  );
}
