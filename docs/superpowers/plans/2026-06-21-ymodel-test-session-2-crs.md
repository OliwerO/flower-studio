# Y-model Test Session 2 — Change Requests (2026-06-21)

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
