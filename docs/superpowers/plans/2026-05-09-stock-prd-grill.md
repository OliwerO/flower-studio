# Stock PRD — grill in progress (2026-05-09)

In-progress design grill. Pick up here on resume. Skill: `grill-with-docs`. Goal: lock the PRD scope before invoking `to-prd`.

## Context

- Architecture audit candidate #1 (extract `stockService.js`, scope A — reads + Write-offs + Reconciliation) **deferred** until Stock PRD lands. Reason: extracting the current shape ahead of the PRD bakes-in the wrong interface (PRD reshapes reads + Demand Entry semantics + likely Batch model). Deferral is short-lived (~2 weeks), so no ADR was written.
- Owner intent: "adjust the stock in the next days" → upcoming work IS the Stock PRD itself, not the extraction. Current grill replaces the deferred grill of scope A.
- Audit candidate #2 (cancel-with-return shared seam) shipped as PR #281, master `e2e19e7`.
- Audit candidate #3 (Wix BACKEND_MODE leak) still open, untouched.

## ADR-0002 baseline (the model the PRD replaces)

`docs/adr/0002-demand-entry-aggregate-model.md`:

- One Demand Entry per variety. No date suffix. Quantity goes negative as orders commit demand.
- Arriving Batch at PO Evaluating: deficit absorbed into the Batch (received − deficit), Demand Entry zeroed, kept as audit marker.
- Order lines point at the Demand Entry record ID throughout.
- Owner manually decides at evaluation whether to fill demand or keep arriving stems as a fresh Batch.
- ADR explicitly notes: this is a deliberate simplification; correct model is time-phased + stem-length + simplified UI; deferred to "future Stock PRD."

## PRD axes — locked priority

Owner picked **a, b, c** (skipped d):

1. **Time-phased demand** (foundation; reshapes data model)
2. **Stem-length tracking** (orthogonal column-add; can ship in parallel)
3. **Simplified inventory UI** (waits on axis 1 reads)

Deferred / out of scope:
- (d) Auto-allocation of arriving Batches against demand. Falls out for free later if axis 1 picks Y model (see below).
- BACKLOG line 48: PO evaluate write-off retry idempotency (`stock_loss_log` row dup on retry). Scoped separately as a bug-fix, not part of PRD.

## In-flight grill — axis 1 (time-phased demand)

### Q2 — model shape fork

**Option X — one Demand Entry per variety + child `demand_slots` table.**
- Stock row stays one per variety.
- New table `demand_slots(demand_entry_id, needed_by_date, qty)`.
- Order line points at slot, not entry.
- ADR-0002 invariant ("one Demand Entry per variety") preserved.
- Reads gain a join.

**Option Y — drop the aggregation; multiple dated Demand Entries per variety.**
- Stock row becomes "Pink Peonies (needed 12.May.)" etc., one per future date with demand.
- Symmetric with Batches (both dated rows, just different prefixes).
- Order line points at the dated Demand Entry directly.
- ADR-0002 invariant retired.
- Stock list grows in row count → needs grouping in UI.
- Auto-allocation falls out for free later.

**Recommendation: Y.** Reasons:
- Symmetry with Batches eliminates the aggregate-exception that caused effective-stock formula to go wrong twice (pitfall #8 history).
- Auto-allocation enabled by data shape directly.
- UI row growth solvable by grouping.
- ADR-0002 explicitly expected to be retired.

### Owner question (sub-grill resolved): "what if we just order flowers that are not yet needed for an order?"

Walk-through (option Y):
1. PO created, no backing demand. Lines added speculatively.
2. PO progresses Draft → … → Evaluating Complete.
3. Arrival creates a Batch row (dated arrival date), qty positive. **Identical to today.**
4. Daily orders draw down: florist picks Batch directly → Batch qty decrements. Or florist declines the Batch → creates a dated Demand Entry (date = order Required By).
5. Stock list shows timeline: Batch qty + per-date Demand qtys, all as separate rows.

**Conclusion:** speculative PO behaviour is **identical** between today and Y. Y only changes representation of UNFULFILLED demand. No-demand state = Batch with positive qty, same as today.

### Edges Y forces decisions on (still open)

i) **Premade bouquet built with no available Batch.**
- Y-i-1 — create Demand Entry dated today (build date). My pick.
- Y-i-2 — restore aggregate undated "premade backlog" entry (partial Y defeat).
- Y-i-3 — block the build with "no stock available".

ii) **Order Line without Required By date.** Pickup orders with flexible/today date.
- Default to today. Same shape as Y-i-1.

## Q2a — RESOLVED 2026-05-10: Y picked

Reasons (recap):
- Symmetry with Batches (both dated rows) eliminates pitfall #8 aggregate-exception.
- Auto-allocation falls out of data shape (SQL window over dated rows).
- Order line FK stays simple (points at one Stock Item row, not a child slot).
- ADR-0002 explicitly anticipated retirement.
- Row growth (~80 → ~180 rows) solved by collapse-by-variety in list view (header count drops to ~30).

## Q2b — RESOLVED 2026-05-10: traceability graph in PRD, v2 ship

Owner request: per-variety expand reveals graph with time on X axis, stems on Y. Steps up at Batch arrival rows, steps down at Demand Entry rows. **Negative region = shortfall window** — owner reads off "buy N stems by date D".

Y-native: each row in graph IS a Stock Item row. No join, no aggregation. Auto-allocation later = SQL window function over the same rows.

Replaces today's "scan 80 rows in your head" UI as the canonical "what to buy" view (folds in Q8).

## v-split — locked 2026-05-10

| v | Scope | Why this slice |
|---|-------|----------------|
| **v1** | Y data model: drop ADR-0002 aggregate invariant. Multiple dated Demand Entries per variety. Order lines FK to dated Demand Entry. Backfill migration (Q4). Collapse-by-variety list view (header = net qty, expand = dated rows). Manual Demand Entry edit per date. Pitfall #8 audited on Y. | Load-bearing change. Ship and run real demand through it before drawing graphs. |
| **v2** | Traceability graph: per-variety expand renders time-X / stems-Y chart. Cumulative line through dated Batches (+) and Demand Entries (−). Negative region highlighted as shortfall window. Charting lib choice + hover/click interactions. | Presentation layer on v1 data shape. Lands in days once v1 stable. |
| **v3** | Auto-allocation: arriving Batch matches earliest open Demand Entries with date ≤ arrival date. SQL window over Stock Item rows. Owner can override pre-commit. | Data shape from v1 makes this trivial. Was deferred axis (d) — falls out for free. |
| **v4** | Stem-length tracking (orthogonal axis 2): `length_cm` column on Stock Item, bouquet recipe field, builder UX, unknown-length fallback. | Independent of v1–v3 data shape. Could ship in parallel; deferred to keep v1 focused. |
| **v5** | Simplified inventory UI overhaul (axis 3): canonical "what to buy this week" view. Per-date demand-vs-supply report. May replace today's StockPanelPage primary view entirely. | Builds on v2 graph + v3 allocation. Owner reads weekly buying plan off one screen. |

## Open edges

i) **Premade bouquet** — RESOLVED 2026-05-10 (revised): premade builds require existing Batch with enough qty (UI blocks otherwise). **Switch to reservation model — premade build does NOT decrement Batch qty.** Reservations live in existing `premade_bouquet_lines` table (no new table). Batch qty stays a single source of truth for physical stems.
   - Premade sold → Reservation removed; Order applies normal Batch deduction or creates dated Demand Entry.
   - Premade returned to stock → Reservation removed; Batch qty unchanged.
   - Premade reclaimed for real order → real-order priority, premade dissolved, Reservation removed, Order deducts Batch qty.
   - Migration step (cutover): one-shot script adds historical premade-deducted qtys BACK to active Batches by summing live `premade_bouquet_lines.quantity`. Otherwise on-hand looks too low post-cutover.

ii) **Order Line without Required By date** — RESOLVED 2026-05-10 (Q3-b): fallback chain `Required By → Order Date → today`. Mirrors existing `orderRepo.js:269-272` pattern. Order Date virtually always set, so today fires only for genuinely broken imports.

## Subsequent grill targets (queued)

- **Q3** — confirm Y-i-1 + Y-ii defaults (today's date as fallback for missing Required By).
- **Q4** — RESOLVED 2026-05-10:
  - **Q4-a-2** — orphan aggregates (negative qty, no linked orders) → convert to "{Variety} ({migration date})" Demand Entry, owner reviews post-cutover.
  - **Q4-b-1** — positive-qty aggregates (manual edits) → convert to synthetic Batch "{Variety} ({migration date})" with same qty. Lossless.
  - **Q4-c-1** — big-bang cutover. Off-hours, ~5 min downtime. Same playbook as Phase 7 PR 2b.
  - Migration script trawls each aggregate Demand Entry, groups linked order lines by Required By (with Q3-b fallback chain), creates one dated Demand Entry per distinct date with summed qty, repoints order_lines.stockItemId, deletes original aggregate.
  - On-hand and planned-demand semantics under Y: "on hand" = sum of +qty Batches per variety; "planned" = sum of −qty Demand Entries per variety; "net" = sum of all rows. List view header surfaces all three columns. Today's single-number conflation (root of pitfall #8) eliminated.
- **Q5** — RESOLVED 2026-05-10:
  - CONTEXT.md updates land with v1 code (not before).
  - **Flower Type** (new term, replaces Variety in lexicon): "A flower type — e.g. 'Pink Peonies', 'White Roses'. Grouping key for Stock Items: one Flower Type has many Stock Item rows (one per date with activity). Distinct from Stock Item (flower + date) and from Stem (the unit count)."
  - **Stem** definition flips its `_Avoid: flower` warning — disambiguation handled by separating Flower Type (type) from Stem (unit count). Both terms first-class.
  - **Stock Item** (top def): "A named flower variety on a specific date. Exists as a Demand Entry (qty ≤ 0, date = when stems are needed for an order) or a Batch (qty ≥ 0, date = when stems physically arrived). Same variety has multiple rows — one per date with activity."
  - **Demand Entry**: "A Stock Item with negative-or-zero quantity, dated to when stems are needed (= linked order's Required By, or Order Date as fallback per Q3-b). Display name carries date suffix, e.g. 'Pink Peonies (12.May)'. Cleared by a same-or-earlier-dated Batch arrival; cleared rows kept as audit, hidden from list by default."
  - **Batch**: drop "at most one Demand Entry" clause. "A variety has zero or more Batches AND zero or more Demand Entries co-existing."
  - **ADR-0002** marked Superseded by new ADR (Stock PRD v1).
  - **Q5a-1** — keep zero-qty Demand Entries as audit rows. List view filters `qty != 0` by default; "Show cleared rows" toggle exposes them.
  - **Q5b-1** — order Required By change → update Demand Entry date suffix + date column **in place**. Stock Item row identity preserved, FK from order_lines stays valid.
- **Q6** — RESOLVED 2026-05-10:
  - `getEffectiveStock(qty)` per-row helper unchanged — each Stock Item row carries one date's net qty.
  - New helper `getFlowerTypeTotals(rows, reservations)` returns `{ onHand, planned, reservedForPremades, net, reclaimable }`:
    - `onHand` = Σ qty where qty > 0 (Batches).
    - `planned` = |Σ qty where qty < 0| (Demand Entries).
    - `reservedForPremades` = Σ qty across active `premade_bouquet_lines` for this Flower Type.
    - `net` = onHand − planned − reservedForPremades (free now).
    - `reclaimable` = onHand − planned (free if all premades dissolved).
  - Backend exposes a new endpoint or extends `/stock` response to deliver per-Flower Type premade reservation roll-up (read-time SUM over `premade_bouquet_lines`). Tap-to-expand lists which premades hold the stems.
  - Pitfall #8 mitigation: `stockMath.js` doc-comment repeats "committed is informational only"; unit tests cover "5 Batches + 3 Demand Entries + 2 Premades → buckets sum independently, never subtracted twice."
  - Caller audit (touched in v1): StockItem.jsx + StockTab.jsx (per-row + Flower Type header), order-line "is there enough" check (calls `getFlowerTypeTotals(rows, reservations).net`), `/stock/:id/usage` per-row unchanged, reports per-flower aggregations.
- **Q7** — RESOLVED 2026-05-10 (Q7-a): write-off attaches to a specific Batch row owner picks. Default = oldest Batch (FIFO freshness). Demand Entries hidden from write-off UI (no physical stems).
- **Q8** — RESOLVED 2026-05-10: delete reconcile-premade feature in v1. Reservation model makes Batch-vs-premade drift structurally impossible. Removes route in `backend/src/routes/stock.js:584`, `StockTab.jsx` UI lines 997-1011, `SettingsTab.jsx:108` toggle, `configService.js:69` setting, `reconcilePremade*` translations.
- **Q9** — RESOLVED 2026-05-10 (Q9-c): no wilt warning in v1. Owner judges Required By manually. Defer flower-lifespan storage to a later PRD if needed (likely paired with v2 graph or v5 UI overhaul).
- **Q10** — RESOLVED 2026-05-10 (Q10-a): one Demand Entry per (Flower Type, date). Same-date orders merge into the existing row (qty summed; order_line.quantity holds per-order share). Different dates stay separate rows. Selector lists ALL existing Demand Entries for the Flower Type with their dates; owner picks which to add to or creates a new dated row matching Required By. **No auto-merge across dates** — would defeat the "buy fresh for the right week" purpose of the Y model.
- **Order-line / Bouquet selector overhaul** (v1 scope addition):
  - Stage 1: typeahead by Flower Type only (grouped, deduplicated, alphabetical). "pink peo" → one result.
  - Stage 2: expanded panel shows allocation choices — existing Batches (free/total/reserved), existing Demand Entries (with dates), or "Order fresh" creating a new dated Demand Entry.
  - Hide zero-qty rows by default ("Show cleared rows" toggle from Q5a-1).
  - Free-qty preview per Batch (`13 free / 20 total · 7 reserved`); tap reveals which premades reserve.
  - Allocation preview ("Batch 06.May → 13 free → −5 here = 8 left").
  - Smart default: same-date Demand Entry exists → add to it; else oldest sufficient Batch (FIFO); else "Order fresh."
  - Bulk "Order fresh for all" when bouquet has many flowers without capacity.
  - Inside Stage 2 drop the redundant Flower-Type prefix on Batch labels (e.g. "06.May · 13 free / 20 total").
  - Past-date Demand Entries (date < Required By) greyed-out or hidden by default.

## Q11 — RESOLVED 2026-05-10: monolithic v1, follow-ups separate

**Q11-a** locked. v1 ships as one PR/cutover. Local validation gate (harness + E2E + lab UI/API) catches data-model and selector bugs pre-prod. v2 (graph), v3 (auto-allocation), v4 (stem-length), v5 (UI overhaul) tracked as follow-up issues, not part of v1 PRD.

## Grill complete 2026-05-10 — handing to `to-prd`

All v1 questions resolved. Next step: invoke `to-prd` skill to publish the v1 GitHub Issue. v2-v5 follow-ups go into BACKLOG.md or separate issues.

## How to resume

1. Read this file.
2. Read `CONTEXT.md` Inventory section for current vocab.
3. Read `docs/adr/0002-demand-entry-aggregate-model.md` for the model the PRD replaces.
4. Re-pick up at Q2a above. Tell the user "resuming Stock PRD grill at Q2a — Y or X."
5. Once Y or X is locked: drill the open edges (Y-i, Y-ii), then walk Q3 → Q8.
6. Finish grill → invoke `to-prd` to publish the GitHub Issue.
7. Owner's "next days" timeline implies axis 1 v1 is the first shipping increment; axis 2 + axis 3 follow as separate PRDs or follow-up issues.

## Out-of-band side effects already taken

- TaskList task #2 ("Grill #1 design") marked completed, conclusion "scope A deferred — pivoted to Stock PRD grill".
- No CONTEXT.md edits yet; will land inline once Y vs X locked.
- No ADRs yet; deferral of scope A not load-bearing enough for posterity.
