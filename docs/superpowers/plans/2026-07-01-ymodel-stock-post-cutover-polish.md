# Y-model Stock — post-cutover polish + parity batch (2026-07-01)

Owner tested the live Y-model on prod (florist app + dashboard) after the 2026-06-30 cutover.
11 items captured across 5 screenshots. Lab-first: reproduce + fix on a **read-only mirror of
migrated prod** (localhost:5433 lab, `STOCK_Y_MODEL=true`), owner verifies, then push to prod.

Cutover fact that drives several items: **every migrated batch shares `date = 2026-06-30`**
(212 rows, 62 active, 1 distinct date). Time/age-based sort and "how long in stock" are degenerate
until fresh dated stock lands.

## Slices (each = a PR)

### PR-1 — Florist Stock UI (D1–D4) · frontend only
- **D1** default sort → **alphabetical** (was longest-in-stock). Owner corrected her earlier ask.
- **D2** sort control "does nothing" → root cause = single cutover date (ties). Replace the
  Longest⇄Newest toggle with a compact sort: **Alphabetical (default) · Longest in stock · Stock level**.
- **D3** align "In premade" numbers across rows — `VarietyListItem` bucket line → fixed columns.
- **D4** drop the always-on per-row 📈 trace icon on florist; trace stays reachable via
  row-tap → expand → **Trace**. Shared `VarietyListItem` gains `showHeaderTrace` (florist=false).
- Files: `apps/florist/src/pages/StockPanelPage.jsx`, `packages/shared/components/VarietyListItem.jsx`,
  `apps/florist/src/translations.js`, shared tests.
- Parity note: D3 is shared → dashboard By-Variety benefits too. D4 header-trace stays ON for dashboard.

### PR-2 — Dashboard flat table filter + batch dates (A, B1) · frontend/shared
- **A** "In stock" filter leaves 0-qty rows. Root cause: `hideZero` filters at the *group* level;
  `BatchArrivalList.flatten()` keeps `qty===0` merged rows (different sell price → own row) inside a
  surviving group. Fix: thread the in-stock flag into `BatchArrivalList`, drop `qty<=0 && reserved<=0`
  rows. Kills the duplicate legacy-fragment 0-rows the owner saw.
- **B1** merged Batch tiers show generic "Batch" with no date. `mergeExpansionRows` sets `date:null`
  on purpose (merge-by-sell). Surface the tier's arrival date (newest receive, compact) so the owner
  knows which batch a tier is.
- Files: `packages/shared/components/BatchArrivalList.jsx`, `packages/shared/components/VarietyListItem.jsx`,
  `apps/dashboard/src/components/StockTab.jsx`, translations, shared tests.

### PR-3 — Trace correctness + chart (B2, B3, C) · backend + shared · needs diagnose
- **B2** Variety history shows a Write-off (−1 Wilted, 03.06) with no prior stock, then +30 purchases
  (05.06). Either the trace lacks the pre-cutover opening balance or ordering is wrong. Investigate
  `/stock/varieties/:key/usage` builder in `stockRepo`.
- **B3** "Unaccounted stems +6" is unlabeled. Almost certainly the pre-cutover opening balance (migrated
  batches carry no historical demand/purchase events). Label it clearly ("до переноса / opening") or
  fold into a real opening-balance event, so the ledger reconciles visibly.
- **C** "Balance after this event" step chart is unreadable. Redesign per inventory-over-time best
  practice (clear running-balance line, in/out as bars or annotations, zero baseline, current on-hand
  callout). Research first.
- Files: `backend/src/repos/stockRepo.js`, `backend/src/routes/stock.js`,
  `packages/shared/components/VarietyTracePanel.jsx`, tests.

### PR-4 — Per-column stock filters (E1) + restore chosen E2 losses · largest, may be own /feature
- **E1** bring the dashboard Orders per-column filter pattern (`ColumnFilterPopover` + a new shared
  `stockFilters` util modeled on `orderFilters`) to the Y-model Stock columns (Type/Variety/Available/
  Cost/Sell/Markup/Arrived/Supplier), dashboard first then florist.
- **E2** restore owner-wanted capabilities lost in the Y-model move (see audit below) — pick per owner.

**Status (2026-07-01, branch `fix/stock-y-filters` → PR):**
- ✅ **E1 dashboard** — SHIPPED. New shared `stockFilters` util (14 tests) + `ColumnFilterPopover` moved
  to shared (dashboard file re-exports); `BatchArrivalList` renders a funnel per header, `Filters (n) ·
  Reset` bar in `StockTab`. All client-side. Lab-verified (Type=peony → 2 rows, footer + bar update).
- ✅ **E2 totals footer** — SHIPPED. `BatchArrivalList footer` sums count/qty/cost/sell over the visible
  (filtered) rows. Lab-verified (TOTAL 7 · 92 · 981 · 2756, follows the filter).
- ✅ **E2b inline reorder-threshold / lot-size edit — SHIPPED** (owner agreed placement). In the
  By-Variety EXPANSION (`VarietyListItem`, owner-only `variety-reorder-settings` row): two inline
  integer fields (`InlinePriceField` gained a `format`/`step` prop). Edit bulk-patches every batch of
  the Variety (`onEditField` → dashboard `patchPriceBulk` / florist `handleEditVarietyField`); backend
  already syncs Reorder Threshold across siblings. Lab-verified end-to-end (edit → all 7 batches updated).
- ✅ **E1b florist filter parity — SHIPPED** (owner agreed). New shared `varietyFilters` util (Variety-
  level: Type / colour·cultivar text / status short·tight·free / net range — a sibling of the flat-table
  `stockFilters`, since the florist list is grouped by Variety not flattened sell-tiers) + a florist
  `StockFilterDrawer` (bottom-sheet, mirrors `OrderFilterDrawer`). A `Filters (n)` pill in the Stock
  control row opens it; the filter applies to `filteredGroups` so both Flat + By-type views honour it.
  Lab-verified (Status=Short → 6 varieties down to the 1 short Peony).

## E2 audit — functionality lost moving legacy → Y-model

**Dashboard (flat table → BatchArrivalList / VarietyListItem):**
- Flat-table **totals footer** (item count, qty sum, cost total, sell total) — GONE. *(recommend restore)*
- Inline-editable **Reorder Threshold**, **Lot Size**, **Farmer**, **Last Restocked** per item — GONE.
  *(threshold matters for Low pill; lot size for PO sizing — recommend restore threshold + lot size)*
- **Per-column sort** — partially back via BatchArrivalList header sort (8 cols; no farmer/lot/threshold).

**Florist (StockItem → VarietyListItem):**
- **Sort controls** (name/qty/sell/supplier/date) — replaced by group-by-type; PR-1 re-adds sort.
- **Committed / orders breakdown** (which orders consume this stock) — GONE from the row *(recommend:
  reachable via Trace; acceptable)*.
- **Inline cost/sell edit** on the row — Y-model shows read-only on expand (owner-only); edit only on
  dashboard flat. *(acceptable — florist is mobile/read-mostly)*.
- **Edit-mode toggle** — gone; adjust buttons always on batch rows. *(acceptable)*.

**Recommendation to owner:** restore **totals footer** + **reorder-threshold / lot-size inline edit**
on the dashboard flat table (PR-4). Everything else the Y-model either replaces or is reachable via
Trace — hold unless the owner disagrees.

## Verification
Lab mirror of migrated prod (`pg_dump DATABASE_PUBLIC_URL` read-only → docker lab). Owner tests at
florist :5176 / dashboard :5177 (PIN 1111). Pre-PR: shared vitest + build all 3 apps; backend vitest +
E2E for PR-3. No prod writes this session.
