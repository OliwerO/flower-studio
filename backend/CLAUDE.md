# Backend — CLAUDE.md

Express API + Airtable services. All business logic lives here — frontends are thin clients.

## Architecture
```
src/
  routes/          → Thin HTTP controllers (req/res only)
  services/        → Business logic, integrations, computations
  repos/           → Data-access layer for Postgres cutovers (Phase 3+ migration)
  db/              → Drizzle schema, migrations, audit log, actor context
  middleware/      → Auth (PIN), error handler
  constants/       → Status enums (statuses.js) — single source of truth
  config/          → Airtable table names (env-driven)
  utils/           → sanitize, batchQuery, fields, auth helpers
  __tests__/       → Vitest test files (unit + pglite integration)
scripts/           → Backfill, shadow-health, start-test-backend, etc.
```

## Routes (src/routes/)
| File | Endpoints | Purpose |
|------|-----------|---------|
| auth.js | POST /auth/verify | PIN validation with rate limiting (5 attempts/15min) |
| orders.js | GET/POST/PATCH/DELETE /orders | Order CRUD + status transitions + delivery cascade. Delegates to orderRepo when ORDER_BACKEND ≠ airtable. |
| customers.js | GET/POST/PATCH /customers, GET /customers/insights | CRM + RFM segmentation |
| stock.js | GET/POST/PATCH /stock, GET /stock/velocity | Inventory + velocity forecasting. Delegates to stockRepo when STOCK_BACKEND ≠ airtable. |
| deliveries.js | GET/PATCH /deliveries | Driver assignments + status cascade to orders |
| stockOrders.js | Full CRUD /stock-orders | PO lifecycle: create, send, shop, review, evaluate |
| stockPurchases.js | POST /stock-purchases | Record supplier deliveries with batch tracking |
| stockLoss.js | GET/POST /stock-loss | Waste logging by reason |
| premadeBouquets.js | CRUD /premade-bouquets | Premade bouquet templates (composed of stock items) |
| dashboard.js | GET /dashboard | Today's operational summary for owner |
| analytics.js | GET /analytics | Financial KPIs with period comparison |
| settings.js | GET/POST /settings | App config persistence (Airtable App Config table). Also exports `getConfig`/`getDriverOfDay`/`generateOrderId` — TODO move to `services/appConfig.js`. |
| products.js | POST /products/pull\|push\|sync\|translate, GET /products/push/status/:jobId | Bidirectional Wix product sync. Push runs as an async job (see `wixPushJob.js`) — POST /push returns 202 + jobId, the modal polls /push/status. /push/sync is the legacy synchronous variant kept for curl debugging. |
| productImages.js | POST/DELETE /products/:wixProductId/image | Bouquet image upload (florist+owner) and removal (owner only). Orchestrates Wix Media upload + Wix Stores attach via `wixMediaClient.js`, persists URL via `productRepo`, audits as `image_set` / `image_remove`, broadcasts SSE `product_image_changed`. |
| webhook.js | POST /webhook/wix | Wix order webhook (HMAC-SHA256 verified) |
| intake.js | POST /intake/parse | AI-powered order parsing (Claude Haiku) |
| events.js | GET /events | SSE real-time broadcast (max 50 clients) |
| public.js | GET /public/* | Unauthenticated endpoints for Wix storefront (60s cache) |
| floristHours.js | CRUD /florist-hours | Florist payroll time tracking |
| marketingSpend.js | GET/POST /marketing-spend | Ad spend tracking by channel |
| admin.js | GET /admin/* | Migration health, parity dashboards, audit log viewer (owner only) |
| test.js | POST /test/reset, GET /test/state, /test/audit, /test/parity | Test-harness only — mounted iff `TEST_BACKEND=mock-airtable` |

## Services (src/services/)
| File | Purpose |
|------|---------|
| airtable.js | Core CRUD with rate-limited queue (5 req/sec). Stock changes serialized via 1-concurrency queue. Delegates to mock or real driver based on `TEST_BACKEND`. |
| airtable-real.js | Real Airtable SDK wrapper. |
| airtable-mock.js | In-memory Airtable replacement used by the test harness. |
| airtable-mock-formula.js | `filterByFormula` evaluator for the mock — supports the formula subset routes actually use. |
| __fixtures__/ | Seed data + sample records for the mock (used by harness + integration tests). |
| airtableSchema.js | Startup validation — checks all expected fields exist in live Airtable base. Skipped under `TEST_BACKEND=mock-airtable`. |
| orderService.js | Order state machine, auto-match stock, create with rollback, cancel with stock return, edit bouquet lines. Delegates to `orderRepo` when ORDER_BACKEND ≠ airtable. |
| premadeBouquetService.js | Dissolve premade bouquets into constituent stock-item lines on order creation. |
| notifications.js | SSE broadcast to all connected clients (heartbeat every 30s). No catch-up buffer yet — clients miss events while disconnected. |
| wix.js | Wix webhook processor — parses payload, creates order + lines + delivery. |
| wixProductSync.js | Bidirectional Wix product pull/push with sync logging. `runPush` accepts `onProgress(entry)` and parallelizes Wix API calls per phase via `p-queue` (concurrency 8) so the full push lands in 10–20s. Pull mirrors Wix → Airtable for prices and descriptions (the 2026-04-22 lockout was specific to the legacy `runSync` flow, which the UI no longer calls). (1200+ L — split candidate.) |
| wixPushJob.js | Async-job wrapper around `runPush()`. POST /products/push starts a job and returns 202+jobId; the frontend polls /products/push/status/:jobId until done. Single-flight by design — exists because Vercel's edge proxy was aborting long synchronous pushes and the UI was reporting failure on successful backend runs. |
| wixMediaClient.js | Wix Media Manager client used by `productImages.js`. Exposes `generateUploadUrl` (signed-URL provisioner), `uploadFile` (multipart PUT), `pollForReady` (waits for Wix to finish processing the asset), `attachToProduct` (Wix Stores media link), `clearMedia` (detach + best-effort delete), and `deleteFiles`. Reuses `WIX_API_KEY`; requires the `Manage Media Manager` scope (`MEDIA.SITE_MEDIA_FILES_UPLOAD`) in addition to `Manage Products`. Harness intercepts every call when `HARNESS_MOCK_WIX=1`. |
| telegram.js | Telegram Bot API wrapper — new-order + delivery-landed alerts. |
| intake-parser.js | Claude Haiku integration for parsing freeform text / Flowwow emails into structured orders. |
| analyticsService.js | Pure math functions for financial KPIs (no DB calls). |
| webhookLog.js | Persists webhook events to Webhook Log table. |
| driverState.js | In-memory backup driver state (resets daily at midnight). |

## Database (in transition — Phase 3+ SQL migration)
Backend is mid-migration from Airtable to Postgres. Two flags control routing:

- `STOCK_BACKEND` ∈ {airtable, shadow, postgres} (default airtable). Phase 3 — currently in shadow week on prod.
- `ORDER_BACKEND` ∈ {airtable, shadow, postgres} (default airtable). Phase 4 — implementation merged but not flipped; read-path migration is the active blocker (see `BACKLOG.md`).

Boot guard in `index.js` rejects mixed modes (e.g. `ORDER_BACKEND=postgres` with `STOCK_BACKEND=airtable`) — order/stock cross-domain transactions cannot span two stores.

Key paths:
- `db/schema.js` — Drizzle table definitions (orders, order_lines, deliveries, stock, stock_movements, audit_log, parity_log, ...).
- `db/migrations/` — `.sql` files applied lexicographically. Used by Drizzle on real PG and by pglite at boot in tests.
- `db/audit.js` — append-only audit log (`audit_log`); writes are tagged via the actor-context async-hook (`actor.js`) so every change carries who/role/req-id.
- `db/index.js` — Postgres + pglite boot. Pglite refuses to boot in `NODE_ENV=production`.
- `repos/orderRepo.js`, `repos/stockRepo.js`, `repos/customerRepo.js`, `repos/productRepo.js` — read/write through the chosen backend. Each repo's three modes share an interface; routes/services call the repo and don't branch on the env flag themselves. `productRepo` (`getImage`, `setImage`, `removeImage`, `getImagesBatch`) caches Wix bouquet image URLs in Airtable today (Product Config table) and is shaped to switch to Postgres in Phase 6 with no caller changes; `getImagesBatch` chunks `OR()` lookups at 100 IDs to stay within Airtable formula limits.
- `db/README.md` — design notes for the migration, including the Phase 4 parity-check stub at `orderRepo.js:1100-1111` (full impl pending — required before flipping `ORDER_BACKEND=shadow` to `postgres`).

## Auth Model
- PIN-based, stateless (no sessions/JWT)
- Roles: `owner` (all access), `florist` (orders/stock/customers), `driver` (deliveries/stock-orders scoped to their name)
- PIN checked via `X-Auth-PIN` header; constant-time comparison
- Driver scope: stock orders filtered by `Assigned Driver` = `req.driverName`

## Key Patterns
- **Routes are thin**: validate input, call service, return response. No business logic.
- **Status transitions**: always go through `transitionStatus()` in `orderService.js` — it validates the state machine and handles timestamps.
- **Cascades**: order ↔ delivery status changes must cascade bidirectionally (see root CLAUDE.md).
- **Stock adjustments**: always go through the serialized stock queue in `airtable.js` — never update stock directly.
- **Error responses**: `{ error: "human-readable message" }` — frontends extract this for toasts.
- **Config values**: use `getConfig(key)` from `settings.js` — never hardcode business values (fees, driver names, markup).

## Airtable Tables (16 tables, env-var-driven)
CUSTOMERS, ORDERS, ORDER_LINES, STOCK, DELIVERIES, STOCK_PURCHASES, STOCK_ORDERS, STOCK_ORDER_LINES, PRODUCT_CONFIG, SYNC_LOG, APP_CONFIG, FLORIST_HOURS, WEBHOOK_LOG, MARKETING_SPEND, STOCK_LOSS_LOG, LEGACY_ORDERS

## Tests
Run all: `cd backend && npx vitest run`
Run one: `cd backend && npx vitest run src/__tests__/orderService.test.js`
Coverage: `cd backend && npx vitest run --coverage`

Two flavours under `src/__tests__/`:
- **Unit** (`*.test.js`) — pure function tests, no I/O.
- **Integration** (`*.integration.test.js`) — boot pglite in-process, apply migrations, exercise repos and routes against real SQL. Runs in CI via `.github/workflows/test.yml`.

Mock external deps (Airtable client, Telegram, Claude API). Never make real network calls in tests. Use `vi.useFakeTimers()` for time-dependent logic.

The 24-section / 153-assertion API-level E2E suite lives at the repo root: `npm run harness` (boots `start-test-backend.js`) + `npm run test:e2e`. Playwright scaffold at `playwright.config.js` for future browser tests.
