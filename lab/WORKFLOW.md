# Lab Harness Workflow Guide

Comprehensive guide for development workflow + maintenance discipline now that the lab harness is shipped (PR #268, ADR 0004). This doc is the source of truth — root `CLAUDE.md` references it, and the GitHub PR template enforces its checklist on every PR.

## 1. Does this work need the lab?

| Work shape | Lab? | Why |
|---|---|---|
| Typo, copy/translation, doc-only PR | No | CI catches everything that matters; lab is overhead |
| One-line bugfix obvious from stack trace | No | Same |
| New service or shared util (≤200 LOC) | No, but write tests | Existing pglite harness + vitest cover it |
| **Schema change** (new column, new table) | **Update factories in same PR** | Otherwise lab fixtures drift and `lab-api` CI fails |
| New backend route or service feature | Optional | Depends on UI scope; pglite E2E often enough |
| **Major UI redesign** (Stock tab, new CRM flows) | **Yes** | Motivating use case — agent walks paths against seeded data |
| **Cross-cutting refactor** (e.g. payment overhaul) | **Yes** | Scenario coverage prevents regression sneak-through |
| Cutover prep / migration rehearsal | Phase 2 (deferred) | Synthetic-only today; snapshot import lands later |

**Rule of thumb:** lab is for "would I want an agent to walk every path against realistic data before this hits prod?" If yes, use it. Otherwise skip.

## 2. Major-overhaul workflow (canonical chain)

```
/feature <one-line>
  ↓
grill-with-docs               # stress-test design vs CONTEXT.md + ADRs
  ↓
brainstorming → to-prd → to-issues   # if ambiguity / multi-PR scope
  ↓
writing-plans                 # docs/superpowers/plans/YYYY-MM-DD-<feature>.md
  ↓
using-git-worktrees           # .claude/worktrees/<feature>/
  ↓
[LAB] Build/refresh scenario for this overhaul:
  - Add/update factories if schema changed
  - Create lab/scenarios/<overhaul-name>.js (compose factories)
  - Register in lab/scenarios/index.js
  - npm run lab:template:rebuild -- --scenario=<overhaul-name>
  - Verify counts in psql
  ↓
subagent-driven-development   # Sonnet executors per task
  ↓
TDD red-green for backend logic / shared utils
  ↓
[LAB] After each phase, agent runs against lab:
  - npm run lab:reset
  - npm run lab:test:api  (regression gate)
  - Optional: npm run lab:dev → manual UI walkthrough
  - Promote stable findings to lab/tests/api/ or lab/tests/ui/
  ↓
verification-before-completion
  ↓
finishing-a-development-branch
```

## 3. Routine PR workflow (lab NOT actively used)

```
/feature for plan + worktree (or just a fresh branch)
  ↓
TDD where applicable
  ↓
cd backend && npx vitest run
npm run harness & npm run test:e2e   # if backend touched
  ↓
PR → CI gates (lint + unit + e2e + lab-api)
```

`lab-api` runs in CI on **every** PR — even routine ones. It's the regression gate that ensures:
- Factories still match schema
- Baseline scenario still seeds cleanly
- cancel-with-return integration test still passes

If `lab-api` fails on a routine PR, you broke a factory or the schema drifted. Fix before merging.

## 4. Lab maintenance discipline (mandatory)

### 4.1 Schema change → factory update in the same PR

Adding a column to `orders` / `stock` / `customers` / etc.:

1. Drizzle migration adds column under `backend/src/db/migrations/`
2. `backend/src/db/schema.js` updated
3. **`lab/factories/<entity>.js` updated** — sensible default for the new column
4. **Factory test updated** — assertion if behaviour matters
5. Re-run `npm run lab:template:rebuild -- --scenario=baseline` locally to catch issues
6. CI runs `lab-api` → validates the factory still seeds cleanly

If you skip step 3 and the column is NOT NULL: `lab:template:rebuild` fails with `null value in column "X" violates not-null constraint`. CI catches it.

If the column is nullable: factory silently doesn't exercise it. Subtle gap — caught only by review or by a test that explicitly cares about the column. Add the column to the factory anyway for completeness.

### 4.2 Schema change → `app_order_id`-style field discipline

Some columns have generation logic (counters, timestamps). Mirror prod-style generation in the factory rather than letting it default to `null` if the column is NOT NULL.

### 4.3 Scenario lifecycle

- Each scenario has a single owner: the overhaul it was built for
- After overhaul ships and stabilizes (~30 days), re-evaluate:
  - **Keep** if it's still useful for regression rehearsal of that area
  - **Archive** to `lab/scenarios/_archived/` (create dir on first archival) if no longer driving anything
- Don't accumulate scenarios indefinitely — they become a graveyard

### 4.4 Factory coverage gaps

Currently covered: Customer, StockItem, Order, OrderLine, Delivery.
Not covered: PO (StockOrder + StockOrderLine), Premade Bouquet, Florist Hours, Marketing Spend, Feedback, KeyPerson, LegacyOrder.

Add when the first scenario needs them. Pattern:
1. `lab/factories/<entity>.js` — pure function, returns row matching `backend/src/db/schema.js`
2. `lab/factories/<entity>.test.js` — TDD red-green
3. Export from `lab/factories/index.js`
4. Use in scenarios

### 4.5 Determinism test discipline

Determinism tests must compare ONLY faker-derived stable fields. Never include `created_at` / `updated_at` (they use `new Date()` and will flake on CI under load).

```javascript
// Right
expect(a.id).toEqual(b.id);
expect(a.name).toEqual(b.name);

// Wrong — will flake on CI
expect(a).toEqual(b);
```

## 5. Agent invocation patterns

### "Test the new stock tab before merge" (exploratory)

```
You: /feature Stock tab redesign
  → grill-with-docs runs
  → plan written
  → worktree created
  → implementation begins
...
At any phase boundary or pre-PR:
You: "Run the lab against stock-overhaul scenario and probe the new tab"
Claude:
  - npm run lab:template:rebuild -- --scenario=stock-overhaul
  - npm run lab:reset
  - npm run lab:dev (background)
  - Drives UI via Playwright (screenshots at each step)
  - Inspects DB state via labPool() between actions
  - Reports findings: "saw X, Y broken, Z works"
```

### "Add a deterministic test for the new endpoint"

```
You: "Add a lab API test for POST /orders/:id/some-new-action"
Claude:
  - Writes lab/tests/api/some-new-action.test.js
  - Pattern: reset → boot backend → snapshot → act → assert state + data
  - Mirrors cancel-with-return.test.js shape
  - Runs npm run lab:test:api locally
  - Test joins CI lab-api job automatically
```

### "Spin up lab to click around"

```
You: "Spin up the lab with stock-overhaul, I want to click around"
Claude:
  - npm run lab:db:up (if not running)
  - npm run lab:template:rebuild -- --scenario=stock-overhaul
  - npm run lab:reset
  - npm run lab:dev
  - Reports: "dashboard at localhost:5177, 230 stock items seeded, owner auto-auth"
```

## 6. Pre-PR verification matrix (CLAUDE.md MANDATORY)

For any PR touching backend/, packages/shared/, or lab/:

```bash
# Backend changes
cd backend && npx vitest run

# E2E if backend touched
npm run harness &
npm run test:e2e

# Shared changes — build all 3 apps (catches missing peerDeps)
cd packages/shared && ../../backend/node_modules/.bin/vitest run
cd apps/florist   && ./node_modules/.bin/vite build
cd apps/dashboard && ./node_modules/.bin/vite build
cd apps/delivery  && ./node_modules/.bin/vite build

# Lab harness
npm run lab:test:unit
npm run lab:test:api
# UI test only if you changed UI / scenarios:
npm run lab:test:ui
```

PR description should list which checks ran. If a check broke for unrelated reasons, say so — don't silently skip.

## 7. Common pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Schema column added, factory not updated | `lab-api` CI fails with "column X does not exist" or NOT NULL violation | Update factory in same PR as schema change |
| Test compares full objects with `expect(a).toEqual(b)` | Passes locally, fails on CI under load | Compare faker-derived stable fields only; never include `created_at`/`updated_at` |
| Scenario hardcodes column names that will drift | Future schema change silently breaks scenario | Use factory output (`stock.display_name`) instead of literal strings |
| Backend running while reset attempted | `database "lab" is being accessed by other users` | `lsof -nP -iTCP:3003 -t \| xargs -r kill` before reset |
| Lab Vite ports conflict with pglite harness | Vite refuses to start on 5176/5177/5178 | Two harnesses use disjoint port ranges by design — stop the other before booting |
| Wrong scenario in template DB | Tests fail because data shape doesn't match | `npm run lab:template:rebuild -- --scenario=baseline` to re-seed |
| Lab tests passed but UI broke in prod | Lab doesn't catch deploy-time issues | Vercel preview deploys + signed-Wix-replay still own those gaps; lab is additive |
| Factory output includes camelCase keys leaking into row | `column "stockItemId" of relation "..." does not exist` | Destructure factory-only inputs (`orderId`, `stockItemId`, `costSnapshot`, `sellSnapshot`) before spread |

## 8. Cost discipline (CLAUDE.md memory)

For lab work specifically:
- **Sonnet executors** for factory + scenario + test scaffolding (mechanical follow-spec)
- **Opus** only for: scenario design judgment, debugging weird CI failures, ADR writing
- **Per-task review** for Known Pitfall areas (cancel-with-return, stock math, status workflows, Wix sync)
- **Phase-boundary review** for everything else

Single Opus window should cover: 1 scenario + 5-10 lab tests + supporting refactor.

## 9. Phase 2 triggers

Revisit ADR 0004 + extend the harness when:
- A migration with non-trivial timing risk approaches → add anonymized snapshot import
- A new overhaul touches Wix sync deeply → consider deployed Railway staging
- More than 3 scenarios accumulate without owners → tooling for scenario lifecycle (auto-prune, last-touched timestamps)
- pglite E2E becomes flaky or limiting → migrate CI off pglite onto lab

## 10. Enforcement automation

The following automations enforce this guide so it doesn't drift:

1. **CI `lab-api` job** runs on every PR + push to master. Catches:
   - Factory drift from schema (NOT NULL violations, missing columns)
   - Broken cancel-with-return (Known Pitfall regression gate)
   - Broken baseline scenario (FK integrity, seed pipeline)
2. **GitHub PR template** (`.github/pull_request_template.md`) prompts the author to confirm lab discipline (factory updates, test additions) on schema changes.
3. **Root `CLAUDE.md`** references this doc in the workflow section so every Claude session inherits the discipline.
4. **`lab-api` is non-bypassable** — even routine PRs run it. Drift is caught at PR-time, not in prod.

The lab is purely additive; failure of `lab-api` blocks merge but doesn't affect the existing `e2e` (pglite) gate. Both must pass.
