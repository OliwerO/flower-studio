# 3b — End-to-End Test Harness: kickoff prompt for a new chat

_Saved 2026-04-28. Use this verbatim as the first message in a fresh
Claude session to start building the local-PG-only E2E test harness._

## Where to run it

The harness has zero local-OS dependencies. Anywhere with Node 20+ works:

- **GitHub Codespaces** (recommended — zero setup, one click from the repo
  page → "Code" → "Codespaces" → "New codespace on master"). Once it boots,
  start the Claude session inside the codespace terminal.
- **Gitpod** — `https://gitpod.io/#https://github.com/OliwerO/flower-studio`
- **Replit** — fork the repo, open a Node template
- **Any cloud Linux box** with Node 20+ installed
- **A second machine of your own** (not strictly necessary, but works)

What the harness uses that needs to actually run:

- `@electric-sql/pglite` (already in package.json) — in-process Postgres,
  no install, no Docker.
- `@playwright/test` (will be installed during 3b) — pulls a headless
  Chromium binary on first run.
- Vite dev servers for the 3 React apps — listen on ports 5173, 5174, 5175.
- Backend Express server — port 3001.

All of these run on a single machine / container. No external services.

## The prompt — copy this verbatim into the new chat

---

```
We just merged PR #156 (SQL migration foundation — Phase 1 + 2.5 + 3 stock
cutover scaffolding) and PR (Phase 4 prep, design + schema + skeleton).
The default STOCK_BACKEND=airtable and ORDER_BACKEND=airtable means prod
behavior is unchanged.

Read these for context before doing anything:
- docs/migration/execution-plan-2026-04-27.md (overall strategy)
- docs/migration/phase-4-orders-design.md (Phase 4 design)
- backend/src/repos/stockRepo.js (the proven cutover pattern)
- backend/scripts/simulate-stock.js (what "good" looks like for stock)

I want option 3b from a previous conversation: build a local-PG-only test
mode so we can run end-to-end UI tests through the florist + driver +
dashboard apps WITHOUT touching prod Airtable. This becomes our permanent
dev/staging substitute.

Goal: full confidence the migration works end-to-end before flipping
STOCK_BACKEND=shadow / ORDER_BACKEND=shadow on Railway. Test the actual
user flows:
  - Florist creates an order with a bouquet → stock deducts in Postgres
  - Driver delivers it → status cascades correctly (order ↔ delivery)
  - Owner edits a Ready bouquet → stock adjustments + audit log correct
  - Owner cancels with stock-return → stock returns to original quantity
  - Owner write-off → Stock Loss Log + dead stems counter
  - Owner recovers a soft-deleted stock item via Admin tab
  - Verify Admin tab parity dashboard shows zero mismatches end-to-end
  - Verify audit log captures actor identity correctly per role

Build plan:

1. Mock Airtable service backed by static JSON fixtures.
   - File: backend/src/services/__fixtures__/airtable-test-base.json
     (snapshot of minimal but realistic data: 5 customers, 10 stock items,
     3 orders with lines + deliveries, 2 POs)
   - Module: backend/src/services/airtable-mock.js implements the same
     interface as services/airtable.js (list, getById, create, update,
     deleteRecord, atomicStockAdjust)
   - Backed by an in-memory map seeded from the JSON. Mutations persist
     to the map (not to disk) so test sequences can chain operations.
   - Generates rec-prefixed ids on insert: `recMockX${counter}`.

2. Backend boot mode that swaps the real Airtable client for the mock.
   - Trigger: env var TEST_BACKEND=mock-airtable
   - When set, services/airtable.js re-exports from airtable-mock.js
     (use a small switching shim — do NOT modify the real airtable.js
     code paths)
   - Validate at boot: TEST_BACKEND can only be set when NODE_ENV !==
     'production'. Fail-fast otherwise.

3. Backend boot mode for in-process pglite as the Postgres backend.
   - Trigger: env var DATABASE_URL=pglite:in-memory (or similar sentinel)
   - When set, db/index.js boots pglite instead of node-postgres
   - Apply migrations on boot
   - Audit/parity tables work identically — same schema applies

4. Boot script: backend/scripts/start-test-backend.js
   - Sets TEST_BACKEND=mock-airtable, DATABASE_URL=pglite:in-memory,
     STOCK_BACKEND=postgres, ORDER_BACKEND=postgres (so cutover paths
     are exercised end-to-end)
   - Seeds Stock + Customers + a few orders from JSON fixture
   - Starts Express on a known port (default 3002 to avoid conflict
     with a real local backend on 3001)
   - Logs the URLs the frontends should hit

5. Playwright setup at repo root.
   - npm i -D @playwright/test (npx playwright install for browsers)
   - playwright.config.js — boots:
     - test backend (start-test-backend.js)
     - florist dev server (port 5173)
     - delivery dev server (port 5174)
     - dashboard dev server (port 5175)
   - Each frontend app's vite.config.js may need a proxy override to
     point at port 3002 in test mode (use VITE_API_BASE env var)

6. E2E test files in tests/e2e/:
   - florist-order-creation.spec.js — login → new order wizard → bouquet
     → submit → assert PG stock row decremented, audit log row exists
   - florist-bouquet-edit.spec.js — open Ready order → swap one flower
     → assert old flower returned + new flower deducted
   - owner-cancel-with-return.spec.js — full cancel flow
   - owner-soft-delete-restore.spec.js — Admin tab interactions
   - admin-tab-parity.spec.js — verify zero mismatches after a real flow
   - driver-delivery-complete.spec.js — driver app flow
   - wix-webhook-replay.spec.js — replay 2-3 captured Wix webhook
     payloads (capture them from prod Webhook Log table first; commit
     sanitized copies as test fixtures)

7. CI integration plan documented in BACKLOG.md.
   - Don't wire to actual CI yet — just document what the GitHub Actions
     workflow would look like. Owner decides when to enable.

Constraints:
- DO NOT touch the production Airtable base. All work happens against
  the mock.
- DO NOT modify production code paths beyond the swap point in
  services/airtable.js.
- Default mode (no TEST_BACKEND env var) MUST behave identically to
  today.
- Use existing patterns: vitest for unit, Playwright for E2E.
- New branch off master: feat/test-harness-mock-airtable.

Ultrathink the design before coding — there are tradeoffs around how
to seed the Airtable fixture (snapshot of prod schema vs hand-curated
minimal set), how Playwright should boot multiple dev servers reliably,
and how to make the TEST_BACKEND swap not turn into a footgun (e.g.,
some path setting it accidentally on prod). Address these in a design
doc before writing implementation code.

Deliverables in order:
1. Design doc: docs/migration/3b-e2e-harness-design.md
2. Mock Airtable + fixture
3. pglite-as-Postgres boot mode
4. start-test-backend.js
5. Playwright config + 1 happy-path spec
6. The remaining specs
7. Documentation update
```

---

## What this gets you

When the harness is built:

- One command to spin up: `node scripts/start-test-backend.js` boots
  the test backend, the 3 frontends, ready to be driven by Playwright.
- E2E tests that exercise the full stack — the ACTUAL React apps, the
  ACTUAL Express routes, the ACTUAL stockRepo / orderRepo, against an
  ACTUAL Postgres (pglite) and a faithful Airtable mock.
- A permanent dev/staging substitute. The same harness becomes the way
  to develop new features without touching prod Airtable, the way to
  validate Phase 5 / 6 / 7 cutovers, and the way to onboard any future
  contributor.

## What it doesn't replace

The shadow-write parity dashboard on prod. That tells you about
real-world traffic patterns (Wix webhooks, time-of-day bursts, etc.)
that no synthetic harness can fully reproduce. The E2E harness validates
the code; shadow-write validates the deployment.

Run them in parallel. They cover different risks.
