/**
 * TypeGroupHeader — sticky collapsible section header for the Y-model Stock list.
 *
 * Sits above per-Variety rows within a Type group. Tapping it toggles visibility
 * of all Variety rows below it (collapsed state is owned by the host page).
 *
 * Props:
 *   typeName      {string}   — Flower type label (e.g. "Rose", "Tulip")
 *   totalQty      {number}   — Sum of current_quantity across all Varieties in this Type
 *   varietyCount  {number}   — Number of distinct Varieties in this Type
 *   collapsed     {boolean}  — Whether the group body is hidden
 *   onToggle      {Function} — Called when the header is clicked
 *   t             {Object}   — Translation strings; must include `t.stems`
 *
 * Role in the Y-model: The Y-model Stock list groups rows first by Type (Rose, Lily…),
 * then shows one sub-row per Variety (4-tuple). This header provides the top-level
 * glanceable summary (total stems, variety count) and the collapse affordance so
 * florists can hide a type they're not working with.
 */
export default function TypeGroupHeader({ typeName, totalQty, varietyCount, collapsed, onToggle, t }) {
  return (
    <button
      type="button"
      role="button"
      onClick={onToggle}
      className="w-full flex items-center px-4 py-3 sticky top-0 z-10 bg-white border-b border-gray-100 text-left transition-colors active:bg-gray-50"
    >
      {/* Type name */}
      <span className="text-base font-semibold text-gray-900 flex-1">{typeName}</span>

      {/* Summary: total stems + variety count badge */}
      <span className="flex items-center gap-2 mr-3 text-sm text-gray-500">
        <span>{totalQty} {t.stems}</span>
        <span className="inline-flex items-center justify-center rounded-full bg-gray-100 text-gray-600 text-xs font-medium px-2 py-0.5 min-w-[20px]">
          {varietyCount}
        </span>
      </span>

      {/* Chevron — inline SVG, rotates on collapse */}
      <svg
        data-testid="type-chevron"
        data-collapsed={String(collapsed)}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${collapsed ? '-rotate-90' : 'rotate-0'}`}
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}
