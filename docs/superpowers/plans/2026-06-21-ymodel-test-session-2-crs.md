# Y-model Test Session 2 — Change Requests (2026-06-21)

> ✅ **COMPLETE (2026-06-30).** Every CR captured here (CR-01 … CR-34) has shipped to master. Stock/new-demand cluster: #407 (CR-02), #408 (CR-03/04/06), #409 (CR-01/07/08), #410 (CR-05), #419 (CR-09), #435 (CR-28). Batch-2 copy/UX/trace (CR-10 … CR-18): see `2026-06-22-ymodel-crs-batch2-plan.md`. Flat-table density + waste-log + shortfall (CR-19 … CR-26): individual fix PRs. Session-2026-06-30 feature CRs: #467 (CR-29), #466 (CR-31), #465 (CR-34), #469 (CR-33), #470 (CR-32), #471 (CR-30). Nothing open. Kept for history.

Live owner walkthrough of the Y-model on the lab dev server (`STOCK_Y_MODEL=true`, scenario `y-model-guide`), continuing the thread from the 2026-06-11/12 session. Owner provides feedback → captured here as CRs → later dissected into implementation slices (after compaction).

## Environment under test
- Branch: `test/triage-fixes-2026-06-19` (octopus-merge of the 7 triage bug-fix PRs #394–#401 — throwaway test branch, NOT for merge)
- Lab dev server: backend :3003, florist :5176, dashboard :5177, delivery :5178, owner PIN `1111`
- Flag: `STOCK_Y_MODEL=true` (Y-model ON)
- Data: `y-model-guide` scenario — 14 stock rows / 13 typed varieties; 4 Peony·Pink batches (−7, +25, −10, −6) collapse to one net +2 variety row.

## Planning outcome (2026-06-21)
All 8 CRs sliced into an implementation plan → **`2026-06-21-ymodel-session2-fixes-plan.md`** (S0 crash re-land · S1 availability model · S2 new-demand flow · S3 column alignment). Locked owner decisions:
- **D-A/D-B (CR-04):** line shows **On hand** (= grabbable, the old "Net") and **Available** (= On hand + premade). Premade reduces On hand; drop "Committed"/"Net" labels. Hydrangea → On hand 22 · 6 Premade · Available 28.
- **D-C (CR-01):** inline confirm ("Only N available — create demand for M more?"), not hard block.
- **D-D (CR-06):** "From incoming PO" source only for **future** POs; free cap nets demand. Overdue → not addable.
- **D-E (CR-03):** overdue POs still count toward incoming/effective but the date is flagged overdue (red).

## Change Requests
<!-- Append CRs here as the owner gives feedback. Format:
### CR-NN — <short title>
- **App/surface:** dashboard Stock tab / florist bouquet picker / ...
- **Observed:** what the owner saw
- **Wanted:** desired behaviour
- **Notes:** screenshots, severity, related CR/decision
-->

### CR-01 — Gate accidental over-allocation (no silent negative demand)
- **App/surface:** Bouquet allocation picker (florist `BouquetEditor.jsx` + `Step2Bouquet.jsx`, dashboard `BouquetSection.jsx` + `Step2Bouquet.jsx`) → shared `VarietyAllocationPicker.AllocationForm`; backend chokepoint `orderRepo.createOrder` + `orderRepo.editBouquetLines`.
- **Observed:** Florist added 20× Gypsophila White to order `202606-020` when only 15 were on hand. Stock silently dropped +15 → **−5**, no warning, no confirmation. Verified in lab DB: stock id `5815…` `current_quantity = -5`; order line qty 20.
- **Root cause (code):**
  - Backend `orderRepo.createOrder` step 4 (`backend/src/repos/orderRepo.js:699-705`) unconditionally calls `stockRepo.adjustQuantity(stockItemId, -quantity)` — no check that available ≥ requested. (Same pattern in `editBouquetLines` `:1157-1158`.)
  - FEFO router (`resolveBatchByFEFO`, `stockRepo.js:229-253`) picks the oldest batch that *fully covers*; if none covers it **falls back to the oldest batch and lets it go negative** (`stockRepo.js:251-252`) — no signal to caller.
  - Picker `AllocationForm` shows `remaining: -N` in amber (`VarietyAllocationPicker.jsx:576-583`) but the **Add button never disables** (`:586-593`). Purely cosmetic.
  - No `allowNegative` / confirm flag exists in the route, repo, or hook.
- **Wanted:** Florists must not be able to **accidentally** consume more than they have. Negative demand stays a legitimate state (PO demand signal) but must be an **explicit, deliberate choice** — not the silent default.
  - Steer to other **available deliveries/batches of the same Variety first** (FEFO already does this server-side when a covering batch exists — keep it) before ever going negative.
  - When the requested amount exceeds net available across all batches of the Variety, **block the default path** and require the florist to explicitly opt into creating demand (pick the "New demand" source / confirm a "create shortfall of N stems?" prompt).
- **Notes / slicing hooks:**
  - Gate belongs primarily at the **backend chokepoint** (createOrder + editBouquetLines) since all add surfaces flow through it — default **reject** (e.g. 409 + structured `{ variety, available, requested, shortfall }`) unless request carries an explicit `allowNegative`/`createDemand: true` flag. Negative-by-design (CLAUDE.md / pitfall #8) stays possible, just opt-in.
  - Frontend: in `AllocationForm`, when `remaining < 0` for a **capped** source, disable Add (or gate behind a confirm) and nudge to switch source to another delivery or to "New demand". The "New demand" source itself stays uncapped (explicit choice). Cross-app parity required (florist + dashboard).
  - **Open question for owner (slicing):** hard-block-then-redirect vs inline confirm dialog ("Not enough — create demand for N stems?"). Also: scope to picker-only, or also any legacy quick-add path?
  - Relates to pitfall #8 (stock-math), [[project_ymodel_cr_decisions_2026_06_12]] (Committed/net decisions).

### CR-02 — Picker crash on undated (null-date) Stock row — `a.date.localeCompare` 🔧 HOT-PATCHED
- **App/surface:** shared `stockAllocationEngine.js` → consumed by `VarietyAllocationPicker` (florist `BouquetEditor`/`Step2Bouquet`, dashboard `BouquetSection`/`Step2Bouquet`).
- **Observed:** Adding a flower to the bouquet threw a full error-boundary crash: *"Что-то пошло не так — undefined is not an object (evaluating 'a.date.localeCompare')"*. Whole editor dead, needs reload.
- **Root cause (code):** `stockAllocationEngine` sorted batches (`:57`) and demand entries (`:79`) with `a.date.localeCompare(b.date)`. An **undated row** (`date == null`) — e.g. the Gypsophila White orig (now −5 after CR-01's over-allocation), or any legacy undated orig — dereferenced `null.localeCompare` → throw. `stockMath.js` comparators already wrap with `String(...)`; the engine didn't. 7 other comparators share the latent pattern (`WriteOffBatchPicker`, `BatchArrivalList`, `VarietyTracePanel`, `BatchTracePanel`, `PendingArrivalsPanel`, `WasteLogPage`, `customerRepo`).
- **Fix applied (this session, on the lab test branch):** added null-safe `byDateAsc` (undated rows sort last) in `stockAllocationEngine.js`; both sorts use it. Regression locked: `test/stockAllocationEngine.test.js` fixture 8 (3 tests, 38 total pass). Hot-reloaded on lab so the walkthrough can continue.
- **Still TODO for the implementation session:** re-land this on a proper `fix/*` branch off master (it currently lives on the throwaway octopus branch); audit + guard the other 7 unguarded `.date.localeCompare` comparators (same crash class); build all 3 apps. Consider a single shared `byDateAsc` util so the pattern stops recurring.

### CR-03 — Surface net + incoming + arrival-date availability in the Stock view (parity with picker)
- **App/surface:** Stock panel — florist `StockPanelPage.jsx` / dashboard `StockTab.jsx` → shared `VarietyListItem.jsx` (4-bucket header). Reference display already exists in the picker: `VarietyAvailabilityLine.jsx` (`On hand · Committed · Reserved · Net [ +Incoming <DateTag> · Effective ]`).
- **Observed:** In the **bouquet picker**, a Variety shows the full availability line incl. incoming PO + arrival date + effective (e.g. Lisianthus White: `0 On hand · 12 Committed · −12 Net · +20 [16.06] · 8 Effective`). The **Stock list** only shows onHand/planned/reserved/net — no incoming, no arrival date, no effective.
- **Wanted:** The Stock view must also show, per Variety: the **net amount against standing orders** AND the **incoming** stems with their **arrival date**, so the owner can see *what will be available, and when*. Not just "what's arriving" — the calculated net against existing orders too (i.e. the same `effective = net + incoming` line, with the DateTag).
- **Date-correctness sub-finding (verified):** the `16.06` chip is sourced from the PO's **`planned_date`** (planned arrival), NOT the order/created date (`created_date = 12.06`) — confirmed in lab DB (PO `c305d1f7`) and code (`/stock/pending-po` returns `plannedDate`; `arrivalsForVariety` maps `p.plannedDate`). So the chip is semantically correct. ⚠️ It reads *in the past* (16.06 vs today 21.06) only because the seed PO is an **overdue `Sent` PO** — real data quirk, not a date-field bug. **Open product question:** should an overdue planned arrival still count toward `incoming`/`effective`, or be flagged as overdue?
- **Notes / slicing hooks:** the heavy lifting already exists — `getVarietyAvailability` + `arrivalsForVariety` (stockMath.js) + `VarietyAvailabilityLine`. Likely slice = feed `pendingPO` into the Stock list and render `VarietyAvailabilityLine` (or its buckets) inside `VarietyListItem`. Cross-app parity (florist + dashboard). Decide whether to always show incoming/effective or only when `incoming > 0`. ⚠️ Bucket semantics for this line are changed by **CR-04** (drop "Committed", show "Premade") — apply CR-04 first.

### CR-04 — Replace "Committed" (order demand) with "Premade" (reservations) in availability buckets ⭐ DECISION
- **App/surface:** shared `VarietyAvailabilityLine.jsx` + `getVarietyAvailability`/`getVarietyTotals` (`stockMath.js`); every consumer — florist `Step2Bouquet.jsx`/`BouquetEditor.jsx`, dashboard `Step2Bouquet.jsx`/`BouquetSection.jsx`, Stock panel via CR-03.
- **Observed (3 contradictions, verified in code+data):**
  1. **Lisianthus White** `0 On hand · 12 Committed · −12 Net` — the 12 is a negative **Demand Entry** (`current_quantity −12`) = a **customer order**, not a premade.
  2. **Peony Pink Sarah Bernhardt** `25 On hand · 16 Committed · 9 Net` — the 16 = two negative DEs (−10, −6) = **customer orders**, no premade link, yet shown as "Committed".
  3. **Hydrangea Blue** — used 6× in **Spring Set** premade, but shows `28 On hand · 28 Net`: premade reservation **invisible**, not subtracted.
- **Root cause (code):** `getVarietyAvailability` defines `committed = Σ|demand entries|` (customer-order demand) and `reserved = premade stems` (`stockMath.js:160-164`). The UI surfaces "Committed" (order demand); consumers pass **`reservations = new Map()`** (Step2Bouquet `:356,:377`; same in BouquetEditor) → `reserved` always 0 → premades never show. So displayed "Committed" is the *opposite* of the owner's mental model, and the wanted bucket ("Premade") is wired to an empty map.
- **DECISION (owner, 2026-06-21):** Drop the "Committed" (customer-order-demand) number — confusing, not wanted. Show **only the premade-reserved amount**, labelled as premade, so the owner sees which stems are tied up in premade bouquets (recoverable — "we theoretically have them, just not assembled yet"). Example: **Hydrangea Blue → `−6` Premade**. Customer-order consumption stays reflected in **Net** only, not as a labelled bucket.
- **Implementation notes / slicing hooks:**
  - Display: `VarietyAvailabilityLine` → remove the `Committed` segment; render a `Premade`/`Reserved` segment when `reserved > 0` (e.g. `· 6 Premade` / `−6`). Net keeps `onHand − committed − reserved` math (order demand still lowers net, just isn't itemised).
  - **Wiring (the real gap):** fetch premade reservations and pass a populated `Map<stockId, reservedQty>` instead of `new Map()`. Source exists — `GET /stock/committed` under Y-model aggregates `premade_bouquet_lines` per stock id (`backend/src/routes/stock.js:118`). Thread through Step2Bouquet/BouquetEditor (both apps) → `getVarietyAvailability`.
  - **Revises** the 2026-06-12 **D5 "committed"** decision in [[project_ymodel_cr_decisions_2026_06_12]] (which kept "committed" visible) — update that plan/memory when slicing.
  - **Open sub-questions for owner:** (a) does premade-reserved subtract from Net (→ Hydrangea Net 22, with reclaimable note) or stay informational (Net 28)? "−6" phrasing implies it subtracts. (b) For a pure order shortfall (Lisianthus 0 on hand owes 12), with "Committed" hidden the owner sees only `Net −12` `+20 → Effective 8` — confirm that's enough or keep a small shortfall hint.

### CR-05 — Align columns across Shortfalls / Pending Arrivals / Flat-table (one vertical grid)
- **App/surface:** Stock panel — `ShortfallSummary.jsx` (SHORTFALLS) + `PendingArrivalsPanel.jsx` (PENDING ARRIVALS) + the Flat-table view in `StockPanelPage.jsx` (florist) / `StockTab.jsx` (dashboard).
- **Observed:** The three sections each lay out Type / Variety / stem-amount at **different horizontal positions** — the SHORTFALLS amount (`−7 stems`), PENDING ARRIVALS amount (`+7`), and the Flat-table `Available` column don't line up vertically. Hard to scan "which flowers, how many" at a glance.
- **Wanted:** Keep the three as **visually distinct sections** (so it's clear they don't belong to one table), but make their **columns share one grid** — Type, Variety, and especially the **stem amount** must each sit in the same vertical column across all three, so amounts stack in a single vertical line.
- **Notes / slicing hooks:** factor a shared column-grid template (CSS grid `grid-template-columns`) used by all three sections; align the left edge (Type/Variety identity via `VarietyIdentity`) and right-align the amount column at a fixed position. Cross-app parity (florist + dashboard). Pure layout — no data/logic change.

### CR-06 — "From incoming PO (N free)" must net out existing demand
- **App/surface:** shared `VarietyAllocationPicker.jsx` → `buildSources` (`:509-519`); affects the source dropdown's "(N free)" label + the AllocationForm `remaining` cap.
- **Observed:** Peony Pink 50cm — header reads `0 On hand · 7 Committed · −7 Net · +7 [16.06] · 0 Effective`, but the source dropdown offers **"From incoming PO +7 → 16.06.2026 (7 free)"**. The +7 PO is **already fully claimed** by the existing −7 customer demand → **0 truly free**. The "(7 free)" directly contradicts the header's own "0 Effective".
- **Root cause (code):** in `buildSources`, the incoming branch sets `available: availability.incoming` (raw `+7`) — it ignores outstanding demand. The header already computes `effective = net + incoming = 0`; the dropdown cap doesn't.
- **Wanted:** the PO source's free cap must reflect demand already consuming it — show `Math.max(0, Math.min(incoming, effective))` free (here **0**), consistent with the displayed Effective. Don't present a fully-pre-committed PO as free stock.
- **Notes / slicing hooks:** change `available` in the incoming branch from `availability.incoming` → `Math.max(0, Math.min(availability.incoming, availability.effective))`. When 0 free, either show "(0 free)" or hide/disable the PO source. Ties into **CR-01** — picking it anyway over-allocates the PO. Add a `buildSources` unit test (`test/VarietyAllocationPicker.test.jsx`) for the demand-eats-PO case.

### CR-07 — Owner must set a sell price when creating a new demand entry
- **App/surface:** shared `VarietyAllocationPicker.jsx` → `AllocationForm` (`:535-595`) + host wiring `onSelectStock` in florist `Step2Bouquet.jsx`/`BouquetEditor.jsx` and dashboard `Step2Bouquet.jsx`/`BouquetSection.jsx`.
- **Observed:** New-demand / new-Variety lines default to **sell 0** (`0 zł × 10 = 0 zł`, `0 zł × 15 = 0 zł`), so the order **Sell total (378 zł)** only counts the one batch-priced line. The allocation form has no price field (only Source + Amount + Add). For a fresh DE there is no card/PO price to resolve from → 0.
- **Wanted:** owner can enter a **sell price per stem** (and likely cost too) when creating a new demand entry, so the order's sell total is correct from the start. Still overridable by the **price-override** field below the cart.
- **Notes / slicing hooks:** add an optional sell/cost-price input to `AllocationForm`, shown for `fresh`/new-demand selections (where `resolveStockLinePrice` would return 0). Thread the typed price through `onSelectStock(selection, amount, { sellPrice, costPrice })` → order line `sell_price_per_unit`/`cost_price_per_unit`. Relates to PR #400 (new-flower cost+sell form in BouquetEditor — different surface: create-stock vs new-demand) and `resolveStockLinePrice`/`resolveVarietySell` (return 0 for priceless fresh DEs). Cross-app parity. Owner-visible → owner-summary when sliced.

### CR-08 — "New demand" line is rejected at order submit (orphan, no Stock Item) 🚧 BLOCKER
- **App/surface:** florist `Step2Bouquet.jsx` `onSelectStock` 'fresh' handler (`:932-939`) + dashboard Step2Bouquet equivalent; backend `orderRepo.createOrder` orphan guard (`:574-582`).
- **Observed:** Order with two "New demand" Peony lines (Peony Pink 60cm Sarah Bernhardt ×10, Peony Pink 50cm ×15) → **Submit fails**: *"Order line(s) without a Stock Item are not allowed: Peony Pink 60cm Sarah Bernhardt, Peony Pink 50cm. Create the flower in Stock first."* Order **not created** (verified: transaction rolled back, no partial order, no stray stock rows in lab DB).
- **Root cause (code):** the picker's "New demand" (`kind: 'fresh'`) handler adds a line as `{ stockItemId: null, flowerName, costPricePerUnit: 0, sellPricePerUnit: 0, ... }` — it **never creates a stock row**. Backend `createOrder` step 2 rejects any null-`stockItemId` line *before* the Y-model DE step (3b). Contrast: "Into committed" (`kind: 'merge'`) → `addOne` with the DE's real id (works); "+ Create new Variety" (`:947`) → POSTs `/stock`, attaches real id (works); the **edit** flow `useOrderEditing.createDemandEntry` also POSTs `/stock`. Only the NewOrder "New demand" source skips row creation.
- **Wanted:** picking "New demand" must yield a real **demand-entry stock row** (negative-qty DE) for that Variety, line bound to its id, so submit succeeds. Mirror `onCreateVariety`/`createDemandEntry`: POST `/stock` with the expanded Variety's 4-tuple → attach `res.data.id`.
- **Notes / slicing hooks:**
  - `buildSources` 'fresh' selection carries **no `variety`** (`{ kind: 'fresh' }`); thread the expanded Variety key through so the handler knows what DE to create (it currently only has `yPickerStockItems[0]['Display Name']` as a fallback).
  - The green **"STOCK" tag** on a null-`stockItemId` NEW line is misleading — fix tagging too.
  - **Entangled with CR-01 (over-allocation gate), CR-04 (premade buckets), CR-07 (sell price on new demand)** — the whole "New demand" path is being reshaped; **slice these together**, don't patch in isolation (risk: duplicate DE rows / conflict with `getOrCreateDemandEntry` dedup-by-(varietyKey,date)).
  - **Workaround for continued testing:** use **"Into committed"** or **"+ Create new Variety"** instead of "New demand" — both produce valid stock-linked lines and submit fine.

### CR-09 — New-PO form over-proposes Varieties + re-proposes already-ordered stems ✅ RESOLVED (#419, 2026-06-22)
- **App/surface:** florist `PurchaseOrderPage.jsx` (full-page New Purchase Order — the surface the owner was on) + dashboard `StockTab.jsx` → `StockOrderPanel.jsx`. New shared util `packages/shared/utils/buildPoSuggestions.js`.
- **Observed (2026-06-22 lab):** opening "New Purchase Order" pre-filled ~7 suggested lines (Lisianthus White 12, Peony Pink 60cm Sarah Bernhardt 10 + 6, Tulip Yellow 8, plus the 3 real shortfalls) while the SHORTFALLS panel below listed only **3** truly-short Varieties. Worse, the 7 Peony Pink already on **Sent PO #PO-GUIDE-1** were re-proposed (no netting of open POs).
- **Root cause (code):** `negativeStock = stock.filter(qty < 0)` (`PurchaseOrderPage.jsx:76`) + `startNewPO` mapped one line per raw negative row. Under Y-model those rows are **Demand Entries**, so the form listed Varieties whose on-hand batches already cover them, and never subtracted open-PO coverage. Diverged from the SHORTFALLS panel, which nets via `allocateVarietyCoverage`.
- **Wanted:** pre-fill only Varieties still short after on-hand **and** all open POs; don't re-buy stems already ordered.
- **Fix (shipped #419):** `buildPoSuggestions(groups, pendingPO, premadeMap)` — one line per Variety with `getVarietyAvailability(...).effective < 0` (date-agnostic `incoming`, so even a **late** PO nets out — intentionally differs from the date-aware panel). qty = `−effective`; demand-driven (`committed > 0`); attaches to the undated orig row, else carries 4-tuple identity (#304). Wired in both apps; legacy (flag-off) pre-fill unchanged. 8 unit tests + 3-app build. For the lab scenario: form now shows **Ranunculus Orange 40cm (5)** + **Gypsophila White (5)**; Peony drops out.
- **Net-new** — not in the S0–S3 plan; D-D (CR-06) covers PO-netting for the bouquet *picker*, a different surface.

### Trace visibility (2026-06-22) — not a CR
- Owner couldn't find the per-Variety trace on the lab. Cause: it lived in **open PR #411** (`feat/trace-under-cards`), not yet on master/lab. **Merged #411 2026-06-22** → trace now on the Stock panel (tap a Shortfall / Pending-Arrival row to expand). Was NOT part of the overnight ultracode batch (#412-417).

---

## Session 2026-06-22 (afternoon) — live lab test, batch 2 (CR-10 … CR-16) 📝 CAPTURED ONLY (second run)
> Owner is testing the **English** UI on the lab. Some copy items below are EN-only (the RU strings are already clear). Flagged per item.

### CR-10 — "Reserved" wording → "premade" (stems locked in a premade bouquet) · copy
- **App/surface:** shared `VarietyListItem.jsx:140` (BucketChip `label={t.reserved}`) · `VarietyAvailabilityLine.jsx:50` (uses a *different* key `t.premade`) · `BatchTracePanel.jsx:53` (`t.traceReservations ?? 'Reserved (no date)'`). Keys: `reserved` EN 'Reserved' (florist:796/dash:1008), RU 'В премейдах' (florist:1629/dash:2057); `premade` EN 'Premade'/RU 'Премейд'.
- **Observed:** the bucket chip labels premade-locked stems **"Reserved"** (EN). Owner wants it to say it's in a **premade**. Also inconsistent: availability line already says "Premade", chip says "Reserved".
- **Wanted:** wherever stems are tied up in a premade bouquet → say **"premade" / "in premade"**, never "reserved".
- **Notes:** RU already 'В премейдах' ✓ — main fix is EN `reserved:'Reserved'` → 'In premade' (or reuse `t.premade`) + align `traceReservations`. Cross-app. Pure copy.

### CR-11 — Shortfalls / Pending-Arrivals row spacing too tall → tighten to flat-table rhythm · layout
- **App/surface:** shared `ShortfallSummary.jsx` (header `py-2.5`, body `px-4 py-2`, `<ul space-y-1>`, rows `py-1`, per-date `DateTag` block) + `PendingArrivalsPanel.jsx`. Compare flat-table rows (`stockRowGrid.js` in `StockPanelPage`/`StockTab`).
- **Observed (screenshot):** rows have large vertical gaps (date-tag-above-row → tall blocks); harder to scan than the tighter flat-table stock list below.
- **Wanted:** "nice and tight, see at once" — match the flat-table row rhythm.
- **Notes:** reduce `space-y-1`/row `py`, shrink/inline the per-date `DateTag`. Layout-only, cross-app.

### CR-12 — Graph (sparkline) behind a right-side trace button, NOT auto-shown on row-click · UX
- **App/surface:** `ShortfallSummary.jsx` + `PendingArrivalsPanel.jsx` (row `onClick`→`toggle`→`VarietyTracePanel`); `VarietyTracePanel.jsx:33` renders `<BalanceSparkline>` **always at top**, then the consuming-orders list, then the drift footer. Mirror 📈 `variety-history-btn` (`VarietyListItem.jsx:180`).
- **Observed:** clicking a row expands the **full** panel — graph AND orders list — by default. Owner clicks to see *which orders consume the stock*, doesn't want the graph every time.
- **Wanted:** row-click → **orders/event list only** (no graph); a dedicated **trace button on the right side** opens the graph on demand.
- **Notes:** split `VarietyTracePanel` so the sparkline is gated; right-edge trace/📈 button toggles it. OPEN CHOICE: inline toggle vs modal — recommend inline. Cross-app.

### CR-13 — Cost/Sell prices shouldn't have the dotted underline · cosmetic
- **App/surface:** shared `InlinePriceField.jsx:54` — `underline decoration-dotted underline-offset-2`. Dashboard inline-editable Cost+Sell cells (S3/#410).
- **Observed (screenshot):** every cost/sell price has a dotted underline.
- **Wanted:** no underline at all.
- **Notes:** remove the underline classes. **CAVEAT:** it's the only "click-to-edit" cue — recommend a hover-only cue (e.g. pencil-on-hover) instead of nothing. Dashboard-only.

### CR-14 — "·mix" cost badge cryptic + fires spuriously (counts demand-entry costs) · bug + copy
- **App/surface:** shared `BatchArrivalList.jsx:195/197` renders a **hardcoded** `·mix` when `costMixed = costsSeen.size > 1` (line 356); tooltip `t.costMixedTooltip`.
- **Observed:** Anemone cost shows **"8.00 ·mix"**; owner doesn't know what "mix" means. ROOT CAUSE (verified in lab DB): Anemone = one real batch (cost **8.00**) + the absorbed **demand-entry** carrying a stray random cost (**14.19** — `de()` doesn't set cost → faker random). `costsSeen` counts every row incl. the DE → size 2 → spurious mix. Mis-fires on **any** Variety with a batch + a DE (Tulip, Astilbe…).
- **Wanted:** (a) understandable label ("bought at >1 cost price, newest shown"); (b) don't fire when there's truly one receive.
- **Notes:** PRODUCT — `costsSeen` should only count positive-qty **receive** rows, never demand entries; "·mix" is hardcoded English (shows in RU too) → make a `t.costMixedShort` key + clearer copy. LAB DATA — `de()` should set `current_cost_price: 0`/null so DEs inject no phantom cost. Cross-app.

### CR-15 — "TBD" undated-arrival label unclear (English jargon) · copy (EN only)
- **App/surface:** `PendingArrivalsPanel.jsx` undated group (`__undated__`, line 50) → `t.undatedShort` = EN **'TBD'** (florist:248/dash:314), RU **'без даты'** (florist:1081/dash:1363).
- **Observed:** PENDING ARRIVALS shows a third group labelled **"TBD"** (the Aster White undated-PO, scenario #17); owner doesn't understand it. (EN UI; RU already 'без даты'.)
- **Wanted:** a clear "arrival date not yet known" label.
- **Notes:** EN-only — change `undatedShort` 'TBD' → 'No date'. Trivial.

### CR-16 — Absorbed / zero-qty demand row: can't reach the consumption trace or open the graph · bug/UX
- **App/surface:** shared `VarietyListItem` expansion (demand sub-rows not individually clickable) + trace wiring: `onRowClick(stockId)→setTraceStockId` opens the **batch** trace (`getUsageByExactId` → that batch's events only); `onVarietyTrace`/📈 (`variety-history-btn`) opens the **variety** trace (`getUsageByVarietyKey`, unions the DE's consuming order). Hosts: `StockPanelPage.jsx:606-607`, `StockTab.jsx:969-970`.
- **Observed:** Anemone (absorption) shows a demand row with qty **0** (owner agrees 0 is correct — used for an order, maybe not delivered). But she can't **click the 0 row** to see which order consumed it, and "can't open the trace view (graph)." ROOT CAUSE: under Y-model the DE (holds the −5 order) and the batch (+12) are separate stock ids; the row-click trace targets the **batch** → shows only +12, never the −5 order → "where did the flowers go?" is invisible there. Only the Variety-level 📈 trace unions both, and it isn't discoverable enough.
- **Wanted:** clicking the row / a clear trace control must reveal **which order(s) consumed the stems** (variety-level history incl. the −5) and open the graph.
- **Notes:** ties to **CR-12**. Make the absorbed/zero demand row reachable — either the demand sub-row opens the variety trace, or the row's trace control uses `getUsageByVarietyKey` (unions DE + batch), not the batch-only `getUsageByExactId`.

### CR-17 — "+N reserved/in-premade" reads as ADDITIVE — premade stems are a SUBSET of on-hand · bug (math presentation)
- **App/surface:** dashboard flat-table qty cell `StockTab.jsx:1320-1327` (`<div>{qty}</div>` then `+{premade.qty} {t.inPremades}`) + florist flat-table equivalent (`StockItem.jsx` / `StockPanelPage`) for parity + `BatchArrivalList.jsx:190` (`+{b.reserved} {t.reserved}`) + the `VarietyListItem` reserved BucketChip (`:137-143`).
- **Observed (screenshot, Hydrangea Blue):** qty shows **18** with **"+6 Reserved/in premades"** beneath → reads as **18 + 6 = 24**. But only 18 stems physically exist; **6 of those 18** are locked in the Spring Set premade → only **12 free**. The leading `+` implies the 6 are *added to* the 18, when they are a *subset of* it.
- **Wanted (owner's words):** show it non-additively — **"12 + 6 in premade"** (free + locked) OR **"18 − 6 in premade"** (total − locked). Make clear the premade stems are part of the 18, not extra.
- **Notes/slicing:** the model already has this number — `getVarietyTotals` net = onHand − committed − reserved = **12** for Hydrangea. DECISION for the second run: either lead with the **grabbable** number (12) + a "6 in premade" sub-line, or keep the physical total (18) but use **"− 6 in premade"** (minus, never plus). Drop the additive `+` everywhere reserved/premade sits beside on-hand. Cross-app parity (dashboard + florist flat tables + BatchArrivalList + VarietyListItem chip). Pairs with **CR-10** (the "reserved" → "premade" wording). **Type: bug (misleading math presentation).**

### CR-18 — Balance graph has near-zero informational value — make amounts + consuming orders/events legible ⭐ HIGH-VALUE
- **App/surface:** shared `BalanceSparkline.jsx` (consumed by `VarietyTracePanel.jsx` + `BatchTracePanel.jsx`). Currently: time-proportional X axis, inverted Y, dashed zero line, staircase path, colour-coded event dots, Y/X axis labels.
- **Observed (owner, 2026-06-22):** "currently it's just a maybe-nice-to-follow line if you already know what happened, but it has **0 informational value**." You can trace the line but cannot read **how many stems existed at any given time** nor **what consumed/added them**. The dates of change are visible (X axis ✓); the **amounts** and the **orders/events** behind each change are not.
- **Wanted:** the graph must be a tool to understand, at a glance: (1) **how many flowers we had at any given time** — the running balance amount must be readable at each step, not just inferable from the line height; (2) **what changed it** — every change point must surface its **delta** and the **order/event responsible** (e.g. "−5 order 202606-020", "+25 PO receipt PO-GUIDE-1", "−8 write-off", "−6 premade Spring Set"); (3) keep the change **dates** (already there).
- **Notes / slicing hooks:** redesign of the chart's *content/annotations*, not just its placement. Each event marker should carry an inline label (delta + balance-after + short event identity) — legible without hover, with hover/tap giving the full detail and the order-click jump (the `onOrderClick` path already exists). Consider: value labels at each step on the staircase, a compact event legend, and larger/labelled markers. Pairs with **CR-12/16** (S6 — graph gated behind a trace button). Captured 2026-06-22 → dedicated slice **S7** in `2026-06-22-ymodel-crs-batch2-plan.md`. Verify visually on the lab (Playwright screenshot) before the owner sees it. Owner-visible → owner-summary when shipped. **Type: feature (chart redesign / data legibility).**

### CR-19 — "· N in premade" must be on ONE line (flat table) ✅ DONE 2026-06-23
- **App/surface:** shared `BatchArrivalList.jsx` amount cell (dashboard "Flat table" under Y-model). The free count + premade sub-label stack in the narrow Available column.
- **Observed (owner, post-CR-17, lab):** Hydrangea showed "12" then "· 6 in premade" **wrapping to two lines** ("· 6 in" / "premade") in the 3.5rem amount column.
- **Wanted:** the premade sub-label on a single line.
- **Fix:** widened the amount grid track 3.5rem→4.75rem + `whitespace-nowrap` on the span. Florist `StockItem` chip already had `whitespace-nowrap`. Verified on lab (label 69×13px, one line). **Type: cosmetic.**

### CR-20 — Flat-table data sits too far from the flower name → pull columns in ✅ DONE 2026-06-23
- **App/surface:** shared `stockRowGrid.js` `STOCK_GRID_FULL` + `BatchArrivalList.jsx` `GRID_COLS` (the two MUST stay byte-identical; also drives ShortfallSummary + PendingArrivalsPanel rows, CR-05).
- **Observed (owner, lab):** big horizontal gap between the Variety name and the Available/Cost/Sell/… columns — the data was shoved to the right edge, hard to scan.
- **Root cause:** the Variety track was `minmax(9rem,1.5fr)` — the `1.5fr` grew to eat the table's slack, pushing data right.
- **Wanted:** data close to the names.
- **Fix:** Variety track `1.5fr` → **capped `13rem`** so it sizes to ~the longest name and the data columns sit right after; trailing Supplier `1fr` absorbs the slack (empty space moves to the right). NB: a `max-content` first attempt went RAGGED — each BatchArrivalList row is its OWN grid, so max-content sized per-row and broke vertical alignment; a FIXED cap resolves identically across w-full rows → columns stay aligned. Verified on lab: amount cells align across Anemone/Hydrangea/Peony/Tulip (Peony no longer drifts). **Type: layout.**

### CR-21 — More space between the numeric columns ✅ DONE 2026-06-23
- **App/surface:** the shared grid gap on BatchArrivalList rows+header, ShortfallSummary, PendingArrivalsPanel (all must match for CR-05 alignment).
- **Observed (owner, lab):** Available/Cost/Sell/Markup columns felt cramped — "a bit more space between columns with numbers… maybe twice as wide."
- **Fix:** grid `gap-1.5` (6px) → `gap-3` (12px) in all three sections (kept identical so columns stay aligned). **Type: cosmetic.**

### CR-22 — Available number bigger / bolder ✅ DONE 2026-06-23
- **App/surface:** BatchArrivalList amount cell (flat-table "Available" free count).
- **Observed (owner, lab):** wanted the available-flowers number to stand out — "a bit bigger / bolder."
- **Fix:** amount span `font-semibold` (text-sm) → `text-base font-bold`. Premade sub-label unchanged. Verified on lab: the count now reads larger/bolder than Cost/Sell and still fits the 4.75rem column. **Type: cosmetic.**

### CR-23 — SHORTFALLS "−N" and "+N late" cryptic → add a legend ✅ DONE 2026-06-23
- **App/surface:** shared `ShortfallSummary.jsx` (Stock panel, both apps).
- **Observed (owner, lab):** didn't understand the red **−N** (e.g. −6) nor the amber **+N late** badge.
- **Meaning (verified in code):** −N = `shortQty`, stems short for that needed-by date (deficit after netting in-time arrivals); "+N late" = `latePoQty`, N on a PO that arrives AFTER that date (coming, but too late). No badge = nothing on order.
- **Fix:** added a one-line legend under the SHORTFALLS header — key `shortfallHint` (en `'−N = stems short for that date · "+N late" = N on order but arriving after it'`, ru `'−N = не хватает к этой дате · "+N поздно" = N в пути, но прибудет позже'`, both apps). Verified on lab. **Type: copy/clarity.**

### CR-24 — SHORTFALLS "+N late" badge + legend = clutter → remove both ✅ DONE 2026-06-24 (supersedes CR-23)
- **App/surface:** shared `ShortfallSummary.jsx` (Stock panel, both apps) + `apps/{florist,dashboard}/src/translations.js`.
- **Observed (owner, lab):** after CR-23 shipped the legend, the owner re-evaluated: the amber **+N late** badge and the explanatory legend line under the SHORTFALLS header were noise without informational value. "I think I don't need it. It messes everything." Confirmed via AskUserQuestion → **Remove it**.
- **Fix:** dropped the late-PO badge from BOTH the dashboard grid layout and the mobile flex layout; removed the whole `shortfall-hint` legend `<p>`; deleted the now-dead `poLate` / `poLateShort` / `shortfallHint` keys (en+ru, both apps). **`latePoQty` stays in `stockMath`/`allocateVarietyCoverage`** — load-bearing: a late PO must still NOT cover the demand, else the shortfall row would wrongly vanish; only its UI surfacing was removed. The panel is now: date → flower → **−N** → Cost/Sell/Markup/Supplier. Test `ShortfallSummary` "LATE pending arrival" updated (row still shows −7, badge testid absent). Shared 521/521; all 3 apps build; verified live (Playwright). **PR #430. Type: copy/clarity (declutter).**

### CR-25 — Waste log: add Today + custom date range; flat date-sorted list, no supplier grouping ✅ DONE 2026-06-24
- **App/surface:** dashboard `StockTab.jsx` (Stock → Waste log) + florist `WasteLogPage.jsx` (parity) + `apps/{florist,dashboard}/src/translations.js`. Backend `GET /stock-loss?from&to` already supported ranges — no backend change.
- **Observed (owner, lab):** (1) wanted a **Today** quick filter — everything written off today, any reason. (2) wanted a **custom date range** (From→To) alongside the existing presets (This month / Last 30 days / Last 3 months — owner said "keep those"). (3) **stop grouping/sorting by supplier** — one flat list sorted by **date DESC**, newest on top, older below.
- **Fix (dashboard):** `wastePeriod` gains `'today'`|`'custom'`; `wasteDateRange` handles both; custom fetches only once BOTH ends chosen (guard in `fetchLossLog`). Removed `wasteGroupBy`/`wasteSortBy`, the group+sort toolbar, the per-supplier grouped tables, and the "Suppliers" summary tile → single flat date-desc table (Supplier kept as a column, not a grouping/sort key). Two load effects consolidated into one keyed on `[wastePeriod, wasteCustomFrom, wasteCustomTo]`. Custom range uses the existing single-date `DatePicker` ×2 (From → To).
- **Fix (florist):** already date-grouped with a Today preset; added the matching `custom` chip + From/To DatePickers; filter now applies an upper bound for custom (presets keep lower-bound-only).
- **Translations:** dashboard +`dateFrom`/`dateTo` (`customRange` already existed) +`noData` (was referenced but undefined — code-review catch, would have rendered the raw key on the empty Today state); florist +`wastePeriodCustom`/`dateFrom`/`dateTo`. en+ru both apps.
- **Verify:** dashboard+florist builds green; adversarial code-review (1 issue found+fixed: `noData`); verified live on lab (Playwright) — Today + Custom render; custom 20→22 Jun narrows to 3 rows + recomputes totals (32→19 stems, 184→132 zł); empty Today shows "No entries"; list flat + date-desc. **PR #432. Type: feature (filtering + layout). Owner-visible → owner-summary candidate.**

### CR-26 — Waste log: filter by supplier, combinable with the time filter ✅ DONE 2026-06-24
- **App/surface:** dashboard `StockTab.jsx` (Stock → Waste log) + florist `WasteLogPage.jsx` (parity) + `apps/{florist,dashboard}/src/translations.js`.
- **Observed (owner, lab):** wanted to know "how many / what flowers we wrote off during a custom period from this or that exact supplier" — a **supplier dropdown** that works **together with** the time filter (two filters at once). NB: distinct from the supplier grouping/sorting removed in CR-25 — this is an explicit filter, list stays flat + date-desc.
- **Fix (dashboard):** `wasteSupplier` state ('all' | supplier); `<select>` in the period bar (ml-auto, right side) with "All suppliers" + suppliers present in the loaded period (+ current selection so it stays valid across period changes — `wasteSupplierOptions` memo). Flat-list filter ANDs supplier with search + the server-side time range; totals recompute over the filtered set.
- **Fix (florist):** mirror `supplierFilter` state + full-width `<select>`; period+reason filter gains a supplier clause. Options from all loaded entries.
- **Translations:** +`supplierAll` ('All suppliers' / 'Все поставщики') en+ru both apps.
- **Verify:** builds green; verified live (Playwright) — dropdown All suppliers / 4f / Stojek; 4f + This month → single 4f row, totals 32→3 stems / 184→12 zł. **PR #434. Type: feature (filter). Owner-visible.**

### CR-28 — Bouquet "N not in stock" double-counts on-hand across same-Variety sibling lines ✅ DONE 2026-06-24 · bug
- **App/surface:** shared `stockMath.js` (new `allocateLinesAgainstVariety`) + florist `steps/Step2Bouquet.jsx` + dashboard `steps/Step2Bouquet.jsx` + florist `BouquetEditor.jsx` + tests. Diagnosed via a 6-agent workflow (5 readers + synthesis).
- **Observed (owner, lab):** Y-model New Order — line 1 = 7 Anemone Burgundy from a dated batch (7 on hand), line 2 = 10 as new demand. Line 2 showed **"3 not in stock"** (10 − 7) not **"10"**. The 7 on-hand stems were counted once per line; real shortfall is 17 − 7 = 10.
- **Root cause:** each cart line compared its qty to the WHOLE Variety's net (`getVarietyAvailability.net`, shared across all rows per CR-27) and the available number was never reduced by what SIBLING lines of the same Variety already claimed.
- **Fix:** new pure helper `allocateLinesAgainstVariety(lines, resolve)` walks lines in order, tracks consumed per Variety key, returns each line's `remainingNet = max(0, varietyNet − earlierSiblings)`. `resolve` returns null to skip deferred/future-PO lines. Each badge surface feeds `remainingNet` into `{qty − available} not in stock`. Florist BouquetEditor nets by stockItemId (its single-item model). NEVER mutates the shared varietyAvail object.
- **Verify:** shared 527/527 (new tests: exact 7→[7,10]→[0,10] case + drain/isolation/deferred/ordering/legacy); 3 apps build; verified live (Playwright) — line 2 now "10 not in stock". **PR #435. Owner-visible.**

## Session 2026-06-30 (live lab test, y-model-guide self-anchored data) ✅ ALL SHIPPED (2026-06-30)

### CR-29 — Fixed-price (Price Override) field should PRE-FILL with the live sell total · UX
- **App/surface:** order creation + premade creation, BOTH apps. Florist `pages/NewOrderPage.jsx` + `components/steps/Step2Bouquet.jsx` (priceOverride input ~line 905-911, placeholder=sellTotal but field empty); dashboard `NewOrderTab` + `steps/Step2Bouquet.jsx`; florist `PremadeBouquetCreatePage.jsx` (line 70) + dashboard `PremadeBouquetCreateModal.jsx`. Possibly edit surfaces too (OrderDetail / premade edit).
- **Owner ask (decided):** today the fixed-price field starts **empty** (only a placeholder hints the sell total) → saves `priceOverride = null`. Owner wants the field **pre-populated with the current sell total** so it's an explicit, visible number; if the user doesn't change it, that value is saved as the price.
- **Current behavior (works, but implicit):** effective price already = `priceOverride ?? sellTotal` (`NewOrderPage.jsx:310`, `orderRepo.js:533`; premade `premadeBouquetService.js`). Lines snapshot sell price at submit so the total doesn't drift post-create. So this CR is about EXPLICITNESS/visibility, not a price-correctness bug.
- **KEY DESIGN NUANCE (resolve before implementing):** a pre-filled value must still **track the sell total until the user manually edits it**, then detach (become a real override). Otherwise pre-filling early "locks" a stale number when lines are added/removed afterwards. Standard pattern: controlled default synced to sellTotal while `!userTouchedOverride`; on first manual edit, stop syncing. Decide whether to persist the synced value as a real `Price Override` number on save, or keep saving null when untouched (the latter keeps the existing `?? sellTotal` fallback and avoids stale overrides — but then the field is just visually pre-filled, not a saved override). Owner intent leans toward "the number sticks" → likely persist on save once shown. **Confirm at slice time.**
- **Parity:** CLAUDE.md order-creation + premade parallel implementations — must land in florist AND dashboard for both order and premade.
- **Status:** ✅ SHIPPED → PR #467 (2026-06-30). Fixed-price field pre-fills the live sell total in `Step2Bouquet` (both apps; new-order + premade), tracks sell until manually edited.

### CR-30 — Recipient/"for whom" step → pre-fill delivery from the chosen key person · FEATURE
- **Owner ask:** after choosing the customer, the flow should ask "for whom is the bouquet?" → pick an existing/connected **key person** (e.g. his wife) OR add a **new** key person with phone + address. Then in the delivery step, that key person's name/phone/address are **pre-filled** into the delivery info, **editable** (e.g. wife's home is on file, but this time deliver to her office → change just the address).
- **App/surface:** order creation, BOTH apps. Florist `pages/NewOrderPage.jsx` + `steps/Step1Customer.jsx` (recipient pick) + `steps/Step3Details.jsx` (delivery prefill); dashboard `NewOrderTab.jsx` + `steps/Step1Customer.jsx` + `steps/Step3Details.jsx` + `KeyPersonChips.jsx`. CRM key-person editors (`CustomerDetailPage`/`CustomerDetailView`) to capture the new fields.
- **What already exists:** orders carry `keyPersonId` (#216, set at creation); key-person selection UI exists (`KeyPersonChips`, Step1 references `keyPeople`). Step3 has manual `recipientName` / `recipientPhone` / `deliveryAddress` (`Step3Details.jsx:161-181`). So linking is there — **prefill + structured contact data are NOT.**
- **GAPS (implementation cost):**
  1. **Schema:** `key_people` today = `name`, `contact_details` (ONE free-text field), `important_date`, `important_date_label`. No structured **phone** or **address** → can't reliably prefill `recipientPhone` + `deliveryAddress`. → migration to add `phone` + `address` (and/or split `contact_details`). Decide: structured columns vs parse free text (unreliable — recommend structured).
  2. **Inline add-new-key-person** with phone+address during the order flow (today add-key-person lives in CRM).
  3. **Step3 prefill** `recipientName`/`recipientPhone`/`deliveryAddress` from the selected key person's record; keep fully editable; per-order edits do NOT mutate the key person's stored address (this-time-only override). Optional: "save this address back to the key person?" prompt — confirm at slice time.
- **Scope flag:** this is a **FEATURE** (schema migration + CRM UI + order-flow wiring across 2 apps), not a quick tweak → run via `/feature`, not a one-shot CR fix. Parity mandatory (florist + dashboard order-creation + CRM).
- **Status:** ✅ SHIPPED → PR #471 (2026-06-30). `key_people.phone`+`address` (migration 0018) + reusable address book: recipient picker in the new-order wizard (both apps), delivery pre-fill from the chosen key person, phone/address inline-editable in CRM. Built per plan `2026-06-30-ymodel-test-crs-features.md`.

### CR-31 — Florist terminal-status button must match delivery type (Delivery → only "Delivered"; Pickup → only "Picked Up") · bug
- **Owner ask:** when an order is a **Delivery**, after the florist delivers it she should see ONLY the **Delivered** button (not Picked Up). When it's a **Pickup**, after the client collects it she should see ONLY the **Picked Up** button (not Delivered). No mixing. (Driver→Delivered already cascades automatically — this is about the florist's manual buttons.)
- **Root cause (single seam):** `packages/shared/utils/orderStatusOptions.js` — `FORWARD_TRANSITIONS['Ready'] = ['Delivered', 'Picked Up', 'Cancelled']` and `getStatusOptions({role, currentStatus, previousStatuses})` takes **no deliveryType** → from **Ready**, florists are offered BOTH terminal buttons regardless of fulfillment type. (Florist `OrderCard.jsx` has a stale local copy `ALLOWED_TRANSITIONS['Ready']` too — should also route through the shared util.)
- **Fix:** thread `deliveryType` (or `isDelivery`) into `getStatusOptions`; filter the Ready forward set → Delivery: `['Out for Delivery'?, 'Delivered', 'Cancelled']` minus `Picked Up`; Pickup: `['Picked Up', 'Cancelled']` minus `Delivered`/`Out for Delivery`. ONE seam fixes all 3 surfaces (florist `OrderCard.jsx` + `OrderDetailPage.jsx`, dashboard `OrderDetailPanel.jsx`) — each call site passes the order's Delivery Type. Owner role stays god-mode any→any. Keep lock-step with backend `orderRepo.transitionStatus` (optional: also tighten the backend ALLOWED_TRANSITIONS by type — currently status-keyed only; not required for the UI ask).
- **Tests:** extend `packages/shared/test/orderStatusOptions.test.js` — Ready+Delivery omits 'Picked Up'; Ready+Pickup omits 'Delivered'; owner unaffected; revert set still works.
- **Scope:** small, clean — shared util + thread param through 3 call sites + tests. Good standalone fix PR (not a /feature). Owner-visible.
- **Status:** 📝 captured, no code yet (owner in collect-feedback mode).

### CR-32 — Two separate time-slot sets: client delivery windows (2h) vs courier assignment slots (1h) · FEATURE
- **Owner ask:** the slots offered to the **client** (when the order is created) are coarse 2h windows — 08-10, 10-12, 12-14, 14-16, 16-18, 18-20. The slots assigned to the **courier** (when the florist/owner assigns a driver to the order) should be finer **1h** slots — 08-09, 09-10, … up to 20:00 — and that courier slot is what's **shown to the driver**. So: order carries the client-chosen window; courier assignment gets its own slot buttons.
- **Today (single slot set):** one configurable list `timeSlots` from app_config (`useConfigLists()`), filtered by `getAvailableSlots(slots, date, slotLeadTimeMinutes)` (`packages/shared/utils/timeSlots.js`). Chosen in `Step3Details.jsx` (both apps) as `deliveryTime`. Stored as a SINGLE `delivery_time` text on BOTH `orders` and `deliveries`. Driver sees that same client window. No courier-specific slot exists.
- **GAPS (implementation cost):**
  1. **Schema:** `deliveries` has one `delivery_time` (= client window, cascaded from order per CLAUDE.md). Add a SECOND field for the courier slot (e.g. `deliveries.courier_time` / `driver_time_slot`). Keep `order.delivery_time` = client window untouched. The order date/time→delivery cascade must NOT clobber the new courier field.
  2. **Config:** add a second slot list — courier 1h slots — to app_config (or generate hourly 08:00–20:00). Owner-editable like `timeSlots`. New `useConfigLists()` key (e.g. `courierTimeSlots`).
  3. **UI — assignment surfaces:** add courier-slot buttons where the driver is assigned: dashboard `order/DeliverySection.jsx`, florist driver-assign section (`OrderCard.jsx` / `OrderDetailPage.jsx`, the `isDelivery && drivers.length` block). Florist + dashboard parity.
  4. **Driver app:** surface the courier slot on the delivery card (`apps/delivery`).
- **Design decisions (owner, RESOLVED 2026-06-30):**
  - Courier slots are **limited to within the client's chosen window** — only the 1h slots that fall inside the client's 2h window are offered at assignment (e.g. client 12-14 → courier picks 12-13 or 13-14). No override outside the window.
  - The **driver sees ONLY the courier 1h slot**, not the client 2h window. (So the driver card shows `courier_time`, not the cascaded client `delivery_time`.)
  - (Open/minor: courier slot lead-time filter — likely none, internal assignment; confirm at slice time.)

### CR-33 — Track delivery margin: client delivery fee (revenue) vs courier payout (cost) · FEATURE (mostly wiring)
- **Owner ask:** delivery is a PRODUCT too — we charge the client one amount and pay the courier another, so track earn/loss on delivery separately from flowers. At order creation: a field for what we charge the client for delivery (near the sell total / override). At courier assignment: a field for what Blossom PAYS the courier — pre-filled with the usual **35 zł** per delivery; if the florist/owner doesn't change it, it stays 35 zł; if they change it, use the new value. Purpose: see delivery profit, incl. **loss** cases (free delivery to client but we still pay the courier). Units = **zł / PLN** (owner's "slot" = transcription of zł).
- **ALREADY EXISTS (big head start):**
  - Client charge: `orders.delivery_fee` + `deliveries.delivery_fee` (pitfall #2: read from the delivery sub-record). Default `defaultDeliveryFee: 35` (config). Chosen in Step3 / DeliverySection today.
  - Courier cost: **`deliveries.driver_payout`** numeric column already exists, AUTO-set to `getConfig('driverCostPerDelivery')` (=**35**) at creation (`orderRepo.js:728`, `orders.js:549`); zeroed when delivery method = Taxi/Florist (florist `OrderCard.jsx`/`OrderDetailPage.jsx`, dashboard `DeliverySection.jsx`/`OrderDetailPanel.jsx`). Default owner-editable in `SettingsTab.jsx` (`settingsDriverCost`). (Sibling `Taxi Cost` field also exists.)
- **GAPS (the actual work):**
  1. **Per-order EDITABLE payout field** at courier assignment — today `driver_payout` is auto-set to 35 and only zeroed by method; there's no input for the florist/owner to override it for a specific delivery. Add an editable field (pre-filled 35, sticks unless changed — same pre-fill-and-detach pattern as [CR-29]) in BOTH assignment surfaces (dashboard `order/DeliverySection.jsx`, florist driver-assign block in `OrderCard.jsx`/`OrderDetailPage.jsx`). Parity.
  2. **Client delivery-fee field placement** at order creation — surface it clearly near the sell-total/override per owner (Step3 already has it; may just need relocation/visibility). Confirm.
  3. **Delivery-margin analytics (the real point):** `analyticsService.computeAnalytics` has `avgDeliveryFee` + delivery counts but NO cost/margin side. Add **delivery revenue = Σ delivery_fee**, **delivery cost = Σ driver_payout** (+ Taxi Cost?), **delivery profit = revenue − cost** (can be negative = loss). Surface in dashboard analytics + expose via Ask Blossom (extend `financePack`/`deliveriesPack`). Keep the existing total=flowers+delivery reconciliation intact ([[project_revenue_net_flower_definition]]).
- **Scope flag:** **FEATURE** but mostly wiring (schema + default already exist) → `/feature`. Smaller than CR-30/32. Parity mandatory; analytics is the core deliverable.
- **Status:** 📝 captured, no code yet (owner in collect-feedback mode).

### CR-34 — New out-of-stock demand attributed to the WRONG date (an existing DE's date, not the order's required-by) · BUG
- **Observed (owner, lab):** created a New Order, delivery **2026-07-03**, with 10 Anemone (out of stock). They correctly appeared in the "flowers we need" / SHORTFALLS list, but the date shown **above the flower is 25 June** — should be **3 July** (when they're needed). 25 June is even in the PAST (today 06-30).
- **Grounded (lab DB, post-order):** Anemone Burgundy DE rows = `(2026-06-25)` now **qty −10** + the on-hand batch drained to 0. **No 07-03 DE exists.** Order lines: both required_by **07-03**, but one (qty 7) bound to flower_name `Anemone Burgundy 50cm (2026-06-25)` (the guide's pre-seeded absorption DE) and one (qty 10) to generic `Anemone Burgundy 50cm`. So the order's demand was applied to the **pre-existing 06-25 Demand Entry** instead of a DE dated to the order's required_by (07-03).
- **Likely root cause (needs `diagnose` — do NOT guess-fix):** when a Variety already has a Demand Entry on some date, the New Order allocation / "New demand" path binds the new demand to that existing DE (or its date) rather than `getOrCreateDemandEntry(varietyKey, requiredBy=07-03)`. The shortfall date is therefore the old DE's date, not the needed date. Candidate sites: Step2 "New demand" POST `/stock` (does it pass the order's required_by as the DE `date`? — PR #409), the VarietyAllocationPicker "Into committed <date>" source (may have offered/consumed the existing 06-25 DE), `getOrCreateDemandEntry`, and SHORTFALLS date grouping (`allocateVarietyCoverage` / `ShortfallSummary.jsx`).
- **Test-data caveat:** entangled with the y-model-guide's pre-seeded Anemone absorption DE @ABSORB_NEED (iso(-5)=2026-06-25). **Clean repro needed:** add out-of-stock demand for (a) a Variety with NO existing DE, and (b) a Variety whose existing DE date ≠ the order date — confirm the shortfall dates to the order's required-by in both.
- **Scope:** correctness bug in demand-date attribution → run `diagnose` (reproduce → minimise → fix → regression test) before any change. Owner-visible. Parity (florist + dashboard New Order).
- **DIAGNOSED + FIXED (2026-06-30, local — pending PR decision):**
  - **Root cause:** `orderRepo.createOrder` step 3b (`orderRepo.js:651-702`) re-homes demand to a `required_by`-dated DE only when the bound stock row has `currentQuantity < 0`. The guide's Anemone absorption DE sits at **qty 0**, and there's no DE/Batch discriminator column (qty-sign is the only signal) → the line bound to that qty-0 DE was misclassified as Batch coverage, skipped re-homing, and step 4 `adjustQuantity` decremented it **in place at its stale 06-25 date**. (Backend-only — the frontend picker binding to the existing DE is harmless once the backend re-homes.)
  - **Fix:** extend step 3b's gate — also route a **qty-0** row through the dated-DE path when it has a non-null date ≠ `demandDate` (stale/absorbed DE or empty Batch on the wrong date → re-home demand to a `required_by` DE, leave the old row untouched via `_deApplied`). qty<0 unchanged (C1); null-dated or same-date qty-0 unchanged (CR-08 fresh placeholder); qty>0 unchanged (Batch coverage). Added `stock.date` to the step-3b SELECT.
  - **Repro + regression:** new `(CR-34)` test in `orderRepo.integration.test.js` (failed before → passes after: old 06-25 DE stays 0, a 07-03 DE holds −10). Verified: orderRepo.integration **43/43**, + fefo/stockRepo/premadeService/createWixOrder **46/46**. C1 + CR-08 still green. No debug tags. Diff: orderRepo.js (+20/−2) + test (+36).
  - **Post-mortem follow-up (not done):** the qty-sign DE/Batch heuristic is fragile at qty 0 — a discriminator column (or always-attribute-demand-by-required_by) would prevent the class. Also check the order-EDIT add-line path for the same qty-0 gap (CR-34 repro is order CREATE only).
- **Status:** ✅ fixed locally + regression-locked; **PR decision pending** (owner in collect-feedback mode — land now or batch with other CR fixes).
- **Scope flag:** **FEATURE** — schema migration + config + UI across florist/dashboard assignment + driver display → run via `/feature`. Parity mandatory.
- **Status:** 📝 captured, no code yet (owner in collect-feedback mode).
