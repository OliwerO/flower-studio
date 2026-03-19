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

### Open Investigation (2026-03-18)
- [ ] **Bouquet edit stock deduction** — user reports adding flowers via bouquet edit does not deduct from stock. Backend code looks correct (PUT /orders/:id/lines creates Order Line + calls atomicStockAdjust). Logging added to backend to capture next occurrence. May be a data type issue or frontend not sending stockItemId correctly. Check Railway logs after next test.

---

## Improvement Project — Code Quality & Reliability (2026-03-19)

Structured improvements to make the codebase more maintainable, reliable, and safe.
Keeping Airtable as the database. Ordered by impact × effort — do the cheap wins first.

### Wave 1 — Security & Crash Prevention (do first)

- [ ] **Fix SSE timing-unsafe PIN check** — `events.js` line 23 uses `allPins.includes(pin)` instead of `timingSafeEqual`. Extract shared `safeEqual()` to `backend/src/utils/auth.js`, use it in `middleware/auth.js`, `routes/auth.js`, and `routes/events.js`
- [ ] **Add `unhandledRejection` handler** — `backend/src/index.js` currently handles SIGTERM but not unhandled promise rejections. Add handler to log + exit cleanly
- [ ] **Add React Error Boundaries** — one per app wrapping the root. Catches component crashes, shows "something went wrong" instead of white screen. 3 small files
- [ ] **Fix dashboard `Promise.all` inconsistency** — `routes/dashboard.js` has partial `.catch(() => [])` coverage. Some queries missing catch = one failure kills entire dashboard load

### Wave 2 — Extract Shared Packages (biggest maintainability win)

Create `packages/shared/` in the monorepo with these modules (all currently duplicated):

- [ ] **`packages/shared/api/client.js`** — single API client (currently 3 identical copies in `apps/*/src/api/client.js`). Accept position config via param
- [x] **`packages/shared/components/Toast.jsx`** — single Toast component with `position` prop, local wrappers in each app
- [x] **`packages/shared/context/ToastContext.jsx`** — shared context, local re-exports in each app
- [ ] **`packages/shared/context/LanguageContext.jsx`** — nearly identical in all 3 apps, minor CSS diff in LangToggle
- [ ] **`packages/shared/context/AuthContext.jsx`** — florist/dashboard identical, delivery adds `driverName`. Support via optional field
- [x] **`packages/shared/utils/stockName.jsx`** — shared renderStockName, consumers updated in both apps
- [ ] **`packages/shared/utils/formatDate.js`** — only used in florist (not a dedup win yet)
- [x] **`packages/shared/utils/timeSlots.js`** — shared getAvailableSlots, consumers updated in both apps
- [x] **Wire up monorepo workspace** — add `packages/shared` to root `package.json` workspaces, update Vite configs for aliasing
- [x] **`packages/shared/hooks/useOrderEditing.js`** — shared bouquet editing hook used by OrderCard (florist) and OrderDetailPanel (dashboard)
- [x] **`packages/shared/utils/parseBatchName.js`** — shared utility, replaces 4 inline copies across florist + dashboard

### Wave 3 — Backend Consolidation

- [ ] **Extract `pickAllowed()` to `backend/src/utils/fields.js`** — currently duplicated in 5 route files (stock, deliveries, orders, floristHours, customers). Same 6-line function × 5
- [ ] **Extract `safeEqual()` to `backend/src/utils/auth.js`** — duplicated in `middleware/auth.js` + `routes/auth.js`. (Partially done if Wave 1 SSE fix is completed first)
- [ ] **Validate env vars on startup** — add required env var check in `index.js` before server starts. Currently no validation = silent failures when vars are missing
- [ ] **Batch OR formulas for large queries** — `orders.js` builds OR formulas with unbounded ID lists. Airtable has ~16KB formula limit. Add batching like `analytics.js` already does (lines 93-107)

### Wave 4 — Component Decomposition (large components)

- [ ] **Split `OrderCard.jsx` (838 lines, 13 useState hooks)** — break into: OrderCardSummary (~150), OrderCardExpanded (~300), BouquetEditor (~200), StockActionPanel (~150)
- [ ] **Split `SettingsTab.jsx` (1172 lines)** — break into: DeliveryZoneEditor, DriverSettings, CategoryEditor, TimeSlotSettings, SettingsTab wrapper (~200 lines each)
- [ ] **Deduplicate `OrderDetailPanel.jsx` (914 lines)** — shares ~70% logic with OrderCard.jsx. Extract shared order display/edit logic, compose differently per app
- [ ] **Split `ProductsTab.jsx` (899 lines)** — product list, product editor, category manager as separate components

### Wave 5 — Testing Foundation

- [ ] **Add ESLint config** — enforce import consistency, unused vars, hook rules. Catches bugs at write time
- [ ] **Backend unit tests** — priority targets: `safeEqual`, `sanitizeFormulaValue`, `atomicStockAdjust`, `pickAllowed`, order rollback logic
- [ ] **Frontend component tests** — Toast, AuthContext, useNotifications (small, isolated, high value)
- [ ] **API integration tests** — order creation + stock deduction, delivery status cascade, PIN auth flow. Use dev base
- [ ] **CI pipeline** — GitHub Actions: lint → test → build. Blocks broken code from deploying

### Wave 6 — Reliability & Observability

- [ ] **Error monitoring (Sentry)** — add to all 3 frontend apps + backend. Quick setup, huge value for catching production issues
- [ ] **Structured logging** — replace `console.error` with structured logger (pino). Add request IDs for tracing
- [ ] **SSE connection limits** — cap max connections per client in `notifications.js` to prevent memory exhaustion
- [ ] **Config shallow copy fix** — `settings.js` line 64 does `{ ...DEFAULTS }` (shallow). Nested mutations leak across requests. Use `structuredClone()` or deep merge
- [ ] **Order creation rollback hardening** — if rollback itself fails, log to dead-letter table for manual cleanup

### Progress Tracking

| Wave | Items | Status | Impact |
|------|-------|--------|--------|
| 1 — Security & Crashes | 4 | Not started | Prevents data loss + exploits |
| 2 — Shared Packages | 11 | In progress (7/11) | Halves maintenance burden |
| 3 — Backend Consolidation | 4 | Not started | Cleaner, safer backend |
| 4 — Component Decomposition | 4 | Not started | Enables testing + reuse |
| 5 — Testing Foundation | 5 | Not started | Catches bugs before users |
| 6 — Reliability | 5 | Not started | Production confidence |
