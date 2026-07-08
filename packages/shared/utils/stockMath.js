// Stock math — single source of truth for "how many stems are available/short".
//
// The model (locked 2026-04-22 after a long diagnosis):
//   - `Current Quantity` on a Stock record is decremented IMMEDIATELY when an
//     order is created (orderService.js → atomicStockAdjust). Every pending
//     order's demand is therefore ALREADY reflected in `Current Quantity`.
//   - `GET /api/stock/committed` returns the LIST of orders that consume each
//     stock item — purely for traceability (tap-to-expand detail). The number
//     it reports is the same demand already baked into Current Quantity.
//   - Therefore `effective = qty - committed` DOUBLE-COUNTS. Always.
//
// Previous code (pre-2026-04-22) computed `qty - committed`, which made
// Hydrangea Pink show "Effective: -4" when qty was -2 and committed was 2
// — the same order, subtracted twice. A 2026-04-16 patch tried to fix this
// with a `qty < 0 ? qty : qty - committed` branch, but that destroyed the
// legitimate cumulative-shortfall case (qty=-5, committed=3 should show -8,
// not -5). Both variants are wrong for the same reason: committed is
// redundant with qty.
//
// The correct answer is `effective = qty`. Period. `committed` is an
// informational breakdown, never a subtraction.
//
// If qty ever drifts from the true physical count, that is a data integrity
// problem (missing receipt event, silent premade deduction, manual Airtable
// edit) to be detected via reconciliation — NOT papered over by formula
// tweaks here.

/**
 * Aggregates per-row stock data into the four Variety-level buckets defined by
 * ADR-0005 (Stock Y-model) and PRD #283.
 *
 * Bucket definitions (ADR-0005):
 *   onHand            — sum of positive current_quantity rows (Batches: physical stems on shelf)
 *   planned           — absolute sum of negative current_quantity rows (Demand Entries: shortage to fill)
 *   reservedForPremades — stems committed to premade bouquets (read from premade_bouquet_lines at
 *                         query time, passed in as a Map<rowId, count>)
 *   net               — onHand − planned − reservedForPremades (effective availability)
 *   reclaimable       — min(reservedForPremades, max(0, planned − onHand))
 *                       "how many premade stems could be dissolved to cover the shortfall"
 *
 * Pitfall #8 history (two prior failure modes encoded as regression tests):
 *   v1 (pre-2026-04-22): `qty - committed` double-counted demand already baked into qty.
 *       Fix: ignore `committed` entirely — it is an informational breakdown, not a subtraction.
 *       This helper only reads `current_quantity`; any `committed` field on a row is silently ignored.
 *   v2 (2026-04-22 interim): `qty < 0 ? qty : qty - committed` hid cumulative shortfall.
 *       Fix: the positive/negative split here uses raw `current_quantity` with no committed involvement.
 *
 * Per-row `getEffectiveStock(qty)` is unchanged — it always returns qty directly. This helper
 * is the ONLY site that subtracts reservedForPremades, and it does so exactly once at the
 * Variety-summary level (not per-row), so there is no double-count.
 *
 * References: PRD #283, ADR-0005 (dated Demand Entries), ADR-0006 (Variety identity), pitfall #8.
 *
 * @param {Array<{id: string, current_quantity: number}>} rows
 *   All stock rows for a single Variety (Batches with positive qty + Demand Entries with negative qty).
 * @param {Map<string, number>} [reservations=new Map()]
 *   Map from row id → reserved stem count for premade bouquets (from premade_bouquet_lines JOIN).
 * @returns {{ onHand: number, planned: number, reservedForPremades: number, net: number, reclaimable: number }}
 */
export function getVarietyTotals(rows, reservations = new Map()) {
  let onHand = 0;
  let planned = 0;
  let reservedForPremades = 0;

  for (const row of rows) {
    const qty = Number(row.current_quantity) || 0;
    if (qty >= 0) {
      onHand += qty;
    } else {
      planned += -qty; // store as positive magnitude
    }
    reservedForPremades += Number(reservations.get(row.id)) || 0;
  }

  const net = onHand - planned - reservedForPremades;
  // reclaimable: how many premade-reserved stems could be freed without leaving orders short.
  // When onHand already covers planned demand (no shortfall), ALL reserved stems are reclaimable.
  // When there is a shortfall (planned > onHand), dissolving premades helps up to the shortfall amount,
  // so reclaimable = min(reserved, planned − onHand).
  const onHandShortfall = Math.max(0, planned - onHand);
  const reclaimable = onHandShortfall === 0
    ? reservedForPremades
    : Math.min(reservedForPremades, onHandShortfall);

  return { onHand, planned, reservedForPremades, net, reclaimable };
}

// ── varietyGroupMatchesView ────────────────────────────────────────────────
// Predicate for the Stock-panel view pills (All / Negative / Low / Slow) under
// the Y-model grouped list. The legacy flat list filters individual stock rows
// by `Current Quantity`; under the Y-model the meaningful signal is the
// per-Variety NET (onHand − planned − reservedForPremades) from getVarietyTotals
// — the same number that drives the short/tight/free badge — so the pills match
// what the row shows. Without this the pills were dead (filteredGroups never
// consulted `view`). `group.rows` are the grouped-endpoint rows; `reservations`
// is the Map<stockId, reservedQty> used everywhere else on the panel.
export function varietyGroupMatchesView(group, view, reservations = new Map(), now = Date.now()) {
  if (!view || view === 'all') return true;
  const rows = group?.rows || [];
  const { net, onHand } = getVarietyTotals(rows, reservations);

  if (view === 'negative') return net < 0;            // short — owes stems
  if (view === 'low') {
    // not short, but on/under the variety's reorder threshold (incl. tight, net 0)
    const threshold = rows.reduce(
      (max, r) => Math.max(max, Number(r['Reorder Threshold'] ?? r.reorder_threshold) || 0),
      5,
    );
    return net >= 0 && net <= threshold;
  }
  if (view === 'slow') {
    if (onHand <= 0) return false;                    // nothing physically sitting
    const restocks = rows
      .map(r => r['Last Restocked'] ?? r.last_restocked)
      .filter(Boolean)
      .map(d => new Date(d).getTime())
      .filter(n => Number.isFinite(n));
    if (restocks.length === 0) return true;           // never restocked = slow
    return (now - Math.max(...restocks)) > 14 * 86400000;
  }
  return true;
}

// ── varietyGroupHasVisibleStock ─────────────────────────────────────────────
// Predicate for the Stock-panel "hide zero" toggle (issue #533). A Variety
// group whose rows net to a raw total of 0 is normally hidden — but a group
// still has something worth showing when either:
//   - it has stems reserved for a premade bouquet, or
//   - it has an active (non-deleted) order-line consumer — `hasActiveConsumer`,
//     computed server-side in `stockRepo.listGroupedByVariety` from a real
//     order binding, not from the premades-only reservations Map.
// Without the second check, a Variety that nets to zero purely because a
// fresh receipt exactly covers a live (not-yet-due) order's demand vanishes
// from the default view with no error — the #533 symptom (a florist "received"
// a flower and it never appeared in stock).
//
// Mirrors the raw-sum totalQty used historically inline in each app (NOT
// getVarietyTotals().net, which additionally subtracts premade reservations)
// so this drop-in preserves prior hideZero behaviour exactly, plus the fix.
export function varietyGroupHasVisibleStock(group, reservations = new Map()) {
  const rows = group?.rows || [];
  const totalQty = rows.reduce((sum, r) => sum + (Number(r.current_quantity) || 0), 0);
  if (totalQty !== 0) return true;
  if (rows.some(r => (Number(reservations.get(r.id)) || 0) > 0)) return true;
  return Boolean(group?.hasActiveConsumer);
}

/**
 * allocateVarietyCoverage — date-aware coverage of a Variety's dated demands by
 * on-hand stock + pending PO arrivals (CR-39).
 *
 * On-hand batches are available any date; a pending arrival covers a demand only
 * when arrival.date <= demand.date (in time). A LATER arrival is reported via
 * `latePoQty` (signal that a PO exists) but does NOT reduce `shortQty` — owner
 * decision 2026-06-14: a late arrival cannot fulfil a dated order, so it stays
 * short. Earliest demand consumes the shared on-hand + arrival pools first
 * (FEFO by needed-by date), so coverage isn't double-counted across demands.
 *
 * @param {Array<{id,current_quantity,date}>} rows  one Variety's stock rows
 * @param {Map<string,number>} reservations         stockId → reserved (premades)
 * @param {Array<{date,qty}>} arrivals              pending PO arrivals for this Variety
 * @returns {{ demands: Array<{date, demandQty, shortQty, latePoQty}> }}
 */
export function allocateVarietyCoverage(rows = [], reservations = new Map(), arrivals = []) {
  // On-hand pool = positive batch qty minus this Variety's premade reservations.
  let onHandPool = 0;
  for (const r of rows) {
    const q = Number(r.current_quantity) || 0;
    if (q > 0) onHandPool += q;
    onHandPool -= Number(reservations.get(r.id)) || 0;
  }
  if (onHandPool < 0) onHandPool = 0; // over-reserved → nothing free to allocate

  // Arrival pool, oldest first, each with a mutable remaining count.
  const pool = (arrivals || [])
    .map(a => ({ date: a.date, remaining: Number(a.qty) || 0 }))
    .filter(a => a.remaining > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const demands = (rows || [])
    .filter(r => (Number(r.current_quantity) || 0) < 0)
    .map(r => ({ id: r.id, date: r.date, demandQty: -(Number(r.current_quantity) || 0) }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  for (const d of demands) {
    let need = d.demandQty;

    // 1) on-hand (available any date)
    const fromOnHand = Math.min(need, onHandPool);
    onHandPool -= fromOnHand;
    need -= fromOnHand;

    // 2) in-time arrivals (arrival.date <= demand.date), oldest first
    for (const a of pool) {
      if (need <= 0) break;
      if (a.remaining <= 0) continue;
      if (String(a.date) > String(d.date)) continue; // late — can't cover this demand
      const take = Math.min(need, a.remaining);
      a.remaining -= take;
      need -= take;
    }

    d.shortQty = need;
    // Signal: incoming that arrives AFTER this demand's needed date (late PO).
    d.latePoQty = pool
      .filter(a => String(a.date) > String(d.date))
      .reduce((s, a) => s + a.remaining, 0);
  }

  return { demands };
}

/**
 * getVarietyAvailability — the single labelled availability model for the
 * bouquet picker (CR-23/28). One Variety in → all buckets out, each named, so
 * the numbers visibly add up: onHand − committed − reserved = net, and
 * net + incoming = effective.
 *
 *   onHand    — physical stems on shelf (Σ positive batch qty)
 *   committed — stems already promised to customer orders (Σ |demand entries|)
 *               [D5: the word is "committed", never "planned"]
 *   reserved  — stems locked into premade bouquets
 *   incoming  — stems arriving on a pending PO (Σ arrivals.qty)
 *   net       — onHand − committed − reserved   (free to allocate right now)
 *   effective — net + incoming                  (free once the POs land)
 *   arrivals  — [{date, qty}] pending arrivals, oldest first (for DateTag)
 *
 * Picker hide rule (D3): hide when effective ≤ 0 by default; deliberate
 * over-promising (reachable via search) still creates a buy signal. Unlike the
 * stock-panel shortfall (allocateVarietyCoverage), this is date-agnostic on
 * purpose — the picker asks "could this Variety supply a new line at all", and
 * a late PO that over-promises is an intentional demand signal.
 *
 * @param {Array<{id, current_quantity}>} rows  one Variety's stock rows
 * @param {Map<string,number>} [reservations]   stockId → reserved (premades)
 * @param {Array<{date, qty}>} [arrivals]       pending PO arrivals for the Variety
 * @returns {{ onHand, committed, reserved, incoming, net, effective, arrivals }}
 */
export function getVarietyAvailability(rows = [], reservations = new Map(), arrivals = []) {
  const { onHand, planned: committed, reservedForPremades: reserved, net } =
    getVarietyTotals(rows, reservations);

  const sortedArrivals = (arrivals || [])
    .map((a) => ({ date: a.date, qty: Number(a.qty) || 0, overdue: a.overdue ?? false }))
    .filter((a) => a.qty > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const incoming = sortedArrivals.reduce((s, a) => s + a.qty, 0);

  return { onHand, committed, reserved, incoming, net, available: net + reserved, effective: net + incoming, arrivals: sortedArrivals };
}

/**
 * allocateLinesAgainstVariety — net each bouquet line's available stock against
 * SIBLING lines of the same Variety in the same bouquet.
 *
 * Without this, two lines of one Variety each compared their quantity to the
 * WHOLE Variety's free stock and so counted the same stems twice: with 7 on hand
 * and lines [7, 10], line 1 read "0 short" and line 2 read "10 − 7 = 3 short",
 * hiding 7 stems of real shortfall. This walks the lines in order so earlier
 * lines claim on-hand first; a later line then sees only what is left. The per-
 * Variety invariant holds: Σ max(0, qty − remaining) === max(0, ΣqtyShown − net).
 *
 * @param {Array} lines  ordered bouquet lines
 * @param {(line, index) => ({ key, net }|null)} resolve
 *        key — grouping identity for the line's Variety (the shared varietyAvail
 *              object, a variety key, or the stockItemId in legacy single-item mode).
 *        net — the Variety's free stock available to the whole bouquet.
 *        Return null to skip a line entirely (no consumption) — e.g. a deferred
 *        line that pulls from a future PO, not current stock.
 * @returns {number[]} remainingNet per line, aligned to `lines` — the value to
 *          subtract from line.quantity for the "N not in stock" badge.
 */
export function allocateLinesAgainstVariety(lines = [], resolve) {
  const consumed = new Map();
  return lines.map((line, i) => {
    const r = resolve(line, i);
    if (!r || r.key == null) return r ? (Number(r.net) || 0) : 0;
    const used = consumed.get(r.key) || 0;
    const remaining = Math.max(0, (Number(r.net) || 0) - used);
    consumed.set(r.key, used + (Number(line.quantity) || 0));
    return remaining;
  });
}

/**
 * arrivalsForVariety — collect a Variety's pending PO arrivals as [{date, qty, overdue}]
 * from the /stock/pending-po map (keyed by stockId). Mirrors the shape consumed
 * by getVarietyAvailability + allocateVarietyCoverage so the picker and the
 * stock-panel shortfall read incoming supply the same way.
 *
 * @param {Array<{id}>} rows                one Variety's stock rows
 * @param {Object} pendingPO               { stockId: { ordered, plannedDate, pos: [...] } }
 * @param {string} [todayIso]              ISO date string (YYYY-MM-DD) for overdue tagging.
 *                                          When provided, arrivals with date < todayIso are
 *                                          tagged overdue:true. Omit to keep overdue:false
 *                                          (backward-compatible default).
 * @returns {Array<{date, qty, overdue}>}
 */
export function arrivalsForVariety(rows = [], pendingPO = {}, todayIso) {
  const out = [];
  for (const row of rows || []) {
    const info = pendingPO?.[row.id];
    if (!info) continue;
    for (const p of info.pos ?? []) {
      const qty = Number(p.quantity) || 0;
      if (qty > 0) {
        const date = p.plannedDate || info.plannedDate || null;
        const overdue = todayIso ? String(date) < String(todayIso) : false;
        out.push({ date, qty, overdue });
      }
    }
  }
  return out;
}

/**
 * Effective stems available for new orders.
 *
 * Always returns `qty`. The `committed` parameter is accepted for backward
 * compatibility with existing call sites and is intentionally ignored — see
 * the file header for the full explanation.
 *
 * @param {number} qty        Current Quantity from the Stock record
 * @param {number} [_committed] Ignored. Kept in signature so old callers do
 *                              not silently break; do not rely on it.
 * @returns {number} effective stock (equals qty; may be negative)
 */
// eslint-disable-next-line no-unused-vars
export function getEffectiveStock(qty, _committed) {
  return Number(qty) || 0;
}

/**
 * True when the stock row is in genuine shortfall — `qty < 0`.
 * A negative Current Quantity means orders have been composed against stems
 * we don't physically have; the owner needs to buy more.
 *
 * @param {number} qty        Current Quantity from the Stock record
 * @param {number} [_committed] Ignored — see file header.
 */
// eslint-disable-next-line no-unused-vars
export function hasStockShortfall(qty, _committed) {
  return (Number(qty) || 0) < 0;
}
