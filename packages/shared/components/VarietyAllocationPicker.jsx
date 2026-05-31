import { useMemo, useState } from 'react';
import { groupByVariety, varietyDisplayName } from '../utils/varietyKey.js';
import { stockAllocationEngine } from '../utils/stockAllocationEngine.js';
import VarietyIdentity from './VarietyIdentity.jsx';

/**
 * Hybrid two-stage Variety picker — replaces BatchPickerModal under STOCK_Y_MODEL.
 * Stage 1 = single search bar with cross-field substring match across the 4-tuple
 * Variety identity (ADR-0006); one row per Variety.
 * Stage 2 = inline allocation panel rendering engine options (batch / merge / fresh).
 *
 * Props:
 *   stockItems       — Y-model rows (type_name/colour/size_cm/cultivar/current_quantity/date)
 *   reservations     — Map<stockId, reservedQty> from getPremadeReservations
 *   requiredBy       — YYYY-MM-DD strict (the order's needed-by date)
 *   qty              — stems needed for the order line being added
 *   role             — 'owner' | 'florist' (gates "+ Create new Variety")
 *   t                — translation strings (pickerSearchPlaceholder, pickerCreateNew,
 *                      pickerNoResults, stems, onHand, planned, reserved, net, cancel)
 *   onSelectStock    — (stockItem | { kind: 'fresh', date, variety: { type_name, colour, size_cm, cultivar } | null }) => void
 *   onCreateVariety  — (varietyDraft) => Promise<stockItem>  (Owner-only, Task 4)
 *   premadesByStockId — Map<stockId, [{id, name, qty}]> — optional, for reserved expand
 *   onClose          — () => void
 *   bulkCandidates   — string[] | undefined — list of varietyKey strings the host marks as
 *                      "unmet, fresh-needed." When length > 1 and onBulkFreshForAll is also
 *                      provided, the picker renders an "Order fresh for all" CTA above the
 *                      close button. A single missing line uses the single-row fresh option
 *                      instead, so the threshold is strictly > 1.
 *   onBulkFreshForAll — (varietyKeys: string[]) => void | undefined — called with
 *                      bulkCandidates when the host-driven CTA is clicked. Picker does NOT
 *                      auto-close; the host decides what to do next.
 *
 * Stage 1 list rule: one row per Variety (4-tuple). A Variety is visible when
 *   - search is empty AND its summed current_quantity across rows > 0, OR
 *   - search is non-empty AND any 4-tuple field (or computed display name)
 *     contains the search substring (case-insensitive).
 *
 * Stage 2 panel: renders inline below the expanded Variety row. Tap the row
 * again to collapse. Options come from stockAllocationEngine (batch/merge/fresh).
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
  premadesByStockId,
  onClose,
  bulkCandidates,
  onBulkFreshForAll,
}) {
  const [search, setSearch] = useState('');
  const [expandedKey, setExpandedKey] = useState(null);

  // Task 4: Create new Variety form state
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ type_name: '', colour: '', size_cm: '', cultivar: '' });
  const [saving, setSaving] = useState(false);

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

  // Build a lookup map from id → original stockItem row for click handlers.
  const stockById = useMemo(() => {
    const map = new Map();
    for (const row of stockItems) map.set(row.id, row);
    return map;
  }, [stockItems]);

  // When a Variety row is expanded, compute engine options for that group,
  // then collapse Batch options by sell-price tier so the picker mirrors the
  // Stock-list merge rule (2026-05-31). Demand-Entry and Fresh options are
  // not collapsed — they remain per-date.
  const expandedOptions = useMemo(() => {
    if (!expandedKey) return null;
    const group = groups.find((g) => g.key === expandedKey);
    if (!group) return null;

    const engineRows = group.rows.map((r) => ({
      id: r.id,
      currentQuantity: Number(r.current_quantity) || 0,
      date: r.date,
      isDemandEntry: (Number(r.current_quantity) || 0) < 0,
    }));

    const raw = stockAllocationEngine(engineRows, reservations, requiredBy, qty);
    return collapseBatchTiers(raw, stockById, qty, t);
  }, [expandedKey, groups, reservations, requiredBy, qty, stockById, t]);

  const isOwner = role === 'owner';

  function handleRowClick(key) {
    setExpandedKey((prev) => (prev === key ? null : key));
  }

  function handleBatchClick(option) {
    // FEFO: oldest underlying stock_id drains first.
    const targetId = option.stockIds?.[0] ?? option.stockId;
    const original = stockById.get(targetId);
    if (original) onSelectStock(original);
  }

  function handleMergeClick(option) {
    const original = stockById.get(option.stockId);
    if (original) onSelectStock(original);
  }

  function handleFreshClick() {
    const group = groups.find((g) => g.key === expandedKey);
    onSelectStock({
      kind: 'fresh',
      date: requiredBy,
      variety: group ? {
        type_name: group.type_name,
        colour: group.colour,
        size_cm: group.size_cm,
        cultivar: group.cultivar,
      } : null,
    });
  }

  function handleDraftChange(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSaveVariety() {
    if (!draft.type_name.trim() || saving) return;
    setSaving(true);
    try {
      const payload = {
        type_name: draft.type_name.trim(),
        colour: draft.colour.trim() || null,
        // TODO: host wires cultivar prefill externally — plain input for now
        cultivar: draft.cultivar.trim() || null,
        size_cm: draft.size_cm !== '' ? parseInt(draft.size_cm, 10) || null : null,
      };
      const newStockItem = await onCreateVariety(payload);
      onSelectStock(newStockItem);
      // Reset form state after successful creation
      setCreating(false);
      setDraft({ type_name: '', colour: '', size_cm: '', cultivar: '' });
    } finally {
      setSaving(false);
    }
  }

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
            <div key={g.key}>
              <button
                type="button"
                data-testid="variety-row"
                onClick={() => handleRowClick(g.key)}
                aria-label={g.displayName}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors"
              >
                <VarietyIdentity variety={g} showType srOnlyFullName />
                <div className="text-xs text-gray-500 mt-1">
                  {g.totalQty} {t.stems}
                </div>
              </button>

              {/* Stage 2: inline allocation panel */}
              {expandedKey === g.key && expandedOptions && (
                <AllocationPanel
                  options={expandedOptions}
                  onBatch={handleBatchClick}
                  onMerge={handleMergeClick}
                  onFresh={handleFreshClick}
                  premadesByStockId={premadesByStockId}
                  t={t}
                />
              )}
            </div>
          ))}
        </div>

        {isOwner && !creating && (
          <div className="px-4 py-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="text-sm text-indigo-700 font-medium hover:text-indigo-900"
            >
              {t.pickerCreateNew}
            </button>
          </div>
        )}

        {isOwner && creating && (
          <div className="px-4 py-3 border-t border-gray-100 space-y-2">
            <div className="space-y-2">
              <div>
                <label htmlFor="variety-type" className="block text-xs font-medium text-gray-700 mb-0.5">
                  Type <span className="text-red-500">*</span>
                </label>
                <input
                  id="variety-type"
                  type="text"
                  value={draft.type_name}
                  onChange={(e) => handleDraftChange('type_name', e.target.value)}
                  className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label htmlFor="variety-colour" className="block text-xs font-medium text-gray-700 mb-0.5">
                  Colour
                </label>
                <input
                  id="variety-colour"
                  type="text"
                  value={draft.colour}
                  onChange={(e) => handleDraftChange('colour', e.target.value)}
                  className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label htmlFor="variety-size" className="block text-xs font-medium text-gray-700 mb-0.5">
                  Size (cm)
                </label>
                <input
                  id="variety-size"
                  type="number"
                  value={draft.size_cm}
                  onChange={(e) => handleDraftChange('size_cm', e.target.value)}
                  className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                {/* TODO: host wires cultivar prefill externally — plain input for now */}
                <label htmlFor="variety-cultivar" className="block text-xs font-medium text-gray-700 mb-0.5">
                  Cultivar
                </label>
                <input
                  id="variety-cultivar"
                  type="text"
                  value={draft.cultivar}
                  onChange={(e) => handleDraftChange('cultivar', e.target.value)}
                  className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleSaveVariety}
                disabled={!draft.type_name.trim() || saving}
                className="flex-1 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t.pickerSaveContinue ?? 'Save & continue'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setDraft({ type_name: '', colour: '', size_cm: '', cultivar: '' });
                }}
                className="text-sm text-gray-500 hover:text-gray-700 px-2"
              >
                {t.cancel ?? 'Cancel'}
              </button>
            </div>
          </div>
        )}

        {bulkCandidates?.length > 1 && onBulkFreshForAll && (
          <div className="px-4 py-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => onBulkFreshForAll(bulkCandidates)}
              className="w-full py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-lg"
            >
              {t.pickerOrderFreshAll ?? 'Order fresh for all'}
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

/**
 * collapseBatchTiers — merges engine Batch options that share a sell price
 * into one tier-row per price. stockIds[] inside each tier are FEFO-sorted
 * (oldest date first) so the host drains oldest stems first. Demand-Entry
 * (`merge`) and `fresh` options pass through untouched.
 *
 * When all batches share a single sell price (or no price is set on any
 * row), the tier renders without a price label — the picker just shows
 * "Use stock" so the florist isn't distracted by a single redundant chip.
 */
export function collapseBatchTiers(options, stockById, qty, t) {
  const out = [];
  const tiers = new Map(); // tierKey → { ...mergedOption }

  for (const opt of options) {
    if (opt.kind !== 'batch') {
      out.push(opt);
      continue;
    }
    const row = stockById.get(opt.stockId);
    const sellRaw = row?.['Current Sell Price'] ?? row?.current_sell_price;
    const sell =
      sellRaw != null && sellRaw !== '' && isFinite(Number(sellRaw))
        ? Number(sellRaw)
        : null;
    const tierKey = sell != null ? sell.toFixed(2) : 'null';

    let m = tiers.get(tierKey);
    if (!m) {
      m = {
        kind: 'batch',
        tierKey,
        sell,
        stockIds: [],
        stockIdDates: [],
        freeQty: 0,
        total: 0,
        reservedQty: 0,
        sufficient: false,
        isDefault: false,
      };
      tiers.set(tierKey, m);
      out.push(m);
    }
    m.stockIds.push(opt.stockId);
    m.stockIdDates.push(opt.date);
    m.freeQty += opt.freeQty;
    m.total += opt.total;
    m.reservedQty += opt.reservedQty;
    if (opt.isDefault) m.isDefault = true;
  }

  // Finalise each tier: FEFO-sort underlying stockIds + recompute sufficient
  // (sum may cross the qty threshold even when no individual batch did).
  const onlyOneTier =
    [...tiers.values()].filter((m) => m.stockIds.length > 0).length === 1;

  for (const m of tiers.values()) {
    const pairs = m.stockIds.map((id, i) => ({ id, date: m.stockIdDates[i] }));
    pairs.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });
    m.stockIds = pairs.map((p) => p.id);
    delete m.stockIdDates;
    m.sufficient = m.freeQty > 0 && m.freeQty >= qty;
    m.sellLabel =
      onlyOneTier || m.sell == null
        ? null
        : `${m.sell.toFixed(2)} ${t?.currency ?? 'zł'}`;
  }

  return out;
}

/**
 * AllocationPanel — renders the engine options for one expanded Variety.
 * Renders inline below the Variety row header.
 */
function AllocationPanel({ options, onBatch, onMerge, onFresh, premadesByStockId, t }) {
  const batchOptions = options.filter((o) => o.kind === 'batch');
  const mergeOptions = options.filter((o) => o.kind === 'merge');
  const freshOption = options.find((o) => o.kind === 'fresh');

  return (
    <div className="bg-gray-50 border-t border-gray-100 px-4 py-3 space-y-2">
      {/* Batch options — one row per sell-price tier */}
      {batchOptions.map((opt) => (
        <BatchOptionButton
          key={opt.tierKey ?? opt.stockId}
          option={opt}
          onClick={() => onBatch(opt)}
          premades={premadesByStockId?.get(opt.stockIds?.[0] ?? opt.stockId)}
          t={t}
        />
      ))}

      {/* Merge (Demand Entry) options */}
      {mergeOptions.map((opt) => (
        <button
          key={opt.stockId}
          type="button"
          data-testid="option-merge"
          data-default={String(opt.isDefault)}
          onClick={() => onMerge(opt)}
          className={[
            'w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors',
            opt.isPastDate
              ? 'text-gray-400 border-gray-200 bg-white'
              : opt.isDefault
                ? 'border-indigo-400 bg-indigo-50 text-indigo-900'
                : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-100',
          ].join(' ')}
        >
          <span className="font-medium">{opt.date}</span>
          {' · '}
          <span>{Math.abs(opt.currentQty)} {t.planned ?? 'planned'}</span>
          {opt.isPastDate && (
            <span className="ml-2 text-xs text-gray-400">(past)</span>
          )}
        </button>
      ))}

      {/* Fresh option */}
      {freshOption && (
        <button
          type="button"
          data-testid="option-fresh"
          data-default={String(freshOption.isDefault)}
          onClick={onFresh}
          className={[
            'w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors',
            freshOption.isDefault
              ? 'border-indigo-400 bg-indigo-50 text-indigo-900'
              : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-100',
          ].join(' ')}
        >
          {t.orderFresh ?? 'Order fresh'}
        </button>
      )}
    </div>
  );
}

/**
 * BatchOptionButton — renders a single Batch option with free/total/reserved breakdown.
 */
function BatchOptionButton({ option, onClick, premades, t }) {
  // #311 AC3: insufficient batches (freeQty < qty needed, or reservations
  // overshoot) are visible but not clickable — the user must pick a different
  // batch or "Order fresh." Engine sets `sufficient` per option.
  const unusable = !option.sufficient;
  return (
    <button
      type="button"
      data-testid="option-batch"
      data-default={String(option.isDefault)}
      data-sufficient={String(option.sufficient)}
      data-tier-key={option.tierKey ?? ''}
      data-stock-ids={(option.stockIds ?? [option.stockId]).join(',')}
      onClick={onClick}
      disabled={unusable}
      aria-disabled={unusable}
      className={[
        'w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors',
        unusable
          ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
          : option.isDefault
            ? 'border-indigo-400 bg-indigo-50 text-indigo-900'
            : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-100',
      ].join(' ')}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {option.sellLabel ?? (t.useStock ?? 'Use stock')}
        </span>
        <span className="text-xs text-gray-500">
          <span className={`font-semibold ${unusable ? 'text-gray-400' : 'text-gray-800'}`}>{option.freeQty}</span>
          {' / '}
          <span>{option.total}</span>
          {option.reservedQty > 0 && (
            <span className="ml-1 text-amber-600">
              ({option.reservedQty} {t.reserved ?? 'reserved'})
            </span>
          )}
          {unusable && (
            <span className="ml-2 text-[10px] uppercase tracking-wide text-red-500">
              {t.batchInsufficient ?? 'insufficient'}
            </span>
          )}
        </span>
      </div>
      {/* Reserved premade list — deferred to lab Playwright test (Task 3 note) */}
      {option.reservedQty > 0 && premades && premades.length > 0 && (
        <details className="mt-1">
          <summary className="text-xs text-gray-400 cursor-pointer">
            {t.reserved ?? 'reserved'} ({option.reservedQty})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {premades.map((p) => (
              <li key={p.id} className="text-xs text-gray-500">
                {p.name} × {p.qty}
              </li>
            ))}
          </ul>
        </details>
      )}
    </button>
  );
}
