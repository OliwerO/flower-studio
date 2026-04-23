# Backlog — Blossom Flower Studio

Features and improvements tracked against original build phases.

---

## Done

### Phase 1 — Backend Scaffold + Airtable CRUD
- [x] Express server with `p-queue` rate limiting (5 req/sec)
- [x] Airtable CRUD service (`list`, `getById`, `create`, `update`, `deleteRecord`, `atomicStockAdjust`)
- [x] PIN auth middleware (`X-Auth-PIN` header, role-based access)
- [x] CORS, error handling, health check endpoint

### Phase 2 — Florist App
- [x] 4-step order wizard (Customer → Bouquet → Details → Review)
- [x] Customer search + create (Name/Nickname/Phone/Link/Email)
- [x] Bouquet builder with live stock, price override, quantity controls
- [x] Delivery vs Pickup flow with date/time picker
- [x] Order list with status/date/source filters + order detail view
- [x] Status transitions with allowed-transitions validation
- [x] Stock panel (view, adjust, receive, write-off)
- [x] PWA manifest + app icons
- [x] Russian translations (bilingual EN/RU via Proxy)
- [x] Status change notifications via SSE (order_ready, new_order)
- [x] Time tracking per status (Prep Started At, Prep Ready At timestamps)
- [x] Bouquet summary on order cards
- [x] TextImportModal (AI text parsing via Claude Haiku)
- [x] Owner-only features (revenue card, margins, stock alerts, day summary)
- [x] Help panel (30 bilingual Q&As)
- [x] Stock evaluation page (PO quality review)
- [x] Shopping support page (owner monitors driver POs)

### Phase 3 — Delivery App
- [x] Driver login with per-driver PINs (Timur/Nikita/Dmitri)
- [x] Today's deliveries list grouped by status
- [x] Mark as delivered (cascades to order status)
- [x] Navigation link (Google Maps / Waze)
- [x] Driver notes field
- [x] Shared task board — drivers self-assign on completion
- [x] Delivery result picker (Success / Not Home / Wrong Address / Refused / Incomplete)
- [x] Map view with Leaflet + driver GPS location
- [x] Stock pickup page (driver shopping for POs)
- [x] SSE notifications (order_ready, stock_pickup_assigned)

### Phase 4 — Wix Webhook Integration
- [x] `POST /api/webhook/wix` with HMAC-SHA256 verification
- [x] Immediate 200 response + async processing
- [x] Customer matching by phone/email, auto-create if not found
- [x] Order + Lines + Delivery record creation
- [x] Deduplication by Wix Order ID
- [x] Webhook event logging to Airtable
- [x] SSE broadcast on new webhook order
- [x] Telegram notification to owner

### Phase 5 — Translation Integration
- [x] Claude Haiku translation service (`@anthropic-ai/sdk`)
- [x] Auto-translate order notes on creation (Notes Original → Notes Translated)
- [x] Non-blocking — failure copies original, logs error

### Phase 6 — Owner Dashboard: Day-to-Day
- [x] Today tab: revenue, order counts, pending deliveries
- [x] Low stock alerts with reorder thresholds
- [x] Negative stock items with needed-by dates
- [x] Deferred demand signals from future orders
- [x] Unpaid aging buckets
- [x] Key date reminders
- [x] Unassigned deliveries
- [x] Driver-of-day selector
- [x] Orders tab: full table with multi-filter, sort, bulk operations
- [x] New Order tab: 4-step wizard (same as florist)
- [x] Stock tab: list with velocity/days-of-supply, receive/write-off, negative filter, slow movers
- [x] Customers tab: search, CRM panel, churn risk, RFM segments

### Phase 7 — Owner Dashboard: Financial KPIs
- [x] Revenue / costs / margins dashboard
- [x] Monthly chart + weekly rhythm
- [x] Source breakdown + source efficiency
- [x] Top products with trend vs prior period
- [x] Flower pairings analysis
- [x] Prep time statistics
- [x] Supplier scorecard
- [x] Stock loss breakdown
- [x] Payment analysis + completion funnel
- [x] Inventory turnover
- [x] Customer metrics (RFM scoring)

### Phase 8 — SSE Notifications
- [x] SSE endpoint (`GET /api/events`)
- [x] Florist app: new_order, order_ready, stock_evaluation_ready events
- [x] Delivery app: order_ready, stock_pickup_assigned events
- [x] Dashboard app: new_order, order_ready events
- [x] Toast + sound notifications
- [x] Fallback polling on SSE disconnect

### Phase 9 — Polish + Testing + Deployment (partial)
- [x] Toast notifications (all 3 apps)
- [x] Loading states: skeleton screens (`Skeleton.jsx`)
- [x] Deployment configs: `vercel.json` per frontend, Railway for backend
- [x] README.md
- [x] Retry buttons on API failure
- [x] Form validation (required fields, price > 0, quantity > 0)

### Beyond Original Plan — Completed
- [x] **Settings tab** — centralized config (delivery fee, markup, driver cost, suppliers, categories, payment methods, storefront categories, delivery zones, time slots)
- [x] **Config persistence** — settings saved to Airtable App Config table (survives restarts)
- [x] **Audit V3** — 6 audit phases: stock safety, webhook logging, delivery results, driver-of-day, unpaid drill-down, flower pairings, prep time tracking, marketing spend, supplier scorecard, stock loss tracking, bulk operations, skeleton loading, KPI tooltips
- [x] **AI text parsing** — intake endpoint parses pasted customer messages (general + Flowwow mode)
- [x] **Bilingual UI** — Proxy-based EN/RU translations across all 3 apps
- [x] **Wix storefront integration** — public API, bidirectional product sync, Telegram alerts, oversell detection, Products tab in dashboard, category manager, delivery zones
- [x] **Negative stock system** — stock can go negative, amber warnings in bouquet builder, flowers needed section in Today tab
- [x] **Purchase Order system** — full PO lifecycle (Draft → Sent → Shopping → Evaluating → Complete), driver shopping flow, florist evaluation, batch tracking, SSE lifecycle events
- [x] **Deferred stock** — per-line toggle for future orders: "use current stock" vs "order new" demand signal
- [x] **Lot size** — inline-editable on stock items, driver sees "N packs × size" format
- [x] **Batch tracking** — new stock record when existing qty > 0, reuse when qty ≤ 0
- [x] **Telegram notifications** — new order alerts to owner
- [x] **Marketing spend tracking** — monthly log by channel
- [x] **Stock loss logging** — waste events with reason tracking
- [x] **Order editing** — bouquet composition editable after creation (add/remove flowers, return-to-stock or write-off, auto-revert status on owner edit)
- [x] **Add unlisted flowers** — bouquet builder can create new stock items mid-order (with optional supplier/cost/sell/lot)
- [x] **PO workflow: owner review step** — Shopping → Reviewing → Evaluating, owner can adjust before florist evaluates
- [x] **PO workflow: driver UX** — bigger buttons, status switchable, clearer prompts, alt flower name in Partial
- [x] **PO workflow: live SSE sync** — owner ↔ driver changes reflected instantly via SSE events
- [x] **PO workflow: florist evaluation** — shows cost price, qty needed, alt flower names, substitute info
- [x] **Dashboard: Kanban detail** — cards show bouquet, delivery address, time slot, driver
- [x] **Dashboard: orders bubble** — counts by Required By date (planned today), not Order Date
- [x] **Dashboard: driver-of-day cascade** — auto-assigns to all unassigned deliveries for today
- [x] **Dashboard Step2Bouquet key fix** — uses stable identity key (no quantity)
- [x] **Dark mode (florist app)** — system preference + manual toggle, iOS dark palette, ThemeContext
- [x] **Premade bouquets** (2026-04-11) — florist composes display bouquets without a customer; inventory view with "Sold"/"Return to stock" actions; match-to-client flow creates an order and consumes the premade; supports both paths (from inventory card or picked inside Step 2 of the new-order wizard). Cross-app parity on florist + dashboard. Backend: new `Premade Bouquets` + `Premade Bouquet Lines` tables, `premadeBouquetService.js`, 7 routes, 9 unit tests.
- [x] **Customer Tab v2.0** (2026-04-18 → 2026-04-20, PRs #101 + #102) — full CRM redesign so the owner stops reaching for Airtable. Split-view (list + detail pane on ≥1280px, slide-over `CustomerDrawer` below). Merged legacy + app order timeline with per-row expand exposing every raw Airtable field and cross-tab "Open in Orders tab" that focuses a single order (dismissable banner). Chip-based Key People over the flat `Key person 1/2` fields (survives future Postgres migration). Universal search + stackable composable filters (Segment, Language, Sex/Business, Communication, Order Source, Found us from, Has Phone/Instagram/Email/KeyPerson, Last order within N days, Min order count, Min total spend, Churn risk). Segment + Acquisition Source rows are clickable filter pills — same interaction model for both. Fixed the broken + Filter dropdown (multi-select picker now opens immediately). Timeline row shows delivery/pickup icon + Unpaid badge + color-coded status pill + richer description fallback chain. Backend: fixed `Segment (client)` / `Key person (Name + Contact details)` field-name aliases (was silently no-oping PATCHes), new `GET /customers/:id/orders` returns merged legacy + app with `{ source, date, description, amount, status, raw }`, `_agg` enrichment on `/customers` (`lastOrderDate`, `orderCount`, `totalSpend`) with 60s cache. Removed the Customer Health RFM strip per owner feedback (not useful). Deleted legacy `CustomerDetailPanel.jsx` (replaced by `CustomerDetailView.jsx`).

---

## To Do

### Phase 9 — Polish + Testing (remaining items)
- [ ] **Empty states with messages** — some views still show blank when data is empty (partial coverage)
- [ ] **Mobile responsiveness on actual devices** — verify florist on iPad, delivery on iPhone, dashboard on desktop
- [ ] **E2E test** — 5 orders through full lifecycle (delivery + pickup paths) against dev base
- [ ] **Phone format validation** — normalize phone numbers on input

### Premade Bouquets — v2 follow-ups
- [ ] **Edit premade lines** — surface `PUT /api/premade-bouquets/:id/lines` in the card UI so the florist can add/remove flowers without returning + re-creating the bouquet
- [ ] **Photo attachment** — add `Photo` attachment field + upload UI for display/advertising
- [ ] **Freshness warning** — highlight premade bouquets older than N days using `Created At`
- [ ] **Wix storefront sync** — project premade bouquets as purchasable products on the storefront (needs decision on Wix product identity, checkout flow, order source mapping)
- [ ] **Metrics** — track premade sell-through vs. return-to-stock rate per week, include in owner dashboard

### Phase 10 — Excel Migration Script
- [ ] **Import historical orders** — parse owner's Excel spreadsheets into App Orders + Order Lines
- [ ] **Map legacy customers** — match Excel customer names to existing Clients (B2C) records
- [ ] **Handle data quality** — missing fields, inconsistent naming, currency conversion

### Infrastructure
- [ ] **Go-live** — see `CHANGELOG.md` Go-Live Checklist (Airtable tables, env vars, deployment)
- [ ] **Custom domain** — e.g., app.blossomflowers.pl
- [ ] **Backup strategy** — scheduled Airtable data export
- [ ] **Error monitoring** — Sentry or similar for production error tracking
- [ ] **Wix Velo integration** — frontend consuming public API (blocked on pre-build checklist)
  - [ ] Restrict same-day delivery slots to "Available Today" bouquets only (Velo checkout logic)
  - [x] Hide "Available Today" nav item via Velo when `/api/public/categories` omits it (post-cutoff) — Velo helpers `getAvailableTodayMenuLabel()` + `isAvailableTodayActive()` added in `docs/wix-velo-categories.js` (2026-04-17)
  - [ ] Use `filteredTimeSlots` from `/api/public/delivery-pricing?date=` for Wix checkout time picker

### PO Substitution — Phase B (2026-04-08)
Phase A shipped: when driver brings a substitute, it lands as its own stock card
(find-by-name or create-new) with the REAL per-stem cost and sell price = cost × targetMarkup.
Primary Not-Found stays at 0 stems. Florist manually swaps in bouquet builder for affected orders.

Phase B v1 (built 2026-04-13): reconciliation screen for negative-stock-driven POs.
- [x] Trigger: `POST /:id/evaluate` detects substitutions and broadcasts `substitute_reconciliation_needed` SSE
- [x] UI: notification banner (SSE handler in `useNotifications.js`) + evaluation page shows impacted orders
- [x] Backend: `POST /orders/:id/swap-bouquet-line` — reassigns a bouquet line from original → substitute
- [x] Reconciliation screen: `SubstituteReconciliationPage.jsx` (florist) + `ReconciliationSection.jsx` (dashboard)
- [ ] Demand suppression: skip original from PO demand when substitute exists (deferred — needs STOCK_PURCHASES notes scanning)
- Kickoff prompt saved at: `scripts/prompts/phase-b-po-substitution-reconciliation.md`

Phase B v2 rewrite — server-side substitute pairing via `Substitute For` link (2026-04-20 → in progress):
- [x] **Commit 1** (PR #105, 2026-04-20) — `findOrCreateSubstituteStock` writes `Substitute For` link on both create and find branches so multiple substitutes can stack on one card. Schema validator updated at `airtableSchema.js:49`.
- [x] **Commit 2** (2026-04-21, owner-side) — `Substitute For` link-to-another-record field (multi-record → Stock) added to prod Airtable Stock table.
- [x] **Commit 3** (2026-04-22, branch `feat/phase-b-reconciliation-commit-3`) — rewrote `GET /stock/reconciliation` to substitute-aware shape (`{ items: [{ originalStockId, substitutes[], affectedLines[] }] }`) joining `Substitute For` links against non-terminal order lines; rewrote the only consumer `ReconciliationSection.jsx` with per-line Swap button (calls `POST /orders/:id/swap-bouquet-line`); deleted `POST /stock/reconciliation/apply`. Drift detection sacrificed — revisit as `/stock/drift` if owner asks.
- [ ] **Commit 4** — migrate florist `SubstituteReconciliationPage.jsx` to the same new endpoint for consistency (currently uses `/stock/committed` + in-memory pairing). Optional rename to `ReconciliationPage.jsx`.

### Wix Stock Sync — accurate inventory projection to storefront (2026-04-08) [WIX-STOCK-PROJECTION]
Currently Wix storefront does NOT track exact stock per product — it just knows "available" or "out of stock"
at a coarser level. After the PO substitution change (Phase A), this becomes more visible:
substitutes no longer silently fill in for the original, so the original can end up 0-stock more often.
- Full session to design exact-stock projection from Airtable Stock → Wix product inventory
- Needs: decision on how substitute flowers map back to Wix products (1:1 new product? linked as alternative? ignored?)
- Needs: decision on whether to expose "available with substitute" as a Wix state or keep it binary
- Related: `backend/src/services/wix.js`, `apps/dashboard/.../ProductsTab.jsx`
- Findable tag: `WIX-STOCK-PROJECTION` (search BACKLOG.md for this string)

### Known Issues (from PO system audit)
- [x] **Hardcoded strings in OrderDetailPanel** — bouquet editing buttons now use `t.xxx` translations (EN+RU)
- [ ] **Hardcoded strings** — scattered English strings not using `t.xxx` in DayToDayTab, DeliveryListPage
- [ ] **Hardcoded categories/units** — StockTab uses inline arrays instead of `useConfigLists`
- [ ] **StockPickupPage empty state** — shows `t.noDeliveries` instead of a stock-pickup-specific message

### Owner-notes + customer call + driver nav (2026-04-21)
- [x] Split owner-authored notes by audience: `Florist Note` (ORDERS) + `Driver Instructions` (DELIVERIES), each prominent on the right role's collapsed card; customer's note stays as `Notes Original`, driver's own note stays as `Driver Notes`.
- [x] Editable at every order stage from dashboard + florist app (no status gate) — owner can add a post-delivery note if needed.
- [x] Customer phone rendered as a one-tap `CallButton` on florist collapsed card, delivery collapsed card, and both detail views. Dashboard recipient phone is also a call link.
- [x] Delivery card: explicit "Details ▾" button for discoverable expand (card body still tappable).
- [x] Three-way navigation strip on delivery card + sheet: Google Maps / Waze / Apple Maps (text-address based — no geocoding).
- [ ] Consider adding a tiny `Florist Note` field to the new-order wizard Step 3 so the owner can capture it at creation time (today she has to open the order after creation).

### Tier 1 Bugs — Blocking Daily Operations (consolidated 2026-04-19)

Consolidated from two divergent sections ("2026-04-03" and "2026-04-07"
reports). Each item below was re-validated against the current code on
2026-04-19 with file:line or commit evidence.

#### Open / migration-blocking
- [x] **Owner edit-everything (MIGRATION-CRITICAL)** — fixed 2026-04-19. Owner can now edit the bouquet on an order in any status, including Delivered / Picked Up / Cancelled. Backend: `orderService.js:311-316` now bypasses the status gate when `isOwner === true`; Ready→New auto-revert still fires but never touches terminal statuses. UI: dropped `!isTerminal` guard on the edit-bouquet button in `OrderCard.jsx:382` (florist, gated by `isOwner` prop), `OrderDetailPage.jsx:289` (florist, role from `useAuth`), and `OrderDetailPanel.jsx:468` (dashboard, PIN-gated to owner at login). Covered by `backend/src/__tests__/editBouquetLines.test.js`.

- [x] **Flowers for future order not in negative stock** — fixed 2026-04-22. Root cause was that `orderService.js` never wrote the `Stock Deferred` field on order-line create (both `createOrder` line 120-127 and `editBouquetLines` new-line path line 508-515). The flag was only used locally to skip stock deduction. Dashboard's `/dashboard` endpoint filters `{Stock Deferred} = TRUE` on Order Lines, so deferred demand was invisible to "Flowers Needed". Also had a latent second bug: on reload + edit, the flag was gone, so a qty change on an originally-deferred line would double-deduct stock. Fix persists the flag conditionally on both create paths. Regression tests pinned in `editBouquetLines.test.js` (deferred = no stock adjust + field written; non-deferred = stock deducted + field omitted).

- [x] **Partial payment reopen shows flowers-only total** — fixed 2026-04-22. Dashboard `OrderDetailPanel.jsx:265` was computing `effectivePrice = (Price Override || lineTotal) + deliveryFee` with `lineTotal` derived from `o.orderLines` — which is stale/empty on a cancel+reopen, collapsing the total to just the delivery fee. Fix prefers the backend-enriched `Final Price` when not editing (matches the florist `OrderCard.jsx:115` summary pattern that already got this right). Parallel fix in florist `OrderCard.jsx:288` for the expanded-view `currentPrice` — it had a weaker variant of the bug (mitigated by `Sell Total` fallback, still vulnerable). While editing the bouquet, both paths still compute live from `editLines` so the grand-total badge tracks quantity changes.

#### Fixed & verified (2026-04-19 validation)
- [x] Orders not shown in "All Orders" (date filter) — `apps/dashboard/src/components/OrdersTab.jsx:61-74` defaults to `monthStart()`
- [x] Dashboard ↔ Delivery app status sync (SSE) — `backend/src/routes/orders.js:364-381` broadcasts `order_status_changed`; delivery + dashboard apps subscribe in `useNotifications.js`
- [x] Card text + notes lost after submit — `backend/src/services/orderService.js:85` writes `Greeting Card Text` onto the Order record (not the Delivery)
- [x] Postcard text not visible after accepting — `apps/florist/src/components/OrderCard.jsx:332-335, 715` renders card text in both collapsed and expanded views
- [x] Finished order stale after submit — `apps/florist/src/pages/NewOrderPage.jsx:293-295` resets form then navigates
- [x] Purchase orders can't be saved — `backend/src/routes/stockOrders.js:382-384` validates lines before create; save path works end-to-end
- [x] New order doesn't create negative stock — `backend/src/services/orderService.js:105-114` rejects orphan lines; `atomicStockAdjust(line.stockItemId, -line.quantity)` at `:137` creates negative rows
- [x] Florist app: black-on-grey unreadable — dark-mode variants on every `bg-gray-100` (OrderCard, Step3Details, buttons throughout)
- [x] Pink login button cut off — `apps/florist/src/pages/LoginPage.jsx:51` has `pb-16` for safe area
- [x] Florist + owner card text edit at any stage — `EditableCardText` in `OrderDetailPage.jsx:101-140` + `OrderDetailPanel.jsx:920` has no status guard
- [x] Date required, time optional — commit `e91083b` (2026-04-19) adds backend validation at `orders.js:277-279` + florist/dashboard `validateStep`; red `*` on both apps' Step3Details
- [x] Florist app: prominent notes on collapsed card — `OrderCardSummary.jsx:124-133` renders a distinct blue-bordered note banner
- [x] Orders tab sort: bidirectional — `OrdersTab.jsx:162-190, 312-317` wires `sortDir` toggle (↑/↓)
- [x] Order total wrong everywhere (missing delivery fee) — every display path uses `Final Price`, which `orders.js` enriches as `(Price Override ‖ sellTotal) + delivFee`
- [x] Florist date filter broken — `backend/src/routes/orders.js:55-58` applies `forDate` inside the `completedOnly` branch; `OrderListPage.jsx:125-127` sends it
- [x] "Lot Size" field unknown in dev Airtable — frontend correctly doesn't send from order creation; `airtableSchema.js:35` expects it in `STOCK_ORDER_LINES` only. Close once the dev base has the column added (infra hygiene, no code change).

#### Spin-off (discovered during 2026-04-19 validation)
- [ ] **Hardcoded `'Nikita'` driver fallback** — `backend/src/routes/stockOrders.js:471` uses the literal name instead of `getDriverOfDay()`. Separate from the "PO can't be saved" bug. Per the "hardcoded fallbacks" rule in CLAUDE.md, swap to `getDriverOfDay()`. Tier 2 cleanup.

### Tier 2 UX Fixes — Daily Friction (2026-04-03)
- [x] **Can't submit order without address** — fixed 2026-04-23 in PR #143. `orders.js:273` + `premadeBouquets.js:146` both dropped the required-address check on Delivery orders. Date still mandatory.
- [x] **Delivery date should be required** — fixed earlier (2026-04-19, commit `e91083b`). Backend at `orders.js:277-279` + florist/dashboard `validateStep`; red `*` on both apps' Step3Details.
- [x] **Time slots not in order** — fixed in PR #125 / commit `191a0df` (2026-04-22). `useConfigLists` now sorts delivery time slots chronologically.
- [x] **Delivery/pickup date not shown** — verified working 2026-04-23. Florist `OrderCardSummary.jsx:142` + `OrderCard.jsx:380` render `fmtDate(order['Delivery Date'] || order['Required By'])` on every card; dashboard shows the same in `OrdersTab.jsx` row.
- [x] **Sorting by delivery date not working** — verified working 2026-04-23. Dashboard `OrdersTab.jsx:170-180` sorts by `Delivery Date || Required By` with bidirectional toggle; florist `OrderListPage.jsx:62` default-sorts active orders by earliest needed.
- [x] **Cancelled status irreversible** — verified working 2026-04-23. `ALLOWED_TRANSITIONS['Cancelled'] = ['New']` in florist `OrderCard.jsx:44` + `OrderCardSummary.jsx:32` + `OrderDetailPage.jsx:29`, and the status-button loop renders transitions from that map. Clicking Cancelled reveals a `New` button that reopens the order. Backend comment at `statuses.js:19` confirms the exception.
- [x] **Florist should see important NOTE prominently** — fixed earlier (Tier 1 list). `OrderCardSummary.jsx:124-133` renders a distinct blue-bordered note banner.
- [x] **Total paid amount not shown** — fixed 2026-04-23 in PR #146. Collapsed card in florist (`OrderCardSummary.jsx`) + dashboard (`OrdersTab.jsx` price column) now shows `Оплачено X · Остаток Y` for Partial orders. Bouquet-edit raising the price on a Paid order surfaces an amber mismatch banner with two actions: `Collect remainder` (→ Partial + existing Payment 2 flow) and `Mark as fully paid` (→ bumps `Payment 1 Amount` to match new total). Backend now backfills `Payment 1 Amount` + `Method` when status flips to Paid via create or PATCH so the banner has a baseline. Legacy Paid orders with P1=0 stay silent.
- [x] **Show negative stock on top in stock tab** — confirmed working 2026-04-23 by owner.
- [ ] **Order edit: new flower should show full form** — cost, sell, lot size, supplier fields + create negative stock
- [x] **PO add planned date** — verified working 2026-04-23. Florist `PurchaseOrderPage.jsx:481` + dashboard `StockOrderPanel.jsx:585-587` render `Planned Date` in the collapsed PO view.
- [ ] **PO total cost by lot size** — if 7 needed but lot size 10, calculate cost for 10. Also: show aggregate PO total on creation so the owner knows how much cash the driver needs for suppliers.
- [ ] **Non-floral components in compositions** — foam, baskets, boxes, ribbons as addable materials separate from flower stock
- [ ] **Stock write-offs sortable** — filter by daily/weekly/monthly
- [ ] **Stock filter: in-stock only + by arrival date** — two filter modes
- [ ] **Technical stock bilingual names** — Dasha has the list of items
- [ ] **Different hourly rates for florists** — Standard, Wedding, Holidays (owner-activated)

### CRM & Relationship Intelligence (2026-04-03, after bug fixes)
- [ ] **Key People system** — new Airtable table (later PostgreSQL): linked to customer, tracks name, phone, relationship type (optional), notes. One key person can have multiple important dates.
  - **Important Dates sub-table**: linked to key person, stores date + date type (Birthday, Anniversary, Wedding, Name Day, Valentine's, Women's Day, Other) + notes
  - Architecture: 3-tier (Customer → Key People → Important Dates). Replaces flat Key person 1/2 fields. Migration script needed.
  - Dashboard: expandable key people cards in Customer Detail Panel
  - Florist: auto-match recipient to existing key people, offer to save new ones
  - Fixes bug: "Important Days" widget doesn't show which client/order reminder is based on
- [ ] **Order purpose/occasion tracking** — record reason for order (birthday, anniversary, corporate, etc.) for analysis and targeted campaigns
- [ ] **Standalone recipe/pricing tool** — florist can build bouquet recipe + calculate price without creating order

### Financial / Payment Tracking (2026-04-03)
- [ ] **Stripe refund handling** — track payment status, cancellation, refund reflected in system
- [ ] **Post-order website message** — change what customer sees after order even if payment failed (Wix-side)

### Database Migration — Airtable → PostgreSQL (2026-04-03, after features stabilize)
- [ ] **Migrate to PostgreSQL on Railway** — replace Airtable as primary database. Owner decision: all data managed through the app, no direct Airtable editing. Add on-demand export feature (to Airtable or Excel) for owner access.
  - Phase A: Stock + POs (most rate-limit pain)
  - Phase B: Orders + Lines + Deliveries
  - Phase C: Customers + Key People + Dates
  - Phase D: Config + Logs → decommission Airtable
  - Prerequisites: all Tier 1+2 bugs fixed, key features stable, migration planning session
  - Design principle: keep business logic in services/ (already done), centralize field names in config

### Post-Migration Follow-ups (blocked on having a real dev environment)
Items that could be shipped today as Airtable one-liners but are held back
because the fix touches a high-risk production-only integration (webhooks
with no replay safety net, or flows that depend on live Wix state). Pick
them up after the Postgres migration stands up a true dev/staging env.

- [ ] **Wix webhook — explicit delivery back-link write** — mirror the PR #144 fix (2026-04-23) into `backend/src/services/wix.js` line ~448. After `db.create(TABLES.DELIVERIES, { 'Linked Order': [order.id], ... })`, add `await db.update(TABLES.ORDERS, order.id, { 'Deliveries': [delivery.id] })`. Same Airtable eventual-consistency risk (back-link missing immediately after create) is theoretically present for Wix-webhook-created orders; the florist-created path was confirmed-and-fixed but Wix path wasn't validated because we have no way to replay a Wix webhook safely against production. Needs dev env to stage a webhook hit and verify the back-link lands before we push.
  - Findable tag: `WIX-BACKLINK`

### Promo & Event Features (2026-04-03)
- [ ] **Promo bouquets** — new order type: customer pays nothing, but flower cost (supplier) and courier cost are tracked as business expense. Add "Promo" option when creating a new order. Promo orders must still deduct stock, track supplier costs, and track courier payment — all flow into business cost reporting, not customer billing. Reporting should show promo orders separately from paid orders.
- [ ] **Seasonal event mode** — major feature requiring dedicated planning session. Two parts:
  - **Event operations UI** — separate quick-entry interface for high-volume peak days (Valentine's, Women's Day, etc.). Optimized for speed, event-specific metrics, composition planning starting ~3 weeks before event. Very different from standard order wizard.
  - **Event retrospective analysis** — per-event tracking: flowers used (species + qty), courier workload + pay per driver, full economics (revenue, flower cost, courier cost, profit), waste/overstock. Goal: plan next year using this year's data.
  - **Prerequisites:** Owner shares Excel files from 14.02 + 08.03 2026 for analysis. Additional cost categories TBD. Do NOT build without planning session.

### Open Investigation (2026-03-18)
- [ ] **Bouquet edit stock deduction** — user reports adding flowers via bouquet edit does not deduct from stock. Backend code looks correct (PUT /orders/:id/lines creates Order Line + calls atomicStockAdjust). Logging added to backend to capture next occurrence. May be a data type issue or frontend not sending stockItemId correctly. Check Railway logs after next test.
