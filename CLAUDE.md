# Flower Studio — CLAUDE.md

Operational platform for **Blossom**, a flower studio in Krakow. Each role — florist, driver, owner — gets a smooth, task-focused interface where the next action is obvious and the data is always trustworthy. No guessing, no stale numbers, no hunting for information.

**Core principle:** data accuracy + ease of use. Every screen should let its user complete daily tasks confidently, see what needs attention next, and never question whether the numbers are correct.

## Users & How They Work
- **Owner** (desktop + mobile) — runs the business from the **dashboard** (desktop: full control over operations, CRM, finances, products, settings) and also logs into the **florist app** on her phone for the same daily-task control she gets on desktop. Future: financial review, strategy, planning for peak days.
- **Florists** (tablet/phone, 2–4 people) — **florist app**: see today's orders, compose bouquets, manage stock, evaluate incoming deliveries, log hours.
- **Drivers** (phone, 2 people) — **delivery app**: see assigned deliveries and PO shopping runs, navigate to addresses, report delivery results.
- UI language: **Russian** — all visible strings via `t.xxx` from `translations.js`

## Stack
- **DB:** Airtable (extend existing base — never replace)
- **Backend:** Node.js + Express, hosted on Railway
- **Frontend:** 3 React apps (Vite + Tailwind) on Vercel
- **Auth:** Stateless PIN via `X-Auth-PIN` header (Owner → all, Florist → orders/stock, Driver → deliveries)
- **Real-time:** SSE via `GET /api/events` (new orders, status changes, stock alerts)
- **Integrations:** Wix (e-commerce webhook + bidirectional product sync), Telegram (alerts), Claude AI (order intake parsing), Flowwow (email import)

## Monorepo Layout
```
backend/            → Express API + Airtable services + integrations
apps/florist/       → Order management, bouquet builder, stock, POs, evaluation, hours (768px+)
apps/delivery/      → Driver deliveries, PO shopping runs, map navigation (375px+)
apps/dashboard/     → Full owner control: orders, stock, CRM, finances, products, settings (1024px+)
packages/shared/    → Auth/Toast/Language contexts, API client, hooks, utils
```
Each sub-directory has its own CLAUDE.md with domain-specific rules.

## Coding Standards
- ES modules, `async/await`, no callbacks
- Express routes = thin controllers; business logic in `services/`
- Functional React + hooks, Context for shared state
- Tailwind utility classes only — no custom CSS files
- Prices in PLN, display as "zł", store as numbers
- Comments in English, UI text in Russian via `t.xxx`
- `console.error` for caught errors; user-facing Russian toasts in UI
- Error toasts should show backend error messages: `err.response?.data?.error || t.fallbackMsg`

## Testing Rules
- **New shared utilities** (`packages/shared/utils/`) **must** include a test file in `packages/shared/test/`
- **New shared hooks** (`packages/shared/hooks/`) **must** include a test file in `packages/shared/test/`
- **New backend services** (`backend/src/services/`) **must** include a test file in `backend/src/__tests__/`
- Test runner: **Vitest** everywhere. Use `@testing-library/react` + `jsdom` for component/hook tests
- Mock external deps (API client, translations) — never make real network calls in tests
- Use `vi.useFakeTimers()` when testing time-dependent logic
- Coverage thresholds are enforced in CI for `packages/shared/utils/` and `packages/shared/hooks/` (80% lines)
- Run backend tests: `cd backend && npx vitest run`

## Airtable Rules (CRITICAL)
- Rate limit: **5 req/sec** — always use `p-queue` for concurrency
- **Always** use `filterByFormula` server-side, never fetch-all-then-filter
- **NEVER** use `ARRAYJOIN` on linked record fields to match by record ID — it returns display names, not IDs. Query by text fields or pass IDs directly.
- Price snapshotting: Order Lines COPY cost/sell prices at creation time
- Field names: match exactly what's in Airtable (case-sensitive)
- `typecast: true` on create/update calls
- Stock can go negative — this is intentional (triggers PO demand signals)

## Status Workflows (match `backend/src/constants/statuses.js`)
- **Order (delivery):** New → Ready → Out for Delivery → Delivered
- **Order (pickup):** New → Ready → Picked Up
- **Cancellation:** any non-terminal → Cancelled; Cancelled → New (reopen)
- **Delivery:** Pending → Out for Delivery → Delivered | Cancelled
- **PO:** Draft → Sent → Shopping → Reviewing → Evaluating → Complete (+ Eval Error → Evaluating retry loop)
- **Always** use constants from `statuses.js` — never raw strings in comparisons or assignments
- Cancellation does NOT auto-return stock (explicit cancel-with-return flow in `orderService.js`)

## Cascade Rules
When updating one record, related records often need updating too:
- **Order status → Delivery status**: `orders.js` cascades Out for Delivery / Delivered / Cancelled to linked delivery
- **Delivery status → Order status**: `deliveries.js` cascades Out for Delivery / Delivered / Cancelled to linked order
- **Order date/time → Delivery date/time**: changing `Required By` or `Delivery Time` on an order cascades to the delivery record
- **Order cancellation → Stock return**: handled by `cancelWithStockReturn()` in `orderService.js`, NOT by status change alone

## Cross-App Feature Parity (IMPORTANT)
When a feature is added to the florist app, it should also be added to the dashboard — and vice versa. The owner uses both apps (dashboard on desktop, florist app on mobile), so they must offer the same capabilities for shared domains (orders, stock, POs). If unsure whether a feature applies to both, ask.

**Parallel implementations to keep in sync:**
- Order editing: `OrderCard.jsx` + `OrderDetailPage.jsx` (florist) ↔ `OrderDetailPanel.jsx` (dashboard)
- Stock management: `StockPanelPage.jsx` + `StockItem.jsx` (florist) ↔ `StockTab.jsx` (dashboard)
- PO management: `PurchaseOrderPage.jsx` (florist) ↔ `StockOrderPanel.jsx` (dashboard)
- Order creation: `NewOrderPage.jsx` + `steps/` (florist) ↔ `NewOrderTab.jsx` + `steps/` (dashboard)
- Bouquet editing: `BouquetEditor.jsx` (florist) ↔ `BouquetSection.jsx` (dashboard)

When adding filters, inline editors, status actions, or any user-facing behavior — implement in both apps.

## Known Pitfalls (prevent recurrence)
These bug patterns have been found and fixed. Follow these rules to avoid reintroducing them:
1. **Stale state after conversion** — when a component has both parent `order` props and local `detail` state, always derive display values (isDelivery, delivery fee, payment status) from `detail` (local state) when loaded, not `order` (parent prop). After a Pickup→Delivery conversion, the parent prop is stale.
2. **Delivery fee lives on the delivery record** — `detail.delivery['Delivery Fee']`, NOT `detail['Delivery Fee']`. The order-level field may be empty or stale. Always prefer the delivery sub-record.
3. **Hardcoded fallbacks** — never hardcode driver names, status strings, or locale strings. Use `getDriverOfDay()` / `getConfig()` for drivers, `ORDER_STATUS.*` / `DELIVERY_STATUS.*` for statuses.
4. **Feature gates** — check that conditional rendering (`isDelivery &&`, `!isTerminal &&`, `isOwner &&`) doesn't accidentally exclude valid use cases. Example: unpaid warnings should show for ALL order types, not just pickup.
5. **Silent catch blocks** — every `catch` should either show a toast with the backend error message or log meaningfully. Never `catch(() => {})`.
6. **PO lines need identity** — every PO line must have either a Stock Item link or a Flower Name. Validate on creation, not during evaluation.

## Key Files
- `BACKLOG.md` — feature tracking, open items, known issues
- `CHANGELOG.md` — all changes, schema diffs, go-live checklist
- `backend/src/constants/statuses.js` — single source of truth for all status enums
- `backend/src/services/airtable.js` — core CRUD with rate limiting
- `backend/src/services/orderService.js` — order state machine + business logic
- `backend/src/routes/` — all API endpoints
- `packages/shared/` — shared contexts, hooks, API client, utils

## Workflow Rules
- Update `CHANGELOG.md` for any schema, env, or deployment-affecting change
- Check off completed items in `BACKLOG.md`
- Create a git branch per feature/fix
- Test against dev base (`.env.dev`), never production (`.env`)

## Change Summaries (IMPORTANT)
After completing each logical step of work (not just at the end), write a short **owner-friendly summary** explaining:
1. **What changed** — which files, what was added/removed/moved
2. **Why** — the problem it solves or the reason behind the approach
3. **How it connects** — how it fits into the existing architecture
4. **What to watch for** — any trade-offs, things that could break, or areas the owner should understand for future decisions

Keep it concise but educational. The goal is for the owner to build a mental model of the codebase over time, not just approve changes blindly. Use concrete file paths and line references, not abstract descriptions.
