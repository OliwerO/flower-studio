# Backend — CLAUDE.md

Express API + Airtable services. All business logic lives here — frontends are thin clients.

## Architecture
```
src/
  routes/          → Thin HTTP controllers (req/res only)
  services/        → Business logic, integrations, computations
  middleware/      → Auth (PIN), error handler
  constants/       → Status enums (statuses.js) — single source of truth
  config/          → Airtable table names (env-driven)
  utils/           → sanitize, batchQuery, fields, auth helpers
  __tests__/       → Vitest test files
```

## Routes (src/routes/)
| File | Endpoints | Purpose |
|------|-----------|---------|
| auth.js | POST /auth/verify | PIN validation with rate limiting (5 attempts/15min) |
| orders.js | GET/POST/PATCH/DELETE /orders | Order CRUD + status transitions + delivery cascade |
| customers.js | GET/POST/PATCH /customers, GET /customers/insights | CRM + RFM segmentation |
| stock.js | GET/POST/PATCH /stock, GET /stock/velocity | Inventory + velocity forecasting |
| deliveries.js | GET/PATCH /deliveries | Driver assignments + status cascade to orders |
| stockOrders.js | Full CRUD /stock-orders | PO lifecycle: create, send, shop, review, evaluate |
| stockPurchases.js | POST /stock-purchases | Record supplier deliveries with batch tracking |
| stockLoss.js | GET/POST /stock-loss | Waste logging by reason |
| dashboard.js | GET /dashboard | Today's operational summary for owner |
| analytics.js | GET /analytics | Financial KPIs with period comparison |
| settings.js | GET/POST /settings | App config persistence (Airtable App Config table) |
| products.js | POST /products/pull\|push\|sync\|translate | Bidirectional Wix product sync |
| webhook.js | POST /webhook/wix | Wix order webhook (HMAC-SHA256 verified) |
| intake.js | POST /intake/parse | AI-powered order parsing (Claude Haiku) |
| events.js | GET /events | SSE real-time broadcast (max 50 clients) |
| public.js | GET /public/* | Unauthenticated endpoints for Wix storefront (60s cache) |
| floristHours.js | CRUD /florist-hours | Florist payroll time tracking |
| marketingSpend.js | GET/POST /marketing-spend | Ad spend tracking by channel |

## Services (src/services/)
| File | Purpose |
|------|---------|
| airtable.js | Core CRUD with rate-limited queue (5 req/sec). Stock changes serialized via 1-concurrency queue. |
| airtableSchema.js | Startup validation — checks all expected fields exist in live Airtable base |
| orderService.js | Order state machine, auto-match stock, create with rollback, cancel with stock return, edit bouquet lines |
| notifications.js | SSE broadcast to all connected clients (heartbeat every 30s) |
| wix.js | Wix webhook processor — parses payload, creates order + lines + delivery |
| wixProductSync.js | Bidirectional Wix product pull/push with sync logging |
| telegram.js | Telegram Bot API wrapper — new-order alerts only (low-stock alerts removed 2026-04-19) |
| intake-parser.js | Claude Haiku integration for parsing freeform text / Flowwow emails into structured orders |
| analyticsService.js | Pure math functions for financial KPIs (no DB calls) |
| webhookLog.js | Persists webhook events to Webhook Log table |
| driverState.js | In-memory backup driver state (resets daily at midnight) |

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
Run: `npx vitest run` from `backend/`
- `analyticsService.test.js` — pure math KPI functions
- `orderService.test.js` — status transition state machine
- `utils.test.js` — sanitize, batch query, field picking
