# Backend — CLAUDE.md

Express API + Postgres repos/services. All business logic lives here — frontends are thin clients.

## Architecture
```
src/
  routes/          → Thin HTTP controllers (req/res only)
  services/        → Business logic, integrations, computations
  repos/           → Data-access layer for Postgres cutovers (Phase 3+ migration)
  db/              → Drizzle schema, migrations, audit log, actor context
  middleware/      → Auth (PIN), error handler
  constants/       → Status enums (statuses.js) — single source of truth
  utils/           → sanitize, fields, auth helpers
  __tests__/       → Vitest test files (unit + pglite integration)
scripts/           → Backfill, shadow-health, start-test-backend, etc.
```

## Routes (src/routes/)
| File | Endpoints | Purpose |
|------|-----------|---------|
| auth.js | POST /auth/verify | PIN validation with rate limiting (5 attempts/15min) |
| orders.js | GET/POST/PATCH/DELETE /orders | Order CRUD + status transitions + delivery cascade. All reads/writes via orderRepo. |
| customers.js | GET/POST/PATCH /customers, GET /customers/insights | CRM + RFM segmentation |
| stock.js | GET/POST/PATCH /stock, GET /stock/velocity | Inventory + velocity forecasting. All reads/writes via stockRepo. |
| deliveries.js | GET/PATCH /deliveries | Driver assignments + status cascade to orders |
| stockOrders.js | Full CRUD /stock-orders | PO lifecycle: create, send, shop, review, evaluate. **Postgres** via `stockOrderRepo` (Phase 7). New PO markers embed human-readable PO number (ADR-0003). |
| stockPurchases.js | POST /stock-purchases | Record supplier deliveries with batch tracking. Routes STOCK reads/writes through stockRepo; purchase records through stockPurchasesRepo. |
| stockLoss.js | GET/POST /stock-loss | Waste logging by reason |
| premadeBouquets.js | CRUD /premade-bouquets | Premade bouquet templates (composed of stock items). Service uses `premadeBouquetRepo` (Postgres, Phase 7). |
| dashboard.js | GET /dashboard | Today's operational summary for owner |
| analytics.js | GET /analytics | Financial KPIs with period comparison |
| settings.js | GET/POST /settings | Thin HTTP layer for app config. State lives in `services/configService.js`. Re-exports its getters for backward compat — callers should migrate to importing from configService directly. |
| products.js | POST /products/pull\|push\|sync\|translate, GET /products/push/status/:jobId | Bidirectional Wix product sync. Push runs as an async job (see `wixPushJob.js`) — POST /push returns 202 + jobId, the modal polls /push/status. /push/sync is the legacy synchronous variant kept for curl debugging. |
| productImages.js | POST/DELETE /products/:wixProductId/image | Bouquet image upload (florist+owner) and removal (owner only). Orchestrates Wix Media upload + Wix Stores attach via `wixMediaClient.js`, persists URL via `productRepo`, audits as `image_set` / `image_remove`, broadcasts SSE `product_image_changed`. |
| orderImages.js | POST/DELETE /orders/:orderId/image | Per-order bouquet image override. Florist+owner upload, owner-only remove. Uploads to Wix Media, writes `Image URL` on the order via `orderRepo.updateOrder`, reaps the previous Wix file via `deleteFiles`, audits as `image_set`/`image_remove` (entityType `order`), broadcasts SSE `order_image_changed`. Mounted before orders.js so it bypasses any future role gating there. |
| webhook.js | POST /webhook/wix | Wix order webhook (HMAC-SHA256 verified) |
| intake.js | POST /intake/parse | AI-powered order parsing (Claude Haiku) |
| events.js | GET /events | SSE real-time broadcast (max 50 clients) |
| public.js | GET /public/* | Unauthenticated endpoints for Wix storefront (60s cache) |
| floristHours.js | CRUD /florist-hours | Florist payroll time tracking |
| marketingSpend.js | GET/POST /marketing-spend | Ad spend tracking by channel |
| admin.js | GET /admin/* | Migration health, parity dashboards, audit log viewer (owner only) |
| test.js | POST /test/reset, GET /test/state, /test/audit, /test/parity | Test-harness only — mounted when `IS_HARNESS` flag is set (DATABASE_URL=pglite:memory) |

## Services (src/services/)
| File | Purpose |
|------|---------|
| orderService.js | Order state machine, auto-match stock, create with rollback, cancel with stock return, edit bouquet lines. All paths via orderRepo (Postgres). |
| premadeBouquetService.js | Dissolve premade bouquets into constituent stock-item lines on order creation. Persistence via `premadeBouquetRepo` (Postgres, Phase 7). |
| notifications.js | SSE broadcast to all connected clients (heartbeat every 30s). No catch-up buffer yet — clients miss events while disconnected. |
| wix.js | Wix webhook processor — parses payload, creates order + lines + delivery. |
| wixProductSync.js | Bidirectional Wix product pull/push with sync logging. `runPush` accepts `onProgress(entry)` and parallelizes Wix API calls per phase via `p-queue` (concurrency 8) so the full push lands in 10–20s. Pull mirrors Wix prices and descriptions into the local product_config table (the 2026-04-22 lockout was specific to the legacy `runSync` flow, which the UI no longer calls). (1200+ L — split candidate.) |
| wixPushJob.js | Async-job wrapper around `runPush()`. POST /products/push starts a job and returns 202+jobId; the frontend polls /products/push/status/:jobId until done. Single-flight by design — exists because Vercel's edge proxy was aborting long synchronous pushes and the UI was reporting failure on successful backend runs. |
| wixMediaClient.js | Wix Media Manager client used by `productImages.js`. Exposes `generateUploadUrl` (signed-URL provisioner), `uploadFile` (multipart PUT), `pollForReady` (waits for Wix to finish processing the asset), `attachToProduct` (Wix Stores media link), `clearMedia` (detach + best-effort delete), and `deleteFiles`. Reuses `WIX_API_KEY`; requires the `Manage Media Manager` scope (`MEDIA.SITE_MEDIA_FILES_UPLOAD`) in addition to `Manage Products`. Harness intercepts every call when `HARNESS_MOCK_WIX=1`. |
| telegram.js | Telegram Bot API wrapper — new-order + delivery-landed alerts. |
| intake-parser.js | Claude Haiku integration for parsing freeform text / Flowwow emails into structured orders. |
| analyticsService.js | Pure math functions for financial KPIs (no DB calls). |
| configService.js | App config singleton — DEFAULTS, in-memory config state, loadConfig/saveConfig, migrations, driver-of-day daily state, cutoff reminder interval. Exports: `getConfig`, `updateConfig`, `generateOrderId`, `getDriverOfDay`, `isPastCutoff`, `getActiveSeasonalCategory`. Import from here, not from routes/settings.js. |
| driverState.js | In-memory backup driver state (resets daily at midnight). |

## Database (Phases 3–7 complete, 2026-05-09)
Phase 7 PR 2b retired Airtable on 2026-05-09. The backend now runs on Postgres exclusively.

- Phase 3 (Stock), Phase 4 (Orders/Lines/Deliveries), Phase 5 (Customers/KeyPeople/LegacyOrders), Phase 6 (config + log tables), and Phase 7 PR 1 (StockOrders/Lines + Premade Bouquets/Lines) are all live on Postgres.
- New repos in Phase 7: `stockOrderRepo.js`, `premadeBouquetRepo.js` — same wire-format pattern as Phase 3+ repos, dual-lookup (recXXX or uuid) so in-flight callers from before the cutover keep working.

Key paths:
- `db/schema.js` — Drizzle table definitions (orders, order_lines, deliveries, stock, stock_movements, audit_log, parity_log, ...).
- `db/migrations/` — `.sql` files applied lexicographically. Used by Drizzle on real PG and by pglite at boot in tests.
- `db/audit.js` — append-only audit log (`audit_log`); writes are tagged via the actor-context async-hook (`actor.js`) so every change carries who/role/req-id.
- `db/index.js` — Postgres + pglite boot. Pglite refuses to boot in `NODE_ENV=production`.
- `repos/orderRepo.js`, `repos/stockRepo.js`, `repos/customerRepo.js`, `repos/productRepo.js` — all Postgres. `repos/stockPurchasesRepo.js` — purchase record CRUD (`noteMarkerExists` + `findDateByPoMarker` used by PO evaluation idempotency). Routes/services call repos directly — no branching on env flags. `productRepo` (`getImage`, `setImage`, `removeImage`, `getImagesBatch`) stores Wix bouquet image URLs in the `product_config` Postgres table.
- `db/README.md` — design notes for the Airtable→Postgres migration (historical reference; migration complete as of 2026-05-09).

## Auth Model
- PIN-based, stateless (no sessions/JWT)
- Roles: `owner` (all access), `florist` (orders/stock/customers), `driver` (deliveries/stock-orders scoped to their name)
- PIN checked via `X-Auth-PIN` header; constant-time comparison
- Driver scope: stock orders filtered by `Assigned Driver` = `req.driverName`

## Key Patterns
- **Routes are thin**: validate input, call service, return response. No business logic.
- **Status transitions**: always go through `transitionStatus()` in `orderService.js` — it validates the state machine and handles timestamps.
- **Cascades**: order ↔ delivery status changes must cascade bidirectionally (see root CLAUDE.md).
- **Stock adjustments**: always go through `stockRepo.adjustQuantity` / `stockRepo.atomicAdjust` — never run raw SQL on the stock table.
- **Error responses**: `{ error: "human-readable message" }` — frontends extract this for toasts.
- **Config values**: use `getConfig(key)` from `settings.js` — never hardcode business values (fees, driver names, markup).

## Tests
Run all: `cd backend && npx vitest run`
Run one: `cd backend && npx vitest run src/__tests__/orderService.test.js`
Coverage: `cd backend && npx vitest run --coverage`

Two flavours under `src/__tests__/`:
- **Unit** (`*.test.js`) — pure function tests, no I/O.
- **Integration** (`*.integration.test.js`) — boot pglite in-process, apply migrations, exercise repos and routes against real SQL. Runs in CI via `.github/workflows/test.yml`.

Mock external deps (Telegram, Claude API, Wix). Never make real network calls in tests. Use `vi.useFakeTimers()` for time-dependent logic.

The 25-section API-level E2E suite lives at the repo root: `npm run harness` (boots `start-test-backend.js` with pglite) + `npm run test:e2e`. Playwright scaffold at `playwright.config.js` for future browser tests.

## Skill Triggers

See root CLAUDE.md "Skill Quick-Reference" for the full table. Backend-specific defaults:
- **Bug or regression** → `diagnose` before proposing a fix (reproduce loop first)
- **New service or route logic** → `tdd` / `superpowers:test-driven-development` (tests are mandatory here)
- **Refactor or consolidation opportunity** → `improve-codebase-architecture`
- **Schema change** (new column, new table) → `grill-with-docs` to stress-test against migration ADRs + update factories in `lab/factories/` same PR
