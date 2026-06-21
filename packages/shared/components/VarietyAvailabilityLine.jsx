import DateTag from './DateTag.jsx';

/**
 * VarietyAvailabilityLine — the ONE labelled availability line for a Variety,
 * shared by the bouquet catalog list (Step2Bouquet, florist + dashboard) and
 * the picker. Shows the owner-decided availability model (D-A, D-B, 2026-06-21):
 *
 *   On hand {net} [· {reserved} Premade · Available {available}] [· +{incoming} <DateTag> · Effective {effective}]
 *
 * Where:
 *   On hand   = net = the grabbable-now value (onHand − committed − reserved)
 *   Premade   = reserved stems locked in premade bouquets (reclaimable)
 *   Available = net + reserved (full capacity if premades are dissolved)
 *   Effective = net + incoming (once pending PO lands)
 *
 * Premade/Available shown only when reserved > 0 (cut clutter when no premades).
 * Effective/incoming shown only when incoming > 0 (otherwise equals net).
 * A negative On hand value is amber — a genuine shortfall / buy signal.
 *
 * Colours use the default Tailwind palette only (no app-specific tokens) since
 * this renders in both the florist and dashboard apps.
 *
 * @param {{ availability: object, t?: object }} props
 *   availability — output of getVarietyAvailability(rows, reservations, arrivals)
 */
export default function VarietyAvailabilityLine({ availability, t = {} }) {
  const {
    net = 0,
    reserved = 0,
    available = 0,
    incoming = 0,
    effective = 0,
    arrivals = [],
  } = availability || {};

  const firstArrival = arrivals[0] ?? null;
  const onHandClass = net < 0 ? 'text-amber-600' : 'text-gray-900';

  return (
    <div
      data-testid="variety-availability"
      className="text-sm text-gray-500 flex flex-wrap items-center gap-x-1.5"
    >
      <span>
        <span data-testid="avail-onhand" className={`font-semibold ${onHandClass}`}>{net}</span>{' '}
        {t.onHand ?? 'On hand'}
      </span>
      {reserved > 0 && (
        <>
          <span>· {reserved} {t.premade ?? 'Premade'}</span>
          <span>· <span data-testid="avail-available" className="font-medium text-gray-900">{available}</span> {t.availTotal ?? 'Available'}</span>
        </>
      )}
      {incoming > 0 && (
        <span data-testid="avail-incoming" className="flex items-center gap-x-1">
          · <span className="text-blue-600 font-medium">+{incoming}</span>
          {firstArrival?.date && <DateTag date={firstArrival.date} kind="arriving" overdue={firstArrival.overdue} compact t={t} />}
          · <span className="font-medium text-gray-900">{effective}</span> {t.effective ?? 'Effective'}
        </span>
      )}
    </div>
  );
}
