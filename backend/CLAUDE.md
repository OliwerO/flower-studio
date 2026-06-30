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
| auth.js | POST /auth/verify | PIN validation with rate limiting (5 attempts/15min). Resolves via the shared `resolveRoleByPin` seam in `utils/driverPins.js`. |
| orders.js | GET/POST/PATCH/DELETE /orders, GET /orders/:id/status-history | Order CRUD + status transitions + delivery cascade. PATCH status is role-aware: owner = any→any, florist/driver = forward map ∪ previously-held statuses (revert). `status-history` returns those previously-held statuses for the florist apps' revert buttons. All reads/writes via orderRepo. |
| customers.js | GET/POST/PATCH /customers, GET /customers/insights | CRM + RFM segmentation |
| stock.js | GET/POST/PATCH /stock, GET /stock/velocity, GET /stock/committed, GET /stock/pending-po, POST /stock, GET /stock/:id/usage, GET /stock/varieties/:key/usage, PATCH /stock/:id, POST /stock/:id/adjust, POST /stock/:id/write-off, GET /stock/reconciliation, GET /stock/needs-backfill, GET /stock/distinct/:column, PATCH /stock/:id/variety-attrs, PATCH /stock/variety-attrs/bulk (Owner-only) | Inventory + velocity + variety backfill + per-Variety trace (T5) |
| deliveries.js | GET/PATCH /deliveries | Driver assignments + status cascade to orders |
| stockOrders.js | Full CRUD /stock-orders | PO lifecycle: create, send, shop, review, evaluate. **Postgres** via `stockOrderRepo` (Phase 7). New PO markers embed human-readable PO number (ADR-0003). |
| stockPurchases.js | POST /stock-purchases | Record supplier deliveries with batch tracking. Routes STOCK reads/writes through stockRepo; purchase records through stockPurchasesRepo. |
| stockLoss.js | GET/POST /stock-loss | Waste logging by reason |
| premadeBouquets.js | CRUD /premade-bouquets | Premade bouquet templates (composed of stock items). Service uses `premadeBouquetRepo` (Postgres, Phase 7). |
| dashboard.js | GET /dashboard | Today's operational summary for owner |
| analytics.js | GET /analytics | Financial KPIs with period comparison |
| settings.js | GET/POST /settings, PUT /settings/driver-language (owner-only; sets a Driver's notification language ru/en/pl in `driver_telegram_chats`), PUT /settings/florist-language (owner-only; sets the group notification language ru/en/pl for the shared florist phone in `system_meta`) | Thin HTTP layer for app config. State lives in `services/configService.js`. Re-exports its getters for backward compat — callers should migrate to importing from configService directly. |
| products.js | POST /products/pull\|push\|sync\|translate, GET /products/push/status/:jobId, PATCH /products/:id | Bidirectional Wix product sync. Push runs as an async job (see `wixPushJob.js`) — POST /push returns 202 + jobId, the modal polls /push/status. /push/sync is the legacy synchronous variant kept for curl debugging. **Product Name is now editable (ADR-0008) and is flower-studio-owned** — Pull will not overwrite a locally-set name (`localNameOwned` guard in `wixProductSync.js`). Push sends EN name + PL/RU/UK translations to Wix. |
| productImages.js | POST/DELETE /products/:wixProductId/image | Bouquet image upload (florist+owner) and removal (owner only). Orchestrates Wix Media upload + Wix Stores attach via `wixMediaClient.js`, persists URL via `productRepo`, audits as `image_set` / `image_remove`, broadcasts SSE `product_image_changed`. |
| orderImages.js | POST/DELETE /orders/:orderId/image | Per-order bouquet image override. Florist+owner upload, owner-only remove. Uploads to Wix Media, writes `Image URL` on the order via `orderRepo.updateOrder`, reaps the previous Wix file via `deleteFiles`, audits as `image_set`/`image_remove` (entityType `order`), broadcasts SSE `order_image_changed`. Mounted before orders.js so it bypasses any future role gating there. |
| webhook.js | POST /webhook/wix | Wix order webhook (HMAC-SHA256 verified) |
| intake.js | POST /intake/parse | AI-powered order parsing (Claude Haiku) |
| events.js | GET /events | SSE real-time broadcast (max 50 clients) |
| public.js | GET /public/* | Unauthenticated endpoints for Wix storefront (60s cache) |
| floristHours.js | CRUD /florist-hours | Florist payroll time tracking |
| marketingSpend.js | GET/POST /marketing-spend | Ad spend tracking by channel |
| admin.js | GET /admin/* | Migration health, parity dashboards, audit log viewer (owner only) |
| issues.js | GET/POST/PATCH /issues, GET /issues/labels, POST /issues/labels/ensure-priorities, GET/POST /issues/:n/comments | Owner-only proxy over the GitHub REST API for the dashboard Issues tab. Reuses `GITHUB_TOKEN` (same token as feedbackService). Filters PRs out of the list (GitHub's /issues returns PRs too). Priority = `priority:*` labels, seeded idempotently. No DB/service — thin HTTP edge. |
| assistant.js | POST /api/assistant/message; GET /api/assistant/conversations; GET/PATCH/DELETE /api/assistant/conversations/:id (all owner-only) | "Ask Blossom" AI assistant. `POST /message` accepts `{ sessionId?, message }`, calls `assistantService.ask()`, returns `{ sessionId, answer, toolResults }` (toolResults = structured tool outputs for future rich-UI). Chat history (auto-saved every turn): `GET /conversations` lists `[{id,title,updatedAt,messageCount}]` newest-first; `GET /conversations/:id` returns `{id,title,messages}` (display turns); `PATCH /conversations/:id` renames (`{title}`, 400 empty / 404 missing); `DELETE /conversations/:id` (204 / 404). Session continuity: in-memory Map (keyed by sessionId, 2h TTL) is a hot cache over the `assistant_conversations` PG table — `ask()` rehydrates from PG on a cache miss, so reopened chats keep full tool context. |
| test.js | POST /test/reset, GET /test/state, /test/audit, /test/parity | Test-harness only — mounted when `IS_HARNESS` flag is set (DATABASE_URL=pglite:memory) |

## Services (src/services/)
| File | Purpose |
|------|---------|
| orderService.js | Order state machine, auto-match stock, create with rollback, cancel with stock return, edit bouquet lines. All paths via orderRepo (Postgres). |
| premadeBouquetService.js | Build / edit / dissolve / sell Premade Bouquets. Flag-on path (STOCK_Y_MODEL=true, issue #285 + #330) uses reservation model — `premade_bouquet_lines` are the ledger; Batch quantity is touched only at sale via standard allocation. Legacy path preserved under `_*Legacy` functions. Persistence via `premadeBouquetRepo` (Postgres, Phase 7). |
| notifications.js | SSE broadcast to all connected clients (heartbeat every 30s). No catch-up buffer yet — clients miss events while disconnected. |
| wix.js | Wix webhook processor — parses payload, creates order + lines + delivery. |
| wixProductSync.js | Bidirectional Wix product pull/push with sync logging. `runPush` accepts `onProgress(entry)` and parallelizes Wix API calls per phase via `p-queue` (concurrency 8) so the full push lands in 10–20s. Pull mirrors Wix prices and descriptions into the local product_config table (the 2026-04-22 lockout was specific to the legacy `runSync` flow, which the UI no longer calls). (1200+ L — split candidate.) |
| wixPushJob.js | Async-job wrapper around `runPush()`. POST /products/push starts a job and returns 202+jobId; the frontend polls /products/push/status/:jobId until done. Single-flight by design — exists because Vercel's edge proxy was aborting long synchronous pushes and the UI was reporting failure on successful backend runs. |
| wixMediaClient.js | Wix Media Manager client used by `productImages.js`. Exposes `generateUploadUrl` (signed-URL provisioner), `uploadFile` (multipart PUT), `pollForReady` (waits for Wix to finish processing the asset), `attachToProduct` (Wix Stores media link), `clearMedia` (detach + best-effort delete), and `deleteFiles`. Reuses `WIX_API_KEY`; requires the `Manage Media Manager` scope (`MEDIA.SITE_MEDIA_FILES_UPLOAD`) in addition to `Manage Products`. Harness intercepts every call when `HARNESS_MOCK_WIX=1`. |
| telegram.js | Telegram Bot API wrapper — new-order + delivery-landed alerts. Exports `sendToChat` (targeted single-chat send) and `escapeHtml` (HTML-entity escape for parse_mode HTML messages). |
| driverNotifyService.js | Single seam every assignment path calls to notify a Driver via Telegram (ADR-0009, PRD #368). Owns chat-id + lang resolution via `driverTelegramRepo`, suppress-self / skip-unregistered guards, and per-language (ru/en/pl) message composition for delivery assignment, daily digest, and PO assignment. Never throws into callers — assignment succeeds even if Telegram is down. |
| floristNotifyService.js | Single seam every Order-creation path calls to notify the shared florist phone of a new Order via Telegram (ADR-0009 florist extension). Resolves florist chat_id + group lang via `floristTelegramRepo`. Skips silently if unregistered. Never throws into callers — order creation succeeds even if Telegram is down. |
| driverBot.js | Inbound `/start <PIN>` registration long-poll on `TELEGRAM_BOT_TOKEN` (the alerts bot). Mirrors `feedbackTelegramBot.js` but uses its own `driver_bot_poll_offset` key in `system_meta` so the two loops never collide. Resolves PIN → driver name via `driverPins.js`, persists chat-id + lang via `driverTelegramRepo`, sends a language-matched confirmation. On a florist PIN (`PIN_FLORIST`), resolves via `resolveFloristByPin`, stores in `system_meta` via `floristTelegramRepo`, sends a language-matched florist confirmation. `/start` is brute-force-guarded per chat_id (5 failed PINs / 15 min, in-memory; cleared on a successful registration) — the bot's equivalent of the `/auth/verify` IP rate limit. |
| intake-parser.js | Claude Haiku integration for parsing freeform text / Flowwow emails into structured orders. |
| analyticsService.js | Pure math helper functions for financial KPIs (take pre-fetched data, return metrics). Also exports `computeAnalytics({ from, to })` — the DB-backed full-report function that both the `/api/analytics` route and the assistant `financial_summary` tool call (single source of truth, so their numbers always match). |
| assistantService.js | Anthropic Claude integration for the "Ask Blossom" assistant. Multi-turn session history is an in-memory Map (keyed by UUID sessionId) backed by the `assistant_conversations` PG table via `assistantConversationRepo`: `ask()` rehydrates a missing session from PG (try/catch, never throws) and upserts the full canonical message array after every turn (auto-save). Also exports `toDisplayTurns` (projects the stored Anthropic array → `{role,text}`, dropping tool blocks) and the history CRUD (`listConversations`, `getConversation`, `renameConversation`, `deleteConversation`). On each turn, calls the tool pack, resolves tool calls, returns the final text answer. Tool results are thin adapters over canonical services — queries never bypass repos. **Prompt caching:** the system prompt (`cachedSystem`) + the 20 tool defs (`CACHED_TOOLS`, breakpoint on the last def) carry `cache_control: ephemeral`, so Anthropic serves them from cache (~10% input cost) on the 2nd+ call within 5 min — saves on the multi-tool loop + multi-turn chats. Tool-call cap is `ASSISTANT_MAX_ITERATIONS` (default 12); model is `ASSISTANT_MODEL` (default sonnet; set to haiku to cut cost). |
| assistantTools/ | Assistant tool-pack registry (23 tools). Each pack file is a read-only thin adapter over a canonical service/repo: `freeTextPack` (search_text — open-ended keyword search over order free-text: customer_request/florist_note/greeting_card_text) → `orderRepo.searchFreeText`; `dataQueryPack` (query_records — flexible validated declarative spec → safe parameterized read-only Drizzle, NEVER SQL; + orders_needing_short_stock composite) → `db` via an allow-list (cross-type joins cast UUID→text, e.g. `stock.id::text = order_lines.stock_item_id`, so legacy recXXX rows don't abort the query); `financePack` → `analyticsService.computeAnalytics`; `financeInsightsPack` (top_products, channel_efficiency, compare_periods) → `computeAnalytics` (compare_periods calls it twice + diffs in-adapter — no new math); `trendsPack` (sales_trends: monthly/weeklyRhythm/funnel/paymentAnalysis) → `computeAnalytics`; `supplierPack` (supplier_scorecard) → `computeAnalytics`; `ordersPack` → `orderRepo.list`; `stockPack` → `stockRepo.list` + `stockLossRepo.list`; `velocityPack` (stock_velocity) → `orderRepo.getLinesForVelocity` + `stockRepo.list` (groups by Display Name → Y-model-safe); `marketingPack` (marketing_spend, `YYYY-MM`) → `marketingSpendRepo.list` (no auto-ROAS — channel is free text); `customersPack` → `computeAnalytics.customers` + `customerRepo.list`/`getById`; `crmPack` (lapsed_customers, upcoming_occasions) → `customerRepo.list` + `customerRepo.listKeyPeopleWithDates`; `deliveriesPack` → `orderRepo.listDeliveries`; `purchasingPack` → `stockOrderRepo.list` + `stockPurchasesRepo.list`; `hoursPack` → `hoursRepo.list` + `floristHoursService.buildPayroll`. Adding a domain = add a pack file + import + push into `TOOLS` in `index.js`. Never inline SQL or recompute business logic here — delegate to the canonical service. Stock available qty = `Current Quantity` as-is (pitfall #8 — never subtract committed); shortfall = qty<0. **Correctness system:** every date tool echoes `period:{from,to}` (the system prompt makes the assistant state the resolved range so a mis-parsed period is caught); parity tests pin each money/count tool to its canonical source; `assistantTools.goldenQuestions.test.js` mocks the LLM + pglite and asserts each tool dispatches + its output is self-consistent (breakdown sums == total, revenue.total == flowers+delivery, shortfall items qty<0); `scripts/assistant-live-smoke.js` (SAFE) checks tool *selection* against a real key. |
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
- `repos/stockRepo.js` Stock Y-model exports (issue #286, behind `STOCK_Y_MODEL` flag): `computeDemandDate(order)` — pure fallback-chain helper; `getOrCreateDemandEntry(varietyKey, date, qty, tx, actor)` — upsert-with-sum for dated DEs; `updateDemandEntryDate(orderLineId, newDate, tx, actor)` — Required By cascade with sole-owner/shared split logic. All three require a Drizzle `tx` handle (must be called inside `db.transaction`). See `backend/src/db/migrations/0013_stock_y_demand_index.sql` for the partial unique index these functions depend on.
- `repos/driverTelegramRepo.js` — CRUD for `driver_telegram_chats` table (driver name → chat_id + lang). Used by `driverNotifyService.js` to resolve targets and by `driverBot.js` to persist registrations. Introduced in migration 0015.
- `repos/assistantConversationRepo.js` — CRUD for `assistant_conversations` (Ask Blossom chat history): `upsert({id,title,messages})` (insert, or on id-conflict refresh messages + bump updated_at without touching a renamed title), `list()` (newest-first + `jsonb_array_length` messageCount), `getById`, `rename`, `remove`. The row id IS the assistant sessionId; `messages` stores the canonical Anthropic array verbatim. Introduced in migration 0016.
- `repos/floristTelegramRepo.js` — Singleton getter/setter for the shared florist phone: `getFloristChatId`, `setFloristChatId`, `getFloristLang`, `setFloristLang`. Backed by `system_meta` kv keys `florist_chat_id` and `florist_notify_lang` (no dedicated table — florists share one PIN and one phone). Used by `floristNotifyService.js` and `driverBot.js`.
- `utils/driverPins.js` — **the single source of PIN→role resolution.** `resolveDriverByPin(pin)`: PIN → driver name (scans `PIN_DRIVER_*`; Backup PIN → owner-set backup name). `resolveFloristByPin(pin)`: `PIN_FLORIST` → `'florist'`. `resolveRoleByPin(pin)`: any PIN → `{ role, driverName? } | null` (owner wins on collision) — consumed by the auth middleware (`middleware/auth.js`) **and** the `/auth/verify` route, so Backup-name resolution can't drift between them. `isValidPin(pin)`: truthy/falsy wrapper used by the SSE handshake (`routes/events.js`). `listDriverPins()`: `[{pin,name}]` registry, also the source of `configService.driverNames`.
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

## Known Pitfalls (backend-specific)
- **Product names are owned by flower-studio (ADR-0008)** — Pull must not overwrite a row whose `Translations.en.title` is set; see `localNameOwned` in `wixProductSync.js`. Push sends EN name + PL/RU/UK translations to Wix so all storefronts reflect the dashboard-set name.

## Tests
Run all: `cd backend && npx vitest run`
Run one: `cd backend && npx vitest run src/__tests__/orderService.test.js`
Coverage: `cd backend && npx vitest run --coverage`

Two flavours under `src/__tests__/`:
- **Unit** (`*.test.js`) — pure function tests, no I/O.
- **Integration** (`*.integration.test.js`) — boot pglite in-process, apply migrations, exercise repos and routes against real SQL. Runs in CI via `.github/workflows/test.yml`.

Mock external deps (Telegram, Claude API, Wix). Never make real network calls in tests. Use `vi.useFakeTimers()` for time-dependent logic.

**Known pglite limitation:** `SELECT FOR UPDATE` is not supported in pglite (single-connection WASM). Integration tests that need concurrency-safe reads must use the partial unique index as the dedup guard instead of `FOR UPDATE`. In production Postgres, row-level locks on `UPDATE` provide isolation. This is documented in `appConfigRepo.js` (line with "pglite does NOT support SELECT FOR UPDATE") and in `stockRepo.js` `getOrCreateDemandEntry`. Never add `FOR UPDATE` to pglite integration tests — the query will fail with a syntax error.

The 28-section API-level E2E suite lives at the repo root: `npm run harness` (boots `start-test-backend.js` with pglite) + `npm run test:e2e`. Playwright scaffold at `playwright.config.js` for future browser tests.

## Skill Triggers

See root CLAUDE.md "Skill Quick-Reference" for the full table. Backend-specific defaults:
- **Bug or regression** → `diagnose` before proposing a fix (reproduce loop first)
- **New service or route logic** → `tdd` / `superpowers:test-driven-development` (tests are mandatory here)
- **Refactor or consolidation opportunity** → `improve-codebase-architecture`
- **Schema change** (new column, new table) → `grill-with-docs` to stress-test against migration ADRs + update factories in `lab/factories/` same PR
