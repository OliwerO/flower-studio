# Flower Studio — CLAUDE.md

Web app for **Blossom**, a flower studio in Krakow. Manages orders, inventory, CRM, deliveries, and owner analytics. Replaces multi-spreadsheet workflow.

## Users & Devices
- 1 owner (desktop) · 2–4 florists (tablet/phone) · 2 drivers (phone)
- UI language: **Russian** — all visible strings via `t.xxx` from `translations.js`

## Stack
- **DB:** Airtable (extend existing base — never replace)
- **Backend:** Node.js + Express, hosted on Railway
- **Frontend:** 3 React apps (Vite + Tailwind) on Vercel: `apps/florist`, `apps/delivery`, `apps/dashboard`
- **Auth:** Stateless PIN via `X-Auth-PIN` header (Owner → all, Florist → orders/stock, Driver → deliveries)
- **Real-time:** SSE via `GET /api/events`

## Monorepo Layout
```
backend/          → Express API + Airtable services
apps/florist/     → Bouquet builder, order form, stock (iPad 768px+)
apps/delivery/    → Driver task board, map, PO shopping (iPhone 375px)
apps/dashboard/   → Owner KPIs, settings, products (Desktop 1024px+)
```
Each sub-directory has its own CLAUDE.md with domain-specific rules.

## Coding Standards
- ES modules, `async/await`, no callbacks
- Express routes = thin controllers; business logic in `services/`
- Functional React + hooks, Context + useReducer for state
- Tailwind utility classes only — no custom CSS files
- Prices in PLN, display as "zł", store as numbers
- Comments in English, UI text in Russian via `t.xxx`
- `console.error` for caught errors; user-facing Russian toasts in UI

## Airtable Rules (CRITICAL)
- Rate limit: **5 req/sec** — always use `p-queue` for concurrency
- **Always** use `filterByFormula` server-side, never fetch-all-then-filter
- Price snapshotting: Order Lines COPY cost/sell prices at creation time
- Field names: match exactly what's in Airtable (case-sensitive)
- `typecast: true` on create/update calls
- Stock can go negative — this is intentional (triggers PO demand signals)

## Status Workflows
- **Delivery:** New → Accepted → In Preparation → Ready → Out for Delivery → Delivered
- **Pickup:** New → Accepted → In Preparation → Ready → Picked Up
- **PO:** Draft → Sent → Shopping → Reviewing → Evaluating → Complete
- Cancellation does NOT auto-return stock

## Key Files
- `BACKLOG.md` — feature tracking, open items, known issues
- `CHANGELOG.md` — all changes, schema diffs, go-live checklist
- `backend/src/services/airtable.js` — core CRUD with rate limiting
- `backend/src/routes/` — all API endpoints

## Workflow Rules
- Update `CHANGELOG.md` for any schema, env, or deployment-affecting change
- Check off completed items in `BACKLOG.md`
- Create a git branch per feature/fix
- Test against dev base (`.env.dev`), never production (`.env`)
