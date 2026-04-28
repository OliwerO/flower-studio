# 3b — End-to-End Test Harness: design

_Drafted: 2026-04-28 · Branch: `claude/test-harness-mock-airtable-HiFJx`_

## What this is, in one paragraph

A local-only test mode that runs the **real** backend, the **real** three React
apps, and the **real** Postgres-cutover code paths against an in-process
pglite database and a JSON-fixture-backed Airtable mock. No prod Airtable
contact, no Railway connection, no Wix webhook signature, no Telegram bot.
The same harness powers Playwright E2E tests today and serves as our
permanent dev/staging substitute as Phase 4–7 cutovers proceed.

## Why this is the right shape

The migration's biggest risk isn't "does the SQL work" — Phase 3's
`stockRepo.integration.test.js` and `simulate-stock.js` already prove that.
The risk is **"do the React apps still behave correctly when the backend
swaps from Airtable to Postgres".** That's a question only an end-to-end
test against the actual UI can answer.

The alternative — flip `STOCK_BACKEND=shadow` on prod and watch the parity
dashboard — validates the deployment but discovers UI regressions on real
customers. Building this harness lets us catch the regressions first,
land them in a PR, and then flip with confidence.

## The four moving parts

```
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│ apps/florist  (5173) │   │ apps/delivery (5174) │   │ apps/dashboard (5175)│
└──────────┬───────────┘   └──────────┬───────────┘   └──────────┬───────────┘
           │  /api/* via Vite proxy   │                          │
           └──────────────────────────┴──────────────────────────┘
                                      ▼
                       ┌────────────────────────────┐
                       │ backend Express  (3002)    │   port 3002 (not 3001)
                       │  - real routes/middleware  │   so a real local backend
                       │  - real orderService       │   on 3001 isn't disturbed
                       │  - real stockRepo/orderRepo│
                       └────────┬──────────┬────────┘
                                │          │
              ┌─────────────────┘          └────────────────┐
              ▼                                             ▼
   ┌──────────────────────┐                   ┌──────────────────────────┐
   │ pglite (in-memory)   │                   │ airtable-mock.js         │
   │  - migrations applied│                   │  - JSON fixture seeded   │
   │  - real audit_log    │                   │  - in-memory Map         │
   │  - real parity_log   │                   │  - filterByFormula subset│
   └──────────────────────┘                   └──────────────────────────┘
```

Each box is a distinct piece, addressed below.

## Decisions

### 1. Hand-curate the JSON fixture, don't snapshot prod

Two real options:

- **Snapshot prod**: `airtable-export -> JSON`. Realistic but contains real
  customer PII (phone numbers, addresses, emails). Would need scrubbing,
  and even scrubbed it carries the schema-drift risk we just spent
  Phase 0 fighting.
- **Hand-curate**: 5 customers, 10 stock items, 3 orders + lines +
  deliveries, 2 POs. Synthetic phone numbers (+48 555 *), Krakow-shaped
  addresses, intentionally diverse states (one paid order, one unpaid;
  one Delivery, one Pickup; one Cancelled).

We pick **hand-curate**. Three reasons:

1. **No PII in git.** Test fixtures land in a public-ish repo. Real customer
   data, even old, must never.
2. **Each test scenario gets a known starting state.** Tests stay
   deterministic — `Red Rose qty 50, Pink Tulip qty 30` is what every spec
   reads on boot. A snapshot's "yesterday's data" makes tests flaky as
   reality drifts.
3. **The fixture documents the schema we depend on.** A hand-curated file
   shows exactly which fields the backend reads — the "minimum viable
   Airtable" — which is itself useful documentation for Phase 7's
   retire-Airtable inventory.

The fixture is a single file: `backend/src/services/__fixtures__/airtable-test-base.json`,
keyed by table id (the same `TABLES.*` identifier that `services/airtable.js`
takes as its first arg). It's loaded once at boot, deep-cloned into the
in-memory Map, and reset between Playwright spec files.

### 2. The Airtable swap: rename, not in-place toggle

Constraint says "do NOT modify the real airtable.js code paths." Three
approaches:

- **Conditional code in airtable.js**: `if (TEST_BACKEND) { ... } else { ... }`.
  Mixes real + mock code, defeats the constraint, footgun-prone.
- **Module mock at test runner level**: `vi.mock('./airtable.js')`. Works
  for unit tests, doesn't work when the *backend process* is what we're
  spinning up — Vitest's mocking machinery isn't there.
- **Rename + shim** (chosen): move today's `airtable.js` → `airtable-real.js`
  byte-for-byte. New `airtable.js` is a 12-line shim that does
  `await import(...)` of mock or real based on `TEST_BACKEND`. The real
  code paths stay unmodified — they just live in a renamed file. Every
  caller of `services/airtable.js` continues to work because the shim
  re-exports the same function names.

The shim uses **dynamic import**, not a static one, so the Airtable SDK
client (`config/airtable.js` calls `new Airtable(...)` at module load) is
never even loaded in test mode. That sidesteps the question of whether
the SDK is happy with `undefined` API keys.

### 3. The TEST_BACKEND footgun guard

The kickoff prompt called this out explicitly: "how to make the
TEST_BACKEND swap not turn into a footgun (e.g., some path setting it
accidentally on prod)."

Three layers of defence, in increasing severity:

1. **Boot banner**: when the shim picks the mock, the backend prints a
   loud red `[MOCK AIRTABLE] Using in-memory fixture — NOT touching
   production Airtable` line on every startup. Visible in any deploy log.
2. **NODE_ENV gate**: in `airtable.js` shim, if `TEST_BACKEND` is set
   AND `NODE_ENV === 'production'`, throw a startup error and `process.exit(1)`.
   Same gate in `db/index.js` for the `pglite:memory` sentinel. Railway
   sets `NODE_ENV=production` by default, so a stray env var in the
   Railway dashboard would crash boot, not silently switch to in-memory.
3. **Schema validator gate**: `validateAirtableSchema()` (which calls the
   live Meta API) is skipped in test mode. If it weren't, the test
   backend would fail boot trying to hit Airtable with `apiKey=mock`.
   The skip is itself logged, so an accidental `TEST_BACKEND=mock-airtable`
   in CI/prod is visible.

The guard order matters: NODE_ENV check first (cheapest), then mode
selection, then validator skip. We never reach the validator skip on prod.

### 4. pglite as the Postgres backend, with one sentinel

`db/index.js` today decides on Postgres-or-not based on `DATABASE_URL`.
We extend that to recognise a sentinel value: `DATABASE_URL=pglite:memory`.
When set, it boots an in-process PGlite instance and applies the same
SQL migrations Railway runs (we already do this in
`backend/src/__tests__/helpers/pgHarness.js` and `scripts/simulate-stock.js`
— the proven pattern).

The drizzle handle returned is `drizzle-orm/pglite`, not `drizzle-orm/node-postgres`.
Both implement the same query interface, so repos calling `db.select()...`
don't notice. The only place that knows is the bootstrap code in
`db/index.js`.

Why a sentinel string and not a separate `PGLITE=true` env var: keeps the
"how do I configure the DB" answer in one variable. Easier to grep, easier
to remember, less plumbing in `start-test-backend.js`.

### 5. Playwright booting four servers reliably

Playwright's `webServer` config takes an array. Each entry has
`{ command, url, reuseExistingServer, timeout }`. Booting four servers
(test backend on 3002, florist on 5173, delivery on 5174, dashboard on 5175):

- **Order**: backend first (the apps' `/api` proxy needs a target).
  Playwright doesn't enforce ordering, but each app's healthcheck URL
  goes through the proxy → goes to the backend → so the apps
  effectively wait for the backend to come up. We don't need explicit
  serialisation; the proxy creates it.
- **Health URLs**:
  - backend: `http://localhost:3002/api/health` (already exists)
  - apps: `http://localhost:5173|5174|5175/` — Vite serves index.html
    once the dev server is ready. Good enough.
- **`reuseExistingServer: !process.env.CI`**: locally, leave servers
  running between spec runs (faster iteration). In CI, kill and restart
  for cleanliness.
- **Timeout**: 60s for backend (pglite migrations are fast but cold), 30s
  for each Vite server. Vite cold-starts in ~3s; 30s gives generous
  headroom for slow CI.

Vite proxy config in each app needs to point at port 3002, not 3001,
when in test mode. Cleanest: read `process.env.VITE_API_PROXY_TARGET` in
`vite.config.js` with a default of `http://localhost:3001`. Playwright
sets `VITE_API_PROXY_TARGET=http://localhost:3002` when it spawns the
Vite servers. Production builds (Vercel) don't run vite dev, so no
production-path leakage.

### 6. The mock's filterByFormula evaluator — pragmatic subset

Airtable formulas are a full DSL. We don't need the full DSL — we need
**the subset the backend uses today**. A grep for `filterByFormula`
across `backend/src/` returns 85 distinct expressions. The grammar they
use:

| Pattern | Frequency | Mock supports |
|---|---|---|
| `{Field} = '<v>'` | very high | yes |
| `{Field} != '<v>'` | high | yes |
| `{Field} = TRUE() / FALSE()` | high | yes |
| `{Field}` (truthy) | medium | yes |
| `{Field} > <n>` / `<` / `>=` / `<=` | medium | yes |
| `{Field} = ''` | medium | yes |
| `RECORD_ID() = "rec..."` | very high | yes |
| `AND(a, b, ...)` | very high | yes |
| `OR(a, b, ...)` | very high | yes |
| `NOT(x)` | medium | yes |
| `IS_BEFORE({d}, '<date>')` | low | yes |
| `IS_AFTER({d}, '<date>')` | low | yes |
| `DATESTR({d}) = '<date>'` | low | yes |
| `FIND("marker", {f} & "") > 0` | low | yes (string contains) |
| `SEARCH('q', {f})` | low | yes (case-insensitive contains) |
| Anything else | rare | falls through, returns all rows + warns |

The implementation is a small recursive-descent parser
(`backend/src/services/airtable-mock-formula.js`). When parsing fails or
hits an unknown token, the mock logs a warning and returns the unfiltered
result set. That's intentional: an over-permissive mock is safer than a
crashing one for E2E testing — the test asserts on UI behaviour, and an
unfiltered result will usually trigger a visible test failure (more rows
than expected) rather than masking a bug.

### 7. Realistic split: foundation now, full UI specs incrementally

The seven-deliverable plan is correct, but a single PR that lands all
seven E2E specs end-to-end-green is unrealistic given the React
selectors haven't been written for testability and we have no
existing Playwright config to model.

What this PR ships:

- **Foundation (1–5)**: design doc, mock + fixture + formula evaluator,
  pglite boot mode, start-test-backend.js, Playwright config, **one**
  happy-path spec (florist order creation).
- **Spec scaffolding (6)**: the remaining six spec files exist with
  realistic user flows expressed as Playwright code, marked
  `test.describe.skip` (so the green check passes) plus a TODO comment
  explaining which selectors / `data-testid`s need to be added to the
  React apps for the spec to flip to `test.describe`. Each skipped spec
  is a self-contained checklist for a follow-up PR.
- **CI plan (7)**: documented in `BACKLOG.md` as a sketch of the
  GitHub Actions workflow. Owner enables when ready.

Why the scaffolding instead of nothing: the framework is the part that's
hard to get right. Once it works for one spec, every other spec is "find
the right selectors, write the assertions" — incremental, low-risk,
parallelisable. Landing all six skeletons in this PR sets the contract;
the fill-in-the-blanks PRs are mechanical.

### 8. Wix-webhook-replay: capture the payloads later

The kickoff prompt asks us to "capture them from prod Webhook Log table
first; commit sanitized copies as test fixtures." This requires the
owner's prod Airtable access — out of scope for this branch. We commit
**one synthetic Wix-shaped payload** to demonstrate the harness shape,
mark the spec skipped with a TODO pointing at the prod Webhook Log table,
and document the sanitisation steps in the spec's header comment.

## How a developer uses the harness

```bash
# One-time setup
npm install
npx playwright install chromium

# Day-to-day: spin everything up
node backend/scripts/start-test-backend.js
# In another terminal:
npm run florist     # 5173
npm run delivery    # 5174
npm run dashboard   # 5175

# Or let Playwright spin everything up:
npx playwright test
```

A developer iterating on a feature can hit `http://localhost:5173/login`
with PIN `1111` (owner) and use the app exactly as the owner would. No
`.env` configuration, no Airtable key, no Postgres setup. The price of
admission to the codebase drops to "Node 20+ installed".

## What this harness doesn't replace

The shadow-write parity dashboard on prod. Two things only prod traffic
can validate:

- Wix webhook bursts under real load (timing, retries, idempotency).
- Saturday peak — five florists, two drivers, one owner all writing
  simultaneously, against the real PG row locks and the real Airtable
  rate limit.

Run E2E and shadow-write in parallel. They cover different failure
modes — code correctness vs. deployment correctness.

## File inventory

New files:

| Path | Purpose |
|---|---|
| `docs/migration/3b-e2e-harness-design.md` | this doc |
| `backend/src/services/airtable-real.js` | byte-for-byte move of today's `airtable.js` |
| `backend/src/services/airtable.js` | dynamic-import shim |
| `backend/src/services/airtable-mock.js` | mock implementation |
| `backend/src/services/airtable-mock-formula.js` | filterByFormula evaluator |
| `backend/src/services/__fixtures__/airtable-test-base.json` | seed fixture |
| `backend/scripts/start-test-backend.js` | one-command harness boot |
| `playwright.config.js` | top-level Playwright config |
| `tests/e2e/helpers/login.js` | shared PIN-login helper |
| `tests/e2e/helpers/test-base.js` | per-test reset (calls /api/test/reset) |
| `tests/e2e/florist-order-creation.spec.js` | happy-path, **runs** |
| `tests/e2e/florist-bouquet-edit.spec.js` | scaffolded, skipped |
| `tests/e2e/owner-cancel-with-return.spec.js` | scaffolded, skipped |
| `tests/e2e/owner-soft-delete-restore.spec.js` | scaffolded, skipped |
| `tests/e2e/admin-tab-parity.spec.js` | scaffolded, skipped |
| `tests/e2e/driver-delivery-complete.spec.js` | scaffolded, skipped |
| `tests/e2e/wix-webhook-replay.spec.js` | scaffolded, skipped |
| `tests/e2e/fixtures/wix-webhook-sample.json` | one synthetic payload |

Modified files:

| Path | Change |
|---|---|
| `backend/src/db/index.js` | recognise `DATABASE_URL=pglite:memory`, boot pglite + apply migrations |
| `backend/src/index.js` | NODE_ENV-prod guard, skip schema validator in test mode, boot banner |
| `apps/florist/vite.config.js` | read `VITE_API_PROXY_TARGET` |
| `apps/delivery/vite.config.js` | read `VITE_API_PROXY_TARGET` |
| `apps/dashboard/vite.config.js` | read `VITE_API_PROXY_TARGET` |
| `package.json` (root) | add `@playwright/test` devDep, `test:e2e` script |
| `BACKLOG.md` | mark 3b done, add CI workflow sketch |
| `CHANGELOG.md` | one entry summarising the harness |

## Acceptance criteria

- `node backend/scripts/start-test-backend.js` boots cleanly with no
  network access and prints the URLs to hit.
- `curl -H 'X-Auth-PIN: 1111' http://localhost:3002/api/stock` returns
  the seeded stock items in JSON.
- `npx playwright test florist-order-creation.spec.js` runs green,
  exercises the create-order flow against pglite, and asserts the audit
  log has a `stock:update` row with `actorRole='owner'`.
- A grep for `TEST_BACKEND` across `backend/src/services/airtable-real.js`
  returns nothing — proving the real code path was not modified.
- Booting with `NODE_ENV=production TEST_BACKEND=mock-airtable node ...`
  exits with code 1 and a clear error.

## Out of scope (intentional)

- Replaying recorded prod Wix payloads — needs owner's Airtable access.
- Driver-app E2E full coverage — the driver app is small, one happy-path
  spec is enough; deep deliveries scenarios stay manual until Phase 4.
- Performance / load testing — pglite isn't representative of Railway PG
  under contention; that's a shadow-write concern.
- Visual regression / screenshot diffing — Playwright can do it, but
  flakiness from font rendering across machines isn't worth the signal.
