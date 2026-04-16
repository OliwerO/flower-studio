# Changelog — Blossom Flower Studio

Tracks all changes that may impact **go-live** (switching from dev base to production base).
Review this entire file before flipping to production.

---

## Schema Changes (Airtable)

Changes made to the **dev base** that must be replicated in **production** before go-live.

| Date | Table | Change | Applied to Prod? |
|------|-------|--------|:-:|
| 2026-03-05 | App Orders | Renamed `Deliveries` → `_Deliveries OLD`, `Deliveries 2` → `Deliveries` (duplicate link field fix) | ⚠️ Production field is already correct — no action needed |
| 2026-03-05 | App Orders | Renamed `Order Lines` → `_Order Lines OLD`, `Order Lines 2` → `Order Lines` (duplicate link field fix) | ⚠️ Production field is already correct — no action needed |
| 2026-03-09 | Webhook Log | New table for logging all incoming webhooks | ❌ |
| 2026-03-09 | Marketing Spend | New table for marketing cost tracking | ❌ |
| 2026-03-09 | Stock Loss Log | New table for waste/write-off tracking | ❌ |
| 2026-03-09 | App Settings | New table for persisted config (delivery fee, target markup, etc.) | ❌ |
| 2026-03-11 | Product Config | New table for Wix storefront product sync | ❌ |
| 2026-03-11 | Sync Log | New table for Wix ↔ Airtable sync history | ❌ |
| 2026-03-12 | Stock | New fields: `Lot Size` (Number, default 1) | ❌ |
| 2026-03-12 | Order Lines | New field: `Stock Deferred` (Checkbox) | ❌ |
| 2026-03-13 | Stock Orders | **New table** — PO header (Status, Created Date, Notes, Assigned Driver, Stock Order ID, Planned Date, Supplier Payments, Driver Payment, link: Order Lines → Stock Order Lines) | ✅ All fields exist |
| 2026-03-13 | Stock Order Lines | **New table** — PO lines (Flower Name, Quantity Needed, Lot Size, Driver Status, Supplier, Cost Price, Sell Price, Notes, Quantity Found, Quantity Accepted, Write Off Qty, Eval Status, Price Needs Review, Alt Supplier, Alt Quantity Found, Alt Flower Name, Alt Cost, Farmer, links: Stock Orders, Stock Item) | ✅ All fields exist |
| 2026-03-17 | Product Config | New fields: `Description` (Long text), `Translations` (Long text/JSON) | ✅ Already created |
| 2026-03-18 | Florist Hours | New field: `Rate Type` (Single line text) — stores rate type name per entry | ❌ |
| 2026-04-11 | Premade Bouquets | **New table** — standalone bouquet compositions the florist prepares before any order. Fields: `Name` (Single line text, required), `Created At` (Created time, auto), `Created By` (Single line text), `Price Override` (Number, optional), `Notes` (Long text), `Lines` (link → Premade Bouquet Lines). | ❌ |
| 2026-04-11 | Premade Bouquet Lines | **New table** — line items for a premade bouquet. Fields: `Premade Bouquet` (link → Premade Bouquets), `Stock Item` (link → Stock, required), `Flower Name` (Single line text), `Quantity` (Number), `Cost Price Per Unit` (Number, snapshot), `Sell Price Per Unit` (Number, snapshot). | ❌ |

### Env vars

Add to `.env.dev` and `.env` (before the feature ships):

```
AIRTABLE_PREMADE_BOUQUETS_TABLE=tbl...       # Premade Bouquets table ID
AIRTABLE_PREMADE_BOUQUET_LINES_TABLE=tbl...  # Premade Bouquet Lines table ID
```

---

## 2026-04-16 — PO Visibility Fix (partial qty + owner-added lines)

Three related symptoms in the PO flow collapsed onto the same root cause:
the florist's evaluation screen was only rendering lines whose `Driver Status`
was explicitly `Found All`, `Partial`, or `Not Found + alt qty`. Any line
where the owner entered a Qty Found (via Shopping Support) but did not tap
the status pill, or any line added mid-shopping through the "+ Add line"
button, stayed at `Pending` and was silently filtered out. Additionally,
the "+ Add line" button on both the dashboard and florist PO pages was
using a temp-local-line pattern that could drop the owner's entry on
refresh/navigate-away if the Flower Name wasn't filled first.

### Frontend — `apps/florist/src/pages/StockEvaluationPage.jsx`
- Evaluation filter (lines ~183-200) now includes any line with `Quantity Found > 0`
  **or** `Alt Quantity Found > 0`, regardless of `Driver Status`. Immediately
  rescues in-flight POs that had partial quantities stuck at `Pending`.
- `notFoundLines` tightened so it only shows lines with zero primary and zero alt.
- Alt-block render (line ~325) now shows whenever `altFound > 0`, even when
  `Alt Supplier` is blank (owner may have entered only the flower and qty).

### Frontend — `apps/florist/src/pages/ShoppingSupportPage.jsx`
- `ShoppingLineItem` auto-derives `Driver Status` on Qty Found / Alt Qty Found
  blur: `qty >= needed → Found All`; `0 < qty < needed → Partial`;
  `qty == 0 && altQty > 0 → Not Found`; `qty == 0 && altQty == 0 → no change`.
  Owner no longer has to tap the status pill for the florist to see her entries.
- New `AddExtraLineForm` component + `addExtraLine` handler — inline form with
  all four required fields (flower name, supplier, qty, cost) enforced up
  front; POSTs via `/stock-orders/:id/lines` and immediately stamps
  `Driver Status: Found All` + `Quantity Found = qty` so the florist sees the
  extra flower for evaluation. Visible only while PO is Sent/Shopping.

### Frontend — `apps/dashboard/src/components/StockOrderPanel.jsx` + `apps/florist/src/pages/PurchaseOrderPage.jsx`
- Replaced `addDraftLine` (temp-local-line) with `addPersistedLine` +
  `AddLineInlineForm`. Full fields required; POST fires only when all four
  are present. When the PO is already `Shopping`, the new line is auto-promoted
  to `Found All` + `Quantity Found` so the florist can evaluate it.
- Final overview (Reviewing/Evaluating/Complete read-only rows) now shows a
  grey "Не получено / Not received" chip on lines that stayed at `Pending`
  with no qty. Makes it obvious what slipped through so the owner can reconcile
  via Receive Stock if needed.

### Translations
- Dashboard + florist: added `addExtraFlower`, `addExtraHint`, `fillAllFields`,
  `lineAddedAndSent`, `notReceived`, `flowerNameLabel` (dashboard) /
  `shopping.flowerName`, `shopping.supplier` (florist).

### No schema or backend changes
Everything rides on existing endpoints:
- `POST /stock-orders/:id/lines` (already supports Draft/Sent/Shopping)
- `PATCH /stock-orders/:id/lines/:lineId` (always supported)
- `stock_order_line_updated` SSE broadcast (already fires) ensures the driver
  app refreshes when the owner adds/edits a line on a Sent PO.

### What to watch for
- The filter relaxation means ANY line with `Quantity Found > 0` is evaluable,
  even if Driver Status is `Not Found` (shouldn't happen, but be aware of
  the mismatch). Previously the owner had to tap a pill; now the qty alone
  is enough. If the florist complains about seeing lines she didn't expect,
  it's likely because the qty was saved but the owner never reconciled the
  pill — surface the qty in owner review, don't re-tighten the filter.
- Owner-added lines on a `Shopping` PO are auto-promoted to `Found All` even
  though no driver actually shopped them. Stock-wise this is fine (the flowers
  really were bought). For reporting, these lines will show `Assigned Driver`
  on the parent PO, not who physically bought them.

---

## 2026-04-11 — Premade Bouquets

A new flow that lets the florist compose bouquets **before** any order exists —
"display" bouquets prepared each day that walk-in clients or Instagram/Wix
buyers can later match to. Stock is deducted the moment the bouquet is built;
if nobody buys it the flowers are returned to stock; if a buyer is matched a
real order is created and the premade record is consumed (no re-deduction).

### Airtable (dev base)
Two new tables: `Premade Bouquets` and `Premade Bouquet Lines` (see schema
table above). Must be created in production before go-live.

### Backend
- `services/premadeBouquetService.js` (new) — `createPremadeBouquet`,
  `listPremadeBouquets`, `getPremadeBouquet`, `updatePremadeBouquet`,
  `returnPremadeBouquetToStock`, `matchPremadeBouquetToOrder`. All stock
  mutations run through the existing `atomicStockAdjust` queue so concurrent
  edits are serialized.
- `services/orderService.js:55` — `createOrder()` now accepts an internal
  `opts.skipStockDeduction` flag. Used only by the match flow, where the
  stock hold was already placed when the premade was built.
- `routes/premadeBouquets.js` (new) — 7 endpoints (`GET`, `POST`, `PATCH`,
  `PUT /lines`, `POST /return-to-stock`, `POST /match`).
- `middleware/auth.js:27` — added `premade-bouquets` resource; owner and
  florist allowed, driver blocked.
- `config/airtable.js` — two new `TABLES.PREMADE_BOUQUETS*` env-var hooks.
- `services/airtableSchema.js` — expected-fields validation for the two new
  tables (catches field-name drift at boot, not at runtime).
- `services/notifications.js` — three new SSE event types:
  `premade_bouquet_created`, `premade_bouquet_matched`,
  `premade_bouquet_returned`.
- `__tests__/premadeBouquetService.test.js` (new) — 9 unit tests covering
  create happy path, rollback, validation guards, return-to-stock, match-to-order
  (including confirmation that the match flow doesn't re-deduct stock and
  carries over the price override).

### Florist App (`apps/florist`)
- `pages/OrderListPage.jsx` — third FAB option ("Готовый букет" → new
  composition page); new "Готовые букеты" view-mode chip on the orders list
  with a live count badge; in that view the page renders a list of
  `PremadeBouquetCard` instead of `OrderCard`.
- `pages/PremadeBouquetCreatePage.jsx` (new, route `/premade-bouquets/new`) —
  name + notes + embedded `Step2Bouquet` picker + save button.
- `components/PremadeBouquetCard.jsx` (new) — expandable card with "Продано"
  and "Вернуть в склад" actions.
- `components/steps/Step2Bouquet.jsx` — accepts new `premadeBouquets` +
  `matchPremadeId` + `onSelectPremade` + `onUnlinkPremade` props. When a
  premade is locked in, the catalog and editable cart hide and a read-only
  composition preview replaces them.
- `pages/NewOrderPage.jsx` — fetches premade bouquets; handles
  `location.state.matchPremadeId` (Path A — "Sold" button on inventory) and
  the in-wizard "tap a premade" flow (Path B); on submit routes through
  `POST /api/premade-bouquets/:id/match` when locked.
- `hooks/useNotifications.js` — toasts for the three new SSE events.
- `App.jsx` — new route `/premade-bouquets/new`.

### Dashboard App (`apps/dashboard`)
Mirrors the florist parity per CLAUDE.md.
- `components/OrdersTab.jsx` — new "💐 Готовые букеты" chip; when active the
  tab renders `PremadeBouquetList` instead of the orders table.
- `components/PremadeBouquetList.jsx` (new) — expandable row list, matches
  the orders table density. Has a "+ Create premade bouquet" button in the
  header that opens `PremadeBouquetCreateModal`.
- `components/PremadeBouquetCreateModal.jsx` (new) — inline modal that
  reuses `Step2Bouquet` + name/notes/price fields for composition.
- `components/NewOrderTab.jsx` — accepts `initialFilter.matchPremadeId`;
  fetches available premades; Path A (from orders tab "Sold" button) and
  Path B (select premade inside Step 2) both route through the match
  endpoint on submit.
- `components/steps/Step2Bouquet.jsx` — same props + behavior as florist
  version (premade list on top, lock banner, read-only cart).
- `pages/DashboardPage.jsx` — passes `navigateTo` down to `OrdersTab` and
  `initialFilter` to `NewOrderTab` so cross-tab "Sold" navigation works.

### Translations
Added ~20 new keys per language to both `apps/florist/src/translations.js`
and `apps/dashboard/src/translations.js` (premade bouquet, inventory, match
to client, return to stock, locked banner, etc.).

### Known trade-offs
- **Florist can't edit a premade bouquet's line composition after save.**
  You can return it to stock and re-create it. Future work: surface the
  `PUT /api/premade-bouquets/:id/lines` endpoint in the card UI.
- **No Wix sync yet.** The bouquets live only in Airtable. If the owner
  wants to advertise them on the storefront we need a new sync integration.
- **No photo/advertised-text fields yet.** Name + notes only for v1.

---

## 2026-04-07 — Stock Workflow Hardening (orphan order/PO lines)

### Airtable (production base `appM8rLfcE9cbxduZ`)
- **Stock.Lot Size** — renamed to remove a trailing space. Symptom: `POST /api/stock` returned `UNKNOWN_FIELD_NAME: "Lot Size"`, breaking the florist "Add new flower" flow on iPad. Verified Airtable column was literally `Lot Size ` (one trailing space). No code change needed; just rename the column.
- **Stock.Farmer** — verified, no trailing space, no rename needed.

### Backend
- `services/orderService.js` — `createOrder` and `editBouquetLines` now hard-reject any new order line that ends up with `stockItemId === null` after `autoMatchStock` runs. Throws a 400 with the offending flower names. Rationale: orphan lines silently broke stock deduction, demand calc and PO generation.
- `routes/orders.js` — `POST /api/orders` now surfaces `statusCode === 400` errors verbatim instead of wrapping them as 500, so the dashboard/florist toast shows the real reason ("Create the flower in Stock first.").
- `routes/stockOrders.js` — `POST /:id/evaluate` now throws per-line if a PO line has any received/written-off quantity but no linked Stock Item. The existing partial-failure machinery flips the PO to `Eval Error` so the owner can fix the link and retry. Previously these lines were silently marked `Processed` and the flowers vanished from inventory.

### Dashboard (`apps/dashboard`)
- `components/steps/Step2Bouquet.jsx` — removed the silent `catch {}` fallback that pushed an inline order line with `stockItemId: null` whenever `POST /api/stock` failed. Now mirrors the florist app: shows the real error in a toast via `useToast`. This was the main producer of orphan order lines.

### Watch for
- Any historical Order Lines created via the dashboard "Add new" path between ~2026-03-16 and 2026-04-07 may already be orphans (no `Stock Item` link). They will not block new orders, but they are invisible to demand/stock calc. To find them in Airtable: filter Order Lines where `Stock Item` is empty.
- The new validation will reject orders that previously slipped through. If a florist hits "Order line(s) without a Stock Item are not allowed", the fix is to first add the flower in Stock (the same form they were already using), not to bypass the check.

---

## 2026-03-21 — Phase 4: Testing Foundation

### Backend
- **Vitest** added as test framework (`npm test` / `npm run test:watch`).
- **`vitest.config.js`** — sets dummy env vars so Airtable/auth imports don't crash during tests.
- **46 tests** across 3 test files, all passing in ~300ms:
  - `__tests__/utils.test.js` — `sanitizeFormulaValue` (formula injection prevention), `pickAllowed` (field whitelisting), `safeEqual` (timing-safe PIN comparison).
  - `__tests__/analyticsService.test.js` — 13 tests covering all pure computation functions: revenue, waste, funnel, product ranking, flower pairings, weekly rhythm, payment methods, prep time, inventory turnover, supplier scorecard, stock losses.
  - `__tests__/orderService.test.js` — `ALLOWED_TRANSITIONS` state machine: valid transitions, terminal states, legacy exits, full status coverage.

---

## 2026-03-21 — Phase 3: Input Validation + SSE Connection Limits

### Backend — Input Validation
- `routes/customers.js` — POST now validates Name/Nickname required, Phone type check, body goes through `pickAllowed` whitelist (was previously passing raw `req.body` to Airtable). PATCH rejects empty updates.
- `routes/floristHours.js` — PATCH rejects empty updates (already had POST validation).
- `routes/marketingSpend.js` — POST now validates: amount must be non-negative number, channel must be non-empty string, notes sanitized.

### Backend — SSE Connection Limits
- `services/notifications.js` — `addClient()` now enforces a max of 50 concurrent SSE connections (expected: ~7 users). Returns `false` when limit reached.
- `routes/events.js` — returns 503 when connection limit hit, preventing memory exhaustion from runaway reconnections or bot traffic.

---

## 2026-03-21 — Phase 2: ESLint, Service Layer Extraction, Logging Cleanup

### Backend — ESLint
- **New file `backend/eslint.config.js`** — ESLint 9 flat config with rules for: `no-unused-vars`, `no-undef`, `eqeqeq`, `prefer-const`, `no-async-promise-executor`, `require-atomic-updates`, `no-duplicate-imports`.
- Added `lint` and `lint:fix` scripts to `backend/package.json`.
- Auto-fixed 4 warnings (let→const, ==→===). Remaining 11 warnings are pre-existing and intentional.

### Backend — Service Layer Extraction
- **New file `backend/src/services/orderService.js`** — extracted business logic from `routes/orders.js`:
  - `createOrder()` — atomic order creation with rollback
  - `transitionStatus()` — status validation, cascade, broadcast
  - `cancelWithStockReturn()` — cancel + stock recovery
  - `editBouquetLines()` — bouquet editing with stock adjustments
  - `autoMatchStock()` — flower name → stock item matching
  - `ALLOWED_TRANSITIONS` — status state machine (now importable by tests)
- **New file `backend/src/services/analyticsService.js`** — extracted 14 pure computation functions from `routes/analytics.js`: `calculateRevenueMetrics`, `rankTopProducts`, `analyzeFlowerPairings`, `calculateWeeklyRhythm`, `calculateMonthlyBreakdown`, `calculateCompletionFunnel`, `analyzeSourceEfficiency`, `analyzePaymentMethods`, `calculatePrepTimeStats`, `calculateInventoryTurnover`, `buildSupplierScorecard`, `breakdownStockLosses`, etc.
- `routes/orders.js` — reduced from 710 to 290 lines (thin controller)
- `routes/analytics.js` — reduced from 570 to 230 lines (data fetcher + assembler)

### Backend — Logging Cleanup
- `routes/webhook.js` — removed `console.log` that dumped full Wix order payload (contained customer PII: names, phones, addresses, payment info). Key structure logging preserved.

---

## 2026-03-21 — Code Quality: Status Constants + Shallow Config Fix

### Backend
- **New file `backend/src/constants/statuses.js`** — centralized constants for all order, delivery, payment, PO, and stock loss statuses. Eliminates ~100 hardcoded status strings scattered across route files.
- **All route files** (`orders.js`, `dashboard.js`, `deliveries.js`, `analytics.js`, `stock.js`, `stockOrders.js`, `stockLoss.js`, `settings.js`, `intake.js`) now import and use status constants instead of string literals.
- **`settings.js`** — fixed shallow config copy bug: `{ ...DEFAULTS }` → `structuredClone(DEFAULTS)`. Previously, nested object mutations (e.g., `storefrontCategories.permanent`) could leak across requests.

---

## 2026-03-20 — Florist Display Restructure + Stock Shortfall Warnings

### Backend
- `GET /api/orders` — new `activeOnly` query param: returns all non-terminal orders (excludes Delivered/Picked Up/Cancelled), sorted by Required By ascending (earliest needed first)
- `GET /api/orders` — new `completedOnly` query param: returns terminal orders (Delivered/Picked Up/Cancelled), last 30 days by default, sorted by Required By descending
- `GET /api/stock/committed` — new endpoint: aggregates committed (deferred) quantities per stock item from future orders (Required By > today). Returns `{ stockId: { committed, orders } }`
- `POST /api/stock/:id/write-off` — removed `Math.min` cap: write-offs can now bring stock negative (intentional, signals demand gap for future orders)

### Florist App
- **Order list default view**: changed from date-filtered (today) to "Active" mode showing all non-terminal orders sorted by earliest needed. Calendar filter moved to "Completed" tab.
- **View mode toggle**: "Active" (default) vs "Completed" tabs. Active shows non-terminal orders. Completed shows last 30 days of terminal orders with optional date filter.
- **Status workflow**: added Accepted and In Preparation statuses with proper transitions, action buttons, styles, and translations (EN/RU)
- **Stock shortfall banner**: red warning banner on order list when any stock item has effective < 0 (current qty - committed from future orders)
- **Order card shortage indicators**: individual cards show red badges for flowers that have stock shortfalls
- **Stock panel**: shows committed quantities and effective stock per item. New "Shortfall" view filter with badge count. Supplier/price moved from collapsed row to expandable section for cleaner UI.
- **DatePicker**: calendar dropdown now uses portal rendering to prevent clipping by parent overflow containers
- **Flowers needed**: now computed from loaded orders instead of separate API calls

---

## Environment / Config Changes

| Date | File | Change | Go-Live Impact |
|------|------|--------|----------------|
| 2026-03-04 | `backend/.env` | Original production config — DO NOT EDIT | This IS the production config |
| 2026-03-04 | `backend/.env.dev` | Created — points to Blossom Dev base | Delete or ignore at go-live |
| 2026-03-04 | `backend/package.json` | `dev` script uses `--env-file=.env.dev` | Change to `--env-file=.env` or remove flag at go-live |
| 2026-03-04 | `backend/src/index.js` | Removed `import 'dotenv/config'` (replaced by `--env-file`) | No change needed — same flag works with `.env` |
| 2026-03-04 | `.gitignore` | Changed to `.env.*` glob pattern | Keep |
| 2026-03-04 | `scripts/seed-stock.js` | Removed `import 'dotenv/config'`, now uses `--env-file` | Run with `--env-file=.env` for production |
| 2026-03-08 | `apps/*/vercel.json` | Railway backend URL in Vercel rewrite configs | Set correct production Railway URL |
| 2026-03-09 | `backend/.env.dev` | Added `PIN_DRIVER_TIMUR`, `PIN_DRIVER_NIKITA`, `PIN_DRIVER_DMITRI` | Add per-driver PINs in production |
| 2026-03-11 | `backend/.env.dev` | Added `AIRTABLE_PRODUCT_CONFIG_TABLE`, `AIRTABLE_SYNC_LOG_TABLE`, `WIX_API_KEY`, `WIX_SITE_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID` | Add all Wix/Telegram env vars in production |
| 2026-03-12 | `backend/.env.dev` | Added `AIRTABLE_STOCK_ORDERS_TABLE`, `AIRTABLE_STOCK_ORDER_LINES_TABLE` | Add PO table IDs in production |

---

## Stock Visibility Overhaul (2026-04-13)

**6-part feature drop** improving stock supply chain visibility:
1. **Trace improvements**: delivery date + clickable order entries in stock trace (both apps)
2. **PO overview table** ("Pending Arrivals"): ordered vs committed flowers above stock table (both apps)
3. **PO substitution Phase B**: impacted orders during evaluation + reconciliation screen + swap endpoint + SSE notifications
4. **Waste log edit/delete**: PATCH + DELETE endpoints with stock restoration, inline UI in dashboard settings
5. **Stock reconciliation tool**: detect mismatches, let owner fix in bulk (dashboard)
6. **Translations**: all new keys in EN + RU for both apps

New endpoints: `PATCH/DELETE /stock-loss/:id`, `POST /orders/:id/swap-bouquet-line`, `GET /stock/reconciliation`, `POST /stock/reconciliation/apply`
New files: `PendingArrivalsSection.jsx` (both apps), `ReconciliationSection.jsx` (dashboard), `SubstituteReconciliationPage.jsx` (florist)
No schema changes — all existing Airtable fields.

---

## Code Changes Affecting Go-Live

| Date | File | Change | Go-Live Impact |
|------|------|--------|----------------|
| 2026-03-04 | `backend/src/services/airtable.js` | Added `typecast: true` to create/update | Keep — helps with new select values |
| 2026-03-04 | `apps/florist/src/components/steps/Step2Bouquet.jsx` | Stock oversell prevention | Keep |
| 2026-03-04 | `apps/florist/src/components/steps/Step3Details.jsx` | Payment method hidden when Unpaid | Keep |
| 2026-03-04 | `apps/florist/src/components/OrderDetailSheet.jsx` | New: order detail bottom sheet | Keep |
| 2026-03-04 | `apps/florist/src/pages/OrderListPage.jsx` | Orders clickable → detail sheet | Keep |
| 2026-03-05 | `backend/src/routes/orders.js` | Status transition validation + stock rollback on cancel | Keep |
| 2026-03-05 | `apps/florist/src/components/OrderDetailSheet.jsx` | Only show allowed next statuses, added "Picked Up" | Keep |
| 2026-03-05 | `backend/src/routes/orders.js` | Fixed field name `Assigned Delivery` → `Deliveries` (matches actual Airtable field) | Keep — same field name in production |
| 2026-03-20 | `backend/src/routes/orders.js` | Added `forDate` query param: unified OR filter on Order Date + Required By. Uses DATESTR() for timezone-safe matching. | Keep — fixes cross-app data consistency |
| 2026-03-20 | `apps/florist/src/pages/OrderListPage.jsx` | Florist now uses `forDate` to show orders placed on OR due on selected date, matching dashboard view | Keep |

---

## Development Log

### 2026-03-06

**Phase 3 — Delivery App + Phase 6 — Owner Dashboard**
- Delivery app: driver task board with self-assign model, map view, per-driver PINs (`48ea4c0`)
- Owner dashboard: day-to-day operations tab, new order tab, cross-app testing (`4d54192`)
- Shared delivery board — drivers self-assign on completion, not pre-assigned (`20ce237`)

### 2026-03-08

**Phase 7 — Financial KPIs + Phase 8 — SSE Notifications + Deployment**
- Phase 7: financial dashboard with RFM scoring, margin visibility, benchmarks (`45d03b9`, `55a378f`)
- Phase 8: SSE real-time notifications for Wix orders, florist + dashboard (`e7437f1`)
- Deployment: Vercel configs for frontends, Railway for backend (`952d242`)
- Dashboard intelligence: actionable metrics, best sellers, payment collection (`3db5fa7`)
- Customer tab: search, filters, clear button, acquisition source pills (`4618b5f`, `7c4f584`, `f53d126`)
- Security hardening: input sanitization, rate limiting, CORS (`40b8bba`, `11dea52`)
- Branding: Blossom logo icons, web app manifests (`edf276e`)

### 2026-03-09

**Phase 5 — Translation + Phase 9 — Polish + Audit V3 + Settings Tab**
- Phase 5: auto-translate order notes to Russian via Claude Haiku (`24fe060`)
- Phase 9: retry on error, README, error toasts, loading states (`c1f6421`)
- Audit V3 (6 phases): stock safety alerts, webhook logging, delivery results, driver-of-day, unpaid drill-down, flower pairings, prep time tracking, marketing spend, supplier scorecard, stock loss tracking, bulk order operations, skeleton loading, KPI tooltips (`0553b9f`, `4fed3f6`, `c1f49e6`, `2aa5859`, `affdd06`)
- Settings tab: centralized config, delivery fee, driver management, waste reasons (`8d7b488`, `125420d`)
- Bilingual UI (EN/RU): Proxy-based translations across all 3 apps (`d1ac8e6`, `e8c737a`)
- SSE expanded: notifications for all order events across all apps (`b5f1e23`)
- Backup driver PIN with daily name override (`87b0511`)
- Smart order intake: AI text parsing + expandable FAB (`98fd522`)
- Florist improvements: bouquet summary on cards, status-priority sort, order detail with customer info (`13c6dd6`, `ac10c14`, `5760ffd`)
- Security: role-based login restriction, webhook auth middleware (`debc525`, `2727ca1`)

### 2026-03-10

**Go-live prep**
- Removed translation feature (not needed for go-live) (`c04a8b8`)
- Comprehensive florist app tutorial — 30 bilingual Q&As (`4b40075`)

### 2026-03-11

**Wix Storefront Integration (Phases A+B)**
- Phase A1+A2: public API endpoints for Wix storefront (`550d3a1`)
- Phase A3: Wix ↔ Airtable bidirectional product sync (`d64c96a`)
- Phase A4+A5: Telegram alerts, oversell detection, sync failure alerts (`3f6f1a5`)
- Phase B1-B3: Products tab in dashboard — sync, review queue, suggested prices (`9c4fbdd`)
- Phase B4+B5: storefront category manager + delivery zones in Settings (`8b55b89`)
- Wix Available Today section in dashboard Today tab with variant size pills (`c3284e5`, `5151499`)
- Owner-only features in florist app: revenue card, margins, stock alerts, day summary (`4780b7a`)
- Settings config persisted to Airtable — survives server restarts (`3d25ea2`)
- Products tab fixes: category pills, key flower dropdown, available today filter (`08708c7`, `c927567`, `b339843`)

### 2026-03-12

**Negative Stock + Purchase Order System + Stock Improvements**
- Full PO system: negative stock allowed, PO CRUD, driver shopping, florist evaluation, SSE lifecycle events (`a4da7a0`)
- PO system hardening: 2 bugs, 6 HIGH, 13 MEDIUM issues fixed (double-evaluate guard, formula injection, batch logic, N+1 calls, role auth, status transitions) (`a4da7a0`)
- Deferred stock: per-line toggle for future orders — "use current stock" vs "order new" demand signal (`a4da7a0`)
- Lot size on stock items: driver sees "2 packs × 25" format (`a4da7a0`)
- Batch tracking: new stock record when qty > 0, reuse when qty ≤ 0 (`108b060`)
- Dashboard: sorting improvements, auto-refresh across tabs (`108b060`)
- Smart refresh: silent polling without UI disruption (`66d70e6`, `0eff88f`)
- Order IDs visible, unpaid payment banners, florist auto-refresh (`029a4f9`)
- Waste tracking redesign: supplier-grouped log + financial scorecard (`9b7a8a6`, `d645bc3`)
- Reorder threshold synced across all batches of same flower (`90a970f`)
- Florist: 5 UI improvements, card message display, European date format for batch labels (`58ce496`, `5a0e431`, `615b5b9`)
- Various fixes: depleted batch visibility, card message truncation, delivery/pickup date display (`c3698d5`, `df57145`, `1e977c4`)

### 2026-03-13

**PO System Polish + Order Form Alignment**
- Dashboard order form aligned with florist: time slot pills + payload fix (`baf4761`)
- Flowers needed section moved to bottom of Today tab + height capped (`818b64a`, `0ac41b5`)
- PO form: searchable stock dropdown for adding lines (`149ad93`)
- Shopping support page + role-based florist navigation (`2e3535a`)
- Stock Orders + Stock Order Lines Airtable setup CSVs added (`65e33d9`)
- Fixes: review step shows date/time/card text for both Pickup and Delivery (`896a0d8`)
- Fixes: removed Delivery Time from order record (field only on Deliveries table) (`58658de`)
- Fixes: removed Stock Deferred field write (not yet created in Airtable) (`25a00f2`)
- Fixes: PO dropdown overflow, negative stock query destructuring order (`0ac41b5`, `b7010d1`)

### 2026-03-14

**PO Owner Feedback — Blocks A-D**
- Block A: Kanban cards show bouquet/address/time/driver, orders bubble counts by Required By date, driver-of-day auto-assigns unassigned deliveries, alt field labels clarified (EN+RU), PO creation bugs fixed (`934dd5a`)
- Block B: Add unlisted flowers to bouquet builder (creates stock record with optional supplier/cost/sell/lot), edit bouquet after order creation with return-to-stock or write-off choice, auto-revert Ready→In Preparation on owner edit (`38f894e`)
- Block C: Driver PO UX overhaul (bigger buttons, always visible, status switchable), live SSE sync between owner and driver, new Reviewing status (Shopping→Reviewing→Evaluating), owner approve-review step, florist evaluation shows cost price/qty needed/alt flower names (`4c8af85`)
- Block D: Florist app dark mode — system preference + manual toggle, iOS-style dark palette, ThemeContext with localStorage persistence (`259c67f`)

### 2026-03-17

**Available Today + Product Descriptions + Wix Push Fixes**
- Available Today infrastructure: cutoff config (18:00 default), smart time slots in order forms, Telegram reminder at cutoff (`60f77ce`, `51c4cea`)
- Available Today category: requires explicit Category assignment + lead time 0 + stock check for Wix push (`c18b5cc`)
- Product descriptions: pull from Wix (HTML→plain text), edit in dashboard, translate to 4 languages via Claude Haiku, push to Wix (plain text→HTML) (`d98e7cd`, `fb02012`, `2f0f3d0`)
- ProductDescriptionEditor component: inline description editing with language tabs (EN/PL/RU/UK) matching category translation pattern (`d98e7cd`)
- Smart time slots: both dashboard + florist order forms gray out past delivery slots when date=today, auto-clear invalid selection on date change (`60f77ce`)
- Settings: Available Today cutoff time + slot lead time controls in Settings tab (`60f77ce`)
- Fix: Wix variant price push — endpoint changed from `/variants/{id}` to `/variants` with ID in body (`60f77ce`)
- Fix: Airtable Description/Translations fields must exist before read/write (`854cb2d`, `c09ad81`, `afdf501`)
- Wix setup: owner created "Available Today" category + page in Wix Editor
- Airtable: Description + Translations fields added to Product Config table

### 2026-03-18

**Bouquet Editing Overhaul + Batch Grouping + Translation Fixes**
- Kanban board fix: expand/collapse wasn't working due to truthy empty array (`173ae09`)
- Sell price auto-calc: entering cost price auto-fills sell using `targetMarkup` (×2.2) — dashboard OrderDetailPanel, dashboard Step2Bouquet, florist Step2Bouquet (`173ae09`)
- Bouquet edit UX: now matches new order wizard — per-line sell price × qty, running sell/cost totals with margin, +/− stepper buttons (`840b950`)
- Stock picker in bouquet edit: shows stock catalog immediately (no typing required) — dashboard shows cost/sell/qty, florist shows sell/qty only (`173ae09`)
- Batch grouping: negative stock in "Flowers Needed" section now grouped by `Purchase Name` (flower type), not by individual batch. "Tulip Red" + "Tulip Red (14.Mar.)" merge into one demand line (`173ae09`)
- Batch date tags: date suffixes like `(14.Mar.)` shown as subtle gray tags in stock pickers instead of embedded in flower name — all 4 bouquet builder views (`173ae09`)
- "Add flower" feature added to florist bouquet edit mode (was missing entirely) (`173ae09`)
- "Adjust PO" option: when removing flowers with negative stock, offers "Adjust purchase order" instead of "Write off" (`173ae09`)
- Double question fix: remove dialog and save dialog no longer both ask return/write-off for the same flowers (`840b950`)
- Missing translations: 8 keys added to dashboard + florist (EN+RU): editBouquet, addFlower, saveBouquet, bouquetUpdated, addToCart, returnOrWriteOff, adjustPO, notReceivedYet (`173ae09`)
- Backend logging: stock deduction during bouquet edits now logs to console for debugging (`840b950`)

### 2026-03-19

**Wave 2 — Shared Packages (partial)**
- Created `packages/shared/` monorepo workspace with `@flower-studio/shared` package
- Extracted `useOrderEditing` hook — shared bouquet editing state + business logic, used by both florist `OrderCard` and dashboard `OrderDetailPanel`. Eliminates ~200 lines of duplicated state management + save logic
- Extracted `parseBatchName` utility — replaces 4 inline copies across florist + dashboard
- Added new translation keys: `returnOrWriteOff`, `adjustPO`, `notReceivedYet`, `addNewFlower`, `addToCart`, `markup`, `deliveryMethod`, `deliveryMethodDriver/Taxi/Florist`, `taxiCost`
- Dashboard `OrderDetailPanel`: removed inline editing state (8 useState hooks), replaced with shared hook
- Florist `OrderCard`: removed inline editing state (7 useState hooks), replaced with shared hook
- Florist `OrderDetailPage`: replaced inline `parseBatchName` with shared import

---

## Go-Live Checklist

- [ ] Create all new Airtable tables in production (Webhook Log, Marketing Spend, Stock Loss Log, App Settings, Product Config, Sync Log, Stock Orders, Stock Order Lines)
- [x] **Stock Orders table** — all fields exist (Status, Created Date, Notes, Assigned Driver, Stock Order ID, Planned Date, Supplier Payments, Driver Payment, link: Order Lines)
- [x] **Stock Order Lines table** — all fields exist (Flower Name, Quantity Needed, Lot Size, Driver Status, Supplier, Cost Price, Sell Price, Notes, Quantity Found, Quantity Accepted, Write Off Qty, Eval Status, Price Needs Review, Alt Supplier, Alt Quantity Found, Alt Flower Name, Alt Cost, Farmer, links: Stock Orders, Stock Item)
- [ ] Add new fields to existing tables (Stock: Lot Size, Farmer; Order Lines: Stock Deferred)
- [ ] Apply all schema changes from "Schema Changes" table above to production base
- [ ] Set all new env vars in Railway (per-driver PINs, Wix API, Telegram, PO table IDs)
- [ ] Set correct Railway backend URL in all Vercel rewrite configs
- [ ] Grep codebase for `fld` — ensure no hardcoded field IDs
- [ ] Verify all Airtable select options exist in production (Source, Status, Payment, etc.)
- [ ] Switch backend to production env: `--env-file=.env` (or remove flag)
- [ ] Seed stock in production base (if not already there)
- [ ] Test one order end-to-end against production (delivery + pickup paths)
- [ ] Test PO lifecycle: Draft → Sent → Shopping → Evaluating → Complete
- [ ] Test deferred stock flow: future order → demand signal → PO
- [ ] Verify Telegram alerts reach owner
- [ ] Remove or archive `.env.dev`
