/**
 * VarietyIdentity — single source of truth for rendering the Variety 4-tuple
 * (type / colour / size / cultivar) with a consistent typographic hierarchy.
 *
 * Hierarchy (#311, matches shipped style from #310):
 *   - Type    — highest prio, bold
 *   - Colour  — same prio,    bold
 *   - Size    — secondary, smaller regular weight, tabular-nums
 *   - Cultivar— secondary, smaller italic, lightest grey
 *
 * Props:
 *   variety           — { type_name, colour, size_cm, cultivar }
 *   showType          — render Type (omit when a TypeGroupHeader is already
 *                       carrying it above the row). Default false.
 *   srOnlyFullName    — render an additional `sr-only` span containing the
 *                       concatenated `varietyDisplayName`. Opt-in because
 *                       Stock list tests assert Type is absent from the DOM
 *                       when `showType` is false. Picker opts in so screen
 *                       readers (and `getByText(/.../)` regex assertions)
 *                       receive the full combined name.
 *   className         — passthrough for layout tweaks.
 */
import { varietyDisplayName } from '../utils/varietyKey.js';

export default function VarietyIdentity({
  variety,
  showType = false,
  srOnlyFullName = false,
  className = '',
}) {
  const hasType     = showType && !!variety.type_name;
  const hasColour   = !!variety.colour;
  const hasSize     = variety.size_cm != null;
  const hasCultivar = !!variety.cultivar;
  const hasAny      = hasType || hasColour || hasSize || hasCultivar;

  return (
    <div
      data-testid="variety-identity"
      className={`flex items-baseline gap-2 truncate ${className}`}
    >
      {srOnlyFullName && hasAny && (
        <span className="sr-only">{varietyDisplayName(variety)}</span>
      )}
      {hasType && (
        <span className="text-sm font-semibold text-gray-900 shrink-0">
          {variety.type_name}
        </span>
      )}
      {hasColour && (
        <span className="text-sm font-semibold text-gray-900 truncate">
          {variety.colour}
        </span>
      )}
      {hasSize && (
        <span className="text-xs font-normal text-gray-600 tabular-nums shrink-0">
          {variety.size_cm}cm
        </span>
      )}
      {hasCultivar && (
        // #536 — cultivar renders in the SAME font/size/weight as Size (height)
        // so an entered cultivar is clearly legible (was italic gray-400 tertiary,
        // which the owner read as "not shown"). Still only rendered when present.
        <span className="text-xs font-normal text-gray-600 truncate">
          {variety.cultivar}
        </span>
      )}
      {!hasAny && <span className="text-sm text-gray-400">—</span>}
    </div>
  );
}
