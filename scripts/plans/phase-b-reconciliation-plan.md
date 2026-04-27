# Phase B — PO Substitute Reconciliation: Implementation Plan

*Planned 2026-04-20. Locks in the six open design decisions from `scripts/prompts/phase-b-po-substitution-reconciliation.md`.*

## 1. Summary and scope boundary

Phase B adds a substitute-aware reconciliation screen that, after a PO is evaluated with a substitute flower, lists every open customer order still referencing the negative original and lets the owner swap bouquet lines over to the substitute — one line at a time, with the owner picking `swapQty` per line (no auto-allocation). Scope: Airtable schema change for a `Substitute For` link field; a **new** `GET /api/stock/reconciliation` handler that replaces the current stock-drift handler at `backend/src/routes/stock.js:747`; verification of the already-written swap endpoint; frontend confirmation of `ReconciliationPage.jsx`; a per-line substitute picker for the multi-substitute case; a dashboard parity surface; an SSE-driven banner; and a manual end-to-end verification script. Out of scope: Wix storefront sync; auto-revert-on-later-arrival; auto-allocation/FIFO logic; the obsolete alternate swap endpoint at `orders.js:468`.

## Locked owner decisions (2026-04-20)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Data model | **A** — Add `Substitute For` multi-link field on Stock → Stock |
| 2 | Partial coverage | **C** — Owner picks `swapQty` per order (no auto-allocation) |
| 3 | Multiple substitutes over time | **A** — Stack on one reconciliation card |
| 4 | Sort priority | **B** — `required-by` date/time ascending (earliest deadline first) |
| 5 | Swap reversal | **A** — Keep swaps permanently, no auto-revert |
| 6 | Wix storefront | **A** — Out of scope |

## 2. Airtable schema change

**Field spec (Airtable UI — Meta API cannot create fields):**
- Table: `Stock`
- Field name: `Substitute For` (case-sensitive, no trailing space)
- Type: **Link to another record → Stock** (self-link)
- Allow multiple records: **Yes**
- Prevent record creation from this field: **Yes** (only backend should populate)
- Show the linked record from the other side: **No** (avoid auto-created reciprocal "Substituted By" column unless desired — if enabled, be consistent with dashboard read code)
- User-editable in dashboard Stock tab: **No** — write-only from backend for this phase. If manual correction needed, owner edits in Airtable directly.

**Schema validator update**: `backend/src/services/airtableSchema.js:45-49` — add `'Substitute For'` to the `[TABLES.STOCK]` array of `EXPECTED_WRITE_FIELDS`. Startup will then confirm it exists and fail loudly if misspelled.

## 3. Backend changes (file-by-file)

### 3.1 `backend/src/services/airtableSchema.js:45`
Add one line: `'Substitute For',` inside the Stock block. ~1 LOC.

### 3.2 `backend/src/routes/stockOrders.js:553-591` (`findOrCreateSubstituteStock`)
- Change signature to accept `originalStockId`: `async function findOrCreateSubstituteStock(altFlowerName, altSupplier, costPerStem, originalStockItem, originalStockId, today)`.
- **Create-branch (line 576)**: set `'Substitute For': [originalStockId]` in the `db.create` payload when `originalStockId` is truthy.
- **Find-branch (line 566-568)**: when an existing substitute card is found, merge `originalStockId` into its existing `Substitute For` multi-link via `db.update(TABLES.STOCK, existing[0].id, { 'Substitute For': Array.from(new Set([...(existing[0]['Substitute For'] || []), originalStockId])) })`. Handles the "Rose Misty substitutes first Rose Silva, then Rose Salma" case without losing the earlier link.
- Update the caller at `stockOrders.js:796` — pass `stockItemId` (the original) as the new arg.
- Leave `originalStockItem` param intact (still used for category/unit copy).
- ~15 LOC net.

### 3.3 `backend/src/routes/stock.js:747-877` — replace handler

**Route conflict decision: REPLACE in place.** Current stock-drift handler is consumed by:
- `apps/dashboard/src/components/ReconciliationSection.jsx` (mounted in `StockTab.jsx:365` and `DayToDayTab.jsx:562`)
- `apps/florist/src/pages/OrderListPage.jsx:237` (reads `.length`)

All three call sites expect the **new** shape (`items[]` with `originalStockId`/`substitutes`/`affectedLines`) once Phase B is live — see `ReconciliationPage.jsx:29` reading `res.data.items`. Dashboard's `ReconciliationSection.jsx` expects the *old* shape and calls `POST /stock/reconciliation/apply`. All must migrate simultaneously (see 4.2).

**New handler at `stock.js:747`** — approximately 110-130 LOC:
1. Fetch all substitute stock cards: `db.list(TABLES.STOCK, { filterByFormula: "AND({Active} = TRUE(), {Substitute For} != '', {Current Quantity} > 0)", fields: ['Display Name', 'Substitute For', 'Current Quantity'] })`.
2. If empty → return `{ items: [] }`.
3. Collect all `originalStockId`s from `Substitute For` multi-links (deduplicated).
4. Fetch those original cards by ID via `listByIds(TABLES.STOCK, originalIds, { fields: ['Display Name', 'Current Quantity'] })`.
5. Fetch open orders referencing any original: filter `AND({Status} != 'Delivered', {Status} != 'Picked Up', {Status} != 'Cancelled')`, fields `['Order Lines', 'Customer', 'Required By', 'App Order ID', 'Status', 'Delivery Time', 'Created At']`, maxRecords 1000.
6. Fetch the linked order lines via `listByIds(TABLES.ORDER_LINES, ...)` with fields `['Order', 'Stock Item', 'Quantity', 'Flower Name', 'Stock Deferred']`. Filter to lines whose `Stock Item[0]` is in the original-id set.
7. Fetch customers for display names.
8. Build `items[]`. For each original:
   - `substitutes[]` = every substitute card linking back to this original, each `{stockId, name, availableQty}`.
   - `affectedLines[]` = all order-lines referencing this original, each `{lineId, orderId, customerName, appOrderId, requiredBy, orderStatus, quantity, suggestedSwapQty: 0}`. (Q2=C locked: always 0.)
   - Sort `affectedLines` by `requiredBy` ascending, then `Created At` ascending as tiebreaker (Q4=B). Use `localeCompare` on ISO strings; items with no `requiredBy` go last.
9. Skip items with empty `affectedLines[]` (no real mismatch — substitute exists but no orders still pointing at original).
10. Return `{ items }`.

**`POST /stock/reconciliation/apply` at `stock.js:879-896`** — **remove**. Only used by the old drift flow; dashboard code at 4.2 retires simultaneously.

### 3.4 `backend/src/routes/stockOrders.js:885-951` — SSE broadcast
Already correct. Minor refinements:
- Include `originalStockName` and `substituteStockName` in the payload so the toast can say "Received 10 stems of Rose Misty as substitute for Rose Silva" without an extra client fetch. `originalStockName` already partially wired (`originalFlowerName`); add `substituteStockName` by looking up `subStock['Display Name']` from the already-fetched `findOrCreateSubstituteStock` call chain.
- Broadcast-when-zero-affected: current code suppresses silently — leave as-is to avoid notification fatigue.

### 3.5 `backend/src/routes/orders.js` — swap endpoints (audit, don't re-edit)
- **Primary (keep):** `POST /:id/swap-bouquet-line` at `orders.js:336`, backed by `swapBouquetLine()` at `orderService.js:491`. Body: `{ lineId, substituteStockId, swapQty }`. Matches `ReconciliationPage.jsx:75-79` exactly. Idempotent, with stock-adjust rollback on partial failure. Status guard allows `New | In Preparation | Ready`.
- **Legacy (deprecate):** `POST /:id/swap-bouquet-line` at `orders.js:468` — **a duplicate route** with body `{ fromStockItemId, toStockItemId, lineId, newQty }`. Only used by the older `apps/florist/src/pages/SubstituteReconciliationPage.jsx`. Express matches whichever is declared first. **Delete the legacy handler (line 468+) and retire `SubstituteReconciliationPage.jsx`.**

## 4. Frontend changes (file-by-file)

### 4.1 `apps/florist/src/pages/ReconciliationPage.jsx`
- Already matches new contract. **One real bug** to fix: line 154 hardcodes `item.substitutes[0]` and line 98 always picks the first substitute. Per Q3=A (stack multiple), add a per-card substitute `<select>` dropdown.
  - Introduce `selectedSubByItem` state: `{ [originalStockId]: stockId }`, default to `item.substitutes[0].stockId`.
  - Render a `<select>` in the red/indigo header block (lines 168-176 area) populated from `item.substitutes`, showing `name (availableQty stems)`.
  - `handleBatchSwap` uses `selectedSubByItem[item.originalStockId]` instead of `item.substitutes[0]`.
  - Advanced: per-line override — add a small dropdown next to the stepper on lines 214-227 when `item.substitutes.length > 1`. Keep simple: one picker per card is enough for v1.
- ~30 LOC net addition.

### 4.2 `apps/dashboard/src/components/ReconciliationSection.jsx`
- Rewrite to consume new `{ items }` shape. Show a table/list of originals with their substitutes and affected lines. Per-line stepper for `swapQty`. Call `POST /orders/:id/swap-bouquet-line` per line.
- **Placement recommendation:** keep it as a section (surface) in Today tab (`DayToDayTab.jsx:562`) and StockTab (`StockTab.jsx:365`) — mirrors current placement, keeps owner's flow unchanged. Component fully rewritten.
- ~150-200 LOC. Copy the UX from `ReconciliationPage.jsx` closely for feature parity.

### 4.3 `apps/florist/src/pages/SubstituteReconciliationPage.jsx` + route at `App.jsx:102`
- Retire. Delete the route and the file; superseded by `ReconciliationPage.jsx`. Grep confirms no other link targets `/reconcile-substitutes`.

### 4.4 `apps/florist/src/pages/OrderListPage.jsx:236-239`
- Already reads `r.data.items?.length` — matches new shape. Verify the banner section below line 240 has a `<button onClick={() => navigate('/reconciliation')}>` wrapper for a tap target. Add if missing.

### 4.5 `apps/florist/src/hooks/useNotifications.js:68-72`
Already handles `substitute_reconciliation_needed`. Optional: add link to reconciliation screen in the toast. **Dashboard parity:** grep `apps/dashboard/src/**/*.js*` for `EventSource` / `substitute_reconciliation_needed`; if SSE wiring present, mirror the same block there.

### 4.6 Translations
`apps/florist/src/translations.js` already has all keys (lines 284-296, 828-840). `apps/dashboard/src/translations.js` — add equivalents for the rewritten section (`reconciliation`, `originalFlower`, `substituteFlower`, `swapSelected`, `swapComplete`, `noReconciliationNeeded`, `ordersNeedSwap`). EN + RU minimum. ~20 LOC per language.

## 5. Reusable utilities/helpers

- `backend/src/utils/batchQuery.js::listByIds` — batch read by IDs (already used at `stock.js:769`).
- `backend/src/utils/sanitize.js::sanitizeFormulaValue` — quote-safe `filterByFormula` values (see `stockOrders.js:561`).
- `backend/src/services/airtable.js::atomicStockAdjust` (line 107) — serialized stock writes; `swapBouquetLine` already calls it with rollback.
- `backend/src/services/orderService.js::swapBouquetLine` (line 491) — battle-tested swap logic. Do not re-implement.
- `backend/src/services/notifications.js::broadcast` — SSE fan-out.
- `backend/src/config/airtable.js::TABLES` — env-driven table ID constants.
- Shared translations proxy — already wired.

## 6. Risks and mitigations

1. **Route conflict on `/stock/reconciliation`** (highest). Today `ReconciliationSection.jsx:18` and `OrderListPage.jsx:237` both call the old drift handler; shapes differ. *Mitigation:* migrate the old handler and all three consumers **in the same PR**. Ship the backend change + `ReconciliationSection.jsx` rewrite + `ReconciliationPage.jsx` substitute-selector together. Verify no other callers via `Grep` for `/stock/reconciliation` + `reconciliation/apply`.
2. **Circular `Substitute For` links**. A substitute card could itself be substituted later. The query `{Substitute For} != ''` would then include the chain. Correct behavior, but can double-surface. *Mitigation:* dedupe originalIds before `listByIds`; skip any original that IS itself a substitute with qty > 0 to avoid double-surfacing (owner resolves chain leaf-to-root).
3. **Stale substitute card when zeroed out**. The filter `{Current Quantity} > 0` in 3.3 step 1 handles this — card drops off once drained.
4. **Two florists swap simultaneously**. The `swapBouquetLine` function's idempotency check (`orderService.js:521`) rejects double-swaps with 409. Frontend refreshes via `await fetchData()` after batch swap (line 115). Accept: rare, recoverable.
5. **SSE broadcast missed if backend restarts**. Reconciliation list is pull-based (`GET /stock/reconciliation` on page mount) — data isn't lost. Banner on `OrderListPage.jsx` re-polls on mount. Toast is advisory only.
6. **Airtable 5 req/sec saturation**. New handler makes ~5-7 sequential reads. At 1000-row maxRecords still fits. Done — `listByIds` already chunks, rate-limited queue in `airtable.js`.

## 7. Verification plan (owner-readable)

1. Restart backend → tail logs → confirm `[SCHEMA CHECK] OK — N expected fields verified` and that N has increased by 1 (the new `Substitute For`).
2. In Airtable, create a test Stock card "Rose TestOriginal" with Current Quantity = -5 (simulate negative demand).
3. Create a test customer order with one bouquet line: 5 stems of Rose TestOriginal. Required By = tomorrow.
4. Create a PO (`/purchase-orders`) with one line for Rose TestOriginal. Send → Shopping → evaluate with 0 accepted of the original, alt flower "Rose TestSubstitute" qty 5.
5. Submit evaluation → backend logs `[STOCK-ORDER] Created substitute stock card "Rose TestSubstitute"`. Confirm the substitute's `Substitute For` in Airtable points to Rose TestOriginal.
6. Florist app shows toast "⚠ 1 orders need flower swap". Open `/reconciliation`.
7. Card renders: Rose TestOriginal (-5) → Rose TestSubstitute (5 available). Affected line: the test order, qty 5, suggestedSwapQty 0.
8. Bump stepper to 5 → Swap Selected. Toast success.
9. Confirm: Rose TestOriginal qty = 0 (was -5, +5); Rose TestSubstitute qty = 0 (was 5, -5). Order line now references substitute, `Flower Name` = "Rose TestSubstitute". Order dropped to New (auto-revert from Ready).
10. Reload reconciliation screen → empty state "No substitutions to review".
11. Dashboard Today tab `ReconciliationSection` shows same lifecycle — add+swap+empty.

## 8. Rollout order

**Commit 1 (backend-only, safe to ship first):** schema validator update + `findOrCreateSubstituteStock` link writes. No field read yet — harmless if field doesn't exist because `catch(() => [])` in `dashboard.js:473` already handles that. Ship, watch logs for `[SCHEMA CHECK] OK`.

**Commit 2:** owner adds `Substitute For` field in Airtable UI. Backend restart picks up schema. Existing substitutes have empty `Substitute For` until new ones arrive — acceptable (Phase A only went live recently; backfill optional).

**Commit 3 (the big one, breaks old drift endpoint):** new `/stock/reconciliation` handler; deletion of `/stock/reconciliation/apply`; rewritten `ReconciliationSection.jsx`; per-substitute selector in `ReconciliationPage.jsx`; retire `SubstituteReconciliationPage.jsx` + its route; add dashboard translation keys. All consumers migrate simultaneously — no staged shape transition needed.

**Commit 4 (cleanup):** delete duplicate swap endpoint `orders.js:468` and the old `fromStockItemId` body variant. Only after Commit 3 proves in prod.

## Critical Files

- `backend/src/routes/stock.js:747` — replace handler
- `backend/src/routes/stockOrders.js:553` — populate `Substitute For` link
- `backend/src/services/airtableSchema.js:45` — add field to validator
- `apps/dashboard/src/components/ReconciliationSection.jsx` — rewrite to new shape
- `apps/florist/src/pages/ReconciliationPage.jsx:154` — per-card substitute selector for Q3=A
- `backend/src/routes/orders.js:468` — delete duplicate handler (Commit 4)
- `apps/florist/src/pages/SubstituteReconciliationPage.jsx` — retire
