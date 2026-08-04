# Architecture review — data quality, reliability, functionality (2026-08-04)

Autonomous `/improve-codebase-architecture` run. Six parallel exploration passes (backend write paths, money flows, integrations, cross-app duplication, test architecture, issue/WIP landscape) + prod verification via Railway env and the `claude_ro` DSN. **No code was changed.** Questions for Oliwer/owner are collected in §5; refactor issues get filed after those are answered.

Vocabulary: domain terms per `CONTEXT.md`; architecture terms (module, interface, seam, adapter, depth, leverage, locality) per the skill's LANGUAGE.md.

---

## 1. Verified live findings (prod, checked 2026-08-04)

These were confirmed directly, not inferred:

1. **Delivery Cost (#641 / ADR-0019) is inert on prod.** `ORS_API_KEY` is not set on the backend service, `app_config.config.studioAddress` is null, and `distanceBands` is absent. `distanceService.resolveDistance` therefore returns null and `orderRepo.js:783-785` falls back to the flat 35 zł — the exact zero-margin state the feature shipped to fix. Every delivery Order created since merge is being priced the old way. Setup needed: ORS key + studio address + band table (owner enters bands in Settings).
2. **Duplicate migration prefix `0024`** (`0024_stock_order_termination.sql` + `0024_wix_price_seen.sql`) — #634's structural gap is real; `meta/_journal.json` is stale. No CI guard exists.
3. **The Demand Entry uniqueness index exists only in `0013_stock_y_demand_index.sql`, not in `schema.js`.** It is the *only* real DB-level invariant in the stock domain (partial unique on the Variety 4-tuple + date where `quantity < 0`), and a future `drizzle-kit generate` diff would drop it. Related: two migrations already share a prefix because generate/hand-author workflows are mixed (#634).
4. **ADR-0018's column does not exist.** The ADR ("every received Batch records the Stock Order line that bought it — written now because it cannot be reconstructed later") is merged; no migration adds the column, `schema.js` has no `stock_order_line_id`. Every Batch received since the ADR's acceptance is permanently unattributable — the precise loss the ADR was written to stop. Cheapest high-value fix in this report.
5. **`WIX_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID` are set on prod** — so the fails-open webhook auth (`webhook.js:24-27`) and silent Telegram no-op paths are latent hazards, not live incidents.
6. **`targetMarkup` on prod is 2.5**, while `analyticsService.js:203` (`estimatedRevenueAt2_2x`) and four dashboard translation strings still say "2.2×".

---

## 2. Deepening candidates

Ranked by data-quality/reliability impact. Each names the module in domain terms, the friction, the shape of the fix, and what deepening buys.

### C1. Variety identity — one composer, one matcher, recompute-on-write

**Files:** `backend/src/repos/stockRepo.js:1078-1155` (`updateVarietyAttrs`/`bulkUpdateVarietyAttrs` — write the 4-tuple, never the Display Name), `packages/shared/utils/varietyKey.js:63-75`, `stockRepo.js:69-73`, `backend/src/services/stockOrderService.js:420-424`, `backend/src/routes/stockOrders.js:26-32` (four divergent name composers), `routes/stockOrders.js:385-404` (a third, case-sensitive variety matcher + inline date-tag regex), `stockRepo.js:79` and `:251-254` (`sizeCm ? … : isNull` — size 0 routed to null, contradicting the pinned parity case `'size 0 is a real size'`).

**Problem:** a Variety's Display Name is a stored denormalised copy of the 4-tuple with **four independent composers and no recompute trigger**. The repair path for mis-classified stock is itself broken (#597): editing attrs leaves the name stale; re-dating a sole-owner Demand Entry leaves the old date inside the name. The composers already diverge on size-0 (`varietyDisplayName` renders `0cm`; the repo composer drops it). A third ad-hoc matcher in `routes/stockOrders.js` is case-sensitive where `findVarietyMatch` is not — the exact drift class #562 closed at the create door, alive one seam over. The interface of "what is this flower called" is nearly as complex as the implementation — a textbook shallow spot in an otherwise deepened area.

**Solution:** one backend name-composition function beside `varietyIdentity.js`, pinned through the existing parity-case mechanism (`varietyIdentityParityCases.js` — add composer cases; the test fails until both sides match). Every write path touching the 4-tuple or a Demand Entry date recomposes the name **in the same transaction**. Retire the `routes/stockOrders.js:385-404` matcher in favour of `stockRepo.findVarietyMatch`. Fix the two size-0 sites.

**Benefits:** locality — identity bugs concentrate where the parity test already looks; #597 becomes impossible rather than repaired; the trace surface, pickers and evaluation all read one truth. Leverage: the Materials effort (#619) inherits a single naming seam for non-flower kinds instead of four.

**Longer term (question Q-B1):** ADR-0006 stored the tuple inline at ~30-50 Varieties and named a "merge tool if drift observed" mitigation; drift has been observed repeatedly. ADR-0017 calls a real `varieties` registry table "the structurally correct answer" that "would also fix #597 and #562" and leaves it as a legitimate future refactor; #640 was explicitly parked as its own post-Materials effort. Composer unification above is worth doing regardless — it is also the preparatory step for the registry.

### C2. Stock mutation atomicity — the procurement domain gets transactions

**Files:** `backend/src/services/stockOrderService.js:283-693` (`evaluatePurchaseOrder` — per line: receive + purchase record + substitute receive + two write-offs + line update, each its own transaction), `:206-282` (`receiveIntoStock` — three independent transactions), `backend/src/routes/stockPurchases.js:24-77` (five), `backend/src/routes/stock.js:652-678` (`/adjust` — read-compute-write while atomic `stockRepo.adjustQuantity` sits unused), `:681-753` (`/write-off` — same, plus fire-and-forget loss log), `backend/src/routes/stockLoss.js:34-98`, `backend/src/routes/orders.js:680-726` (`/swap-bouquet-line` — three transactions).

**Problem:** the Order domain is exemplary (`orderRepo.createOrder`, `transitionStatus`, the Delivery cascade — all single transactions). The entire Stock Order → Batch pipeline is not: atomicity is *simulated* by ADR-0003 string markers plus `EVAL_ERROR` retry. A crash between `receiveIntoStock` and `stockPurchasesRepo.create` leaves Stems credited with no marker — the retry credits them **again**. Two routes do read-compute-write on `Current Quantity` (lost updates under concurrency). `GET /stock/pending-po` (`stock.js:193-390`) performs non-idempotent writes inside a GET.

**Solution:** thread a `tx` handle through the receive/evaluate seam the way `stockRepo`'s Y-model exports already demand one (`getOrCreateDemandEntry(…, tx, actor)` is the in-house prior art). `receiveIntoStock` = one transaction; evaluation = one transaction per line including its markers; `/adjust` and `/write-off` switch to `adjustQuantity` inside a transaction; the pending-po GET's write half moves behind an explicit non-GET seam.

**Benefits:** crash-safety becomes a property of the module, not of operator retry discipline. Kills the #323 "stems disappeared" class at its root. Tests get to assert invariants ("purchase row exists iff batch row exists") instead of marker choreography.

### C3. Stock Order domain module — finish the extraction, add the audit seam (#596)

**Files:** `backend/src/routes/stockOrders.js:316-421` (the ADR-0016 line-identity lock — ~105 lines of domain rules in an Express handler), `:680` (`/send` re-resolve), `:756` (`/driver-complete`), `:776` (`/approve-review`) — all reachable only via HTTP; `backend/src/repos/stockOrderRepo.js:103/117/325/339` (bare Drizzle writes: no `actor`, no `recordAudit`, no transaction, and `stock_orders`/`stock_order_lines` have no `updated_at`); prod `audit_log` has **zero rows** for either entity while `stock` has 2,371.

**Problem:** W2 extracted `evaluatePurchaseOrder` and proved the shape (domain result `{outcome}`, route maps to HTTP). The rest of the PO lifecycle stayed in the route, so its 409 contract is tested against hand-built error handlers that behave differently from the production `errorHandler` — and nothing can answer "who changed this line" for the studio's procurement money. Deletion test on the route logic: deleting it would scatter ADR-0016 across two apps' editors — it is earning its keep, it's just in the wrong place with the wrong test surface.

**Solution:** complete the extraction (`sendPurchaseOrder`, `patchLine`, `addLine`, `driverComplete`, `approveReview` as domain functions). Give `stockOrderRepo` the `stockRepo` signature — `(id, fields, opts = {})`, before-read + `recordAudit` inside `db.transaction`, `updated_at` columns. #596's acceptance test ("exactly one audit row per PO-line PATCH, carrying the actor") becomes writable in the existing pglite harness.

**Benefits:** the identity-lock contract gets a non-HTTP test surface; audit coverage stops being opt-in; composes with C2 (same transaction boundary).

### C4. Order money — one Final Price

**Files:** nine independent implementations of "what did this Order come to": `backend/src/services/analyticsService.js:252`, `backend/src/routes/orders.js:249-250`, `:340-343`, `:525-529`, `backend/src/routes/dashboard.js:78-83`, `:146-147`, `apps/florist/src/pages/NewOrderPage.jsx:340-342`, `apps/dashboard/src/components/NewOrderTab.jsx:287-289`, `apps/dashboard/src/components/OrderDetailPanel.jsx:284-300` — two of which read the Delivery Fee from **different columns** (`orders.delivery_fee` vs `deliveries.delivery_fee`). Sibling duplications: order sell/cost totals (~11 and ~5 sites), Delivery Margin (computed inline in `DeliveryPricingFields.jsx:81-82` while `computeDeliveryMargin` is never called in production code), `orderFilters.js:55-57` keeping filter-price aligned with display-price *by comment*.

**Problem:** the most-read financial quantity in Blossom has no module. Each site re-derives it; the fee column split means list, detail, analytics and dashboard can disagree on the same Order. Pitfall #2/#10 gating (`isDeliveryOrder`) must be re-remembered at every new site.

**Solution:** a single order-money module (shared package + backend both import it, pinned by a parity case list exactly like `varietyIdentity`) exposing effective price / sell total / cost total / margin over the wire shape both tiers already hold — with the Delivery-Type gate inside it. Then retire reads of the redundant `orders.delivery_fee` column. Interface design (backend-computed field vs shared function) is a grilling-session decision.

**Benefits:** leverage — nine call sites and every future Ask Blossom tool inherit one formula; the filter/display divergence class disappears; ADR-0019's "neither number derived from the other" is enforceable in one place.

### C5. Receive-time money truth — the #535/#340/#555/#326 cluster

**Files:** `backend/src/services/stockOrderService.js:479` (a fully-rejected line — everything arrived damaged — creates **no** `stock_purchases` row: the money paid vanishes from supplier spend), `:521-525` + `:156-157` + `:542-543` (substitute money: `Alt Cost` is a **total** while `Cost Price` is **per-stem** in the same table, and substitute sell is always recomputed as `cost × targetMarkup`, discarding the owner's price), `:244` (sell = `linePrice || staleCardPrice || 0`), `backend/src/repos/stockOrderRepo.js:203` (`|| 0` coercion — an empty PATCH turns a real sell price into 0), `apps/florist/src/pages/StockEvaluationPage.jsx` (no sell-price input at all — #340 unimplemented), plus the PO "total" being planned `Needed × Cost` in four frontend copies with no backend computation (`PurchaseOrderPage.jsx:476/589`, `StockOrderPanel.jsx:550/663`).

**Problem:** the seam where market reality enters the system (Reviewing/Evaluating) has no interface for the two numbers the owner cares about — what was actually paid, and what the Stems will sell for. Both are silently derived or silently lost. `stock_orders.supplier_payments` (the cash actually handed over) is TEXT JSON read by zero backend code, never reconciled against line costs.

**Solution:** mostly *product* decisions, already parked on #535 ("narrow fix vs #340 redesign") — collected in §5. The unit-mismatch (`Alt Cost`) and the `|| 0` coercion are code defects fixable independent of the product fork.

**Benefits:** supplier scorecard, purchase spend, and per-Batch cost stop being fiction for damaged/substituted deliveries — the money the studio spends at the market becomes as trustworthy as Order revenue.

### C6. Wix mirror — promote the ADR-0020 baseline from special case to the module's interface

**Files:** `backend/src/services/wixProductSync.js:842-938` (`runPull` per-variant block): Price has the `wix_price_seen` change-detection baseline; Product Name has the ADR-0008 ownership guard; **Description (`:923-925`), Image URL (`:847`), Active (`:900`), Visible in Wix (`:901`) clobber unconditionally**, and Category (`:910-917`) partially. No divergence counters exist for any of them (`pricesNotOnWix` covers price only). 1,569-line module — already flagged as a split candidate in backend/CLAUDE.md.

**Problem:** the mirror rule — "a Pull may only import a Wix-side *change*, never re-stamp a stale echo" — was implemented for one field after two months of silent data loss (#428). The other four owner-editable fields still run the pre-fix logic. `Active` is the sharpest: a Florist deactivating a Product variant, followed by a Pull before the next Push, is silently reactivated — same class, workflow-visible. This is a shallow-module symptom: the mirror policy lives per-field, inline, instead of behind one seam.

**Solution:** one mirror seam — per-field `{ wixValue, seenBaseline, localValue } → mirror / skip / report` — with Price's existing behaviour as the reference adapter, applied to Description, Image URL, Active, Visible, Category; a divergence counter per field flowing into `sync_log` like `pricesNotOnWix` does. Field-by-field scope confirmation is Q-B4 (Active/Visible have workflow semantics worth a deliberate decision).

**Benefits:** the "sibling still clobbers" class is closed permanently rather than field-by-field after each incident; divergence is visible instead of two-months-invisible; a natural first slice of the wixProductSync split.

### C7. Order intake durability — a paid Wix Order must never silently not exist

**Files:** `backend/src/routes/webhook.js:70` (200 sent before processing — Wix's 12 retries are consumed by an ack for work that then fails), `backend/src/services/wix.js:443-451` (every failure swallowed to `console.error` + a `Failed` log row), `backend/src/repos/webhookLogRepo.js:18-19` (raw payload deliberately not persisted) **and** `wix.js:76-77` (payload deliberately not logged to Railway — PII) — so a failed intake's payload is gone in both places; recovery (`/reprocess`) requires already knowing the Wix order ID; no alert of any kind fires.

**Problem:** the single most valuable intake path in Blossom (a customer already paid) has fire-and-forget semantics end to end. Reliability of everything downstream — Florist New-Order Notification, stock decrement, Delivery creation — is moot if the Order was never created and nobody was told.

**Solution:** persist the raw payload for **failed** intakes only (a dead-letter row that `/reprocess` can replay — PII retention question for the owner, Q-A3), send a Telegram owner alert on `Failed`, and fail **closed** when `WIX_WEBHOOK_SECRET` is unset (`webhook.js:24-27` — secret is set on prod today, so this is hardening, not an incident).

**Benefits:** a lost paid Order becomes an alert + a replay button instead of a customer complaint days later.

### C8. Order editing — apply the deletion test to the seam that already exists

**Files:** `packages/shared/hooks/useOrderEditing.js` (638 lines — the largest hook in the shared package, built to own order editing, **imported by neither** `apps/florist/src/components/OrderCard.jsx` (1,629 L) **nor** `apps/dashboard/src/components/OrderDetailPanel.jsx` (1,330 L), only by the two wizards' Step2 + `OrderDetailPage`); the duplicated orchestration: `doSave` (`OrderCard.jsx:327-386` ≈ `OrderDetailPanel.jsx:104-146`, near-verbatim), `patch`/`patchDelivery`/`handleChangeCustomer`/dissolve/price-rollup — ~200 lines of stock-mutating logic maintained 2-3×, aligned by comments ("Parity with florist OrderCard").

**Problem:** the seam was built, then abandoned in place — the worst of both worlds: the bundle carries the hook, the parity table documents the duplication, and any stock-adjustment fix lands in one copy and silently skips two. A module that no caller imports fails the deletion test in the most literal way possible.

**Solution:** decide the direction (Q-B2): either route the three editors through the hook (making it the real seam it was designed to be), or delete it and extract the *actually shared* orchestration (the save/patch/customer-change bundle) as a smaller module. Either resolves the misleading state; keeping both is the only wrong answer.

**Benefits:** the order-editing save path — the one that mutates stock — gets one implementation, one test surface; ~400 duplicated lines die.

### C9. Status vocabulary — one shared source (#580), and three transition maps become one

**Files:** 156 raw status-string literals across `apps/` vs exactly two files importing `backend/src/constants/statuses.js` via a `../../../../` relative path; `ALLOWED_TRANSITIONS` duplicated byte-identically at `orderRepo.js:831-839` and `orderService.js:69-77` (the latter dead), with a **third private copy** in `apps/florist/src/components/OrderCard.jsx:18-51`; the PO state machine hand-encoded in both PO pages (18 + 11 raw literals) and in `routes/stockOrders.js:35-47` — which `stockOrderService.js:642/651` and four route sites bypass when writing status directly.

**Problem:** the status vocabulary — the one thing CLAUDE.md says must never be raw strings — crosses the app/backend seam through a four-level relative path used by 5% of consumers, and the Order/Stock-Order state machines exist in 3+ copies each. #580 already poses the fork; draft PR #621 is **fully redundant** (its identical twin merged as #564; #188 closed) and should be closed, not rebased.

**Solution:** #580 option (a): `packages/shared` re-exports the backend constants; consumers migrate (mechanically, spread over PRs); the dead `orderService` map is deleted; PO transition legality moves behind the `stockOrderService` seam so service writes can't bypass it.

**Benefits:** ADR-0015's machine lives in one place; the `../../../../` path stops being load-bearing; the 156-literal drift surface shrinks to zero over time.

### C10. Translation contract for shared components

**Files:** three per-app `translations.js` (1,970 + 2,534 + 317 lines, zero shared structure); the only drift guard is `packages/shared/test/bouquetFlowerFormKeys.test.js` — a regex over source text requiring a two-space indent, covering **one** component's keys in **two** of three apps; ~10 shared components index a host-supplied `t` whose Proxy returns the key itself on a miss (so every violation ships as a visible `varietyNone`-style literal, never an exception); #638's 33 duplicate keys with diverging values.

**Problem:** shared components declare an implicit interface (required top-level keys) that nothing structural enforces. The guard that exists is the right idea with the wrong generality.

**Solution:** each shared component exports its required-keys list (BouquetFlowerForm already does); one generic test walks *all* shared components × *all three* apps' translation files. #638's burn-down itself needs owner label choices (each fix picks between two Russian strings she reads on her phone) — parked in §5.

**Benefits:** the Proxy trap becomes a CI failure instead of a shipped literal; adding a shared component automatically extends the guard.

### C11. Test harness — one route harness with the production error handler

**Files:** `buildApp()` copy-pasted into 37 backend test files, every one substituting a fake error handler for `middleware/errorHandler.js`; `pgHarness.js:162-170` exports `harnessAsDbModule` — used by 2 of 89 files; four independent fixture systems (86 hand-written pglite inserts, the `airtable-test-base.json` fixture, `tests/e2e/helpers/seed.js` API-seeding, `lab/factories/`), so a schema change is four edits; `lab/tests/api/` duplicates four backend integration tests nearly 1:1; `apps/delivery` has **zero coverage of any kind** while Playwright boots its server on every run; `POST /api/stock-purchases` — the *sibling absorption site* pitfall #9 names — has zero tests at every layer while its PO twin has nine.

**Problem:** the tests validate error shapes production never produces — dangerous precisely because `errorHandler` masks messages and drops `code`, the only signal the PO editors act on. And the fixture quadruplication means the layers CI runs rarely (lab, Playwright) rot first.

**Solution:** a `helpers/routeHarness.js` (mount router + role injection + **real** errorHandler + pooled pglite) deleting ~1,500 lines of bootstrap; adopt `harnessAsDbModule`; pick one canonical factory source (Q-B8). Add the two highest-risk missing tests first: `stock-purchases` absorption, one delivery-app Playwright spec.

**Benefits:** every new integration test inherits the prod-faithful seam for free; the 409-contract class of bug becomes testable where it actually bites.

### C12. Process-lifetime state — what a Railway redeploy silently destroys

**Files:** `configService.js:370-401` (Driver of the Day in module memory — a mid-day redeploy silently unsets today's driver; the Telegram bots' `system_meta` poll offsets are the in-house prior art for doing this right), `wixPushJob.js:26-51` (job registry in a process Map — a redeploy mid-Push leaves the owner a 404 for a half-landed push), no scheduler anywhere (Pull runs only on a button — catalog drift accumulates indefinitely), `index.js:171-179` (any unhandled rejection in any fire-and-forget path exits the process, killing every other in-flight background task).

**Problem:** operational state that must survive a deploy lives in process memory; the system's answer to "what runs periodically" is "the owner clicks".

**Solution:** persist Driver of the Day in `system_meta`; persist push-job status rows; decide whether Pull should self-schedule (owner-visible behaviour — Q-B6); triage the fire-and-forget paths so one bad rejection doesn't cascade.

**Benefits:** deploys stop being silent operational events; drift self-heals instead of accumulating.

---

## 3. Point defects to file regardless of decisions

No architecture question attached — file/fix after review sign-off:

| # | Defect | Where |
|---|---|---|
| D1 | ADR-0018 column missing — implement migration + `receiveIntoStock`/`stockPurchases.js` stamp now; history is bleeding daily | `schema.js`, `stockOrderService.js:238-254`, `routes/stockPurchases.js:44` |
| D2 | DE unique index not declared in drizzle schema (drop risk) | `schema.js` stock table, migration `0013` |
| D3 | size-0 identity bug (`sizeCm ? … : isNull`) ×2, contradicts pinned parity case | `stockRepo.js:79`, `:251-254` |
| D4 | Taxi Cost + Driver Payout summed unconditionally; mutual-zeroing exists only in 4 frontend click handlers | `analyticsService.js:83` |
| D5 | Delivery Fee read from `orders.*` in dashboard/orders routes but `deliveries.*` in analytics | `routes/dashboard.js:78-80`, `routes/orders.js:248` vs `analyticsService.js:68-69` |
| D6 | Cancelled deliveries land in the Pending group (confirmed live, #583) | `apps/delivery/src/pages/DeliveryListPage.jsx:151-158` |
| D7 | `Alt Cost` unit mismatch (total vs per-stem) + `|| 0` sell coercion | `schema.js:563-570`, `stockOrderRepo.js:203` |
| D8 | Write-off route: loss log fire-and-forget while decrement commits | `routes/stock.js:730-740` |
| D9 | "2.2×" labels vs `targetMarkup` 2.5 | `analyticsService.js:203`, dashboard translations ×4 |
| D10 | Webhook auth fails open when secret unset (harden: fail closed) | `routes/webhook.js:24-27` |
| D11 | `deliveryPricing.integration.test.js` misclassified by CI's name-based split | backend `__tests__` |
| D12 | Dead shared exports (`InlinePriceField`, `TraceWindowPills`, `ListItem`, `useOrderPatching`, `useVarietyTraceExpand` — 0 importers) | `packages/shared/index.js` |
| D13 | `stock_purchases.quantity_accepted` never set by the manual receive route | `routes/stockPurchases.js:68-76` |

## 4. WIP hygiene (from the issue-landscape pass)

- **Close draft PR #621** — identical twin merged to master as #564 (`a37d3ad`); #188 already closed. Rebasing it would re-do merged work.
- **Verify-and-close stale issues:** #588 (shipped via #568/#600/#611), #589 (DELETE routes exist since #600 — residual gap is UI surfacing at most), #605 (shipped via #608 — check the two residual ACs), #405 (florist PO entry point exists — reframe to per-row "order more" or close), #354 (premise predates Y-model cutover — re-verify against prod).
- **Materials WIP (#619/#624) is healthy but blocked on questions**, not on code: #627 needs guard semantics; #629 needs rounding + recount-origin schema; #630 blocked by #627; **#636 (Recount UI prototype) is the critical path for plan P6 and has six open questions with zero comments.** This review deliberately proposes nothing that collides with map #624's decided territory (`isPickable` deny-list, no `?kind=` param, DB CHECK in `0027`).

---

## 5. Questions for Oliwer / owner (answer these tomorrow)

### A. Live prod — quickest wins first

- **Q-A1. Delivery pricing activation:** #641 is inert (no `ORS_API_KEY`, no `studioAddress`, no `distanceBands` — §1.1). Set the three now? Cost: an OpenRouteService key (free tier exists) + typing the studio address + the owner entering her band table in Settings. Until then every Delivery books zero margin.
- **Q-A2. ADR-0018 column (D1):** OK to ship as an immediate standalone migration PR? It is inert by design (nullable, no read path) — but every day unshipped is unrecoverable purchase-attribution history.
- **Q-A3. Webhook dead-letter (C7):** failed Wix intakes would persist the raw payload (customer name/address/phone) in Postgres until replayed. Acceptable PII-wise (it's the same data the Order would hold anyway)? Plus a Telegram owner alert on every failed intake — yes?

### B. Architecture direction (needed before filing the refactor issues)

- **Q-B1. Variety registry table:** commit to it as the named post-Materials effort (superseding ADR-0006's inline choice, as ADR-0017 anticipates and #640 requests), with C1's composer unification as the preparatory slice? Or keep the inline model and do C1 only?
- **Q-B2. `useOrderEditing` (C8):** resurrect (route OrderCard/OrderDetailPanel through it) or delete-and-extract-smaller? Someone who remembers why the editors never adopted it should decide — the index.js comment suggests bundle-size was the reason it was *dropped*, which argues for the smaller extraction.
- **Q-B3. Order money module home (C4):** shared function both tiers import (varietyIdentity-style parity pinning), or backend-computed fields on the wire (`effectivePrice` served in order responses)? The second kills frontend drift permanently but fattens payloads and needs a backfill for list views.
- **Q-B4. Wix mirror baseline scope (C6):** apply the seen-baseline to Description + Image URL + Category uncontroversially? And **Active/Visible** — should a Wix-side visibility change ever win over a local unpushed change, or is local always authoritative for availability (stronger than baseline: ADR-0008-style ownership)?
- **Q-B5. Supplier identity:** promote Supplier to a table with FK (rename stops forking scorecard/payments/history five ways), or keep free-text + the managed config list? A rename today silently splits every total.
- **Q-B6. Scheduled Pull (C12):** should Pull self-run (e.g. hourly)? Owner-visible: storefront edits would flow in without her clicking, and divergence toasts could appear "unprompted".
- **Q-B7. Driver of the Day persistence (C12):** move to `system_meta` so a redeploy doesn't unset it mid-day — any reason it was left in-memory?
- **Q-B8. Fixture consolidation direction (C11):** make `lab/factories/` the single factory source consumed by backend integration tests + E2E seeds, or keep layers separate and just add the missing PO factories?
- **Q-B9. Expense module:** CONTEXT.md defines **Expense** and **Recurring Expense** (lazy materialisation, edit-or-skip) — nothing exists in code: no table, no route, no service, and marketing spend + payroll are also outside `computeAnalytics` (stitched client-side in FinancialTab). Is the Expense module scheduled work I should slot after Materials, or did the plan change? (Without it there is no place where revenue minus *all* costs exists.)

### C. Already parked in issues (restated so tomorrow's pass answers them in one sitting)

- **#636 (blocks Materials plan P6)** — six Recount-UI questions: list contents (all Materials+Supplies? Add-ons? flowers?); submission unit (whole sitting vs per-row — decides dropped-tablet survival); skipped-vs-zero rows; Continuous Material input shape (two shapes on one list vs per-row mode); feedback shape (per-row delta vs end summary); own screen vs stock-view mode.
- **#629** — rounding rule at the base-unit boundary (down / nearest / reject), and how "recount-origin" is represented (column vs sourceType enum alongside ADR-0018's stamp). Also: is Continuous Material (story 15) in slice 1 or not — #625 didn't record it.
- **#627** — exact guard semantics for the four write-path holes (reject status/error shape? gate earlier?).
- **#628** — which analytics queries get a kind gate, on which side (turnover denominator, waste %, supplier scorecard, loss totals, margin numerator).
- **#630** — which shared components get a kind prop in slice 1; how the kind-filtered view is expressed per host.
- **#535 vs #340** — narrow substitute-sell-price fix now, or fold into #340's evaluation redesign? (C5 sharpens this: the unit-mismatch and coercion defects are separable and should not wait.)
- **#580** — (a) shared re-export vs (b) modal-only: this review recommends (a) (C9).
- **#583** — cancelled deliveries: hide entirely vs collapsed group.
- **#581** — where do undated orders sort in desc mode; which app's comparator is correct (they diverged at birth: sentinel `'9999-12-31'` vs `'9999'`).
- **#582** — 19 unreachable product_config rows: GUARDED one-shot script vs admin surface.
- **#597** — per-table decision on the three `flower_name` snapshots (order_lines historical: leave; stock_order_lines on live PO: re-derive) — folds into C1.
- **#634** — journal: regenerate-in-sync vs drop drizzle-kit generate and hand-author; + add the CI prefix-uniqueness guard (this review votes yes on the guard regardless).
- **#638** — 33 duplicate translation keys: each fix is a choice between two Russian labels the owner reads — needs her eyes, batched.
- **#457** — vector store choice (pgvector vs managed) + refresh trigger, if Code-RAG is still wanted.

---

## 6. Sequencing suggestion (post-answers)

1. **Now / trivial:** Q-A1 setup, D1 (ADR-0018 migration), close PR #621, stale-issue sweep, D2/D3/D9/D11.
2. **Slice with Materials (already planned):** everything in map #624 — untouched by this review.
3. **First refactor wave (data quality):** C1 composer unification → C2 transactions → C3 PO module+audit (they compose: same seam, same tests).
4. **Second wave (money):** C4 order money + C5 receive-time truth (needs the #535/#340 answer) + D4/D5/D7.
5. **Third wave (reliability):** C6 mirror seam + C7 intake durability + C12 process-state.
6. **Continuous:** C9 status migration, C10 translation guard, C11 harness — mechanical, ride along with touching PRs.
7. **Post-Materials headline effort (if Q-B1 = yes):** the Variety registry — the one refactor that retires #597, #562-class drift, and half of #640's ladder in a single structural move.
