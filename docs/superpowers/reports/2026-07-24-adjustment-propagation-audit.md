<!-- Generated 2026-07-24 by a 31-agent adjustment-propagation audit (20 findings confirmed, 4 refuted). -->

# Flower Studio — Engineering Report: Issue #558 (Hydrangea Blue → White → Blue) and the "edit doesn't propagate" class

All line refs verified against `master` @ d8c0205 in `/Users/oliwer/Projects/flower-studio`.

---

## 1. The #558 break chain

A PO line carries **three independent identities** that are written by different code paths and read by different consumers. The owner's edit moved one of them.

| Identity | Column(s) | After her edit |
|---|---|---|
| Free-text name | `stock_order_lines.flower_name` | **"Hydrangea White"** ✅ changed |
| Variety 4-tuple (ADR-0006) | `type_name`, `colour`, `size_cm`, `cultivar` | **Hydrangea / Blue** ❌ stale |
| Stock link | `stock_order_lines.stock_id` | **d4c73354 = "Hydrangea Blue" card** ❌ stale |

### Step 1 — the write hole

Both apps' flower picker sends the correct full payload. `apps/dashboard/src/components/StockOrderPanel.jsx:1239-1248` (identical florist twin `apps/florist/src/pages/PurchaseOrderPage.jsx:954-963`):

```js
onUpdate(line.id, {
  'Flower Name': item['Display Name'],
  'Stock Item': [item.id],          // ← re-link
  Supplier: item.Supplier || '',
  'Cost Price': itemCost, 'Sell Price': itemSell,
  'Lot Size': ..., 'Quantity Needed': qty, Farmer: item.Farmer || '',
});
```

`PATCH /stock-orders/:id/lines/:lineId` then filters it through an allow-list that **has no `'Stock Item'` entry** — `backend/src/routes/stockOrders.js:288-300`:

```js
const allowed = [
  'Driver Status','Quantity Found','Alt Supplier','Alt Quantity Found',
  'Alt Flower Name','Cost Price','Sell Price','Alt Cost',
  'Quantity Accepted','Write Off Qty','Notes','Quantity Needed',
  'Flower Name','Supplier','Lot Size','Farmer',
  'Type','Colour','Size','Cultivar',
  'Alt Type','Alt Colour','Alt Size','Alt Cultivar',
];
const fields = {};
for (const key of allowed) { if (key in req.body) fields[key] = req.body[key]; }
```

Unknown keys are dropped with no 400, no log. The repo layer already supports the write — `backend/src/repos/stockOrderRepo.js:222-230` `if ('Stock Item' in fields) { ... out.stockId = raw; }` — only the route withholds it. Git history shows the omission is incidental: the list has only ever been appended to (`439d503` added Type/Colour/Size/Cultivar for #304; `c69517a` added the Alt-* attrs).

The picker **also never sends Type/Colour/Size/Cultivar** from the newly picked card, so the 4-tuple goes stale for a second, independent (frontend) reason. And the owner cannot fix it by hand: the Variety inputs are rendered only when no link exists — `StockOrderPanel.jsx:1266` + `:1390` `{!stockItemLinked && (`, mirrored at `PurchaseOrderPage.jsx:981` + `:1073`.

This exactly reproduces the confirmed prod row: `flower_name`, `cost_price` 16.28, `supplier` OZ, `farmer` "Sonneveld Hydrangea" landed; `type_name`, `colour`, `stock_id` did not.

The one-way name composer at `stockOrders.js:305-318` only fires **attrs → name**, and only when the name is blank. There is no reverse path anywhere.

### Step 2 — nothing downstream can heal it

Both post-creation writers of `stock_id` require the line to be **unlinked**:
- `backend/src/routes/stock.js:227` `.filter(({ line }) => !line['Stock Item']?.[0] && line['Flower Name'])` → writes at `:288`
- `backend/src/services/stockOrderService.js:349` `if (!stockItemId && (accepted > 0 || writeOff > 0)) {`

They are auto-**linkers**, never re-pointers. No re-link path exists in the codebase.

### Step 3 — the three consumers split

| Consumer | Reads | Showed |
|---|---|---|
| **Pending Arrivals** | the **link** → joined card's Type/Colour | **Blue** |
| **Evaluation screen** | the **free-text name** | **White** |
| **Receive at evaluation** | the **link** + line attrs | **Blue** |

- Pending Arrivals: `backend/src/routes/stock.js:298` `const stockId = line['Stock Item']?.[0] || line._resolvedStockId;` keys the whole response map by stock id → the 10 White stems aggregate under the Blue card. `packages/shared/components/PendingArrivalsPanel.jsx:34-44` then labels the row from `stockRow.Type` / `stockRow.Colour`. The line's `flowerName` *is* on the wire (`stock.js:309-311`) but is only reachable through a `type ? … : …` legacy branch that no production payload can hit (`stockRepo.listGroupedByVariety` filters `type_name IS NOT NULL`, `stockRepo.js:1238`; the auto-create fallback stamps `'Unclassified'`, `stockRepo.js:706-710`). So Pending Arrivals was **the truthful screen** — it showed what the system would actually do.
- Evaluation screen: `apps/florist/src/pages/StockEvaluationPage.jsx:318`, `:367`, `:496` all render `{line['Flower Name']}` — the florist saw and accepted "White".
- Receive: `stockOrderService.js:292` `let stockItemId = line['Stock Item']?.[0];` — authoritative, validated only for existence (`:328-334`). The new batch's **name comes from the linked card, not the line** (`:178-179` `const rawName = stockItem['Display Name']`; `:202` `` `${baseName} (${batchLabel})` ``), and its attrs from `effectiveAttrs` (`:185-190`), where both the line and the card said Blue. `flower_name` influences **nothing** that is written when a link exists.

Result on prod: stock row `6e3cf702` **"Hydrangea Blue (24.Jul.)"**, Colour Blue, qty 10, cost 16.28; `stock_purchases` row linked to the Blue card; and `stockOrderService.js:222-243` stamped cost 16.28 / sell 50 onto the **Blue** template card.

### Step 4 — no audit trail

`backend/src/repos/stockOrderRepo.js` never imports `recordAudit`; `update` (`:112-114`), `updateLine` (`:315-317`), `delete` (`:120`, `:323`) are bare Drizzle statements. `backend/src/routes/stockOrders.js` never imports `actorFromReq` (10 mutating endpoints: `:114 :197 :259 :343 :401 :416 :432 :482 :502 :519`). Neither `stock_orders` nor `stock_order_lines` has an `updated_at` column (`backend/src/db/schema.js:512-530`, `:532-570`). Matches the confirmed prod gap: zero audit rows for either table — the edit left no actor, no timestamp, no before/after.

The audit rows that *do* exist for the receipt carry `actor_role = 'system'`, because `stockOrderService` never threads an actor and `stockRepo.js:746` defaults `{ actorRole: 'system' }`.

---

## 2. Why the two stock rows merged

The merge is **derived at render time**, not a data mutation. Key — `packages/shared/components/BatchArrivalList.jsx:534`:

```js
const key = [varietyKey, sell != null ? sell.toFixed(2) : ''].join('|');
```

i.e. **Type · Colour · Size · Cultivar · Sell**. Mirrors backend `_varietyKey` (`backend/src/repos/stockRepo.js:1219-1226`, ADR-0006). Florist sibling: `packages/shared/components/VarietyListItem.jsx:496-498`.

This is documented, owner-confirmed behaviour — `BatchArrivalList.jsx:491-496`: rows collapse when those five match; cost/supplier/farmer/arrival-date differences fold in. The two Hydrangea Blue lots (22.Jul @ 20.00/Stefan, 24.Jul @ 16.28/OZ) had different sell prices until **2026-07-27 10:58:20Z**, when the owner's bulk sell edit set both to 60.00. They merged **because of that edit**, exactly as designed.

**What survives the merge** (the row is not as blind as it looks): `costMixed: m.costsSeen.size > 1` (`:666`, fed at `:573`) renders a `·mixed` badge + tooltip at `:359-364`; two suppliers render as **"Stefan, OZ"** (`:640-645` → `:383`); and `expandable = expandRows.length > 1` (`:276-277`) gives a chevron whose drill-down (`ExpandedDetails`, `:439-468`) lists each lot's date / qty / cost / supplier.

**What is genuinely lost or wrong:**

1. **Displayed cost is the newest lot's, not a blend** — `:575-581` "Track the newest receive — its cost wins", emitted at `:646`. Row shows 16.28 and markup ×3.7 (`:676` `r.markup = r.sell / r.cost`). True blended cost is 16.90, true markup ×3.55.
2. **The totals footer multiplies that one cost by the whole merged NET qty** — `:495-501`: `cost += (Number(r.cost)||0) * (Number(r.qty)||0)`. For this pair: 12 × 16.28 = **195.36 zł** against a true basis of 2×20.00 + 10×16.28 = **202.80 zł**. Worse, `r.qty` is net of committed demand (`:660`), so a shortfall row contributes **negative** value to the stock valuation. Live on the owner's money surface (`StockTab.jsx:758` passes `footer`).
3. **Farmer and PO provenance are unreachable in the UI at all.** `Farmer` is on the wire (`stockRepo.js:495`) with zero frontend readers. `poDisplayId` is parsed server-side into every purchase trace event (`stockRepo.js:1470-1486`) and read by nothing — `VarietyTracePanel.jsx:161` shows only supplier. So "which PO did these 10 stems come from" is not answerable anywhere.
4. **Parity gap:** the florist app has none of the divergence signalling. `packages/shared/utils/varietyFinancials.js:50` returns `{cost, sell, markup, supplier}` with no mixed flag (its header comment at `:2-3` says it "mirrors BatchArrivalList.flatten's derivation" — it mirrored the cost pick but not the later CR-14 `costsSeen` guard). `mergeExpansionRows` (`VarietyListItem.jsx:501-508`) drops cost and supplier entirely. On her phone the owner sees one unflagged cost of 16.28 and cannot discover the 20.00 lot at all.

**Bulk edit itself has no collision pre-check and no confirmation** — `BatchArrivalList.jsx:286-289` `save()` → `apps/dashboard/src/components/StockTab.jsx:223-238` fires N parallel PATCHes and toasts. Nothing looks for a sibling tier it is about to merge with. Not destructive (rows persist; prior value is in the audit log), but there is **no per-row sell control on any Stock screen**, so the merge cannot be undone from where it was caused. (`backend/src/routes/stockPurchases.js:60-66` can re-split it — but only by receiving more stems.)

---

## 3. Systemic findings — "the edit does not propagate"

Ranked by severity. Every one is the same shape: **one identity/value is written, its denormalized twins are not, and consumers disagree about which to trust.**

### S1 · CRITICAL — PO line identity can be edited into a permanently inconsistent state
`stockOrders.js:288-300` drops `'Stock Item'`; the picker drops the 4-tuple; the Variety inputs are hidden once linked (`StockOrderPanel.jsx:1390`). **Consequence:** the #558 receipt — wrong flower in stock, wrong card credited with the money, no way for the owner to correct it in either app. Zero tests cover re-pointing a persisted line (`ls backend/src/__tests__ | grep stockOrders` → addLineIdentity / sendIdentity / receiveIntoStock / substituteVariety / evaluatePurchaseQty / optionalSupplierPrice / evalAbsorptionHidden / substituteDoubleBook / assign-notify — none edits identity after creation).

### S2 · CRITICAL — the receive is link-authoritative and the florist approves the powerless field
`stockOrderService.js:292` / `:350` / `:435-439`. The screen shows `flower_name`; the system acts on `stock_id`. No comparison exists anywhere (grep for any name-vs-card check across `stockOrderService.js` + `routes/stockOrders.js` returns nothing). **Consequence:** the person physically holding the stems cannot approve what will be recorded. The existing regression lock encodes today's behaviour by construction — `stockOrders.receiveIntoStock.integration.test.js:87` seeds a card whose name and attrs agree.

### S3 · HIGH — total audit blackout on the PO stack
No `recordAudit`, no `updated_at`, no soft-delete on `stock_orders` / `stock_order_lines`. Covers PO deletion, line deletion, status transitions, driver reassignment, and supplier/driver payment amounts. Violates the contract stated in `backend/src/db/audit.js:1-5`. **Consequence:** prod forensics for #558 could only *infer* the owner's action from surviving field values.

### S4 · HIGH — audit coverage is the exception, not the rule
Only `orderRepo` and `stockRepo` write audit rows. Zero in: `stockOrderRepo`, `stockPurchasesRepo`, `stockLossRepo`, `customerRepo`, `productConfigRepo`, `premadeBouquetRepo`, `marketingSpendRepo`, `hoursRepo`, `savedViewRepo`, `appConfigRepo`, `driverTelegramRepo`, `floristTelegramRepo`, `assistantConversationRepo`. Sharpest edges: `stockLossRepo.js:88` soft-deletes a write-off with no audit; `customerRepo.js:317-321` soft-deletes a Key Person as a side effect of clearing a name; `routes/products.js:158-180` overwrites the flower-studio-owned Name + PL/RU/UK translations (ADR-0008) unaudited. **Consequence:** each is a future #558 — a symptom in the data with no record of the action.

### S5 · HIGH — delivery fee stored twice, cascaded never
`orders.delivery_fee` **and** `deliveries.delivery_fee` are both written at create (`orderRepo.js:547-548`, `:575`, `:772`) and by `convertToDelivery` (`:1571-1588`) — proof they're meant to agree. The cascade set in `updateOrder` is `Required By` + `Delivery Time` only (`orderRepo.js:1327-1330`); `updateDelivery` cascades `Status` only (`:1478`). The only UI fee editor writes just the delivery row (`OrderDetailPanel.jsx:1185-1186`). Consumers split: delivery-record wins at `routes/orders.js:239` and `analyticsService.js:68-69`; **order-column wins** at `routes/orders.js:341` (→ `Final Price`), `routes/dashboard.js:78-79` and `:146` (unpaid aging), `OrderDetailPanel.jsx:276`, `OrderDetailPage.jsx:272`. **Consequence:** same order, four screens, two totals — and the detail panel displays the new fee while computing its total from the old one. This is CLAUDE.md pitfall #2 violated by the backend's own `GET /:id`, and pitfall #1's "don't OR the two" violated verbatim in three places.

### S6 · HIGH — attr-less stock cards get the whole name stuffed into `type_name`
`stockOrderService.js:35-44` creates PO-linked cards with no Type/Colour, so `stockRepo.js:706-710` fires: `values.typeName = baseName` → `type_name = 'Hydrangea White'`, `colour = NULL`. That is a Variety key that can never match `('Hydrangea','White')`, is copied onto every dated Batch by `receiveIntoStock`, and is excluded from the needs-backfill list. Reachable from `routes/stockOrders.js:145-151` and `:368-373`. The eval UI already documents this failure class — `StockEvaluationPage.jsx:40-43` ("which is how \"Dahlia Coral\" once got Type=\"Dahlia Pink\""). **Consequence:** the direct mechanism behind the "Pink Peonies Type/Colour mangling" cluster; each new PO for the real Variety mints yet another row.

### S7 · MEDIUM — correcting a card's Variety attrs leaves its Display Name stale
`stockRepo.js:1034-1041` (`updateVarietyAttrs`) and `:1076-1083` (bulk) build a patch with `typeName/colour/sizeCm/cultivar/updatedAt` and **no `displayName`** — even though every create path composes the name from the attrs (`stockRepo.js:66-71`, `stockOrderService.js:370-374`). **Consequence: the remediation flow for #558 is itself broken.** Fix the hydrangea's colour Blue→White and the card still reads "Hydrangea Blue" in every picker, PO line, waste log and Variety trace, while grouping/FEFO/demand keys say White. Real stale-name surfaces: waste log, new PO-line pre-fill, and every future Batch minted from the card. Secondary: re-classifying a Demand Entry can collide with the partial unique index `stock_demand_variety_date_idx` (`migrations/0013_stock_y_demand_index.sql`) and surface as an unexplained 500.

### S8 · MEDIUM — the mixed-cost badge and per-lot drill-down are dashboard-only
See §2.4. Violates the Cross-App Feature Parity rule in root CLAUDE.md; the owner runs the florist app on her phone.

### S9 · MEDIUM — stock-value footer is wrong on two independent bases
See §2.2. One lot's cost × net qty.

### S10 · MEDIUM — `GET /stock/pending-po` auto-links by display name with an unordered `LIMIT 1`
`stock.js:234-237` → `stockRepo.js:597` `ilike(stock.displayName, …)` with **no `ORDER BY`** and `maxRecords: 1`. No 4-tuple check, contradicting ADR-0006. First-line-wins collapse at `stock.js:243`/`:262`/`:284-290`. No unique index on `display_name`; dated batches carry a `(24.Jul.)` suffix (`stockRepo.js:66-71`), so a line named "Hydrangea Blue" never matches the existing batch and mints a duplicate card. Failures swallowed at `stock.js:281` `} catch { /* skip */ }` and `:375` (pitfall #5). The link write is fire-and-forget and unaudited (`:288-289`). **Consequence:** a permanent, non-deterministic binding written as a side effect of a GET.

### S11 · MEDIUM — unordered `LIMIT 1` in the evaluation auto-resolve too
`stockOrderService.js:361-364`, `:396-399`, `:28-31` — none passes `sort`; `stockRepo.listFromPg` only orders when one is supplied. With `includeEmpty: true` the 4-tuple filter matches dated batches **and negative Demand Entries**, so a DE is an eligible link target. **Consequence:** which row gets the absorption math, the price-template rewrite and lends its name to the new Batch is unspecified for any multi-row Variety.

### S12 · MEDIUM — `receiveIntoStock` takes the batch **name** from the card and the **attrs** from the line
`stockOrderService.js:201-217` — the two writes sit four lines apart with no reconciliation. Reachable today via the substitute path. **Consequence:** one row displayed "Hydrangea Blue (24.Jul.)" but filed under the White Variety — invisible to humans, authoritative for FEFO. This is precisely the failure class pitfall #9 (`batch-variety-attrs`) exists to prevent; #327 fixed attrs being *absent*, not *contradicting*.

### S13 · LOW (latent) — `PATCH /deliveries/:id` accepts `Delivery Date`/`Delivery Time` with no reverse cascade
`routes/deliveries.js:16-22` allows them; `orderRepo.js:1478` cascades `Status` only. The forward direction runs `updateDemandEntryDate` over every line (`orderRepo.js:1424-1437`), reachable from nowhere else. A shipped-but-unreferenced component already does the wrong thing: `apps/dashboard/src/components/order/DeliverySection.jsx:74`. **Consequence:** a loaded gun — any caller re-scheduling via the delivery record leaves `orders.required_by` and every Demand Entry pinned to the old date.

---

## 4. Recommended fixes

Ranked. Each is a vertical slice sized for one PR. `#562` = the published variety-creation-discipline PRD.

| # | Slice | Scope | Belongs to |
|---|---|---|---|
| **F1** | **Make PO-line identity atomic.** Add `'Stock Item'` to the allow-list (`stockOrders.js:288`); in the same handler, when `'Stock Item'` **or** `'Flower Name'` changes, re-derive `Type/Colour/Size/Cultivar` from the newly linked card (mirror of the existing attrs→name composer at `:305-318`) so name + link + 4-tuple always move together. Make the route **400 on unknown keys** instead of dropping them — this defect existed only because a dropped field is silently successful. Owner-only, non-terminal PO statuses. Integration test: create line on card A → PATCH to card B → evaluate → assert the receipt lands on B. | backend + test | **#562** (root cause of #558) |
| **F2** | **Un-hide Variety identity on linked lines.** Render the 4-tuple read-only when a link exists (`StockOrderPanel.jsx:1390`, `PurchaseOrderPage.jsx:1073`) so the owner can *see* which Variety a line resolves to, and have `handleStockSelect` send the picked card's attrs (`StockOrderPanel.jsx:1239`, `PurchaseOrderPage.jsx:954`). Both apps — parity table. | 2 frontends | **#562** |
| **F3** | **Fail loud on identity disagreement at evaluation.** At the top of each line, resolve one canonical `receiveTarget` and compare it to the line's declared identity (name **and** 4-tuple). On mismatch → `Eval Error` naming both ("line says 'Hydrangea White', linked card is 'Hydrangea Blue'"), not a silent link-wins. Surface "→ receives into: Hydrangea Blue" next to the flower name on `StockEvaluationPage.jsx:367` and `StockOrderPanel.jsx:877`. Extend `stockOrders.receiveIntoStock.integration.test.js` with a disagreement case (today's fixture agrees by construction, `:87`). | backend + 2 frontends + test | new issue, depends on F1 |
| **F4** | **Audit the PO stack.** Give `stockOrderRepo` the `stockRepo` treatment: wrap `create/update/createLine/updateLine/deleteById/deleteLineById` in `db.transaction`, read `before`, call `recordAudit(tx, { entityType: 'stock_order' \| 'stock_order_line' })` with `opts.actor`. Thread `actorFromReq(req)` from all 10 endpoints in `routes/stockOrders.js`. Add `updated_at` to both tables in the same migration. Thread an actor through `evaluatePurchaseOrder(poId, lines, { actor })` so receipts stop being `actor_role='system'`. Lock with a test asserting one audit row per PO-line PATCH. | backend + migration + test | new issue (S3) |
| **F5** | **Derive Display Name from the 4-tuple in `updateVarietyAttrs`/`bulkUpdateVarietyAttrs`** (`stockRepo.js:1034`, `:1076`), preserving the `(dd.Mmm.)` / `(YYYY-MM-DD)` suffixes, using the existing composer. Guard against a Demand Entry collision on `stock_demand_variety_date_idx` (explicit merge or clear 4xx, not a 500). Decide per table what happens to the three `flower_name` snapshots: `order_lines` on a shipped order is legitimately historical (leave it, but join the trace on `stock_item_id`); `stock_order_lines` on a non-Complete PO is live data and must be re-derived — same seam as F1. **This unblocks the manual repair path for #558-class data.** | backend + test | **#562** |
| **F6** | **One owner for the delivery fee.** Add `resolveDeliveryFee(order)` next to `isDeliveryOrder` in `backend/src/utils/deliveryGate.js`, make `deliveries.delivery_fee` authoritative, and route `routes/orders.js:341`, `routes/dashboard.js:78`/`:146`, `analyticsService.js:68`, `OrderDetailPanel.jsx:276`, `OrderDetailPage.jsx:272` through it. Test in the shape of `deliveryFeeTypeGate.integration.test.js`: PATCH the fee, assert `GET /orders`, `GET /orders/:id`, `/dashboard` and `computeAnalytics` agree. | backend + 2 frontends + test | follow-up to #554/#586 (S5) |
| **F7** | **Weighted cost + honest footer.** Compute a quantity-weighted cost across `m.underlying` (positive-qty only, matching CR-14's gate at `:572`) for the displayed cost, the markup **and** the footer (`BatchArrivalList.jsx:495-501`); show the range (`16.28–20.00`) where the column has room. Decide whether the footer values `r.physical` or net `r.qty` — today a shortfall row *subtracts* from stock value. Edge case in the same loop: a newest batch with null cost renders `—`/`—`, contributes 0, and shows **no** `·mixed` badge. | shared + test | new issue (S9) |
| **F8** | **Parity: mixed-cost signal + per-lot drill-down in the florist app.** Add a `costsSeen` set to `varietyFinancials.js` behind CR-14's `qty > 0` gate and render `·mixed` + `t.costMixedTooltip` in `VarietyListItem.jsx:306` (both translation keys already exist in both apps). Give `mergeExpansionRows` the per-lot cost/supplier it drops (`VarietyListItem.jsx:501-508`) and render a mobile-shaped `ExpandedDetails`. Shared test asserting both surfaces flag the same two-cost fixture — the dashboard half already exists at `packages/shared/test/BatchArrivalList.test.jsx:136`. | shared + florist + test | new issue (S8), parity rule |
| **F9** | **Deterministic resolution everywhere.** Give every `maxRecords: 1` stock lookup an explicit `sort`: `stock.js:234`, `stockOrderService.js:28`, `:361`, `:396`. For a receive target, prefer the undated template row, then oldest-dated batch (FEFO); exclude Demand Entries or prefer them by explicit rule. Resolve by 4-tuple first, name only for genuinely attr-less legacy lines; **refuse** to link when the line's attrs contradict the candidate. Move the auto-link out of `GET /stock/pending-po` into an explicit, awaited, audited operation. Test seeding three rows of one Variety. | backend + test | **#562** (S10/S11) |
| **F10** | **Forbid the attr-less card create.** Either require Type before a card can be minted from a PO line (matching the discipline `StockEvaluationPage.jsx:149-163` already enforces for substitutes), or have `resolveOrCreateStockItem` accept and pass Type/Colour/Size/Cultivar. At minimum, have `stockRepo.js:706-710`'s name→`type_name` fallback log loudly and flag the row for `GET /stock/needs-backfill`. | backend | **#562** (S6) |
| **F11** | **Close the delivery-date gun.** Either drop `'Delivery Date'`/`'Delivery Time'` from `DELIVERIES_PATCH_ALLOWED` (`deliveries.js:16-22`) and delete the dead `DeliverySection.jsx`, or mirror the cascade in `orderRepo.updateDelivery` including the `updateDemandEntryDate` loop. Cheaper: the first. Test both entry points. | backend | new issue (S13) |
| **F12** | **Render farmer + PO provenance.** `poDisplayId` is already on the wire for every purchase trace event (`stockRepo.js:1470-1486`) with zero readers; add it to `VarietyTracePanel.jsx:161`. Surface `Farmer` in `ExpandedDetails`. Cheap, no backend change. | frontend | nice-to-have |
| **F13** | **Broaden audit to the money and provenance repos**, prioritised by irreversibility: soft-deletes first (`stockLossRepo.remove:88`, `customerRepo`'s Key Person clear `:317-321`), then money (`stockPurchasesRepo.create:21`, `hoursRepo`), then `productConfigRepo` (ADR-0008 fields). | backend, multi-PR | new epic (S4) |

**Suggested order:** F1 → F2 → F3 (closes #558 end to end) → F4 (so the next one is diagnosable) → F5 (unblocks manual repair) → F9/F10 (#562 body) → F6 → F7/F8 → F11/F12/F13.

---

## 5. Open questions for the owner

1. **Should batches with different cost or different supplier ever merge into one row?** Today the rule is Type · Colour · Size · Cultivar · **Sell** (`BatchArrivalList.jsx:491-496`, owner-confirmed 2026-05-31) and it worked as designed. Options: (a) keep it, fix only the cost/markup/footer math (F7); (b) add cost to the key — physically identical stems then show as two rows whenever a price moved; (c) add supplier to the key. (a) is recommended, but this is her call, not an engineering one.

2. **Which cost should the merged row display — newest, or quantity-weighted?** "What I paid last" and "what these 12 stems cost me" are different questions. If she wants both, the column needs a label change and the footer must use the weighted figure regardless.

3. **When she changes the flower on a PO line, should it be an edit or a replace?** Cleanest is: changing the flower deletes and re-creates the line (new identity, clean audit row, no stale twins). Editing in place is fewer clicks but is exactly what produced #558. Which does she want?

4. **When the florist's evaluation screen and the PO's stock link disagree, should the system block or ask?** F3 proposes blocking into `Eval Error` with a message naming both. The alternative — trusting the name the florist actually saw and re-linking automatically — is fewer taps but silently re-points a record based on free text.

5. **Should a bulk price edit warn before it merges two rows?** "This will combine 2 rows into 1 — continue?" costs one dialog on every bulk price change. Worth it, or noise?

6. **Should re-converting Pickup → Delivery revive the cancelled delivery record?** Still-open pre-existing follow-up from #554 (root CLAUDE.md pitfall #10) — today it does not, so a mis-tap and a correction leaves an orphan.

7. **How much history does she want for a corrected flower name?** F5 asks whether a shipped order's line should keep the name it was fulfilled under, or always show the card's current name. Historically accurate vs. currently consistent — both are defensible.
