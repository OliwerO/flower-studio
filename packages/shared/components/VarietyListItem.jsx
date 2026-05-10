/**
 * VarietyListItem — collapsible row for a single Variety in the Y-model Stock list.
 *
 * Sits beneath a <TypeGroupHeader> and shows 4 buckets of aggregated stem counts
 * derived from `getVarietyTotals`. Expanding the row reveals individual Batch and
 * Demand-Entry sub-rows sorted by date ascending.
 *
 * Props:
 *   variety     {Object}   — Variety group object from `groupByVariety`:
 *                              { key, type_name, colour, size_cm, cultivar, rows[] }
 *                            Each row must have { id, current_quantity, date }.
 *   reservations {Map<string,number>}
 *                           — Map from stock-row id → reserved stem count (from
 *                             premade_bouquet_lines JOIN). Passed down from the host page.
 *   hideType    {boolean}  — When true (normal case: under a TypeGroupHeader) drop
 *                            the Type prefix from the display name, showing only
 *                            "<Colour> <Size>cm <Cultivar?>".
 *   expanded    {boolean}  — Whether the sub-row expansion is visible.
 *   onToggle    {Function} — Called when the header row is clicked (toggle expand).
 *   onBatchClick {Function} [optional]
 *                           — Called with `stockItemId` when a Batch row is tapped.
 *                             Not called for Demand Entry rows (those are read-only).
 *                             Kind classification: current_quantity < 0 → 'demand',
 *                             else 'batch' (ADR-0005 negative-qty derivation rule).
 *   premadesByStockId {Map<string,Array>} [optional, Task 7]
 *                           — Map from stock-row id → premade-bouquet lines for
 *                             the reserved-tap detail sheet (Task 7). Ignored here.
 *   t           {Object}   — Translation strings. Required keys:
 *                              onHand, planned, reserved, net, stems.
 *
 * Bucket definitions (ADR-0005, pitfall #8):
 *   onHand            — sum of positive current_quantity rows (physical stems on shelf)
 *   planned           — absolute sum of negative current_quantity rows (shortfall to fill)
 *   reserved          — stems committed to premade bouquets (from reservations Map)
 *   net               — onHand − planned − reserved (effective availability)
 *
 * IMPORTANT: Never inline qty − reserved subtraction here. Always call
 * `getVarietyTotals(variety.rows, reservations)`. This is the pitfall #8 hotspot —
 * two prior double-count bugs came from doing the subtraction at the wrong level.
 * See packages/shared/utils/stockMath.js for the full history.
 *
 * References: PRD #283, ADR-0005, ADR-0006, pitfall #8.
 */
import { getVarietyTotals } from '../utils/stockMath.js';
import { varietyDisplayName } from '../utils/varietyKey.js';

export default function VarietyListItem({
  variety,
  reservations = new Map(),
  hideType = true,
  expanded = false,
  onToggle,
  onBatchClick,
  // premadesByStockId reserved for Task 7
  t,
}) {
  // Aggregate the 4 buckets — never inline; always go through the helper (pitfall #8).
  const { onHand, planned, reservedForPremades, net } = getVarietyTotals(
    variety.rows,
    reservations,
  );

  // Build display name. When under a TypeGroupHeader (hideType=true), drop the
  // type_name prefix so we don't repeat "Rose Rose Pink 60cm" in the list.
  const displayName = hideType
    ? varietyDisplayName({ ...variety, type_name: null })
    : varietyDisplayName(variety);

  const netNegative = net < 0;

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {/* ── Header row ── */}
      <button
        type="button"
        data-testid="variety-header"
        onClick={onToggle}
        className="w-full flex items-center px-4 py-2.5 text-left transition-colors active:bg-gray-50"
      >
        {/* Left: Variety display name */}
        <span className="flex-1 min-w-0 text-sm font-medium text-gray-800 truncate pr-3">
          {displayName}
        </span>

        {/* Right: 4-bucket numeric grid — equal columns, values right-aligned */}
        <span className="grid grid-cols-4 gap-x-4 text-right shrink-0">
          {/* onHand */}
          <span className="flex flex-col items-end">
            <span data-testid="bucket-onHand" className="text-sm font-semibold text-gray-900 tabular-nums">
              {onHand}
            </span>
            <span className="text-[10px] text-gray-400 leading-none">{t.onHand}</span>
          </span>

          {/* planned */}
          <span className="flex flex-col items-end">
            <span data-testid="bucket-planned" className="text-sm font-semibold text-gray-900 tabular-nums">
              {planned}
            </span>
            <span className="text-[10px] text-gray-400 leading-none">{t.planned}</span>
          </span>

          {/* reserved (for premades) */}
          <span className="flex flex-col items-end">
            <span data-testid="bucket-reserved" className="text-sm font-semibold text-gray-900 tabular-nums">
              {reservedForPremades}
            </span>
            <span className="text-[10px] text-gray-400 leading-none">{t.reserved}</span>
          </span>

          {/* net — red when negative */}
          <span className="flex flex-col items-end">
            <span
              data-testid="bucket-net"
              className={`text-sm font-semibold tabular-nums ${netNegative ? 'text-red-600' : 'text-gray-900'}`}
            >
              {net}
            </span>
            <span className="text-[10px] text-gray-400 leading-none">{t.net}</span>
          </span>
        </span>
      </button>

      {/* ── Expansion body ── */}
      {expanded && (
        <ul className="bg-gray-50 border-t border-gray-100">
          {[...variety.rows]
            .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
            .map((row) => {
              // ADR-0005 negative-qty derivation rule: negative qty → Demand Entry
              const kind = row.current_quantity < 0 ? 'demand' : 'batch';
              const absQty = Math.abs(row.current_quantity);
              const label = `(${row.date ?? '—'}) ${absQty} ${t.stems}`;

              if (kind === 'batch') {
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      data-testid="stock-item-row"
                      data-row-kind="batch"
                      onClick={() => onBatchClick && onBatchClick(row.id)}
                      className="w-full text-left px-6 py-2 text-sm text-gray-700 active:bg-gray-100 transition-colors"
                    >
                      {label}
                    </button>
                  </li>
                );
              }

              // Demand Entry — read-only, visually distinct
              return (
                <li key={row.id}>
                  <div
                    data-testid="stock-item-row"
                    data-row-kind="demand"
                    className="px-6 py-2 text-sm text-red-700 bg-red-50"
                  >
                    {label}
                  </div>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
