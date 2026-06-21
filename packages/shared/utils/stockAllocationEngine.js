/**
 * Stock Y-model allocation engine — issue #287, PRD #283.
 *
 * Given a single Variety's Stock Item rows + premade reservations, return
 * a ranked list of allocation options for ONE order line of qty stems
 * needed by requiredBy.
 *
 * Inputs are already filtered to a single Variety (the four-tuple from
 * ADR-0006). The selector layer (#288) handles Variety filtering.
 *
 * Pure: no I/O, no module-level state, deterministic given inputs.
 *
 * Pitfall #8 immunity (CLAUDE.md): the engine NEVER subtracts committed
 * demand from Batch quantities. Batch.currentQuantity already reflects past
 * order decrements. Reservations (premade lines) are subtracted from
 * Batch freeQty as a separate read-time bucket per ADR-0005.
 *
 * ADR-0005: dated Demand Entries supersede the aggregate model.
 * ADR-0006: Variety identity is the four-tuple (Type, Colour?, Size?, Cultivar?).
 *
 * @param {Array<{id: string, currentQuantity: number, date: string, isDemandEntry: boolean}>} rows
 *   — Variety's stock rows, pre-filtered to a single Variety. The selector
 *   layer derives `isDemandEntry` as `currentQuantity < 0` (per ADR-0005:
 *   a Demand Entry IS a stock row with negative quantity — there is no
 *   `is_demand_entry` column on the schema).
 * @param {Map<string, number>} reservations
 *   — stockId → reserved qty (from getPremadeReservations). Pass an empty
 *   Map if no premades exist for this Variety.
 * @param {string} requiredBy — YYYY-MM-DD strict (no ISO timestamps);
 *   the order's needed-by date. Same-form comparison used throughout.
 * @param {number} qty — stems needed (positive integer)
 * @returns {Array<Option>} — ranked options
 *
 * Each Option is one of:
 *   { kind: 'batch',  stockId, freeQty, total, reservedQty, date, sufficient, isDefault }
 *     — `freeQty` may be negative if reservations exceed currentQuantity
 *       (data-integrity signal — never marked sufficient).
 *   { kind: 'merge',  stockId, date, currentQty, isPastDate, isDefault }
 *     — `currentQty` is the raw `stock.current_quantity`, which is
 *       negative for a Demand Entry (committed-demand magnitude).
 *   { kind: 'fresh',  date, isDefault }
 *
 * Smart-default rule (exactly ONE option has isDefault: true):
 *   1. If a same-date Demand Entry exists → that merge option
 *   2. Else if any Batch has freeQty >= qty → oldest such Batch (FIFO by date asc)
 *   3. Else fresh
 *
 * Past-date merges (date < requiredBy) are NEVER the default — flagged
 * with isPastDate: true so the UI can grey them.
 */
import { byDateAsc } from './sortByDate.js';

export function stockAllocationEngine(rows, reservations, requiredBy, qty) {
  const batches = rows.filter((r) => !r.isDemandEntry);
  const demands = rows.filter((r) => r.isDemandEntry);

  // ── Batch options ────────────────────────────────────────────────────────
  // Sort FIFO (oldest first)
  const sortedBatches = [...batches].sort(byDateAsc);

  const batchOptions = sortedBatches.map((row) => {
    const reservedQty = reservations.get(row.id) ?? 0;
    const freeQty = row.currentQuantity - reservedQty;
    return {
      kind: 'batch',
      stockId: row.id,
      freeQty,
      total: row.currentQuantity,
      reservedQty,
      date: row.date,
      // Tightened guard: negative freeQty (reservation overflow) is never
      // sufficient regardless of qty. Preserves the negative signal for
      // the picker UI to surface as a data-integrity warning.
      sufficient: freeQty > 0 && freeQty >= qty,
      isDefault: false,
    };
  });

  // ── Demand Entry (merge) options ─────────────────────────────────────────
  // Sort by date ascending so UI sees them in chronological order
  const sortedDemands = [...demands].sort(byDateAsc);

  const mergeOptions = sortedDemands.map((row) => ({
    kind: 'merge',
    stockId: row.id,
    date: row.date,
    currentQty: row.currentQuantity,
    isPastDate: row.date < requiredBy,
    isDefault: false,
  }));

  // ── Fresh option ─────────────────────────────────────────────────────────
  const freshOption = { kind: 'fresh', date: requiredBy, isDefault: false };

  // ── Determine default (smart-default rule) ───────────────────────────────
  // Rule 1: same-date Demand Entry (not past-date, redundant check but clear)
  const sameDateMerge = mergeOptions.find((o) => o.date === requiredBy);

  // Rule 2: oldest sufficient Batch (FIFO — already sorted)
  const oldestSufficientBatch = batchOptions.find((o) => o.sufficient);

  let defaultSet = false;
  if (sameDateMerge) {
    sameDateMerge.isDefault = true;
    defaultSet = true;
  } else if (oldestSufficientBatch) {
    oldestSufficientBatch.isDefault = true;
    defaultSet = true;
  }
  if (!defaultSet) {
    freshOption.isDefault = true;
  }

  // ── Ranked output: batches first, then merges, then fresh ────────────────
  return [...batchOptions, ...mergeOptions, freshOption];
}
