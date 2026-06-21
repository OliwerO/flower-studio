import { useMemo, useState } from 'react';
import { groupByVariety, varietyDisplayName } from '../utils/varietyKey.js';
import { stockAllocationEngine } from '../utils/stockAllocationEngine.js';
import { getVarietyAvailability, arrivalsForVariety } from '../utils/stockMath.js';
import { formatDateDMY } from '../utils/formatDate.js';
import { byDateAsc } from '../utils/sortByDate.js';
import VarietyIdentity from './VarietyIdentity.jsx';
import VarietyAvailabilityLine from './VarietyAvailabilityLine.jsx';

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
  pendingPO = {},
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

  // CR-24: when the host opens the picker on a SINGLE pre-chosen Variety (the
  // common path — tapping a catalog row passes just that Variety's rows), skip
  // the redundant Stage-1 search/list and open straight at the allocation form.
  // groupByVariety is stable per mount and the picker remounts on every open,
  // so the initializer runs fresh each time.
  const allVarieties = useMemo(() => groupByVariety(stockItems), [stockItems]);
  const singleVariety = allVarieties.size === 1;
  const [expandedKey, setExpandedKey] = useState(
    () => (singleVariety ? [...allVarieties.keys()][0] : null),
  );

  // Task 4: Create new Variety form state
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ type_name: '', colour: '', size_cm: '', cultivar: '' });
  const [saving, setSaving] = useState(false);

  const needle = search.trim().toLowerCase();

  const groups = useMemo(() => {
    const all = groupByVariety(stockItems);
    const visible = [];
    for (const [, group] of all) {
      // S3.2-i: one labelled availability model per Variety. The hide rule is
      // effective ≤ 0 (D3) — net free now plus incoming PO — so a Variety
      // reserved/committed down to nothing drops out, while a negative-stock
      // Variety that an incoming PO lifts back above zero reappears (CR-22).
      const availability = getVarietyAvailability(
        group.rows,
        reservations,
        arrivalsForVariety(group.rows, pendingPO),
      );
      const displayName = varietyDisplayName(group);

      if (!needle) {
        if (availability.effective <= 0) continue;
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

      visible.push({ ...group, displayName, availability, totalQty: availability.net });
    }
    return visible;
  }, [stockItems, reservations, pendingPO, needle]);

  // Build a lookup map from id → original stockItem row for click handlers.
  const stockById = useMemo(() => {
    const map = new Map();
    for (const row of stockItems) map.set(row.id, row);
    return map;
  }, [stockItems]);

  // When a Variety is active (expanded row, or the single pre-chosen Variety),
  // compute its availability + engine allocation options. Batch options are
  // collapsed by sell-price tier (2026-05-31) so the source dropdown mirrors the
  // Stock-list merge rule; Demand-Entry and Fresh options stay per-date. We read
  // the group from the UNFILTERED set so a fully-committed Variety the host
  // explicitly opened still resolves (the hide rule only governs the list).
  const expandedData = useMemo(() => {
    if (!expandedKey) return null;
    const group = allVarieties.get(expandedKey);
    if (!group) return null;

    const availability = getVarietyAvailability(
      group.rows,
      reservations,
      arrivalsForVariety(group.rows, pendingPO),
    );

    const engineRows = group.rows.map((r) => ({
      id: r.id,
      currentQuantity: Number(r.current_quantity) || 0,
      date: r.date,
      isDemandEntry: (Number(r.current_quantity) || 0) < 0,
    }));

    const raw = stockAllocationEngine(engineRows, reservations, requiredBy, qty);
    const options = collapseBatchTiers(raw, stockById, qty, t);
    return { group, availability, options };
  }, [expandedKey, allVarieties, reservations, pendingPO, requiredBy, qty, stockById, t]);

  const isOwner = role === 'owner';

  function handleRowClick(key) {
    setExpandedKey((prev) => (prev === key ? null : key));
  }

  // CR-25/26: the allocation form resolves the chosen source to a concrete
  // selection, then adds it to the order with the amount the owner typed.
  function handleAdd(selection, amount) {
    const qtyToAdd = Math.max(1, Number(amount) || 1);
    if (selection?.kind === 'fresh') {
      const group = expandedData?.group;
      onSelectStock(
        {
          kind: 'fresh',
          date: requiredBy,
          variety: group ? {
            type_name: group.type_name,
            colour: group.colour,
            size_cm: group.size_cm,
            cultivar: group.cultivar,
          } : null,
        },
        qtyToAdd,
      );
      return;
    }
    // batch (FEFO oldest underlying stock_id) or merge (the demand entry row).
    const targetId = selection?.kind === 'batch'
      ? (selection.stockIds?.[0] ?? selection.stockId)
      : selection?.stockId;
    const original = stockById.get(targetId);
    if (original) onSelectStock(original, qtyToAdd);
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
        {/* Stage 1 — search only when more than one Variety is in play. A single
            pre-chosen Variety (CR-24) skips straight to the allocation form. */}
        {!singleVariety && (
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
        )}

        {singleVariety && expandedData ? (
          /* CR-24: single Variety — header + allocation form, no list. */
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 pt-4 pb-2">
              <VarietyIdentity variety={expandedData.group} showType srOnlyFullName />
              <div className="mt-1">
                <VarietyAvailabilityLine availability={expandedData.availability} t={t} />
              </div>
            </div>
            <AllocationForm
              options={expandedData.options}
              availability={expandedData.availability}
              defaultQty={qty}
              t={t}
              onAdd={handleAdd}
            />
          </div>
        ) : (
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
                  <div className="mt-1">
                    <VarietyAvailabilityLine availability={g.availability} t={t} />
                  </div>
                </button>

                {/* Stage 2: inline allocation form for the expanded Variety */}
                {expandedKey === g.key && expandedData && (
                  <AllocationForm
                    options={expandedData.options}
                    availability={expandedData.availability}
                    defaultQty={qty}
                    t={t}
                    onAdd={handleAdd}
                  />
                )}
              </div>
            ))}
          </div>
        )}

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
    pairs.sort(byDateAsc);
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
 * buildSources — turns engine options + Variety availability into the owner's
 * mental model of allocation sources (CR-26): one dropdown of
 *   { From stock [· sell tier] · Into committed <date> · From incoming PO · New demand }.
 * Each source carries an `available` cap (null = uncapped) and the concrete
 * `selection` the host resolves on Add. Exported for unit testing.
 */
export function buildSources(options, availability, t = {}) {
  const list = [];
  for (const o of options) {
    if (o.kind === 'batch') {
      const priceLabel = o.sellLabel ? ` · ${o.sellLabel}` : '';
      list.push({
        value: `batch:${o.tierKey ?? o.stockId}`,
        label: `${t.srcStock ?? 'From stock'}${priceLabel}`,
        available: o.freeQty,
        selection: o,
        isDefault: o.isDefault,
      });
    } else if (o.kind === 'merge') {
      list.push({
        value: `merge:${o.stockId}`,
        label: `${t.srcCommitted ?? 'Into committed'} ${formatDateDMY(o.date)}`,
        available: null,
        selection: o,
        isDefault: o.isDefault,
      });
    }
  }
  if ((availability?.incoming ?? 0) > 0) {
    const d = availability.arrivals?.[0]?.date;
    list.push({
      value: 'incoming',
      label: `${t.srcIncoming ?? 'From incoming PO'} +${availability.incoming}${d ? ` → ${formatDateDMY(d)}` : ''}`,
      available: availability.incoming,
      // A PO already covers this demand → still create a fresh demand entry at
      // the order's needed-by date; the coverage engine matches it to the PO.
      selection: { kind: 'fresh' },
    });
  }
  list.push({
    value: 'fresh',
    label: t.srcFresh ?? 'New demand',
    available: null,
    selection: { kind: 'fresh' },
  });
  return list;
}

/**
 * AllocationForm — CR-25/26 single-screen allocation for one Variety. The owner
 * picks a source from a dropdown, sees that source's available count, types the
 * amount, and watches the remaining (available − amount) update live — then Add
 * commits the line with the typed amount. No window-hopping to the cart.
 */
function AllocationForm({ options, availability, defaultQty, t, onAdd }) {
  const sources = useMemo(() => buildSources(options, availability, t), [options, availability, t]);

  const initialValue = (sources.find((s) => s.isDefault) ?? sources[0])?.value ?? 'fresh';
  const [value, setValue] = useState(initialValue);
  const [amount, setAmount] = useState(String(Math.max(1, defaultQty || 1)));

  const selected = sources.find((s) => s.value === value) ?? sources[sources.length - 1];
  const amt = Math.max(0, parseInt(amount, 10) || 0);
  const remaining = selected?.available != null ? selected.available - amt : null;

  return (
    <div className="bg-gray-50 border-t border-gray-100 px-4 py-3 space-y-2">
      <label className="block">
        <span className="block text-xs font-medium text-gray-500 mb-1">{t.allocSource ?? 'Source'}</span>
        <select
          data-testid="alloc-source"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-indigo-400"
        >
          {sources.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}{s.available != null ? ` (${s.available} ${t.free ?? 'free'})` : ''}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">{t.allocQty ?? 'Amount'}</span>
          <input
            data-testid="alloc-qty"
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-20 text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400"
          />
        </label>
        {remaining != null && (
          <span
            data-testid="alloc-remaining"
            className={`text-xs ${remaining < 0 ? 'text-amber-600 font-medium' : 'text-gray-500'}`}
          >
            {t.allocRemaining ?? 'remaining'}: {remaining}
          </span>
        )}
      </div>

      <button
        type="button"
        data-testid="alloc-add"
        onClick={() => onAdd(selected.selection, Math.max(1, amt))}
        className="w-full py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
      >
        {t.allocAdd ?? 'Add'}
      </button>
    </div>
  );
}
