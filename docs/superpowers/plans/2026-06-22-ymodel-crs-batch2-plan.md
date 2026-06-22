# Y-model Test-Session Batch-2 CRs (CR-10 … CR-17) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) tracking. **One branch** `fix/ymodel-crs-batch2` off master, **commit per slice**, **one PR** at the end (the slices share files heavily — per-slice branches would conflict). CRs sourced from `docs/superpowers/plans/2026-06-21-ymodel-test-session-2-crs.md` (CR-10 … CR-17, captured 2026-06-22 afternoon).

**Goal:** Land the seven display/UX fixes the owner raised live-testing the Y-model trace + stock screens.

**Architecture:** All changes live in `packages/shared/` (components/utils/translations consumers) + the two app `translations.js` + the two stock hosts (`StockTab.jsx` dashboard, `StockPanelPage.jsx` florist). No backend, no schema. The Y-model flag-off path must stay inert (these surfaces only render under `STOCK_Y_MODEL=true`).

**Tech Stack:** React + Tailwind (shared components), Vitest + @testing-library/react (shared tests now genuinely run JSX — 509 tests, do not regress), lab harness for visual verify.

## Global Constraints
- **Cross-app parity** (root CLAUDE.md): every change to a stock/trace surface lands in BOTH florist + dashboard. Parallel files: `StockTab.jsx` ↔ `StockPanelPage.jsx`; both consume the same shared components.
- **UI strings**: Russian + English, in BOTH `apps/florist/src/translations.js` and `apps/dashboard/src/translations.js`. Production UI is Russian; several RU strings are already correct (owner tested EN).
- **Shared tests are mandatory + now real**: `packages/shared/vitest.config.js` runs `.test.jsx` (fixed in #424). New shared util/hook → test file required (CI 80% on utils/hooks). Do NOT report a JSX test green without the suite actually executing it.
- **`STOCK_Y_MODEL` flag-off stays inert** — these components only mount under the flag; legacy flat list untouched.
- **Pitfall #7/#8** (LOAD-BEARING): never inline `qty − committed`/`qty − reserved`; use `getEffectiveStock` / `getVarietyTotals`. CR-17 must read the existing `net` (= onHand − committed − reserved), not invent a formula.
- **Never `git add -A`** — stage explicit paths.
- **Pre-PR matrix**: `cd packages/shared && ../../backend/node_modules/.bin/vitest run` (full shared suite) + build all 3 apps (`vite build` florist, dashboard, delivery — shared re-exports reach every app). Lab verify per slice that touches data (S3).
- Update `packages/shared/CLAUDE.md` structure block if a component's contract changes (S6 changes VarietyTracePanel's props).

## Two OPEN DECISIONS (recommended baked in; owner confirms on execution)
1. **CR-17 layout** — recommended **"12 free · 6 in premade"** (free leads; 12+6=18 reads correct). Alt: "18 · −6 in premade". Either kills the misleading "18 +6 = 24".
2. **CR-12/16 graph reveal** — recommended **inline toggle** (graph hidden by default in the expanded area, a right-side trace button toggles it inline), consistent with the current inline expand. Alt: modal/popover.

## Companion data-track (separate plan — NOT a slice here)
PO/order/delivery lifecycle + deep-history lab data → spec'd in **`docs/superpowers/plans/2026-06-22-ymodel-lab-data-additions.md`** (workflow `wz30p7gry`, completed). It is a DESIGN SPEC (not paste-ready code), covering, as concept rows #19–#27:
- **PO 5 missing statuses** Draft / Shopping / Reviewing / Evaluating / Eval Error (+ exposes PurchaseOrderPage missing-key gray-fallback defect).
- **PO line states** Found All / Partial / Not Found (+ `substitute_*` fields) / eval_status Processed.
- **Delivery records** (none exist today) — Pending / Out for Delivery / Delivered + the order↔delivery cascade; one delivery-order deliberately left UNlinked.
- **Payment** Paid + Partial (Unpaid already default).
- **Deep-history Variety** (Tulip Red 50cm Strong Love): multi-week restock cycle crossing zero twice, >6 events (x-axis tick thinning), 2 Complete POs (distinct poDisplayId), 2 writeoffs.
- **Order Cancelled** (dedicated Marigold; still shows in trace — join has no status filter).
**PREREQ (risky):** widen `po()`/`poLine()`/`order()` to emit the full NOT-NULL column set + add a `delivery()` helper wrapping `makeDelivery` — because `insertMany` uses `row[0]` keys positionally, so EVERY row of a table must share identical keys. Verify against `backend/src/db/schema.js`.
**cannotSeed (defer):** delivery RESULT labels (need a `delivery_result` column/migration or post-seed PATCH); a 2nd split-payment (needs `payment_2_*` columns).
This is lab test-data for the "second run" — execute as its own pass (rebuild template + reset), decide separately whether the helper/factory changes warrant a real PR. Does NOT gate the CR fixes (S1–S6).

---

## Slice S1 — Copy & i18n (CR-10 wording · CR-14 label · CR-15) — `frontend/copy`, dep: none
**CRs:** CR-10 (Reserved→premade), CR-15 (TBD→No date), CR-14 (the *label* half only — make "·mix" a translated key + clearer copy; the spurious-trigger logic is S3).
**Files:**
- `apps/florist/src/translations.js` + `apps/dashboard/src/translations.js`:
  - `undatedShort` EN `'TBD'` → `'No date'` (florist:248 / dash:314). RU `'без даты'` (florist:1081 / dash:1363) — keep.
  - add key `costMixedShort` — EN `'mixed'`, RU `'разные'` (place beside `costMixedTooltip` florist:827 / dash:1040 + RU florist:1660 / dash:2089).
  - `reserved` EN `'Reserved'` → `'In premade'` (florist:796 / dash:1008). RU `'В премейдах'` — keep. (Confirms the chip + availability wording converge on "premade".)
- `packages/shared/components/BatchTracePanel.jsx:53` — `t.traceReservations ?? 'Reserved (no date)'` → default `'Premade (no date)'`; add `traceReservations` EN `'Premade (no date)'` / RU `'Премейд (без даты)'` to both translations if not present.
- `packages/shared/components/BatchArrivalList.jsx:195,197` — replace the **hardcoded** `·mix` span text with `·{t.costMixedShort ?? 'mixed'}`.
- `packages/shared/components/VarietyListItem.jsx:140` — chip `label={t.reserved}` now reads "In premade" via the string change (no code change needed beyond confirming it reads from `t.reserved`).
**Deliverable:** EN UI shows "In premade" / "No date" / "·mixed" (translated, not hardcoded). RU unchanged (already correct).
**Steps:** pure string edits (skip TDD red — copy). Grep-guard: `grep -rn "·mix" packages/shared` returns nothing after.
**Tests:** shared suite stays green; add/extend a BatchArrivalList test asserting the mix badge text comes from `t.costMixedShort` (no hardcoded literal).
**Verify→lab:** merge → `git -C <main> pull` (vite HMR), refresh; EN labels updated.

## Slice S2 — Premade stems shown as a SUBSET of on-hand, not additive (CR-17) — `frontend`, dep: S1
**Files:**
- `apps/dashboard/src/components/StockTab.jsx:1320-1327` — qty cell `<div>{qty}</div>` + `+{premade.qty} {t.inPremades}`.
- florist parity: `apps/florist/.../StockItem.jsx` (or `StockPanelPage` flat row) — same qty+reserved cell.
- `packages/shared/components/BatchArrivalList.jsx:190` — `+{b.reserved} {t.reserved}` sub-line.
- `packages/shared/components/VarietyListItem.jsx:137-143` — reserved BucketChip.
**Deliverable (recommended layout):** where on-hand and premade-reserved sit together, show **free** (= `net`, the grabbable number the model already computes) then "· N in premade" — NO leading `+` that implies addition. Hydrangea (18 physical, 6 premade) → reads **"12 · 6 in premade"**, never "18 +6".
**Steps:**
- [ ] Confirm the free number = `getVarietyTotals(...).net` (onHand − committed − reserved) — do NOT inline subtraction (pitfall #8).
- [ ] Update each of the 4 render sites to lead with free + non-additive premade sub-label.
- [ ] (Decision pt 1 — if owner picks "18 −6 in premade" instead: lead with physical qty, premade prefixed `−`.)
**Tests:** component test (VarietyListItem + a StockTab flat-row test): a Variety with onHand 18 / reserved 6 / committed 0 renders free **12** and a "6 in premade" element, and the reserved element has **no** `+` prefix. Verify a no-premade Variety is unchanged.
**Verify→lab:** Hydrangea Blue reads 12 · 6 in premade.

## Slice S3 — "·mix" fires only on real multi-cost receives + lab data fix (CR-14 logic) — `frontend+data`, dep: S1
**Files:**
- `packages/shared/components/BatchArrivalList.jsx` (~320-356, the `flatten`/merge loop) — `m.costsSeen.add(cost)` must run **only for positive-qty receive rows** (batches), never demand entries (qty ≤ 0 / `type==='dated-demand'`). A DE has no cost basis.
- `packages/shared/utils/varietyFinancials.js` — audit: its newest-positive-batch rule already filters to positive batches (line ~34 `if (date && positive)`), confirm no DE cost leaks into any "mixed" concept it exposes.
- `lab/scenarios/yModelGuide.js` — the `de()` helper: set `current_cost_price: 0` (demand entries carry no cost) so the lab stops injecting a phantom cost (Anemone DE = 14.19 today).
**Deliverable:** Anemone (one batch @8.00 + absorbed DE) shows **no** "·mixed". A genuine two-cost Variety (e.g. seed one, or Carnation if costs differ) still shows it.
**Steps (TDD — logic):**
- [ ] Write failing test: BatchArrivalList `flatten` — group with one positive batch (cost 8) + one demand entry (cost 14) → `costMixed === false`.
- [ ] Write test: group with two positive batches (cost 8 + cost 12) → `costMixed === true`.
- [ ] Fix `costsSeen` population to skip non-positive rows; green.
- [ ] Edit lab `de()` → `current_cost_price: 0`.
**Tests:** the two above; full shared suite green.
**Verify→lab:** `npm run lab:template:rebuild -- --scenario=y-model-guide && npm run lab:reset`; query/inspect Anemone — no mix badge. (Backend reads live; no dev restart unless data didn't refresh.)

## Slice S4 — Tighten Shortfalls / Pending-Arrivals row spacing (CR-11) — `frontend/css`, dep: none
**Files:** `packages/shared/components/ShortfallSummary.jsx` (header `py-2.5`, body `px-4 py-2`, `<ul space-y-1>`, rows `py-1`, per-date `DateTag` block) + `packages/shared/components/PendingArrivalsPanel.jsx` (same pattern).
**Deliverable:** row vertical rhythm matches the flat-table stock rows below (`stockRowGrid.js`); "tight, scannable at a glance."
**Steps:** reduce `space-y`/row `py`; shrink or inline the per-date `DateTag` block so each entry isn't a tall stack. Compare side-by-side with the flat table. Skip TDD red (CSS).
**Tests:** shared suite green; optional class-presence assertion. Visual check on lab is the real gate.
**Verify→lab:** refresh; Shortfalls/Pending rows as tight as the stock list.

## Slice S5 — Remove dotted underline on Cost/Sell prices (CR-13) — `frontend/css`, dep: none
**Files:** `packages/shared/components/InlinePriceField.jsx:54` — `className="… underline decoration-dotted underline-offset-2 …"`.
**Deliverable:** no underline on prices. Replace the edit-affordance with a **hover-only** cue (e.g. `hover:underline` or a faint pencil/edit icon on hover) so editability isn't lost (CAVEAT from the CR).
**Steps:** remove `underline decoration-dotted underline-offset-2`; add hover cue. Skip TDD red (CSS).
**Tests:** assert the class no longer carries `decoration-dotted`; suite green.
**Verify→lab:** dashboard Shortfalls/Pending prices have no dotted underline.

## Slice S6 — Trace: graph behind a right-side button; row-click → consuming orders; absorbed/zero rows reachable (CR-12 + CR-16) — `frontend`, dep: S4
**Files:**
- `packages/shared/components/VarietyTracePanel.jsx` — currently renders `<BalanceSparkline>` (`:33`) ALWAYS, then the event list, then drift footer. Add a `showGraph` prop (default `false`); render the consuming-orders event list always, the sparkline only when `showGraph`.
- `packages/shared/components/ShortfallSummary.jsx` + `PendingArrivalsPanel.jsx` — row-click keeps expanding to the event LIST (no graph by default); add a right-edge **trace button** (mirror the `variety-history-btn` 📈 pattern, `VarietyListItem.jsx:180`) that toggles `showGraph` for that row (inline — decision pt 2).
- `packages/shared/components/VarietyListItem.jsx` + hosts `StockTab.jsx:969-970` / `StockPanelPage.jsx:606-607` — CR-16: ensure the trace reachable from an **absorbed/zero** demand row resolves to the **Variety-level** trace (`getUsageByVarietyKey`, unions DE + batch → shows the consuming order), NOT the batch-only `getUsageByExactId` (which shows only the +purchase). Make the zero-qty demand sub-row (or its row-level trace control) open the variety trace.
- Update `packages/shared/CLAUDE.md` (VarietyTracePanel contract: new `showGraph` prop).
**Deliverable:** clicking a Shortfall/Pending/stock row shows *which orders consume the stock* (list) without the graph; a right-side trace button reveals the graph on demand; an absorbed row (Anemone, qty 0) can reach the consuming-order history.
**Steps (TDD where logic):**
- [ ] VarietyTracePanel test: default (no `showGraph`) renders the event list + NO `data-testid="trace-sparkline"`; with `showGraph` it renders the sparkline.
- [ ] Gate the sparkline behind the prop; keep drift footer behavior.
- [ ] ShortfallSummary/PendingArrivalsPanel: add the right-side trace button per row; row-body click → list only; button → toggle graph. Test: clicking row shows list, not sparkline; clicking trace button shows sparkline.
- [ ] CR-16 wiring test: an absorbed/zero demand row's trace control invokes the variety-key fetch (unions DE + batch) and surfaces the consuming order. Verify on lab against Anemone (order −5 visible).
**Tests:** the above + full shared suite green; build all 3 apps.
**Verify→lab:** click a row → orders list (no graph); trace button → graph; Anemone absorbed row → consuming order reachable.

## Slice S7 — Balance graph redesign: amounts + events legible ON the chart (CR-18) — `frontend`, dep: S6
**CR:** CR-18 (owner: "0 informational value" — can't read how many stems existed at any time, nor what consumed them; only the dates are visible).
**Root cause:** `BalanceSparkline.jsx` HAS all the data — running balance, signed delta, event type, order id/customer, supplier, bouquet — but surfaces it ONLY in a `<title>` hover tooltip (`:236, :255`). On a tablet/phone there is no hover; the chart shows a bare staircase + colour dots. The amounts and the orders/events are effectively invisible.
**Files:**
- `packages/shared/components/BalanceSparkline.jsx` — the redesign (consumed by `VarietyTracePanel` + `BatchTracePanel`; both apps).
- `packages/shared/test/BalanceSparkline.test.jsx` — assert balance + delta + identity text render as real nodes (not `<title>`).
- `apps/florist/src/translations.js` + `apps/dashboard/src/translations.js` — any new short labels (e.g. `tracePO`, reuse existing `traceType*`).
**Deliverable:** at each change point the chart makes legible **without hover**: (1) the **running balance** value at each plateau (the "how many at any time"); (2) the signed **delta** (`+25` green / `−5` red / dissolve gray); (3) a short **event identity** (order id / customer · "PO" + poDisplayId · write-off reason · premade/dissolve bouquet). Dates stay on the X axis. Markers stay order-clickable (`onOrderClick`) and keep the full `<title>`. The full event identity also remains in the event LIST below (already rendered by VarietyTracePanel) — the chart now carries delta+balance+type inline, the list carries full identity, so one glance answers "how many, when, why".
**Steps (TDD where logic, then visual-verify):**
- [ ] Write failing test: given a 3-event series (+25 purchase, −5 order w/ orderId, −8 writeoff), the rendered SVG contains a balance-after text node per step (`data-testid="bal-label-{i}"`) and a signed delta text node per event (`data-testid="delta-label-{i}"`) — NOT only inside `<title>`.
- [ ] Grow the chart: `H` ≈ 190–210, widen `padTop`/`padBottom`/`padLeft` for labels; keep `viewBox` responsive.
- [ ] Render the running-balance value at each plateau (after the jump), tabular-nums, red when negative.
- [ ] Render a signed delta badge beside each marker, coloured by direction (green/red/gray for dissolve); stagger above/below the staircase to avoid overlap on adjacent events.
- [ ] Render a short event-identity label per marker (order → `orderId`/customer short; purchase → `PO ${poDisplayId ?? ''}`; writeoff → reason; premade/dissolve → bouquetName), truncated; when adjacent events are too close horizontally, drop the identity label (keep delta+balance) and rely on the marker `<title>` + the list. Never let labels collide illegibly.
- [ ] Add light y-gridlines + value labels at min / 0 / max so balance levels are readable.
- [ ] Keep `onOrderClick` + the full `<title>` for tap/hover detail.
- [ ] Run `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/BalanceSparkline.test.jsx` → PASS; full shared suite green; build all 3 apps.
**Verify→lab:** Playwright screenshot a Variety trace (e.g. deep-history Tulip Red after the lab-data track, or Peony) with the graph open; confirm balance amounts + deltas + event identities are readable at a glance. Iterate (≤2×) if cramped. This is the highest-visibility item — self-verify the screenshot before calling it done.
**Note:** owner-visible → write an `owner-summary` when shipped.

---

## Ledger
- [ ] S1 — copy & i18n (CR-10/14-label/15)
- [ ] S2 — premade-as-subset presentation (CR-17)
- [ ] S3 — "·mix" trigger + lab data (CR-14 logic)
- [ ] S4 — Shortfalls/Pending spacing (CR-11)
- [ ] S5 — dotted underline (CR-13)
- [ ] S6 — trace graph-button + consumption-on-click + absorbed-row reachability (CR-12/16)
- [ ] S7 — balance graph redesign: amounts + events legible (CR-18)

(Update on each clean review: `Sx: complete (commits <base7>..<head7>, review clean)`.)

## Execution notes (post-compaction)
- Subagent-driven, Sonnet implementers; spec-review per slice; opus code-quality review at the end (one branch). Skip TDD red for pure copy/CSS (S1/S4/S5); mandatory red for logic (S3 costsSeen, S6 prop gating + wiring).
- Confirm the two OPEN DECISIONS with the owner before S2 / S6 land (recommended values baked in).
- One branch `fix/ymodel-crs-batch2`, commit per slice, one PR closing the CR cluster. Deploy each frontend slice to lab via merge + `git -C <main-tree> pull` (HMR); S3 also needs `lab:template:rebuild -- --scenario=y-model-guide && lab:reset`.
