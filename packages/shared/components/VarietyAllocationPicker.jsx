import { useMemo, useState } from 'react';
import { groupByVariety, varietyDisplayName } from '../utils/varietyKey.js';

/**
 * Hybrid two-stage Variety picker — replaces BatchPickerModal under STOCK_Y_MODEL.
 * Stage 1 = single search bar with cross-field substring match across the 4-tuple
 * Variety identity (ADR-0006); one row per Variety.
 * Stage 2 (Task 3) = inline allocation panel rendering engine options.
 *
 * Props:
 *   stockItems       — Y-model rows (type_name/colour/size_cm/cultivar/current_quantity/date)
 *   reservations     — Map<stockId, reservedQty> from getPremadeReservations
 *   requiredBy       — YYYY-MM-DD strict (the order's needed-by date)
 *   qty              — stems needed for the order line being added
 *   role             — 'owner' | 'florist' (gates "+ Create new Variety")
 *   t                — translation strings (pickerSearchPlaceholder, pickerCreateNew,
 *                      pickerNoResults, stems, onHand, planned, reserved, net, cancel)
 *   onSelectStock    — (stockItem | { kind: 'fresh', date }) => void  (Task 3)
 *   onCreateVariety  — (varietyDraft) => Promise<stockItem>  (Owner-only, Task 4)
 *   onClose          — () => void
 *
 * Stage 1 list rule: one row per Variety (4-tuple). A Variety is visible when
 *   - search is empty AND its summed current_quantity across rows > 0, OR
 *   - search is non-empty AND any 4-tuple field (or computed display name)
 *     contains the search substring (case-insensitive).
 */
export default function VarietyAllocationPicker({
  stockItems = [],
  reservations = new Map(),
  requiredBy,
  qty = 1,
  role,
  t,
  onSelectStock,
  onCreateVariety,
  onClose,
}) {
  const [search, setSearch] = useState('');
  const [expandedKey, setExpandedKey] = useState(null); // Task 3: Stage 2 expansion

  const needle = search.trim().toLowerCase();

  const groups = useMemo(() => {
    const all = groupByVariety(stockItems);
    const visible = [];
    for (const [, group] of all) {
      const totalQty = group.rows.reduce(
        (sum, r) => sum + (Number(r.current_quantity) || 0),
        0,
      );
      const displayName = varietyDisplayName(group);

      if (!needle) {
        if (totalQty <= 0) continue;
      } else {
        const haystack = [
          group.type_name,
          group.colour,
          group.size_cm != null ? String(group.size_cm) : null,
          group.cultivar,
          displayName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) continue;
      }

      visible.push({ ...group, displayName, totalQty });
    }
    return visible;
  }, [stockItems, needle]);

  const isOwner = role === 'owner';

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2 border-b border-gray-100">
          <input
            autoFocus
            type="search"
            placeholder={t.pickerSearchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400"
          />
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {groups.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-gray-400">
              {t.pickerNoResults}
            </p>
          )}
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              data-testid="variety-row"
              onClick={() => setExpandedKey(g.key)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors"
            >
              <div className="text-sm font-medium text-gray-900">{g.displayName}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {g.totalQty} {t.stems}
              </div>
              {/* Task 3: Stage 2 panel renders here when expandedKey === g.key */}
            </button>
          ))}
        </div>

        {isOwner && (
          <div className="px-4 py-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => {
                // Task 4: expand inline form here
              }}
              className="text-sm text-indigo-700 font-medium hover:text-indigo-900"
            >
              {t.pickerCreateNew}
            </button>
          </div>
        )}

        <div className="px-4 pb-4 pt-2 border-t border-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
          >
            {t.cancel ?? 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
