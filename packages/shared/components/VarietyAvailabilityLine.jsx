import DateTag from './DateTag.jsx';

/**
 * VarietyAvailabilityLine — the ONE labelled availability line for a Variety,
 * shared by the bouquet catalog list (Step2Bouquet, florist + dashboard) and
 * the picker. Replaces the old "three unlabelled numbers" (42 net · 50 batch ·
 * 8 demand) with named buckets that visibly add up (CR-23/28):
 *
 *   On hand X · Committed Y · Reserved Z · Net N   [ +I <DateTag arriving> · Effective E ]
 *
 * onHand − committed − reserved = net (free now); net + incoming = effective
 * (free once POs land). Zero-value buckets (committed/reserved/incoming) hide to
 * cut clutter; On hand + Net always show. Effective shows only when incoming > 0
 * (otherwise it equals Net). A negative Net is amber — a genuine shortfall /
 * buy signal (D5: the word is "Committed", never "planned").
 *
 * Colours use the default Tailwind palette only (no app-specific tokens) since
 * this renders in both the florist and dashboard apps.
 *
 * @param {{ availability: object, t?: object }} props
 *   availability — output of getVarietyAvailability(rows, reservations, arrivals)
 */
export default function VarietyAvailabilityLine({ availability, t = {} }) {
  const {
    onHand = 0,
    committed = 0,
    reserved = 0,
    incoming = 0,
    net = 0,
    effective = 0,
    arrivals = [],
  } = availability || {};

  const firstArrival = arrivals[0]?.date ?? null;
  const netClass = net < 0 ? 'text-amber-600' : 'text-gray-900';

  return (
    <div
      data-testid="variety-availability"
      className="text-sm text-gray-500 flex flex-wrap items-center gap-x-1.5"
    >
      <span>
        <span className="font-medium text-gray-900">{onHand}</span> {t.onHand ?? 'On hand'}
      </span>
      {committed > 0 && (
        <span>· {committed} {t.committed ?? 'Committed'}</span>
      )}
      {reserved > 0 && (
        <span>· {reserved} {t.reserved ?? 'Reserved'}</span>
      )}
      <span>
        ·{' '}
        <span data-testid="avail-net" className={`font-semibold ${netClass}`}>{net}</span>{' '}
        {t.net ?? 'Net'}
      </span>
      {incoming > 0 && (
        <span data-testid="avail-incoming" className="flex items-center gap-x-1">
          · <span className="text-blue-600 font-medium">+{incoming}</span>
          {firstArrival && <DateTag date={firstArrival} kind="arriving" compact t={t} />}
          · <span className="font-medium text-gray-900">{effective}</span> {t.effective ?? 'Effective'}
        </span>
      )}
    </div>
  );
}
