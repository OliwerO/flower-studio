# Y-Model CR — Sliced Implementation Plan (2026-06-12)

Source: the 37 change requests in `2026-06-11-ymodel-test-session-notes.md`, captured over two
live test sessions on the integrated Y-model (`integration/y-model-2026-06-11`). Decisions pass
complete — this plan turns the CRs into ordered vertical slices, unblocked-first.

Companion: `2026-06-12-ymodel-functionality-guide.md` (how the model works today, by example).

---

## Canonical decisions (settled 2026-06-12 — do not re-litigate)

| # | Decision | Choice | Gates |
|---|---|---|---|
| **D1** | Quantity unit across all PO editors | **Stems** is canonical everywhere. "Lots/Pkgs" is an optional entry helper only (`pkgs × lotSize → stems`); the stored + displayed value is always stems. | S4 |
| **D2** | New-PO prefill vs open POs | **Net out** what's already on a non-Complete PO; prefill only the uncovered remainder; annotate "+N already on PO #X"; owner may add more by hand. | S4 |
| **D3** | Picker, fully-committed Varieties | **Hide** rows where `effective ≤ 0` by default; keep them reachable via search so deliberate over-promising (which creates a buy signal) still works. | S3 |
| **D4** | Driver partial-find split | **Earliest needed-by first** — fill the soonest order whole; the shortfall lands on the later demand date. | S5 |
| **D5** | Word for committed demand | **"Committed"** (ru ≈ «Зарезервировано под заказы»/«Обещано»). Never "planned". | all |
| **D6** | Date display | **Coloured chip, date-only**, by kind: **grey = arrived** (batch), **red = needed** (demand), **blue = arriving** (PO). Never relative "+Nd", never raw ISO. | S1 |
| **D7** | Variety dedup on entry | **Snap to canonical** — case-insensitive match auto-corrects to the existing Variety (kills duplicate + attr-less rows). Needs backend variety-key normalization. | S4 |

### Lexicon (use these exact concepts everywhere; t-keys ru/en/pl)
- Quantity buckets: **On hand · Committed · Reserved · Incoming**.
- Derived: **Net** = on hand − committed − reserved · **Effective** = net + incoming.
- Date kinds: **Arrived** (batch) · **Needed** (demand) · **Arriving** (PO).
- Banned word: **"planned"** (it conflated demand and arrival — the root of CR-28/31).

### Shared `<DateTag>` spec (the keystone of S1)
- New `packages/shared/components/DateTag.jsx` + reuse `formatDateDMY` (already in
  `VarietyListItem.jsx`). Props `{ date, kind, compact }`.
- Renders a coloured chip per `kind` (D6 colours). Default **DD-MM-YYYY**; `compact` →
  **DD-MM** for tight inline chips. Replaces every relative/ISO date in the stock surfaces.
- Test in `packages/shared/test/` (CI 80% gate on utils).

---

## Slices (ordered: unblocked first)

Every slice is florist **and** dashboard (parity rule) unless noted. All behind `STOCK_Y_MODEL`.
Pre-PR per slice: 3 app builds + backend/shared vitest + lab unit (+ lab api when backend/lab touched).

### S1 · Dates & layout — UNBLOCKED, ship first
CRs: 2, 3, 4, 6, 11, 30, 32, 33, 34. Decisions: D6.
1. **Build `<DateTag>`** (shared) per spec above + test.
2. **ShortfallSummary.jsx** (`:238` `friendlyDate`) → `DateTag kind="needed"`. Kills "+3d/+6d/ISO" inconsistency. (CR-32)
3. **PendingArrivalsPanel.jsx** (`:177-199`): drop the "+qty · +Nd" chip → `DateTag kind="arriving"`; **regroup by arrival date** (header = DateTag, then flower names); **remove the "N varieties · N stems incoming" summary**. (CR-33)
4. **StockPanelPage.jsx** layout: move PendingArrivals (`:431`) to sit **directly above** ShortfallSummary (`:550`); Receive button + search drop below the pair. (CR-34)
5. **Bouquet cart line** demand date → `DateTag kind="needed"` in `Step2Bouquet` + dashboard `NewOrderTab` Step2 + `OrderCard`/`OrderDetailPanel`. (CR-30)
6. **PO planned-date** → `DateTag kind="arriving"` in `StockOrderPanel.jsx` (`:726`,`:745`) + florist `PurchaseOrderPage.jsx`; fix native `<input type=date>` display. (CR-3)
7. **Qty "050" leading-zero**: hold qty/lotSize/pkgs/cost/sell as **strings** in form state, coerce at save — `StockOrderPanel.jsx:465` + `PurchaseOrderPage.jsx`. (CR-4)
8. **Driver line label**: drop the `(date)` suffix from `line['Flower Name']` display — `StockPickupPage.jsx:348`. (CR-11)

### S2 · Stock panel — mobile-first
CRs: 35, 36, 37. Decisions: —. Florist-only (dashboard `StockTab` stays a desktop table — correct).
1. Florist `StockPanelPage`: default to **By-Variety** mobile list; demote the "Flat table" (`BatchArrivalList`, wide cost/sell/markup) — owner-gate or phone-reflow. (CR-35)
2. `VarietyListItem` expand: add **owner-only cost · sell · markup · supplier** block. (CR-36)
3. `VarietyListItem`: **tap row → expand** (owner detail); add an explicit **Trace button** (replaces today's tap-opens-trace at `:202` → `StockPanelPage:628`). (CR-37)

### S3 · Picker availability + allocation — THE BIG ONE
CRs: 20, 21, 22, 23, 24, 25, 26, 27, 28. Decisions: D1, D3, D5, D6. (Likely its own sub-plan.)
Shared calc first, then florist `Step2Bouquet` + dashboard `NewOrderTab` Step2 (parity).
1. **Availability engine** (extend `stockMath`/`stockAllocationEngine`): per-Variety
   `effective = onHand + incoming − committed − reserved`, plus per-source buckets + labels (D5).
2. **Hide `effective ≤ 0`** by default; reachable via search (D3). (CR-20) · show **surplus + arrival** (CR-22) · surface **reservations + untie-premade** prompt (CR-21).
3. **Skip redundant Stage-1** when the Variety is already chosen from the search list (CR-24).
4. **Amount inside the picker + live remainder** — source dropdown { from stock · from incoming PO · new demand }, qty field, "remaining" counter; remove the hardcoded `qty=1` (`Step2Bouquet:873`). (CR-25/26)
5. **Label the numbers** (committed vs incoming, per lexicon) so the "three unlabelled numbers" vanish (CR-23/28); **cart-line binding reflects the whole Variety**, not one sub-row (CR-27).

### S4 · PO-line consolidation
CRs: 7, 8, 9, 10. Decisions: D1, D2, D7.
1. **One shared `<PoLineEditor>`** (deep module) for create / edit-existing / add-off-plan, in both `StockOrderPanel` + `PurchaseOrderPage`. Identical field set; **qty = stems** (D1), Pkgs as helper. (CR-8/9)
2. **`composeLineName()`** — prefer composed Variety identity; free name as fallback only (CR-7).
3. **New-PO prefill nets** pending-PO + annotates "+N on PO #X" (D2). (CR-10)
4. **Variety entry snaps to canonical** (D7) — backend variety-key normalization + datalist suggest.

### S5 · Driver shopping + realtime
CRs: 5, 12, 13, 14. Decisions: D4.
1. **Merge same-variety lines per supplier** for the driver (CR-12); on partial find, **split back earliest-needed-first** (D4) — backend distribution.
2. **Expected pay per supplier** beside the input (CR-13).
3. **Substitute form**: flower + colour + supplier + paid only; drop the big all-flowers datalist (CR-14).
4. **Realtime**: broadcast `stock_order` created/sent; delivery app refetches on it (CR-5).

### Separate track · Suppliers entity (NOT Y-model polish)
CRs: 15, 16, 17, 18, 19. Own **grill → PRD → issues** chain.
New `suppliers` table (multi phone/email/website/notes), dashboard CRUD, becomes the typeahead
source everywhere supplier is entered; alt-supplier cost-routing into per-supplier owed totals.

---

## Cross-cutting
- **Parity matrix:** S1/S3/S4 touch florist + dashboard twins (`StockOrderPanel ↔ PurchaseOrderPage`,
  `Step2Bouquet ↔ NewOrderTab`, cart lines across `OrderCard`/`OrderDetailPanel`/`BouquetSection`/`BouquetEditor`).
- **Lexicon t-keys** added to all three apps' `translations.js` (ru/en/pl), behind the agreed words.
- **Lab:** keep `y-model-guide` current as the rehearsal fixture; add scenarios for the picker
  (effective ≤ 0, surplus) and driver split-back when S3/S5 land.
- **Verification gate:** S5 realtime + any PO/driver flow needs an E2E/integration path named in the PR.

## Suggested execution order
S1 (now, unblocked) → S2 → **S3** (biggest; consider a dedicated sub-plan) → S4 → S5 → Suppliers (own chain).
Each slice = its own branch + PR per CLAUDE.md branch hygiene; do not pile slices on one branch.
