# Y-Model Test Session — Notes (2026-06-11)

Live testing against lab (`y-model-demo` scenario, STOCK_Y_MODEL=true, owner PIN 1111).
Florist :5176 · Dashboard :5177 · Delivery :5178 · API :3003.

Format: each item = observation → why it renders that way → decision (KEEP / CHANGE / OPEN Q).
Change requests get logged here, NOT implemented yet. Logic-implications query session happens at the end.

---

## SESSION STATUS — paused 2026-06-11 (resume here)
**State:** UI-walkthrough testing of the integrated Y-model. 22 change requests captured (CR-1…22), no fixes implemented yet (CR-1 typeahead was already live via #365). Next planned step the user asked for: a **logic-implications / query session** to sort CRs into buckets and resolve the open decisions, BEFORE writing any code.

**To resume the lab:** `git checkout integration/y-model-2026-06-11` (already there) → `npm run lab:db:up` (if Docker pg down) → `npm run lab:dev`. Apps: florist :5176 · dashboard :5177 · delivery :5178 · backend :3003. Lab PINs: owner 1111 · florist 2222 · Timur 3333 · Nikita 4444.

**Data scenarios:** `y-model-demo` (rich/mixed, original walkthrough) OR **`y-model-guide`** (NEW 2026-06-12 — one concept per Variety, teaching fixture). Lab currently seeded on **`y-model-guide`**. Switch: `npm run lab:template:rebuild -- --scenario=<name> && npm run lab:reset`.

**Teaching deliverable (2026-06-12, owner-requested):** `docs/superpowers/plans/2026-06-12-ymodel-functionality-guide.md` — every Y-model concept explained by worked example, numbers verified against the `y-model-guide` scenario. Built: `lab/scenarios/yModelGuide.js` (registered `y-model-guide`) + seeder extended for `stockOrders`/`stockOrderLines` in `lab/helpers/seed.js`. Verified live (florist Stock panel screenshot `ymodel-guide-stock-panel.png`).

**Branch:** `integration/y-model-2026-06-11` (= `integration/y-model-polish-2026-05-31` + master merged, commit `473d096`). Not pushed. Originals (`integration/y-model-polish-2026-05-31`, `master`) untouched.

**Tests still to do (user: "continue remaining tests later"):** PO evaluation → receive-into-stock (#323/#327 path), premade build/dissolve, stock evaluation page, anything past the New-Order bouquet step.

## CR INDEX (by action bucket — for the implications pass)
**A — Quick frontend fixes (land on integration branch, low risk):**
- CR-2 demand-date → DD/MM/YYYY (display only) · CR-3 planned-date format (3 spots) · CR-4 qty "050" leading-zero (string-in-state) · CR-6 shared `<DateTag>` chip · CR-11 driver label drop demand-date · CR-13 driver expected-pay-per-supplier

**B — PO-line-entry consolidation (deep module, one `<PoLineEditor>`):**
- CR-7 name display (free vs composed) · CR-8 qty semantics stems-vs-lots ⚠️ · CR-9 three divergent forms (add-line missing sell/variety)

**C — Picker availability rework (shared calc, florist+dashboard):**
- CR-20 effective + hide net-zero · CR-21 surface reservations + untie-premade · CR-22 surplus + arrival display

**D — Decisions ✅ RESOLVED 2026-06-12** (see `2026-06-12-ymodel-cr-implementation-plan.md` → "Canonical decisions"):
- D1 qty unit = **stems** (lots = helper) · D2 prefill = **net pending-PO** + annotate · D3 picker = **hide effective ≤ 0**, reachable via search · D4 driver = **earliest needed-by first** · D5 demand word = **"Committed"** · D6 dates = **coloured chip, date-only** (grey arrived/red needed/blue arriving) · D7 dedup = **snap to canonical**. CR-8/10/12/20/Q-B all closed by these.

**E — Standalone NEW feature (own grill→PRD→issues, NOT Y-model polish):**
- CR-15 alt-supplier typeahead · CR-16 auto-persist new supplier · CR-17 alt cost → supplier total · CR-18 provisional supplier editable-after · CR-19 **Suppliers entity + dashboard management view** (foundation)

**F — Real-time / driver:**
- CR-5 new Sent PO push live to delivery · CR-14 driver substitute form simplify (flower+colour+supplier+paid)

**Highest real-money impact:** CR-10 (double-order), CR-8 (10× qty error). **Biggest scope:** CR-19 (Suppliers). **Most logic-laden:** CR-12 (FEFO split-back).

## ⚠️ Meta: lab is running on `master` — missing all open Y-model PRs
- `integration/y-model-polish-2026-05-31` holds **18 commits / 8 merged PRs** not on master:
  #358 #360 #361 #362 #363 #364 #366 #367 + typeahead **#365**.
- That integration branch is **10 commits behind master** (master moved with #375, #378–#383). So it's stale.
- Implication: testing on master = testing without the very features under review (e.g. the typeahead in CR-1 already exists in #365). "Continue the integration" = re-stitch these PRs onto current master, then test that.
- **Decision needed:** which tree does the lab run on? (see Open Q-A)

## Integration done (Q-A resolved)
- Branch **`integration/y-model-2026-06-11`** = `integration/y-model-polish-2026-05-31` + `master` merged forward. Commit `473d096`.
- Conflicts: only 2 files, both import-list unions (kept `TierSwitchChip` AND `resolveStockLinePrice`/`resolveVarietySell`): `BouquetSection.jsx`, `BouquetEditor.jsx`. Bodies auto-merged.
- Brought in master's 3 Y-model fixes that were missing: **#375** (gate variety fields + Type-only sendable), **#380** (price pending-PO off Stock Order), **#383** (pending-PO sell in picker list) — plus 9 polish PRs already on the branch.
- Verified: florist+dashboard+delivery builds OK, shared vitest OK, backend vitest OK. Lab rebooted on this branch; grouped stock = 13 varieties.
- **Note:** original `integration/y-model-polish-2026-05-31` ref untouched (fallback). master untouched.
- **CR-1 (typeahead) is now LIVE in the running lab** — #365 is on this branch.

## Change requests
- **CR-1 — New-variety Type/Colour/Cultivar/Farmer typeahead (dedup).** Suggest existing values to prevent typo/case duplicates.
  - Status: **already built in PR #365** (datalist sourced from Stock distinct values) — just not on master. BUT datalist only *suggests*, owner can still free-type "peony" lowercase → case-variant dup. True dedup needs case-insensitive normalize-on-save (snap to canonical existing Variety). → decide in implications pass.
- **CR-2 — Demand-date format in line name.** `(2026-05-16)` → show `DD/MM/YYYY` and present nicer than bare parens. Display-only; stored value stays ISO.
- **CR-3 — Planned-date format (PO create + created-PO views).** Confirmed in 3 places, all want DD/MM/YYYY:
  - create form: native `<input type=date>` → MM/DD/YYYY (OS=en-US). `StockOrderPanel.jsx:648`.
  - PO list header pill: renders `order['Planned Date']` raw ISO → "Planned date: 2026-06-12". `StockOrderPanel.jsx:726`.
  - created-PO edit field: native `<input type=date>` → "06/12/2026". `StockOrderPanel.jsx:745`.
  - Owner also wants dates rendered as a **distinguishable badge/chip** (her words: "format as some kind of batch so it's clearly distinguishable from the [flower] type"). → ties to CR-2; see CR-6.
- **CR-4 — Qty input "050" leading-zero trap.** `StockOrderPanel.jsx:465-468` — `value={line.quantity}` (Number) + onChange `Number(e.target.value)`. When typed string ("050") is numerically equal to current state Number (50), React skips the DOM reset → raw "050" stays, leading zero "can't be deleted." Fix: hold quantity (and lotSize/pkgs/cost/sell) as **strings** in form state; coerce at save (createPO already does `Number(...)||1`). Parity twin: florist `PurchaseOrderPage.jsx`.
- **CR-5 — New Sent PO doesn't push live to delivery app.** Delivery `StockPickupPage.jsx:57` only refetches on SSE `stock_order_line_updated`; PO create/send emits no event it listens for. Driver gets the run only via the 30s fallback poll (`:60`) or reload. New *orders* push live — POs don't. Possible parity fix: broadcast `stock_order_created`/sent + refetch on it.
- **CR-6 — Unify Y-model date rendering as a chip.** Owner wants every Y-model date (demand date in line names = CR-2, planned date = CR-3, batch dates) shown as a consistent DD/MM/YYYY **badge**, visually distinct from flower type/name. `BouquetSection.jsx` already has a `formatPoDate`+`PO_MONTHS` helper — candidate to extract into a shared `<DateTag>` used everywhere. Decide scope in implications pass.

- **CR-7 — Line-name display inconsistent (free name vs composed Variety+date).** `createPO` (`StockOrderPanel.jsx:176`): `composedName = l.flowerName?.trim() || [type,colour,size,cultivar]`. A manual new-variety line where the owner ALSO free-typed a name → free name wins, the structured Type/Colour (e.g. "Pink") is stored but hidden; displays bare "peony". Shortfall lines instead show "Peony Pink 60cm Sarah Bernhardt (2026-05-16)" (full identity + demand-date chip). So rows look structurally different. Decide: always prefer composed Variety identity for display; treat free name as fallback only.
- **CR-8 — Qty means different things in different editors (DANGEROUS, 10× error risk).**
  - Create form: **Qty = raw stems**, separate **Pkgs = lots** (`pkgs × lotSize`). `:204-208`.
  - Sent-PO existing-line editor (DraftLineEditor): **qty = LOTS** (`totalStems = qty * lotSize`, `:1201,:1265`). No Pkgs field.
  - Sent-PO add-line form (AddLineInlineForm): **qty = LOTS** (`:1433`).
  - Same-looking number field, opposite meaning. Owner types 5 (lot 10): create form → 5 stems; sent editor → 50 stems. Unify the model + labels across all three.
- **CR-9 — Three divergent PO-line entry surfaces; add-line form missing fields.** AddLineInlineForm ("Extra flower bought off-plan", `:1419`) exposes only name/supplier/lotSize/qty/cost — **no Sell price, no Variety (Type/Colour/Size/Cultivar), no Pkgs, no Farmer/Notes**. Create form + DraftLineEditor each show a different superset. Owner: "always has to display the same data in the same place." → consolidate into ONE shared PO-line editor component used in all three contexts (create / edit-existing / add-off-plan). Deep-module + parity (florist `PurchaseOrderPage.jsx` has the same three).
- **CR-10 — New-PO prefill double-counts shortfalls already on an open PO (over-order risk).** `startNewPO` (`:84`) prefills from `negativeStock = stock.filter(qty<0)` with NO netting of pending POs. `/stock/pending-po` already returns per-item `{ordered, pos[]}` (and StockTab already fetches it, `StockTab.jsx:106`) — the data exists, the prefill just ignores it. Fix: subtract pending-PO `ordered` from the negative qty; prefill only the uncovered remainder; annotate "already on PO #X: N". Highest real-money impact of the session.

## Driver app (delivery / StockPickupPage)
- **CR-11 — Drop the demand-date from the driver line label.** `StockPickupPage.jsx:348` renders `line['Flower Name']` = composed identity **with `(2026-05-12)` suffix**. Driver doesn't need the needed-by date — only the flower + supplier. Show identity without the `(date)`. Supplier IS already shown as the group header (`:188`) — works once suppliers are set; lines with no supplier fall under "—"/"Direct" (owner forgot to set them → consider gating Send on supplier, minor).
- **CR-12 — Merge same-variety lines within a supplier for the driver.** Lines grouped by supplier only (`:152-157`); two demand-date entries for the same Variety render as two rows ("…05-12 need 10" + "…05-16 need 6"). Driver should see ONE row (Peony Pink 60cm Sarah Bernhardt, need 16) — they arrive together, cover both demands. **Logic implication:** when driver reports "found 11/16", the found qty must distribute back across the two underlying demand-date lines (rule: fill earliest demand first / FEFO). UI merge is easy; the split-back rule needs a decision. → implications pass.
- **CR-13 — Show expected pay per supplier.** `:206-219` only has an INPUT for "Total paid at {supplier}"; no computed reference. Driver can't see what he *should* pay. Add expected = Σ(cost price × qty) for that supplier's found lines, next to the input.
- **CR-14 — Partial / "found more elsewhere" substitute form is overwhelming + missing fields.** `:479-519`: the substitute "flower name" is a datalist of EVERY known flower (full Type/Colour/Size/Cultivar combos) → "peonies in disorder," overwhelming on a phone. Missing a **colour** field and a **paid amount** field. Owner request: driver enters only minimal ID — **flower + colour + supplier + amount paid** (+ optional qty + note); NOT full length/cultivar. Owner fills the full identity afterward via the existing **ReconciliationSection** (dashboard) / **SubstituteReconciliationPage** (florist `/reconcile`). So: strip the big datalist, add colour + paid, keep it light.
- Parity note: the driver pickup view has no florist/dashboard twin, but its data feeds owner **Shopping Support** + **Reconciliation** — keep field names aligned with those.

## Suppliers — promote from config-string to first-class entity (BIG, its own feature)
Current model: suppliers = a **flat string-list in app config** (`configService.js:17`, default `['Stojek','4f',…]`, edited in Settings). Order/PO line has `supplier` text; order has `supplier_payments` JSON `{supplier: amount}`; line has `substitute_supplier`/`Alt Supplier` text. **No supplier record → no phone/email/website.** Per-supplier "Total paid at X" is a **manual** input — not computed, and alt cost does NOT roll into it.
- **CR-15 — Alt-supplier needs a typeahead/dropdown** from known suppliers. `ShoppingSupportPage.jsx:602` is plain `type=text` (same gap in the driver substitute form, CR-14, and they must match). 
- **CR-16 — New supplier typed → auto-persist to known suppliers** so it's selectable next time (append to the suppliers source).
- **CR-17 — Alt-supplier cost rolls into that supplier's PO total.** If alt flower bought at Bisping (not 4f), its qty+cost adds to Bisping's owed for this PO. Drives (a) driver "what to pay Bisping" (= CR-13) and (b) owner money-per-supplier. One shared calc: owed(supplier) = Σ(base lines routed to supplier · cost) + Σ(alt costs routed to supplier). Currently nothing computes this.
- **CR-18 — Provisional supplier, editable after the fact.** Owner buys from an unknown supplier, enters a temp name, gets full details a day later → must be able to rename/correct and reconcile the temp into a known supplier without losing the cost linkage.
- **CR-19 — Suppliers management view on dashboard (the foundation).** New `suppliers` entity (table) with multiple phones/emails/websites/notes; CRUD UI as a dashboard tab; becomes the typeahead source EVERYWHERE supplier is entered (PO create line dropdown in `StockOrderPanel`, alt-supplier in ShoppingSupport + driver substitute). Once this exists, CR-15/16/18 fall out almost for free; CR-17 is the cost-routing logic on top.
- **Scope flag:** this is a new mini-domain ("Suppliers CRM"), NOT Y-model polish. Deserves its own grill → PRD → issues chain. Parity: alt-supplier surfaces in florist ShoppingSupport + delivery substitute + dashboard PO form — all switch to the entity source together.

## Bouquet picker availability is incomplete under Y-model (New Order → Bouquet step)
Picker math (`apps/florist/src/components/steps/Step2Bouquet.jsx:345-349`): `totalQty = Σ current_quantity`, `poQty = Σ pendingPO.ordered`, shown as two raw numbers ("22 pcs · +8 → 12.Jun"). It **never nets demand vs incoming, never subtracts premade reservations, never hides fully-committed varieties.** Filter (`:317-321`) keeps any row with `qty≠0 || onOrder>0` — so net-zero rows still show.
- **Worked examples (verified in lab):**
  - *Peony Pink 50cm*: one −7 demand entry (needed 05-13) + 7 incoming (12.Jun). Picker shows "−7 pcs · +7". Effective = −7+7 = **0 free** → should be **hidden** (nothing available for a new order). Currently shown.
  - *Rose White 60cm Avalanche*: 30-stem batch (10.May) **+** a −8 demand entry (05-18) → picker sums to "**22 pcs**"; +8 incoming covers the −8; **3 stems reserved** by premade "Romantic Pink" (shown in StockTab as "30 +3 Reserved", invisible in picker). Owner wants to see the physical 30 and the 3 reserved, not the bare netted 22.
- **CR-20 — Effective availability + hide net-zero.** Compute `effective = onHand + incoming − demand − reserved` per Variety. Hide rows where effective ≤ 0 (Peony 50cm). NOTE this refines existing deliberate behavior (`:312-316` intentionally shows negative rows so owner can over-order → drives PO demand). New rule: hide only when incoming/reservations net it to ≤0; a genuinely short variety with no incoming still shows. **Decision for implications:** hide net-zero entirely, vs show with "0 free" and allow over-draw (which re-creates demand)?
- **CR-21 — Surface premade reservations in the picker + untie prompt.** Show reserved-in-premade count (like StockTab's "+N Reserved"). If owner selects stems that are reserved, prompt to **dissolve/untie the premade** → its stems return to stock (each flower back to its original batch row). Hooks into existing premade-dissolve (`premadeBouquetService` dissolve, #367). 
- **CR-22 — Show effective surplus + arrival.** "12 needed, 12 arrive → 0 → hide; 12 needed, 20 arrive → show 8 (+ when it arrives)." Same calc as CR-20; this is the positive-surplus display side.
- These three are ONE picker-availability rework. Put the calc in shared (`stockAllocationEngine.js`/`stockMath.js`) so florist `Step2Bouquet` + dashboard `NewOrderTab` Step2 share it (parity). Picker currently shows the PO **arrival/planned date** ("→12.Jun"), not the demand date — that's fine (owner self-corrected the 12th-vs-13th confusion).

## Meta-pattern
- CR-7/8/9 are facets of one architectural issue: **PO line entry+display is fragmented across ~4 components** (formLines create / DraftLineEditor / AddLineInlineForm + the read pill) with divergent field sets, qty semantics, and naming — duplicated again in florist `PurchaseOrderPage.jsx`. Strong `improve-codebase-architecture` candidate: one `<PoLineEditor>` (deep module) + one `composeLineName()` + one qty-semantics rule, consumed everywhere. Flag for the implications pass / a possible `/audit po-line-entry`.

## Open questions
- **Q-A (branch):** Run lab on `master`, the stale `integration/y-model-polish-2026-05-31`, or a fresh re-integration of the open PRs onto current master? Blocks meaningful testing.
- **Q-B (dedup depth):** Suggest-only (datalist, #365 as-is) vs enforce canonical (case-insensitive match → snap). Latter has backend implications (variety-key normalization).

## Cross-app parity flags
- All three CRs live in dashboard `StockOrderPanel.jsx`; florist twin is `PurchaseOrderPage.jsx` — any change must land in both (parity rule). #365 itself must be checked for florist parity.
- Demand-date `(YYYY-MM-DD)` format is backend-composed (ADR-0006, `stockRepo.getOrCreateDemandEntry`) → a *display* reformat is frontend; changing the stored string would hit every Y-model surface. Keep reformat client-side.

---

## Session 2 — 2026-06-12 — New Order → Bouquet picker (florist `Step2Bouquet.jsx` + shared `VarietyAllocationPicker`)
Ground truth pulled from lab DB for **Tulip Yellow 40cm** (the worked example):
- Batch row `0adf…` — `current_quantity = +50`, date **2026-05-10**, sell **11.00**.
- Demand Entry `b87a…` — `current_quantity = −8`, date **2026-05-13**, sell 59.29.
- Pending PO line `71d0…` (Shopping PO) → `stock_id = b87a…` (the DE), `quantity = 8` → renders as search-list "**+8 → 12.Jun**" (12.Jun = PO planned date).
- groupByVariety sums all rows → **50 + (−8) = 42** → that is the "42 pcs / 42 stems" in list + Stage-1.
- Nameless row = stock `259dc5dd` (`display_name "peony"`, **type/colour/size/cultivar all NULL**, qty 0, +50 pending) — the attr-less "peony" PO line from Session 1 (pitfall #9).

**Root finding:** under Y-model the picker shows **three unreconciled numbers for one Variety** (42 net · 50 raw batch · 8 demand), none labelled, and the allocation modal is half-built (qty hardcoded to 1, no remainder, redundant stage). CR-23–28 are ONE rework — they extend bucket **C** (CR-20/21/22).

- **CR-23 — Three numbers, one Variety, none labelled (root of "doesn't add up").** List + Stage-1 show **netted** totalQty (`Σ current_quantity` incl. −8 DE = 42, `Step2Bouquet:345`); allocation "Use stock" shows **raw batch** 50 (`stockAllocationEngine` batch `total = current_quantity`, no netting); "· 8 planned" is the **−8 DE** (`AllocationPanel` merge `abs(currentQty)`). One availability model, surfaced identically in list + modal: on-hand / reserved / demand / incoming / **effective**.
- **CR-24 — Kill the redundant Stage-1 step.** Tapping a specific variety in the search list opens `VarietyAllocationPicker` at **Stage 1** (search box + single-row list, `Step2Bouquet:580` sets `yPickerStockItems=v.rows`) → owner must tap the row *again* to reach source options. Variety already chosen → open straight at Stage-2 allocation options. (Generic open from a search-all entry can still start at Stage 1.)
- **CR-25 — Choose the amount inside the picker + live remainder.** Picker is `qty={1}` hardcoded (`Step2Bouquet:873`); it adds 1 stem, amount set afterward via cart +/−. Owner wants: pick source → see that source's available count → type amount in the SAME modal → watch "remaining" decrement as she allocates. No window-hopping.
- **CR-26 — Source as one dropdown, not tap-through buttons.** Owner's explicit model: dropdown { from stock · from incoming PO · create new demand }; after pick, show available for that source; as added, show left. Re-frames the batch/merge/fresh inline buttons into one selector + qty field.
- **CR-27 — "X not in stock · +N on order" misleads when the line binds to a Demand Entry.** Cart line bound to the −8 DE → `availableQty = −8` → `10 − (−8) = 18` "not in stock" (`Step2Bouquet:129`), though a 50-stem batch physically exists. Binding + availability must reflect the whole Variety, not one sub-row. (Same root as CR-23.)
- **CR-28 — "+8 → 12.Jun" (incoming PO) vs "8 planned" (demand entry) are different 8s, both unlabelled.** Search-list "+8" = pending PO arrival; modal "8 planned" = the −8 DE. Coincident magnitude + no labels = max confusion. Explicit labels: *arriving/incoming* vs *demand/committed*.
- **CR-29 — Nameless picker row (attr-less stock row, pitfall #9).** Row `259dc5dd` renders BLANK because `varietyDisplayName` needs the 4-tuple and all four are NULL. Same attr-less "peony" line from Session 1 (CR-7). When that PO is received, `receiveIntoStock` must back-fill type_name etc. (pitfall #9) or it stays invisible/nameless everywhere.
- **CR-30 — Demand-date in the bouquet-contents line: reformat + bring back the coloured DateTag.** Cart line "Tulip Yellow 40cm **(2026-05-13)**" shows the raw ISO demand date in parens (backend-composed display_name). Owner: want **DD.MM, no year**, as a coloured chip/badge (the old "13 May" box), and labelled as to *which* date it is (this is the DE's **demand** date, not an arrival). Direct extension of CR-2/CR-6 (shared `<DateTag>`). **Owner note: "we do not use the badges anymore"** → a coloured date badge existed somewhere historically and was dropped — find where, decide whether DateTag revives it. → investigate in implications pass.

**Meta:** CR-23/25/26/27/28 + Session-1 CR-20/21/22 = the **single picker-availability + allocation rework** (shared calc → florist `Step2Bouquet` + dashboard `NewOrderTab` Step2, parity). CR-29 = pitfall #9 recurrence. CR-30 = DateTag (bucket A/CR-6) reaching the cart line.

- **CR-31 — Canonical vocabulary: every quantity and every date must name its kind (THE umbrella ask).** Owner: "you need to be clear what the data means — it cannot be ambiguous." Verified semantics:
  - **"8 planned"** = a **Demand Entry** = stems **committed to a real customer order** (lab: Tulip Yellow DE −8 ↔ order line qty 8, status Ready, `required_by 2026-05-13`). NOT an arrival. The word "planned" is wrong → use **"needed / committed to orders."**
  - **"+8 → 12.Jun"** = a **pending PO arrival** (incoming supply, PO planned date). Different concept, coincidentally also 8. → label **"arriving."**
  - **Dates carry three different meanings, none labelled:** Batch date = **arrival/restock** date (`stock.date` set on receipt); Demand-Entry date = **needed-by** date (`computeDemandDate(order)` → `requiredBy`, `stockRepo.js:37`); PO date = **planned shopping/arrival** date. Same `(DD.MM)` chip must say which kind (e.g. coloured differently or prefixed).
  - **Decision for implications pass:** fix a 4-term lexicon — *on-hand (batch, dated by arrival)* · *committed demand (dated by needed-by)* · *incoming (PO, dated by arrival)* · *fresh (new demand at order's needed-by)* — and use the SAME words + date-kind labels in list, picker, cart line, stock panel, driver app. This is the parent of CR-23/27/28/30.
- **Data-hygiene note (the "fuzzy / sometimes a date, sometimes not"):** this lab's `stock` table = **8 demand entries (neg qty) · 14 dated batches · 1 undated legacy row · 1 attr-less row**. A Variety can mix dated batches (arrival), dated DEs (needed-by), AND undated aggregate rows → looks fuzzy. Undated + attr-less rows (CR-29) are the offenders; under full Y-model every row should be dated + attr-complete. Flag for the implications pass: decide whether undated/legacy rows are migrated, hidden, or back-filled.

## Session 2b — 2026-06-12 — Florist Stock panel (on `y-model-guide` data)
- **CR-32 — Shortfall date headers: show a real date (DD-MM-YYYY), not relative "+Nd".** `ShortfallSummary.friendlyDate` (`packages/shared/components/ShortfallSummary.jsx:238-245`) shows Today/Tomorrow/"+Nd" within 7 days, then **raw ISO beyond 7 days** → the inconsistent "+3d" (06-15), "+6d" (06-18), "2026-06-20" (Ranunculus, 8 days out). Owner: always a date, **DD-MM-YYYY**. A `formatDateDMY` helper ALREADY exists and is used for the demand date in the Variety expand (`VarietyListItem.jsx:185`) — reuse it here. (Shared → fixes dashboard too.)
- **CR-33 — Pending Arrivals: drop the "+7 · +4d" badge → show arrival DATE; group BY date.** `PendingArrivalsPanel.jsx:177-199` renders a per-arrival chip "+{qty} · {+Nd}". The right-side "+7 stems" already carries qty; the chip should carry the **arrival date** (DD-MM-YYYY), not "+4d". Restructure: **group by arrival date** → header "Pending arrivals · <date>", then the flower names arriving that date. **Drop the "2 varieties · 27 stems incoming" summary** (owner: "not useful at all").
- **CR-34 — Layout: stack Pending Arrivals DIRECTLY above Shortfalls.** Current order (`StockPanelPage.jsx`): Pending (`:431`) → "Receive stock" button (`:449`) → search bar → Shortfalls (`:550`). Owner wants the two signal panels **adjacent** (what's coming / what's missing together); Receive + search move below them.
- **CR-35 — Florist "Flat table" is desktop/dashboard-style → lead with the mobile format.** The "Flat table" tab (`BatchArrivalList`, `viewMode==='batch'`, `StockPanelPage.jsx:583`) renders a wide Type/Variety/Avail/**Cost/Sell/Markup**/Arrived/Supplier table — mirrors dashboard `StockTab`, unreadable on a phone. Florist app should default to / emphasise the **By-Variety mobile list**; the wide cost/markup table is owner/desktop info. Decide: drop Flat table on florist, or phone-reflow / owner-gate it.
- **CR-36 — Owner detail (cost / sell / markup / supplier) belongs on Variety EXPAND, not as always-on columns.** The By-Variety expand (`VarietyListItem.jsx:174-251`) shows only Batch/Demand tag + date + sell(multi-tier only) + adjust +/- + qty. No cost / markup / supplier. Owner: tap a Variety → expand reveals **cost, sell, markup, supplier** (owner-only). Moves the table columns' info into the mobile expand.
- **CR-37 — Tap = expand (owner detail); make Trace an explicit BUTTON.** Today tapping a sub-row in the expand opens the **trace** (`VarietyListItem.jsx:202` `handleRowClick` → `StockPanelPage.jsx:628` `setTraceStockId`). Owner: tap should reveal owner detail (CR-36); **trace gets its own button** (visual-trace work lands later). Separate the two interactions.
- **Meta:** CR-32/33 are CR-6/CR-30/CR-31 (shared `<DateTag>` + date-kind labelling) reaching the Stock panel — and the DMY formatter already exists, just unused in the two summary panels. CR-35/36/37 = florist Stock panel must stay **mobile-first**, with owner-depth info gated behind expand; parity twin = dashboard `StockTab` (stays a desktop table — correct there). ✓ Positive: the demand date inside the Variety expand is ALREADY DD-MM-YYYY (`formatDateDMY`), so the look the owner wants exists — it just isn't applied to the shortfall/pending headers.
