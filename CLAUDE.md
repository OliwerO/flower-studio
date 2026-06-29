# Flower Studio — CLAUDE.md

Operational platform for **Blossom**, a flower studio in Krakow. Each role — florist, driver, owner — gets a smooth, task-focused interface where the next action is obvious and the data is always trustworthy. No guessing, no stale numbers, no hunting for information.

**Core principle:** data accuracy + ease of use. Every screen should let its user complete daily tasks confidently, see what needs attention next, and never question whether the numbers are correct.

## Users & How They Work
- **Owner** (desktop + mobile) — runs the business from the **dashboard** (desktop: full control over operations, CRM, finances, products, settings) and also logs into the **florist app** on her phone for the same daily-task control she gets on desktop. Future: financial review, strategy, planning for peak days.
- **Florists** (tablet/phone, 2–4 people) — **florist app**: see today's orders, compose bouquets, manage stock, evaluate incoming deliveries, log hours.
- **Drivers** (phone, 2 people) — **delivery app**: see assigned deliveries and PO shopping runs, navigate to addresses, report delivery results.
- UI language: **Russian** — all visible strings via `t.xxx` from `translations.js`

## Stack
- **DB:** Postgres (Drizzle ORM, hosted on Railway). Phase 7 PR 2b retired Airtable on 2026-05-09 — historical migration notes in `docs/migration/` archive.
- **Backend:** Node.js + Express, hosted on Railway
- **Frontend:** 3 React apps (Vite + Tailwind) on Vercel
- **Auth:** Stateless PIN via `X-Auth-PIN` header (Owner → all, Florist → orders/stock, Driver → deliveries)
- **Real-time:** SSE via `GET /api/events` (new orders, status changes, stock alerts)
- **Integrations:** Wix (e-commerce webhook + bidirectional product sync), Telegram (alerts), Claude AI (order intake parsing), Flowwow (email import)
- **CI:** `.github/workflows/test.yml` runs Vitest (backend + shared) + the API E2E suite on every PR and on push to master.

## Monorepo Layout
```
backend/            → Express API + Postgres repos/services + integrations
apps/florist/       → Order management, bouquet builder, stock, POs, evaluation, hours (768px+)
apps/delivery/      → Driver deliveries, PO shopping runs, map navigation (375px+)
apps/dashboard/     → Full owner control: orders, stock, CRM, finances, products, settings (1024px+)
packages/shared/    → Auth/Toast/Language contexts, API client, hooks, utils
```
Each sub-directory has its own CLAUDE.md with domain-specific rules.

## Quick Start
From repo root (npm workspaces — install once with `npm install`):
- `npm run backend`        — boot Express on :3001 (reads `backend/.env`)
- `npm run florist`        — Vite dev server for the florist app
- `npm run dashboard`      — Vite dev server for the dashboard
- `npm run delivery`       — Vite dev server for the delivery app
- `npm run harness`        — boot the test backend (pglite in-memory)
- `npm run test:e2e`       — run the 25-section API E2E suite (against `npm run harness`)
- `npm run test:e2e:ui`    — Playwright UI mode

Backend tests:
- `cd backend && npx vitest run`                                    — all
- `cd backend && npx vitest run src/__tests__/orderService.test.js` — single
- `cd backend && npx vitest run --coverage`                         — with coverage

Shared package tests: `cd packages/shared && npx vitest run`.

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

## Postgres Rules
- Use repos (`orderRepo`, `stockRepo`, etc.); routes must not run raw SQL directly.
- Use `db.transaction(...)` for multi-row writes — partial commits leave data corrupt.
- Audit log writes happen inside repo transactions — never write audit rows from routes.
- Stock can go negative — this is intentional (triggers PO demand signals).

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
- CRM: `CustomerListPage.jsx` + `CustomerDetailPage.jsx` (florist) ↔ `CustomersTab.jsx` + `CustomerDetailView.jsx` (dashboard)
- Premade bouquets: `PremadeBouquetCreatePage.jsx` (florist) ↔ `PremadeBouquetList.jsx` + `PremadeBouquetCreateModal.jsx` (dashboard)
- Storefront products (Wix catalog): `BouquetsPage.jsx` + `bouquets/BouquetCard.jsx` (florist) ↔ `ProductsTab.jsx` + `products/ProductCard.jsx` (dashboard) — name + PL/RU/UK translations, key flower, product type, price, lead time, qty, category, active, push/pull. Name editor is shared `ProductTranslationEditor`; EN name + translations owned by flower-studio per ADR-0008
- Waste log: `WasteLogPage.jsx` (florist) ↔ `StockLossSection` inside `SettingsTab.jsx` (dashboard) — keep entry surfaces in lock-step
- Order filtering: `OrdersTab.jsx` (dashboard, per-column popovers) ↔ `OrderListPage.jsx` + `OrderFilterDrawer.jsx` (florist, bottom-sheet drawer); shared `orderFilters` util (`EMPTY_ORDER_FILTER`, `buildOrderQueryParams`, `orderMatchesClientFilter`, `activeOrderFilterCount`, `clearOrderFilter`)

When adding filters, inline editors, status actions, or any user-facing behavior — implement in both apps.

## Known Pitfalls (prevent recurrence)
These bug patterns have been found and fixed. Follow these rules to avoid reintroducing them:
1. **Stale state after conversion** — when a component has both parent `order` props and local `detail` state, always derive display values (isDelivery, delivery fee, payment status) from `detail` (local state) when loaded, not `order` (parent prop). After a Pickup→Delivery conversion, the parent prop is stale.
2. **Delivery fee lives on the delivery record** — `detail.delivery['Delivery Fee']`, NOT `detail['Delivery Fee']`. The order-level field may be empty or stale. Always prefer the delivery sub-record.
3. **Hardcoded fallbacks** — never hardcode driver names, status strings, or locale strings. Use `getDriverOfDay()` / `getConfig()` for drivers, `ORDER_STATUS.*` / `DELIVERY_STATUS.*` for statuses.
4. **Feature gates** — check that conditional rendering (`isDelivery &&`, `!isTerminal &&`, `isOwner &&`) doesn't accidentally exclude valid use cases. Example: unpaid warnings should show for ALL order types, not just pickup.
5. **Silent catch blocks** — every `catch` should either show a toast with the backend error message or log meaningfully. Never `catch(() => {})`.
6. **PO lines need identity** — every PO line must have either a Stock Item link or a Flower Name. Validate on creation, not during evaluation.
7. **Order Termination flows behind a shared seam — never inline.** Both Cancellation (Status → Cancelled, optional Stem return) and Deletion (record removed, Owner-only) live behind `useOrderTerminationFlow` (`packages/shared/hooks/`) + `OrderTerminationConfirm` (`packages/shared/components/`). Hosts pass `apiClient`, `showToast`, `t`, and `onSuccess`; the hook owns the two-button confirm state, the three endpoints (POST `/orders/:id/cancel-with-return`, PATCH `/orders/:id`, DELETE `/orders/:id`), and toast composition. Any new site that needs to cancel or delete an Order MUST consume the hook + component, never reimplement the handlers inline. Translation keys (`cancelConfirm`, `cancelAndReturn`, `cancelNoReturn`, `orderCancelled`, `orderDeleted`, `stockReturned`, `confirmDelete`) are exercised by the hook directly; per-app `translations.js` must define them. History: pre-2026-05-02 the florist app silently patched Status (stock decremented forever); 2026-05-09 the three lockstep sites (`apps/florist/src/components/OrderCard.jsx`, `apps/florist/src/pages/OrderDetailPage.jsx`, `apps/dashboard/src/components/OrderDetailPanel.jsx`) were migrated behind the seam — drift is now structurally impossible.
8. **Stock / Committed is NOT a subtraction** — `Current Quantity` is decremented immediately on order creation (`orderService.js` → `atomicStockAdjust`). Every pending order's demand is therefore ALREADY reflected in `Current Quantity`. `GET /stock/committed` returns the SAME demand as an informational breakdown (for traceability and the tap-to-expand orders list) — it is NOT a second number to subtract. The correct formula is `effective = qty`. Always use `getEffectiveStock(qty)` from `packages/shared/utils/stockMath.js`, never inline `qty - committed` anywhere. A negative `qty` means genuine shortfall — buy more stems. If you need to understand drift between `qty` and physical reality, look at the `/stock/:id/usage` trace; do not invent formula tweaks. Any stock-math change must be audited on BOTH `apps/florist/src/components/StockItem.jsx` AND `apps/dashboard/src/components/StockTab.jsx`. History: pre-2026-04-22 used `qty - committed` (double-counted), 2026-04-22 first-attempted fix used `qty < 0 ? qty : qty - committed` (broke cumulative shortfall case), 2026-04-22 final fix collapsed to `effective = qty`.
9. **A new Batch MUST carry its Variety attrs** — any code path that creates a Stock Item from a PO receipt (`receiveIntoStock` in `backend/src/routes/stockOrders.js`, and the sibling absorption site in `backend/src/routes/stockPurchases.js`) MUST write `Type / Colour / Size / Cultivar` onto the new dated Batch, sourced from the PO line and falling back to the orig Stock Item. When the orig Demand Entry has `type_name = NULL`, back-fill it in the SAME transaction. Why: under `STOCK_Y_MODEL=true`, `stockRepo.listGroupedByVariety` filters `type_name IS NOT NULL`, so an attr-less Batch is invisible in the grouped Stock view, FEFO can't compute its Variety key, and the legacy picker routes onto the undated orig instead. This was the root cause of #323 (stems "disappeared" after a PO evaluation). Absorption math (`batchQty = qty + existingQty` when negative, ADR-0002) is deliberate and unchanged — do NOT touch it while fixing attrs. Fixed in #327; regression-locked by `backend/src/__tests__/stockOrders.receiveIntoStock.integration.test.js`.

## Key Files
- `BACKLOG.md` — feature tracking, open items, known issues
- `CHANGELOG.md` — all changes, schema diffs, go-live checklist
- `backend/src/constants/statuses.js` — single source of truth for all status enums
- `backend/src/repos/` — data-access layer (orderRepo, stockRepo, etc.)
- `backend/src/services/orderService.js` — order state machine + business logic
- `backend/src/routes/` — all API endpoints
- `packages/shared/` — shared contexts, hooks, API client, utils
- `backend/src/routes/assistant.js` — `POST /api/assistant/message` (owner-only). Stateless — session continuity via client-supplied `sessionId` UUID.
- `backend/src/services/assistantService.js` — Anthropic Claude integration; multi-turn session history (in-memory); resolves tool calls through thin adapters over canonical services (parity-pinned: assistant tools call the same `computeAnalytics` / `orderRepo` / etc. as the main API routes, so numbers can never drift).
- `backend/src/services/assistantTools/` — tool-pack directory. Each tool is a thin adapter; never bypass repos or inline SQL. Dashboard-only in v1; florist mount is a follow-up.

## Default Workflow Skills (mandatory for non-trivial work)

### Skill Quick-Reference

When unsure which skill to invoke, consult this table. The right skill at the right moment eliminates rework — the reminder exists so you don't have to remember.

| Situation | Skill | Notes |
|-----------|-------|-------|
| Stress-test design against domain model | `grill-with-docs` | Preferred entry — uses CONTEXT.md + docs/adr/ |
| Stress-test design interactively (no domain docs) | `grill-me` | Socratic interview, one decision at a time |
| Formalize design into a PRD | `to-prd` | Converts conversation context → GitHub Issue |
| Break PRD/spec into tickets | `to-issues` | Tracer-bullet vertical slices |
| Detailed implementation plan | `superpowers:writing-plans` | Produces `docs/superpowers/plans/` doc |
| Full feature from idea to PR | `/feature` | Bundles the full chain below |
| Implement a feature or bugfix (with tests) | `tdd` or `superpowers:test-driven-development` | Red-green-refactor |
| Bug, test failure, unexpected behavior | `diagnose` | Reproduce → minimise → hypothesise → fix loop |
| Architecture audit (pre-redesign / quarterly) | `/audit <area>` | Wraps `improve-codebase-architecture`. Surfaces deep modules + shallow wrappers. No code edits — produces refactor issues. |
| Verify work before PR | `superpowers:verification-before-completion` | Evidence before assertions, always |
| Branch cleanup | `/branches` | Prune gone branches |
| Create or triage a GitHub issue | `triage` | Issue state machine |
| New skill needed | `write-a-skill` | Proper structure + progressive disclosure |
| Major UI overhaul / cross-cutting refactor / schema change | `lab/WORKFLOW.md` | Lab harness: scenario rehearsal + factory discipline + CI `lab-api` gate |

### Canonical entry: `/feature`

For any change > one-line, run `/feature <one-line description>`. Full sequence + cost-discipline overrides + bail-outs live in `.claude/commands/feature.md`. The chain threads Matt's design discipline (`grill-with-docs`, `to-prd`, `to-issues`, vertical slicing, deep modules, CONTEXT.md vocabulary) with superpowers' execution discipline (worktrees, subagent-driven dev, verification gate, branch finishing).

**Skip the chain only for:** typo fixes, one-line bugfixes obvious from a stack trace, dependency bumps, doc-only PRs.

### Hard rules `/feature` enforces (apply even when not running it)

- **Branch hygiene gate.** SessionStart hook (`.claude/hooks/branch-audit.sh`) flags `[gone]` upstreams, finished worktrees, open user PRs, and local branches >7d old without upstream. Run `/branches` before starting new work if flagged. May 2026 branch graveyard came from piling new features onto whatever branch was checked out instead of landing prior work first. The hook is read-only; only `/branches` and `/feature` take destructive action.
- **Bug workflow.** Invoke `diagnose` FIRST (not `systematic-debugging`). Phase 0 prod-signal sweep (Railway logs → PG via `claude_ro` → shadow-health) is flower-studio-tuned. No hypotheses or fixes before reproduce → minimise → instrument, even when cause looks obvious.
- **Architecture audit.** `/audit <area>` wraps `improve-codebase-architecture`. Use before major redesigns (Stock overhaul, CRM rework) or quarterly. Produces refactor issues, not edits.
- **Worktree mandatory for parallel sessions.** Two Claude sessions in this repo simultaneously → each in its own `.worktrees/<feature>/`. Cross-session git collisions of 2026-05-02 (stray commits, branch flips, mangled commit messages) caused by skipping this. `git worktree list` before any branch op.
- **Lab harness — see `lab/WORKFLOW.md`.** Mandatory rules:
  - Schema change (new column, new table, NOT NULL added) → update `lab/factories/<entity>.js` in same PR. Otherwise CI `lab-api` fails on NOT NULL or unknown-column.
  - Major UI overhaul → build scenario under `lab/scenarios/<name>.js`, rebuild template, Playwright rehearsal before merge.
  - Determinism tests compare faker-derived stable fields only — never `created_at`/`updated_at` (drift on CI).
  - Pre-PR matrix MUST include `npm run lab:test:unit` + `npm run lab:test:api` when backend, packages/shared, or lab/ changes.

## Workflow Rules
- Update `CHANGELOG.md` for any schema, env, or deployment-affecting change
- Check off completed items in `BACKLOG.md`
- Create a git branch per feature/fix using prefixes `feat/ fix/ chore/ docs/ test/`. **Never** use a `claude/*` prefix — Claude-spawned branches with random suffixes turn into a graveyard. Use intent-driven names so a future session knows what was being attempted.
- **Land or kill within 7 days.** Open a PR (draft is fine) within a day of branching so GitHub tracks the state. Branches that go >100 commits behind master are deleted, not rebased — the work is either re-done from current main or abandoned with a note in BACKLOG.
- **Update the relevant CLAUDE.md in the same PR** that adds/removes a route, page, service, repo, or shared util. The structure tables in sub-CLAUDE.md files only stay accurate if every PR touches them; drift is what made the 2026-04 audit necessary.
- **Production only** — there is no dev/staging environment. All work targets the production Postgres DB (Railway), Railway backend, and Vercel frontends directly. Production Postgres is the live DB. Use the `claude_ro` DSN for reads. Vercel previews + Railway preDeployCommand handle deploys. Be careful with destructive operations.
- **Default to read-only** when poking at prod from a Claude session — use the `claude_ro` DSN for any Postgres read. Escalate to a write-capable token only when the user explicitly approves the specific change.
- **Railway CLI is installed and authenticated.** Use it directly to diagnose production issues — do not ask the user to run Railway commands. Key commands:
  - `railway logs` — tail recent backend logs (grep for `[FEEDBACK]`, `[PG]`, `[ERROR]`, etc.)
  - `railway logs --tail 200` — more history
  - `railway variables` — list env vars (values redacted)
  - `railway run node backend/scripts/shadow-health.js` — run a script against prod env
  - For Postgres issues: `railway connect` opens a psql session, or use `railway run` with the `DATABASE_URL` env already injected.
  **When to use:** any production bug where the root cause could be a runtime error, missing env var, PG query failure, or service crash. Check `railway logs` BEFORE hypothesising about code — the log often names the exact error. This is faster than adding debug logging and redeploying.

## Verification Gate (integrations + cutovers)
Before claiming a fix on Wix, Telegram, the order/stock cutover, or the Wix webhook, the PR description must name the automated path that proved it: an E2E section number, an integration test, the signed Wix replay, or `npm run harness` + `npm run test:e2e`. If none of those apply, prefix the PR title with `[unverified]` and require explicit owner sign-off before merge. The Wix-sync fix cluster of April 2026 (5+ patches in 2 weeks) was caused by skipping this — the signed-replay harness fixes it going forward.

## Pre-PR Verification (MANDATORY before opening or pushing any PR)
Before opening a PR or pushing changes that will trigger CI/Vercel builds, run the same checks CI runs — locally. The Mac has the compute; using it saves a round-trip and avoids the embarrassing "tests passed locally, deploy failed on Vercel" loop.

**The check matrix — run all that apply to the diff:**
1. **Backend changes** (anything in `backend/`):
   - `cd backend && npx vitest run` — unit + integration tests
   - `npm run harness &` then `npm run test:e2e` — 153-assertion E2E suite
2. **Shared package changes** (anything in `packages/shared/`):
   - `cd packages/shared && ../../backend/node_modules/.bin/vitest run` — 98 tests
   - **Build ALL THREE apps**: `cd apps/florist && ./node_modules/.bin/vite build`, then dashboard, then delivery. Shared's `index.js` re-exports reach every app even if only one consumes a given component, so a missing dep in shared (like `lucide-react` not being in shared's peer deps) breaks any app that imports anything from shared. Vercel builds each app in isolation — local npm-workspace hoisting hides the bug. Building all three locally is the only way to catch it before deploy.
3. **Frontend changes** in any single app: `cd apps/<that-app> && ./node_modules/.bin/vite build`. Plus build any other app that imports a file you touched in `packages/shared/`.
4. **Static guards** (silent-catch CI guard, etc.): the guards live in `.github/workflows/test.yml` — if you added a new `catch(...)` block to backend, scan the diff for `catch (...) {}`/`catch(() => {})` patterns yourself.
5. **Lab harness** (anything in `backend/`, `packages/shared/`, or `lab/`):
   - `npm run lab:test:unit` — factory + scenario unit tests
   - `npm run lab:test:api` — cancel-with-return regression gate (requires `npm run lab:db:up && npm run lab:template:rebuild -- --scenario=baseline` first if not already done)
   - `npm run lab:test:ui` — only when UI / scenarios changed (slower, optional)
   - These run in CI as the `lab-api` job on every PR. Running locally first saves the round-trip when a factory drifted from the schema or a determinism test included `created_at` (will flake on CI). See `lab/WORKFLOW.md`.

**Workflow:** finish work → run the matrix above → if anything fails, fix and re-run until clean → commit → push → open PR. Do not announce "ready for review" / "tests pass" / "PR opened" until **every** applicable check above has produced green output. If a check is broken (e.g. harness won't boot for unrelated reasons), say so explicitly in the PR body — don't silently skip it.

**Why this matters:** Vercel preview deploys run on every PR push and are gated by the production build pipeline. A broken preview is a failed PR check that the owner sees in their inbox. The first PR for collapsible-push (May 2 2026) shipped with `lucide-react` imported in `packages/shared/components/WixPushModal.jsx` but not declared as a shared peerDep — local builds passed via npm-workspace hoisting, dashboard + delivery preview deploys failed on Vercel. Building all three apps locally before push would have caught it.

## Stale-doc rule
Any markdown doc whose body references current state and is dated >30 days old must be updated in the same session that touches it, or moved to `docs/archive/` with an "ARCHIVED YYYY-MM-DD" banner explaining what changed. Stale planning docs poison future Claude context — they get loaded into prompts and quietly contradict reality.

## Production Scripts
Every script in `scripts/` and `backend/scripts/` carries one category in a header comment. Adding a new script = pick a category up front.

| Category | Meaning | Example |
|---|---|---|
| SAFE | Read-only or pglite-isolated. Cannot mutate prod. | `backend/scripts/shadow-health.js` |
| GUARDED | Refuses to run in `NODE_ENV=production` (or only mutates pglite). | `backend/scripts/start-test-backend.js`, anything seeding the test fixture |
| DESTRUCTIVE | Mutates prod Railway PG. Requires explicit owner approval phrase before run. | `scripts/cleanup-test-orders.js`, `backend/scripts/backfill-stock.js` (idempotent but writes prod) |
| STALE | Pending deletion — kept only because removal isn't free. Never run. | `scripts/create-dev-base.js`, `scripts/setup-dev-base.js` (dev-base path was abandoned) |

## Change Summaries (IMPORTANT)
After completing each logical step of work (not just at the end), write summaries for the two distinct audiences:

**`dev-summary` — for Oliwer (technical).** Four sections (What changed / Why / How it connects / What to watch for) with concrete file paths and line refs. Builds Oliwer's mental model of the codebase over time. The artifact for PR descriptions and future-session context. See `.claude/skills/dev-summary/SKILL.md`.

**`owner-summary` — for the business owner (non-technical).** Four sections (What's new for you / Why this helps / How to use it / Watch out for). Zero jargon, no file paths, only language she'd see on her phone or dashboard. Write this **only when the change has an owner-visible effect** — internal refactors and CI work do not need it. See `.claude/skills/owner-summary/SKILL.md`.

Internal refactor, schema migration with no UI effect, dev tooling → `dev-summary` only.
UI change, behavior change, new option, removed workaround → both `dev-summary` *and* `owner-summary`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`OliwerO/flower-studio`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
