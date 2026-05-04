# Flower Studio — CLAUDE.md

Operational platform for **Blossom**, a flower studio in Krakow. Each role — florist, driver, owner — gets a smooth, task-focused interface where the next action is obvious and the data is always trustworthy. No guessing, no stale numbers, no hunting for information.

**Core principle:** data accuracy + ease of use. Every screen should let its user complete daily tasks confidently, see what needs attention next, and never question whether the numbers are correct.

## Users & How They Work
- **Owner** (desktop + mobile) — runs the business from the **dashboard** (desktop: full control over operations, CRM, finances, products, settings) and also logs into the **florist app** on her phone for the same daily-task control she gets on desktop. Future: financial review, strategy, planning for peak days.
- **Florists** (tablet/phone, 2–4 people) — **florist app**: see today's orders, compose bouquets, manage stock, evaluate incoming deliveries, log hours.
- **Drivers** (phone, 2 people) — **delivery app**: see assigned deliveries and PO shopping runs, navigate to addresses, report delivery results.
- UI language: **Russian** — all visible strings via `t.xxx` from `translations.js`

## Stack
- **DB:** Airtable (live) → Postgres (in transition). Phase 3 (Stock) is in shadow week on prod. Phase 4 (Orders) merged but not flipped — read-path migration is the active blocker. See `backend/src/db/README.md` and `BACKLOG.md` pickup checklist. Routes pick the backend via `STOCK_BACKEND` / `ORDER_BACKEND` env flags, default `airtable`. Boot guard rejects mixed modes.
- **Backend:** Node.js + Express, hosted on Railway
- **Frontend:** 3 React apps (Vite + Tailwind) on Vercel
- **Auth:** Stateless PIN via `X-Auth-PIN` header (Owner → all, Florist → orders/stock, Driver → deliveries)
- **Real-time:** SSE via `GET /api/events` (new orders, status changes, stock alerts)
- **Integrations:** Wix (e-commerce webhook + bidirectional product sync), Telegram (alerts), Claude AI (order intake parsing), Flowwow (email import)
- **CI:** `.github/workflows/test.yml` runs Vitest (backend + shared) + the API E2E suite on every PR and on push to master.

## Monorepo Layout
```
backend/            → Express API + Airtable services + integrations
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
- `npm run harness`        — boot the test backend (mock Airtable + pglite)
- `npm run test:e2e`       — run the 24-section / 153-assertion API E2E suite (against `npm run harness`)
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
- CRM: `CustomerListPage.jsx` + `CustomerDetailPage.jsx` (florist) ↔ `CustomersTab.jsx` + `CustomerDetailView.jsx` (dashboard)
- Premade bouquets: `BouquetsPage.jsx` + `PremadeBouquetCreatePage.jsx` (florist) ↔ `PremadeBouquetList.jsx` + `PremadeBouquetCreateModal.jsx` (dashboard)
- Waste log: `WasteLogPage.jsx` (florist) ↔ `StockLossSection` inside `SettingsTab.jsx` (dashboard) — keep entry surfaces in lock-step

When adding filters, inline editors, status actions, or any user-facing behavior — implement in both apps.

## Known Pitfalls (prevent recurrence)
These bug patterns have been found and fixed. Follow these rules to avoid reintroducing them:
1. **Stale state after conversion** — when a component has both parent `order` props and local `detail` state, always derive display values (isDelivery, delivery fee, payment status) from `detail` (local state) when loaded, not `order` (parent prop). After a Pickup→Delivery conversion, the parent prop is stale.
2. **Delivery fee lives on the delivery record** — `detail.delivery['Delivery Fee']`, NOT `detail['Delivery Fee']`. The order-level field may be empty or stale. Always prefer the delivery sub-record.
3. **Hardcoded fallbacks** — never hardcode driver names, status strings, or locale strings. Use `getDriverOfDay()` / `getConfig()` for drivers, `ORDER_STATUS.*` / `DELIVERY_STATUS.*` for statuses.
4. **Feature gates** — check that conditional rendering (`isDelivery &&`, `!isTerminal &&`, `isOwner &&`) doesn't accidentally exclude valid use cases. Example: unpaid warnings should show for ALL order types, not just pickup.
5. **Silent catch blocks** — every `catch` should either show a toast with the backend error message or log meaningfully. Never `catch(() => {})`.
6. **PO lines need identity** — every PO line must have either a Stock Item link or a Flower Name. Validate on creation, not during evaluation.
7. **Cancel always offers stock-return choice** — clicking the Cancel pill / button must NEVER silently flip status. Surface a two-button confirm: `Cancel + return stock` (POST /orders/:id/cancel-with-return) vs `Cancel only` (PATCH Status=Cancelled). Implemented in three places that must stay in lockstep: `apps/florist/src/components/OrderCard.jsx`, `apps/florist/src/pages/OrderDetailPage.jsx`, `apps/dashboard/src/components/OrderDetailPanel.jsx`. Translation keys: `cancelConfirm`, `cancelAndReturn`, `cancelNoReturn`, `stockReturned`. History: pre-2026-05-02 the florist app silently patched Status, leaving stock decremented forever — surfaced during Phase 4 cutover smoke test.
8. **Stock / Committed is NOT a subtraction** — `Current Quantity` is decremented immediately on order creation (`orderService.js` → `atomicStockAdjust`). Every pending order's demand is therefore ALREADY reflected in `Current Quantity`. `GET /stock/committed` returns the SAME demand as an informational breakdown (for traceability and the tap-to-expand orders list) — it is NOT a second number to subtract. The correct formula is `effective = qty`. Always use `getEffectiveStock(qty)` from `packages/shared/utils/stockMath.js`, never inline `qty - committed` anywhere. A negative `qty` means genuine shortfall — buy more stems. If you need to understand drift between `qty` and physical reality, look at the `/stock/:id/usage` trace; do not invent formula tweaks. Any stock-math change must be audited on BOTH `apps/florist/src/components/StockItem.jsx` AND `apps/dashboard/src/components/StockTab.jsx`. History: pre-2026-04-22 used `qty - committed` (double-counted), 2026-04-22 first-attempted fix used `qty < 0 ? qty : qty - committed` (broke cumulative shortfall case), 2026-04-22 final fix collapsed to `effective = qty`.

## Key Files
- `BACKLOG.md` — feature tracking, open items, known issues
- `CHANGELOG.md` — all changes, schema diffs, go-live checklist
- `backend/src/constants/statuses.js` — single source of truth for all status enums
- `backend/src/services/airtable.js` — core CRUD with rate limiting
- `backend/src/services/orderService.js` — order state machine + business logic
- `backend/src/routes/` — all API endpoints
- `packages/shared/` — shared contexts, hooks, API client, utils

## Default Workflow Skills (mandatory for non-trivial work)

**Canonical entry point: `/feature`.** The `.claude/commands/feature.md` command bundles the chain below with the cost-discipline overrides from this file (Sonnet executors, batched reviews, tight subagent prompts, MVP-sized plans, TDD red-phase exemptions). Use `/feature <one-line description>` instead of invoking the skills one-by-one — the command exists specifically so future sessions don't re-derive the discipline. The manual chain below is documented for cases where `/feature` is overkill or where you need to deviate.

**Branch hygiene gate.** The SessionStart hook at `.claude/hooks/branch-audit.sh` runs at every session start and surfaces local branches with `[gone]` upstream, finished worktrees, open PRs by the current user, and local branches >7d old without an upstream. If the hook flags issues, run `/branches` to clean up before starting new work — the May 2026 branch graveyard happened because new features were piled onto whatever branch was checked out instead of landing the prior work first. `/feature` enforces this gate at step 0; if you skip `/feature` for a quick fix, you can still hit it manually with `/branches`. The hook is read-only (never mutates); only `/branches` and `/feature` take destructive action, and only with the safety rails described in those commands.

For any feature/bugfix that takes more than a one-line change, this is the default sequence. Future Claude sessions in this repo should follow it without being asked:

1. **`superpowers:brainstorming`** — explore intent + design BEFORE writing code. Invoked before any plan-mode entry. Skip only if the user has already locked in scope.
2. **`superpowers:writing-plans`** — produce a phased implementation plan saved under `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`. Plans use bite-sized checkbox steps with exact code + commands, no placeholders.
3. **`superpowers:using-git-worktrees`** — create an isolated worktree under `.worktrees/<feature>/` so the session has its own checkout, branch, and index. **Never share the main repo's working tree across two Claude sessions** — the cross-session git collisions of 2026-05-02 (stray commits, branch flips mid-task, mangled commit messages) were caused by this. Main repo (top-level checkout) stays on `master` for general operations only.
4. **`superpowers:subagent-driven-development`** — execute plan tasks via fresh subagents with two-stage review between tasks. Keeps the main context clean and parallelises independent work.
5. **`superpowers:test-driven-development`** — write the failing test first, then the minimal implementation. Required for backend services + shared utils per the Testing Rules section above.
6. **`superpowers:verification-before-completion`** — run the actual verification commands (tests, builds, smoke tests) and confirm their output BEFORE claiming the work is done. Evidence beats assertion. Especially load-bearing for prod cutovers and integration changes (also see "Verification Gate" below).

Skip the chain only for: typo fixes, one-line bugfixes obvious from a stack trace, dependency bumps, or doc-only PRs.

If two Claude sessions are active in this repo simultaneously, **each session must operate in its own worktree** under `.worktrees/`. Use `git worktree list` before any branch operation to see who's on what.

### Cost discipline (added 2026-05-03 after 2× 5h Opus burn on bouquet-image-upload)

The default chain above is non-negotiable for quality. These tunings cut token cost without weakening it.

**Model selection per role.** Subagents inherit Opus unless overridden. Pass `model` explicitly when spawning agents via the `Agent` tool:
- **Opus** — planning (`writing-plans`, `code-architect`), final review (`code-reviewer`, `requesting-code-review`), debugging (`systematic-debugging`), brainstorming. Reasoning-heavy steps.
- **Sonnet** — execution subagents that follow a written plan task ("implement Task 7 exactly as specified"). Sonnet 4.6 is adequate for "follow these steps + run these commands" and ~5× cheaper. Use for: TDD red/green loops on backend services with a clear spec, UI wiring tasks, doc updates, mechanical refactors.
- **Haiku** — never for code; OK for one-shot greps / file lookups via Explore agent if Sonnet feels overkill.

**When to skip TDD** (still respect the Testing Rules section). TDD red/green is mandatory for: new backend services, new shared utils, new repos, new shared hooks. Skip the formal red phase for: pure UI wiring (importing an existing shared component into a page), CSS/Tailwind tweaks, copy/translation changes, doc-only edits, simple route handlers that compose existing services. For these, write the test alongside or after the implementation — verification still mandatory before commit.

**Batched reviews, not per-task.** `subagent-driven-development` spec defaults to two reviewers (code-quality + spec-compliance) between every task. For a 17-task plan this spawns ~34 review subagents, each re-reading CLAUDE.md + plan + spec. Instead:
- Run reviews **at phase boundaries** (groups of 3–5 related tasks), not after every task.
- Final reviewer pass at the end, before the PR, covering the whole branch diff.
- Keep per-task review only when a task touches a Known Pitfall area (status workflows, stock math, cancel-with-return, Wix sync, shadow-window writes).

**Pre-trim subagent prompts.** Don't paste the full plan into every executor subagent. Paste only that task's section + relevant file paths + the spec excerpt that affects it. The plan exists on disk — the subagent can read the bits it needs.

**Right-size plans.** A 2300-line plan for one feature is a smell. If a plan exceeds ~1500 lines or 15 tasks, split it: land an MVP first, file follow-ups for the rest. Each task should be one commit's worth (≤ ~300 LOC, ≤ 2 files in most cases).

**Rough budget guide.** A 17-task feature like bouquet-image-upload should fit in **one** 5h Opus window when tuned per above (Sonnet for executors, batched reviews, tight subagent prompts). If two windows look likely, the plan is probably too big — split.

## Workflow Rules
- Update `CHANGELOG.md` for any schema, env, or deployment-affecting change
- Check off completed items in `BACKLOG.md`
- Create a git branch per feature/fix using prefixes `feat/ fix/ chore/ docs/ test/`. **Never** use a `claude/*` prefix — Claude-spawned branches with random suffixes turn into a graveyard. Use intent-driven names so a future session knows what was being attempted.
- **Land or kill within 7 days.** Open a PR (draft is fine) within a day of branching so GitHub tracks the state. Branches that go >100 commits behind master are deleted, not rebased — the work is either re-done from current main or abandoned with a note in BACKLOG.
- **Update the relevant CLAUDE.md in the same PR** that adds/removes a route, page, service, repo, or shared util. The structure tables in sub-CLAUDE.md files only stay accurate if every PR touches them; drift is what made the 2026-04 audit necessary.
- **Production only** — there is no dev/staging environment. All work targets the production Airtable base, Railway backend, and Vercel frontends directly. Be careful with destructive operations.
- **Default to read-only** when poking at prod from a Claude session — use the `claude_ro` DSN for any Postgres read. Escalate to a write-capable token only when the user explicitly approves the specific change.

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

**Workflow:** finish work → run the matrix above → if anything fails, fix and re-run until clean → commit → push → open PR. Do not announce "ready for review" / "tests pass" / "PR opened" until **every** applicable check above has produced green output. If a check is broken (e.g. harness won't boot for unrelated reasons), say so explicitly in the PR body — don't silently skip it.

**Why this matters:** Vercel preview deploys run on every PR push and are gated by the production build pipeline. A broken preview is a failed PR check that the owner sees in their inbox. The first PR for collapsible-push (May 2 2026) shipped with `lucide-react` imported in `packages/shared/components/WixPushModal.jsx` but not declared as a shared peerDep — local builds passed via npm-workspace hoisting, dashboard + delivery preview deploys failed on Vercel. Building all three apps locally before push would have caught it.

## Stale-doc rule
Any markdown doc whose body references current state and is dated >30 days old must be updated in the same session that touches it, or moved to `docs/archive/` with an "ARCHIVED YYYY-MM-DD" banner explaining what changed. Stale planning docs poison future Claude context — they get loaded into prompts and quietly contradict reality.

## Production Scripts
Every script in `scripts/` and `backend/scripts/` carries one category in a header comment. Adding a new script = pick a category up front.

| Category | Meaning | Example |
|---|---|---|
| SAFE | Read-only or pglite-isolated. Cannot mutate prod. | `backend/scripts/shadow-health.js`, `scripts/airtable-backup.mjs` |
| GUARDED | Refuses to run in `NODE_ENV=production` (or only mutates pglite). | `backend/scripts/start-test-backend.js`, anything seeding the test fixture |
| DESTRUCTIVE | Mutates prod Airtable / Railway PG. Requires explicit owner approval phrase before run. | `scripts/cleanup-test-orders.js`, `backend/scripts/backfill-stock.js` (idempotent but writes prod) |
| STALE | Pending deletion — kept only because removal isn't free. Never run. | `scripts/create-dev-base.js`, `scripts/setup-dev-base.js` (dev-base path was abandoned) |

## Working During Shadow Windows

A "shadow window" is the 7-day period between flipping a domain to `<DOMAIN>_BACKEND=shadow` (writes go to BOTH Airtable and Postgres, reads still come from Airtable, parity is logged) and flipping it to `postgres` (PG becomes source of truth). It is a runtime mode, **not a code freeze.** Bug fixes and features ship normally — but the constrained domain has rules.

### Phase status check before working
1. Read the "Migration cutover state" block at the top of `BACKLOG.md`. It records which `*_BACKEND` flag is at which value, and when the shadow window started.
2. The constrained domain is whichever flag is currently at `shadow`. As of 2026-04-30: **Stock**.
3. Validate at any time with `CLAUDE_RO_URL='<from railway>' node backend/scripts/shadow-health.js`. Output should say "✓ Shadow-write is healthy. No parity issues to investigate."

### Domain decision table (Stock shadow example — generalises to whichever domain is in shadow)

| You're touching... | Shadow-domain risk | What to do |
|---|---|---|
| UI / read-only feature / analytics / new report | None | Ship normally. |
| A non-shadowed domain (orders, customers, POs, deliveries, hours, marketing, Wix sync) | None | Ship normally. |
| A bug fix in routes already going through `stockRepo` | Low | Ship — `stockRepo` dispatches to the right store. Add or update an integration test if write semantics change. |
| A new feature that **writes** to the shadowed domain | Medium | Must use the repo (`stockRepo.update / .create / .atomicAdjust`). **Never** call `airtable.atomicStockAdjust()` directly — it bypasses the shadow path. New write paths require a `*.integration.test.js` exercising them against pglite. |
| Adding a column to the shadowed table | High — schema drift | See "Schema changes" sequence below. |
| A backfill / data-migration script | High | Run against prod only with explicit owner approval. Idempotent or it doesn't ship. |

### Schema changes — strict sequence
A new column on a shadowed entity must land in lockstep across both stores or `parity_log` will fire on every record.

1. **Airtable first** — owner adds the column in Airtable UI (production base). Confirms correct field name + type.
2. **PG migration** — Drizzle migration (`backend/src/db/migrations/`) adds the column. Commit + deploy.
3. **Mappers updated in the SAME PR** — `airtableTo*` / `*ToAirtable` in the affected repo (`stockRepo.js`, `orderRepo.js`, etc.). Otherwise reads/writes silently drop the field.
4. **Wait 24h** — let the next day's writes flow through the new field.
5. **Re-run shadow-health** — confirm `parity_log` is still 0. THEN start writing the field in business logic (services, routes).

### Discipline during shadow
- **Don't edit Airtable directly while shadow is on.** Owner-side manual stock edits in the Airtable UI bypass the backend → PG never sees them → next shadow-write reports a divergence that isn't real. If you need to fix Airtable data, do it through the app (florist or dashboard), which routes through `stockRepo`.
- **Treat parity_log → freeze trigger.** If `parity_log` row count goes 0 → N during a shadow window, freeze merges that touch the constrained domain until root cause is found and parity is restored to 0. The shadow-health agent (Telegram, daily) is the canary.
- **Don't try to "speed-run" the shadow week.** The 7 clean days exist to catch race conditions, edge-case writes (cancel-with-return, bouquet edit, premade dissolve), and concurrent multi-actor sequences. Cutting it short trades a week of caution for hours of incident.

### Mixed-mode is rejected at boot
The boot guard in `backend/src/index.js` refuses combinations that split a single business operation across two stores. Specifically: `ORDER_BACKEND=postgres` requires `STOCK_BACKEND=postgres`; `ORDER_BACKEND=shadow` requires `STOCK_BACKEND ∈ {shadow, postgres}`. Order creation deducts stock — running orders on PG while stock stays on Airtable would commit one half on each store with no shared transaction. Always cut over the dependency-leaf domain (stock) before its dependents (orders).

## Change Summaries (IMPORTANT)
After completing each logical step of work (not just at the end), write a short **owner-friendly summary** explaining:
1. **What changed** — which files, what was added/removed/moved
2. **Why** — the problem it solves or the reason behind the approach
3. **How it connects** — how it fits into the existing architecture
4. **What to watch for** — any trade-offs, things that could break, or areas the owner should understand for future decisions

Keep it concise but educational. The goal is for the owner to build a mental model of the codebase over time, not just approve changes blindly. Use concrete file paths and line references, not abstract descriptions.
