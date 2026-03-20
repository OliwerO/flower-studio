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
| 2026-03-13 | Stock Orders | **New table** — PO header (Status, Supplier, Driver, Notes, Supplier Payments) | ❌ |
| 2026-03-13 | Stock Order Lines | **New table** — PO lines (Stock Item, Qty Needed, Lot Size, Driver Status, Eval Status, Price Needs Review) | ❌ |
| 2026-03-17 | Product Config | New fields: `Description` (Long text), `Translations` (Long text/JSON) | ✅ Already created |
| 2026-03-18 | Florist Hours | New field: `Rate Type` (Single line text) — stores rate type name per entry | ❌ |

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
- [ ] Add new fields to existing tables (Stock: Lot Size; Order Lines: Stock Deferred)
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
