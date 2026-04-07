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

---

## To Do

### Phase 9 — Polish + Testing (remaining items)
- [ ] **Empty states with messages** — some views still show blank when data is empty (partial coverage)
- [ ] **Mobile responsiveness on actual devices** — verify florist on iPad, delivery on iPhone, dashboard on desktop
- [ ] **E2E test** — 5 orders through full lifecycle (delivery + pickup paths) against dev base
- [ ] **Phone format validation** — normalize phone numbers on input

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
  - [ ] Hide "Available Today" nav item via Velo when `/api/public/categories` omits it (post-cutoff)
  - [ ] Use `filteredTimeSlots` from `/api/public/delivery-pricing?date=` for Wix checkout time picker

### Known Issues (from PO system audit)
- [x] **Hardcoded strings in OrderDetailPanel** — bouquet editing buttons now use `t.xxx` translations (EN+RU)
- [ ] **Hardcoded strings** — scattered English strings not using `t.xxx` in DayToDayTab, DeliveryListPage
- [ ] **Hardcoded categories/units** — StockTab uses inline arrays instead of `useConfigLists`
- [ ] **StockPickupPage empty state** — shows `t.noDeliveries` instead of a stock-pickup-specific message

### Tier 1 Bugs — Blocking Daily Operations (2026-04-03)
- [ ] **Orders not shown in "All Orders"** — created & submitted order appears in CRM but not order list
- [ ] **Dashboard ↔ Delivery app status sync** — orders marked delivered in dashboard stay as "New" on iPhone delivery app (SSE sync issue)
- [ ] **Card text + notes lost after submit** — Greeting Card Text and important notes disappear after order submission (order 202603-038)
- [ ] **Postcard text not visible after accepting** — even when text entered while accepting order, not visible once submitted
- [ ] **Finished order stale after submit** — order stays on screen after submission, doesn't refresh
- [x] **Florist "Add new flower" fails** — Airtable rejected `Lot Size` because the column on Stock had a trailing space (`appM8rLfcE9cbxduZ`). Renamed in Airtable, no code change. (2026-04-07)
- [x] **Dashboard silently created orphan order lines** — `apps/dashboard/.../Step2Bouquet.jsx` had a `catch {}` that pushed lines with `stockItemId: null` whenever stock create failed. Now shows the real error toast and `orderService.createOrder` / `editBouquetLines` reject orphan lines server-side. (2026-04-07)
- [x] **PO evaluate silently dropped lines without Stock Item** — `routes/stockOrders.js` `/evaluate` skipped the receive-into-stock block when a line had no Stock link, marking it `Processed` while the flowers vanished. Now throws per-line so the PO flips to `Eval Error` and the owner can fix the link. (2026-04-07)
- [ ] **Purchase orders can't be saved** — PO save fails, blocks entire PO workflow
- [ ] **New order doesn't create negative stock** — submitting order does not generate negative stock entries
- [ ] **New flowers for future order not in negative stock** — flowers added to future order don't appear in negative stock view
- [ ] **Florist app: black on grey unreadable** — text contrast too low, can't read on device
- [ ] **Pink login button cut off** — button not fully visible on some screens

### Tier 2 UX Fixes — Daily Friction (2026-04-03)
- [ ] **Can't submit order without address** — address should be optional (sometimes unknown until delivery day)
- [ ] **Delivery date should be required** — date required, time and address optional
- [ ] **Time slots not in order** — sorting broken in time slot picker
- [ ] **Delivery/pickup date not shown** — date missing from order display
- [ ] **Sorting by delivery date not working** — sort function broken
- [ ] **Cancelled status irreversible** — clicking Cancelled can't be changed back
- [ ] **Florist should see important NOTE prominently** — notes not visible on order front page
- [ ] **Total paid amount not shown** — only flower price visible, not full order total
- [ ] **Show negative stock on top** in stock tab
- [ ] **Order edit: new flower should show full form** — cost, sell, lot size, supplier fields + create negative stock
- [ ] **PO add planned date** — visible in collapsed PO view
- [ ] **PO total cost by lot size** — if 7 needed but lot size 10, calculate cost for 10
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

### Promo & Event Features (2026-04-03)
- [ ] **Promo bouquets** — new order type: customer pays nothing, but flower cost (supplier) and courier cost are tracked as business expense. Add "Promo" option when creating a new order. Promo orders must still deduct stock, track supplier costs, and track courier payment — all flow into business cost reporting, not customer billing. Reporting should show promo orders separately from paid orders.
- [ ] **Seasonal event mode** — major feature requiring dedicated planning session. Two parts:
  - **Event operations UI** — separate quick-entry interface for high-volume peak days (Valentine's, Women's Day, etc.). Optimized for speed, event-specific metrics, composition planning starting ~3 weeks before event. Very different from standard order wizard.
  - **Event retrospective analysis** — per-event tracking: flowers used (species + qty), courier workload + pay per driver, full economics (revenue, flower cost, courier cost, profit), waste/overstock. Goal: plan next year using this year's data.
  - **Prerequisites:** Owner shares Excel files from 14.02 + 08.03 2026 for analysis. Additional cost categories TBD. Do NOT build without planning session.

### Tier 1 Bugs — Blocking Daily Operations (2026-04-03)
- [x] **Card text + notes lost after submit** — was saving to wrong table (Delivery instead of Order). Fixed: save to Order, added card text for pickup orders
- [x] **Dashboard ↔ Delivery app status sync** — SSE broadcast for all status changes, Order→Delivery cascade, visibility-change refresh
- [x] **New order doesn't create negative stock** — removed silent text-only fallback, show error if stock creation fails
- [x] **Deferred demand not visible** — dashboard now shows deferred demand in Flowers Needed section
- [x] **Finished order stale after submit** — form reset added before navigation
- [x] **Orders not shown in "All Orders"** — default date filter changed to month start
- [x] **Florist app: black on grey unreadable** — dark mode variants added to all bg-gray-100 elements
- [x] **Pink login button cut off** — bottom padding added for iPhone safe area
- [x] **Dashboard build error** — pre-existing syntax error in OrderDetailPanel ternary fixed
- [ ] **Orders not shown in "All Orders"** — created & submitted order appears in CRM but not order list (verify after deploy)
- [ ] **Dashboard ↔ Delivery app status sync** — orders marked delivered in dashboard stay as "New" on iPhone (verify after deploy)
- [ ] **Purchase orders can't be saved** — PO save fails (verify after deploy — may be fixed by prior commit 6697aa3)

### Tier 2 UX Fixes — Daily Friction (2026-04-03)
- [ ] **Can't submit order without address** — address should be optional (sometimes unknown until delivery day)
- [ ] **Delivery date should be required** — date required, time and address optional
- [ ] **Time slots not in order** — sorting broken in time slot picker
- [ ] **Delivery/pickup date not shown** — date missing from order display
- [ ] **Sorting by delivery date not working** — sort function broken
- [ ] **Cancelled status irreversible** — clicking Cancelled can't be changed back
- [ ] **Florist should see important NOTE prominently** — notes not visible on order front page
- [ ] **Total paid amount not shown** — only flower price visible, not full order total
- [ ] **Show negative stock on top** in stock tab
- [ ] **Order edit: new flower should show full form** — cost, sell, lot size, supplier fields + create negative stock
- [ ] **PO add planned date** — visible in collapsed PO view
- [ ] **PO total cost by lot size** — if 7 needed but lot size 10, calculate cost for 10
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

### Open Investigation (2026-03-18)
- [ ] **Bouquet edit stock deduction** — user reports adding flowers via bouquet edit does not deduct from stock. Backend code looks correct (PUT /orders/:id/lines creates Order Line + calls atomicStockAdjust). Logging added to backend to capture next occurrence. May be a data type issue or frontend not sending stockItemId correctly. Check Railway logs after next test.
