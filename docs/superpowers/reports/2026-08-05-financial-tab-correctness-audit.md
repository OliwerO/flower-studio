# Financial tab correctness audit — findings

**Issue:** [#646](https://github.com/OliwerO/flower-studio/issues/646)
**Date:** 2026-08-05
**Scope:** every number on the dashboard Financial tab — the data behind it and the arithmetic on top of it. That is `backend/src/services/analyticsService.js` (596 L) and its four inputs (`orderRepo`, `stockRepo`, `stockPurchasesRepo`, `stockLossRepo`).
**Out of scope:** the Materials/Add-ons kind-gating on map [#624](https://github.com/OliwerO/flower-studio/issues/624). Defect 1 in the brief (monthly gross revenue) is already owned by [#628](https://github.com/OliwerO/flower-studio/issues/628) — recorded here with measured magnitude, not re-filed.

**How everything below was measured.** Two read-only probes against production:

1. Direct SQL over the `claude_ro` DSN.
2. **The real `computeAnalytics` executed against production**, with `PG_AUTO_MIGRATE=false` and `connectPostgres()` never called, so the numbers quoted are literally what the Financial tab renders — not a re-implementation of its math. Probe scripts are in the session scratchpad; both are SAFE (read-only role, no writes attempted).

Because `computeAnalytics` also backs eight Ask Blossom tool packs (`financePack`, `financeInsightsPack`, `trendsPack`, `supplierPack`, `customersPack`, …), **every confirmed finding below is wrong on the screen and in the assistant's answers, identically.**

---

## Summary

| # | Finding | Status | On-screen impact |
|---|---|---|---|
| F1 | Waste + Inventory Turnover are computed from **1 stock row out of 104** | CONFIRMED | Waste KPIs are structurally `0` |
| F2 | Inventory turnover is undefined under the Y-model, not merely period-mismatched | CONFIRMED | Renders 268×–656× against a 6–12× "healthy" band |
| F3 | Monthly `flowerRevenue` is gross; the period figure is net | CONFIRMED (owned by #628) | May off by −1 974 zł; monthly bar components exceed the monthly total |
| F4 | `revenueGap` charges delivery revenue against a flower-cost target | CONFIRMED | Gap overstated by 3 940 zł all-time (+26 %) |
| F5 | `Partial` payment is booked at 100 % of the order | CONFIRMED | 2 orders on prod |
| F6 | Per-source `marginPercent` puts delivery fee in the numerator only | CONFIRMED | Source margins overstated |
| F7 | `topProducts.revenue` is gross list price | CONFIRMED | Doesn't reconcile with `revenue.flowers`; same in Ask Blossom |
| F8 | Two waste sources disagree inside one payload | CONFIRMED | `waste` says 0, `stockLossBreakdown` says 989 |
| F9 | Analytics is a 4th private implementation of the delivery-fee rule | CONFIRMED (latent) | 0 divergent rows today |
| F10 | `Final Price` and `Sell Total` branches are dead | CONFIRMED | none — cleanup |
| F11 | Weekly rhythm buckets by `Required By`, population selected by `Order Date` | CONFIRMED | 8 orders cross the boundary |
| F12 | Supplier `wastePercent` / `wasteCost` cross periods | CONFIRMED (methodological) | distorts both months |
| F13 | `pg.active` is a filter key that does not exist | CONFIRMED | root cause of F1 |
| — | Previous-period boundary arithmetic | **RULED OUT** | lengths always match |
| — | Cancelled-order cost invisibility | **RULED OUT (negligible)** | 3 orders, 306.98 zł, all Mar–Apr |
| — | `active: true` hiding deactivated rows | **RULED OUT (inert)** | 0 inactive rows on prod |
| — | Front-end money math | **RULED OUT** | client does none |
| D1 | 32 order lines carry 5 604 zł of revenue at zero cost | DATA | flower margin overstated |
| D2 | `driver_payout` == `delivery_fee` on 104/123 rows | DATA / landmine | `deliveryProfit` ≈ 0 by convention |

---

## F1 — Waste and Inventory Turnover are computed from one stock row (CRITICAL, confirmed)

`computeAnalytics` fetches its stock snapshot at [analyticsService.js:40](backend/src/services/analyticsService.js:40):

```js
stockRepo.list({ pg: { active: true } }),
```

`listFromPg` ([stockRepo.js:598-604](backend/src/repos/stockRepo.js:598)) recognises `includeInactive` and `includeEmpty`. It **does not read `pg.active` at all** (see F13). So this call takes both defaults, and the second one is fatal:

```js
if (pg.includeEmpty !== true) filters.push(gt(stock.currentQuantity, 0));
```

Under the Y-model a Variety's canonical card sits at `0` once its batches are spent, and Demand Entries are *negative*. Filtering to `current_quantity > 0` therefore keeps almost nothing. Measured on production through the repo itself:

| call | rows | `Dead/Unsold Stems` | stock value |
|---|---|---|---|
| `{ active: true }` — **what analytics does** | **1** | **0** | 97.68 zł |
| `{ includeEmpty: true }` | 104 | 476 | 97.68 zł |
| `{ includeEmpty: true, includeInactive: true }` | 104 | 476 | 97.68 zł |

The single surviving row is `Hydrangea White (24.Jul.)` — 6 stems, 16.28 zł each, `dead_stems = 0`.

**Consequence.** `calculateWasteMetrics` ([:291](backend/src/services/analyticsService.js:291)) sums dead stems over that one row, so the entire Waste block is a constant zero. Confirmed by running the real function for every period on prod:

```
July      waste {"totalDeadStems":0,"unrealisedRevenuePLN":0,"wastePercent":0}
June      waste {"totalDeadStems":0,"unrealisedRevenuePLN":0,"wastePercent":0}
May       waste {"totalDeadStems":0,"unrealisedRevenuePLN":0,"wastePercent":0}
All time  waste {"totalDeadStems":0,"unrealisedRevenuePLN":0,"wastePercent":0}
```

`FinancialTab.jsx` renders that section whenever `costs.totalFlowerCost > 0` ([:612](apps/dashboard/src/components/FinancialTab.jsx:612)) and colours `wastePercent` **green / "Healthy"** at ≤ 10 % ([:619-621](apps/dashboard/src/components/FinancialTab.jsx:619)). The owner is being shown a green, confident zero while 948 dead stems are recorded in `stock` and 989 written-off stems are recorded in `stock_loss_log`.

This **supersedes** the brief's defect 2. The brief diagnosed the *lifetime-counter-in-a-period-report* problem and the *soft-deleted rows* problem — both are real, but they are downstream of a filter that discards 99 % of the rows before either can bite. The soft-delete split still stands as measured:

| `dead_stems` | stems |
|---|---|
| total recorded | 948 |
| on live, active rows | 476 |
| on soft-deleted rows | 472 (49.8 %) |
| on live-but-inactive rows | 0 |

**Fix shape.** Do not simply add `includeEmpty: true` — that would restore a lifetime, non-period-scoped counter as the headline. The period-scoped source already exists, is already fetched, and is already in the payload: `stockLossRepo.list({ from, to })` at [:44](backend/src/services/analyticsService.js:44). Drive `waste` from it (see F8).

---

## F2 — Inventory turnover is undefined under the Y-model (confirmed, worse than suspected)

`calculateInventoryTurnover` ([:520](backend/src/services/analyticsService.js:520)) divides an annualised period cost by *today's* shelf value. The brief called this "undefined by construction" because the two sides span different periods. Production shows a second, larger problem: **the denominator is ~98 zł no matter what.**

Only one active row has positive quantity (F1), and even with `includeEmpty: true` the value is unchanged at 97.68 zł — because under the Y-model on-hand stock genuinely sits near zero: of 104 live active rows, 100 are at `0`, 3 are negative Demand Entries (−16 stems), 1 is positive.

Real output of the shipped function:

| period | `annualizedCost` | `currentStockValue` | **`turnsPerYear` rendered** |
|---|---|---|---|
| July | 26 194 zł | 98 zł | **268.2×** |
| June | 41 466 zł | 98 zł | **424.5×** |
| May | 64 113 zł | 98 zł | **656.4×** |
| Aug (to date) | 8 395 zł | 98 zł | **85.9×** |
| All time | 41 649 zł | 98 zł | **426.4×** |

`FinancialTab.jsx:625-627` prints this as `"268.2×"` and colours it amber (green only between 6 and 12). It is not off by a period — it is off by roughly 50×, and it will stay wrong after any period-alignment fix, because a business that consumes stems to zero has no meaningful average inventory in this table.

**Fix shape.** This is a design decision, not a patch. Either compute average inventory over the period from `stock_purchases` + consumption, or remove the KPI. Reporting a ratio whose denominator is a leftover hydrangea is worse than reporting nothing.

---

## F3 — Monthly flower revenue is gross; the period figure is net (confirmed; owned by #628)

`calculateMonthlyBreakdown` ([:417](backend/src/services/analyticsService.js:417)) sums `_flowerSell` (gross list price); `calculateRevenueMetrics` ([:267](backend/src/services/analyticsService.js:267)) defines flower revenue as `totalRevenue − deliveryRevenue` (net of `Price Override`). Measured magnitude, from the shipped function:

| month | monthly row `flowerRevenue` (gross) | period `revenue.flowers` (net) | delta |
|---|---|---|---|
| 2026-05 | 17 882 zł | 15 908 zł | **−1 974 zł (−12.4 %)** |
| 2026-06 | 10 332 zł | 10 588 zł | +256 zł |
| 2026-07 | 6 462 zł | 6 404 zł | −57 zł |
| 2026-08 | 390 zł | 1 350 zł | **+960 zł (+71 %)** |
| all-time sum | 56 540 zł | 55 404 zł | **−1 135 zł** |

Two things worth adding to #628 that the brief did not state:

- **The monthly row is internally inconsistent, not just inconsistent with the KPI.** For May the shipped payload is `rev=17028, flow=17882, del=1120` — the components exceed the total by 1 974 zł. `FinancialTab.jsx:317` feeds these rows to a `BarChart`, so the stacked segments are visibly larger than the bar's own total.
- **147 of 168 live orders carry a `price_override`** (gross 53 245.60 zł vs charged 51 953.40 zł), split 66 discounted / 64 uplifted / 17 equal. There is no constant bias to reason around.

---

## F4 — `revenueGap` compares total revenue against a flower-only target (confirmed)

[:203-204](backend/src/services/analyticsService.js:203):

```js
estimatedRevenueAt2_2x: revenue.estimatedRevenue,          // paidFlowerCost × targetMarkup
revenueGap:             revenue.totalRevenue - revenue.estimatedRevenue,
```

`estimatedRevenue` is derived from **flower cost only**. `totalRevenue` **includes the delivery fee**. Delivery is a pass-through priced against distance, not a 2.2× markup on stems — folding it into the numerator credits courier income as flower performance.

Production, all time: `revenueGap = 14 994.55 zł`, of which **3 940 zł is delivery revenue** — the gap is overstated by 26 %. Per month the distortion runs 535–1 120 zł.

`FinancialTab.jsx:228-248` is the tab's most prominent card and drives its own green / amber / red banding off `revenueGap / estimatedRevenueAt2_2x`, so the error moves the traffic light, not just the digits.

**Fix shape.** Compare like with like: `revenue.flowers − estimatedRevenue`. `revenue.flowers` is already net and already excludes delivery.

---

## F5 — `Partial` payment is booked as fully paid (confirmed)

Every population split in the file is `o['Payment Status'] !== PAYMENT_STATUS.UNPAID` ([:87](backend/src/services/analyticsService.js:87), [:410](backend/src/services/analyticsService.js:410), [:481](backend/src/services/analyticsService.js:481)). `PAYMENT_STATUS` has three members — `Paid`, `Unpaid`, **`Partial`** ([statuses.js:50-54](backend/src/constants/statuses.js:50)). A `Partial` order therefore contributes **100 % of its `Effective Price`** to revenue, and 0 to `unpaidAmount`.

Production: 163 `Paid`, 3 `Unpaid`, **2 `Partial`**. Small today, wrong by construction, and it silently grows with use. There is no column recording how much of a partial payment landed, so the fix needs a product decision before code: either capture the amount, or exclude `Partial` from revenue and surface it as its own bucket.

Related: `FinancialTab.jsx:190` computes `unpaidCount = revenue.orderCount − revenue.paidOrderCount`, which quietly re-labels `Partial` as paid on screen too.

---

## F6 — Per-source margin puts the delivery fee in the numerator only (confirmed)

`analyzeSourceEfficiency` ([:462-468](backend/src/services/analyticsService.js:462)):

```js
map[src].revenue    += o['Effective Price'] || 0;   // includes delivery fee
map[src].flowerCost += o._cost || 0;                // flowers only
marginPercent: Math.round(((s.revenue - s.flowerCost) / s.revenue) * 100)
```

Same shape as F4, one table lower: a source with more deliveries scores a better "margin" purely because couriered orders carry a fee. Rendered at `FinancialTab.jsx:364-366`. Fix: subtract `_deliveryFee` from the numerator, or keep the two margins separate.

---

## F7 — `topProducts.revenue` is gross list price (confirmed)

`rankTopProducts` ([:312](backend/src/services/analyticsService.js:312)) accumulates `Sell Price Per Unit × Quantity` — the same gross quantity F3 is about, at line level. Product revenues therefore do not sum to `revenue.flowers`, and the ranking itself can be wrong wherever a `Price Override` lands unevenly across a bouquet.

This one leaves the screen: `financeInsightsPack.top_products` is a thin adapter over the same function, so **Ask Blossom answers "which product earned the most" with catalog list price**. Any fix to F3 must decide how an order-level override apportions across lines; the simplest defensible rule is pro-rata by line sell value.

---

## F8 — Two waste sources disagree inside one payload (confirmed)

The same response carries both:

| field | source | July | all-time |
|---|---|---|---|
| `waste.totalDeadStems` | `stock.dead_stems`, snapshot, 1 row (F1) | **0** | **0** |
| `stockLossBreakdown.totalQty` | `stockLossRepo.list({from, to})`, period-scoped | **289** | **989** |

`stock_loss_log` holds 258 live rows, 989 stems, 2026-03-19 → 2026-07-31, and is already fetched at [:44](backend/src/services/analyticsService.js:44) for `breakdownStockLosses` and the supplier scorecard. Per month: Mar 107, Apr 244, May 158, Jun 191, Jul 289.

**The correct source is already in the function.** `waste` should be derived from `stockLosses`, which makes the numerator period-scoped and puts it on the same span as the `allFlowerCost` denominator it is divided by — closing the brief's defect 2 in full. Valuation should reuse the `lostValue` convention already established in `assistantTools/stockPack` (`qty × the batch's own cost price`, with an `unvaluedQuantity` escape hatch for cost-less legacy batches) rather than inventing a second one.

---

## F9 — Analytics is a fourth private implementation of the delivery-fee rule (confirmed, latent)

The brief counted three implementations of the order total. There are four, and #644 has since introduced a named seam the fourth does not use — `resolveDeliveryFee(order, delivery)` in [utils/deliveryGate.js:56](backend/src/utils/deliveryGate.js:56):

```js
if (!isDeliveryOrder(order)) return 0;
if (delivery) return Number(delivery['Delivery Fee'] || 0);
return Number(order?.['Delivery Fee'] || 0);   // ← fallback analytics does not have
```

`routes/orders.js` (both endpoints) and `routes/dashboard.js` call it. `analyticsService.js:68` inlines its own variant:

```js
if (isDeliveryOrder(order) && order._delivery?.['Delivery Fee']) { … }
```

**Divergence:** a Delivery order with no `deliveries` row. The routes fall back to the order's own `Delivery Fee` column; analytics reports 0. Production has **0 such rows** today (127 delivery orders, all with a delivery row), so this is latent — but it is exactly the drift pattern that produced #554 and #644, and the seam exists precisely so there is one answer. Collapse analytics onto `resolveDeliveryFee`.

Also verified while here: the pitfall-10 gate is working. One Pickup order still carries a fee on its cancelled delivery row and is correctly excluded.

---

## F10 — `Final Price` and `Sell Total` are dead branches (confirmed)

`enrichOrderPrices` ([:252](backend/src/services/analyticsService.js:252)) reads `o['Final Price'] ?? …`. There is **no `final_price` column** (verified against `information_schema` on prod) and `orderRepo` never attaches one — `Final Price` is a *computed wire field* that `routes/orders.js:252` and `:349` write onto the response. Analytics calls `orderRepo.list` directly, so the branch is always `undefined` and always falls through. Same story for `order['Sell Total']` at `routes/orders.js:342`: no column, no repo field, always falls through to `lineTotal`.

Harmless today, actively misleading to read — both look like an authoritative stored total overriding the computation beneath them. Remove alongside the F9 consolidation.

---

## F11 — Weekly rhythm mixes two date bases (confirmed, small)

The order population is selected by `Order Date` ([orderRepo.js:282-283](backend/src/repos/orderRepo.js:282) — `dateFrom`/`dateTo` filter `orders.order_date`). `calculateWeeklyRhythm` ([:383](backend/src/services/analyticsService.js:383)) then buckets by **`Required By`**. So an order placed inside the period but required after it still lands on a weekday inside the chart, and one required inside the period but placed before it is missing entirely.

Production: **8 orders** have `order_date` and `required_by` in different months. For a "which day of the week is busiest" chart the delivery date is arguably the *right* basis — but then the population must be selected on it too. Pick one basis and state it in the label.

---

## F12 — Supplier waste crosses periods (confirmed, methodological)

`buildSupplierScorecard` ([:564-568](backend/src/services/analyticsService.js:564)) divides the period's losses by the period's purchases, and values them at the period's `avgPricePerUnit`. A June loss against a May purchase inflates that supplier's June rate and deflates May's. `Math.min(100, …)` at :568 caps the visible symptom, which also hides it.

Not a coding error — a definition that was never chosen. Decide what the number means (loss attributed to the purchase batch it came from, most likely) before writing code.

---

## F13 — `pg.active` is a filter key that does not exist (confirmed; root cause of F1)

`listFromPg` reads `includeInactive`, `includeEmpty`, `category`, `displayName`, the Variety 4-tuple, and `ids`. It never reads `pg.active`. But the doc comment directly above it ([stockRepo.js:584](backend/src/repos/stockRepo.js:584)) advertises the shape as:

```
// PG shape: `{ pg: { active?, includeEmpty?, includeInactive?, category?, … } }`
```

That stale `active?` is what makes `stockRepo.list({ pg: { active: true } })` in analytics read as a deliberate, correct choice — the brief itself lists it as lead 6, "deliberate or inherited?". It is neither: it is inert, and the real filter doing the damage is the `includeEmpty` default nobody wrote down.

Fix the comment in the same PR as F1, and grep for other callers relying on a key the function ignores.

---

## Ruled out

**Previous-period boundary arithmetic — no off-by-one.** `prevTo = from − 1 ms`, `prevFrom = prevTo − periodLength`, both `.toISOString().split('T')[0]`. All inputs are date-only strings, so `new Date()` parses as UTC midnight and `toISOString()` reads back UTC — no local-timezone drift is possible. Verified over seven ranges (calendar months incl. February, a full year, a single day, a partial month): **the previous window is always exactly as many days as the current one.**

One naming caveat, not a bug: it is a *rolling* window, not the previous calendar month. The comparison period for July (31 d) is 2026-05-31 → 2026-06-30, not June. Everything labelled "vs previous period" and every `rankTopProducts` trend arrow means that. If the tab's copy implies "vs last month", change the copy or change the window — deliberately.

**Cancelled-order cost — real but negligible.** [:39](backend/src/services/analyticsService.js:39) excludes `CANCELLED` from the cost population while cancellation does not auto-return stock, so stems consumed by a cancel-without-return are physically gone and financially invisible. Production has **3 cancelled orders, ever** — 306.98 zł of cost, 814 zł of sell, all between 2026-03-18 and 2026-04-06. Worth a comment in the code; not worth a fix.

**`active: true` hiding deactivated rows — inert.** Zero live-but-inactive stock rows on prod, and zero dead stems on them. The `includeEmpty` default (F1) is the whole of the damage.

**Front-end money math — none exists.** Confirmed the brief's finding: `FinancialTab.jsx` is 877 lines and its only `reduce` calls sum florist hours ([:445-447](apps/dashboard/src/components/FinancialTab.jsx:445)). Every figure is server-side. There is no front-end/back-end parity risk on this tab.

---

## Data findings (not code defects)

**D1 — 32 order lines carry revenue at zero cost.** Of 409 live order lines, 32 have `cost_price_per_unit` null or 0 while carrying **5 604 zł of sell value** out of 56 967 zł total (9.8 %). Total recorded cost is 17 915 zł. Those lines push `flowerMarginPercent` up with no offsetting COGS — the shipped figure is 67.98 % all-time, and `FinancialTab.jsx:264` colours anything ≥ 55 % green. Also 8 lines have no stock link and 4 have zero sell price. Line cost/sell are self-contained columns, so the money is intact; the gap is data entry, and it should be surfaced (a "lines with no cost" count) rather than silently averaged in.

**D2 — `driver_payout` is being recorded equal to the delivery fee.** 104 of 123 deliveries with both fields set have `driver_payout = delivery_fee` (10 above, 9 below); sums are 4 165 zł payout against 3 930 zł of fee. `deliveryProfit = deliveryRevenue − deliveryPayoutTotal` ([:279](backend/src/services/analyticsService.js:279)) is therefore ≈ 0 by convention, not by measurement — the shipped values are July `0`, June `−35`, May `+70`, all-time `−120`. `FinancialTab.jsx:428-430` colours it red below zero, so the tab reports the delivery operation as marginally loss-making on the strength of a bookkeeping habit.

**This is the #641 landmine.** ADR-0019 **reused** `driver_payout` for the new distance-based *Delivery Cost* instead of renaming it ([schema.js:240](backend/src/db/schema.js:240)). The pricing is **inert on production today** — 0 rows have `distance_km`, 0 have `taxi_cost` — so the column still holds only hand-entered payouts. The moment #641 activates, the same column starts carrying an auto-computed cost, and `deliveryProfit` will be summing two different quantities across the history boundary with nothing marking where it moved. Decide now: either migrate the historical rows, or gate the metric on `distance_km IS NOT NULL`.

---

## The most durable output: invariants, not one-off fixes

`backend/src/__tests__/analyticsRevenueReconcile.test.js` (28 L) locks exactly one property — `total === flowers + delivery` — and it holds on every period probed. It is also the reason defect F3 is *visible*: the invariant was enforced at the top level and never extended downward. More invariants of that kind will catch this class before it ships:

1. **`sum(monthly[].flowerRevenue) === revenue.flowers`**, and per row `revenue === flowerRevenue + deliveryRevenue`. Both fail today (F3).
2. **`sum(topProducts[].revenue) <= revenue.flowers`** — fails today (F7).
3. **Waste numerator and denominator span the same dates** — assert `waste` is derived from a `{from, to}`-filtered source, not a snapshot (F1, F8).
4. **Turnover's two sides share a period** — or the KPI is removed (F2).
5. **Every population split names its payment statuses explicitly**, so adding a fourth `PAYMENT_STATUS` member breaks a test instead of silently joining "paid" (F5).
6. **A metric that mixes delivery and flower money must say so in its name** — `revenueGap` and per-source `marginPercent` both fail this today (F4, F6).

Parity tests already pin each assistant tool to its canonical source, so fixing `computeAnalytics` fixes Ask Blossom by construction. Worth re-running `assistantTools.*.parity` after any change to confirm that still holds.

---

## Proposed issues

| Proposed | Findings | Notes |
|---|---|---|
| Waste block reads one stock row — drive `waste` from `stockLossRepo` | F1, F8, F13 | Highest value. Fixes a green "Healthy 0 %" that is hiding 989 written-off stems |
| Inventory turnover is undefined under the Y-model — redefine or remove | F2 | Needs a product decision first |
| `revenueGap` and per-source margin mix delivery money into flower metrics | F4, F6 | One seam, two call sites |
| `Partial` payment booked at 100 % | F5 | Needs a product decision (capture the amount vs. own bucket) |
| `topProducts.revenue` is gross — apportion `Price Override` per line | F7 | Pairs with #628; do not fix F3 twice |
| Collapse the four delivery-fee/total implementations onto `resolveDeliveryFee`; delete the `Final Price` / `Sell Total` dead branches | F9, F10 | Pure consolidation, no behaviour change on today's data |
| Weekly rhythm: pick one date basis | F11 | Small |
| Supplier waste: define the attribution period | F12 | Definition first |
| Surface order lines with no cost price | D1 | Data-quality signal, not a formula change |
| Decide `driver_payout` semantics before #641 activates | D2 | Time-boxed by the feature going live |
| Analytics invariant suite | all | The durable half of this audit |

**F3 is not in this list** — it is owned by [#628](https://github.com/OliwerO/flower-studio/issues/628)/P1. The magnitude measured above should be attached to that issue as a comment.
