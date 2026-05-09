# Phase 7 PR 2b — Airtable Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the Airtable infrastructure now that no production code path reads from or writes to it. Strip the mode-flag plumbing, the fallback branches in repos/services/routes, the schema validator, the npm dep, the boot guard, and the mocks. Update CLAUDE.md to reflect the post-Airtable architecture. After this PR lands, the only Airtable trace left is `__fixtures__/airtable-test-base.json` (read-only seed source for `phase7pr2a-seed.js`) and historical mention in the docs/migration archive.

**Architecture:** Strip-then-delete. Phase A removes airtable fallback branches from the live code paths (repos + services + routes + boot guard) — every function becomes PG-only, with the same external signature. Phase B deletes the now-unimported leaf files (`airtable.js`, `airtable-real.js`, `airtable-mock.js`, `airtable-mock-formula.js`, `airtableSchema.js`, `config/airtable.js`, `utils/batchQuery.js`) and drops the `airtable` npm dep. Phase C updates CLAUDE.md and ships.

**Tech Stack:** Node 22, Express, Drizzle ORM, Vitest, Playwright E2E.

**Key constraints:**
- **Production-only.** Every change ships to live operations. No staging.
- **Owner ALSO needs to**: cancel the Airtable subscription after merge (out of code scope; flag in PR description and CHANGELOG).
- **`STOCK_BACKEND` and `ORDER_BACKEND` env vars** in Railway: PR 2b makes them meaningless. Owner should remove them from Railway after merge — flag in PR description.
- **`__fixtures__/airtable-test-base.json` stays** — the harness seed reads it directly via `phase7pr2a-seed.js`. Don't rename in PR 2b (cosmetic; file as NICE-TO-FIX for later).
- **Wix orders must keep working.** `processWixOrder` ships PG-native after PR 2a. PR 2b touches `reprocessWixOrder`'s else-of-PG-mode branch (dead code), not the happy path. E2E section 24 (HMAC replay) gates this.
- **Audit log writes survive.** `createOrder`, `cancelWithStockReturn`, `deleteOrder`, `editBouquetLines`, `updateOrder`, `updateDelivery`, `convertToDelivery` all already write audit rows in their PG branches. The fallback branches that bypass audit are what we're deleting — auditability improves, doesn't degrade.

---

## File Structure

### Deleted in PR 2b
- `backend/src/services/airtable.js`
- `backend/src/services/airtable-real.js`
- `backend/src/services/airtable-mock.js`
- `backend/src/services/airtable-mock-formula.js`
- `backend/src/services/airtableSchema.js`
- `backend/src/config/airtable.js`
- `backend/src/utils/batchQuery.js`

### Modified in PR 2b
- `backend/src/index.js` — drop `validateAirtableSchema` import + call, strip `STOCK_BACKEND` / `ORDER_BACKEND` mixed-mode boot guard.
- `backend/src/repos/orderRepo.js` — strip every `if (MODE !== 'postgres') { airtable.* }` branch; delete `mirrorAirtableOrder`; drop `MODE`, `getBackendMode`, `_setMode`, `_resetMode`, `airtable`, `TABLES` exports/imports.
- `backend/src/repos/stockRepo.js` — same pattern.
- `backend/src/services/orderService.js` — delete the airtable fallback bodies in `createOrder`, `transitionStatus`, `cancelWithStockReturn`, `deleteOrder`, `editBouquetLines` (all gated by `if (orderRepo.getBackendMode() !== 'airtable') early-return`). Drop airtable imports.
- `backend/src/services/wix.js` — delete `reprocessWixOrder`'s else-of-postgres-mode `db.deleteRecord(TABLES.X)` branch; drop airtable imports.
- `backend/src/routes/orders.js` — delete `db.getById(TABLES.DELIVERIES/ORDER_LINES)` fallback branches gated by `pgEmbeds` / `hasPgEmbeds`; drop airtable imports.
- `backend/src/routes/deliveries.js` — drop airtable imports if no live usage; verify.
- `backend/src/routes/test.js` — update stale comment about "in-memory airtable-mock".
- `backend/package.json` — remove `airtable` dep from `dependencies`.
- `backend/scripts/start-test-backend.js` — drop `TEST_BACKEND=mock-airtable` env set + the `STOCK_BACKEND` / `ORDER_BACKEND` setters (now no-ops).
- `CLAUDE.md` (root) — drop Airtable references, mark Phase 7 complete.
- `backend/CLAUDE.md` — drop airtable services from the table; mark migration complete; rename services section.
- `BACKLOG.md` — tick off PR 2b checklist items; clear standing investigations referencing the migration.
- `CHANGELOG.md` — add PR 2b entry.

### Untouched
- `backend/src/services/__fixtures__/airtable-test-base.json` — read-only seed for `phase7pr2a-seed.js`. PR 2b does NOT delete or rename. Keep as-is; the name is documented in `phase7pr2a-seed.js` so a future reader knows where it came from. NICE-TO-FIX: rename in a future cosmetic PR.
- `__tests__/orderRepo*.test.js`, `stockRepo*.test.js` etc. — pglite-only, no airtable knowledge. No changes needed.
- `phase7pr2a-seed.js` — already PG-native. No changes.

---

## Tasks

### Task 1: Strip Airtable fallback from `orderRepo.js`

**Files:** Modify `backend/src/repos/orderRepo.js`

**Why:** The repo has ~12 functions with `if (MODE !== 'postgres') { airtable.* call }` branches. After Phase 4 cutover, MODE is always 'postgres' in production. The dead branches add 200+ LOC of code, force every reader to mentally bisect "which mode am I in?", and prevent the airtable.js delete in Task 6.

**Strategy:** Replace each branch with a hard PG-only contract. Drop the MODE state entirely. Delete `mirrorAirtableOrder` (no callers since PR 2a). Drop airtable + TABLES imports.

**Specific functions to simplify:**
- `getBackendMode()`, `_setMode()`, `_resetMode()`, `MODE` constant — delete (no callers after T3+T4).
- `list()` (line ~266) — drop the `if (MODE !== 'postgres') return airtable.list(...)` early-return, keep the PG body.
- `getById()` (line ~325) — drop airtable fallback.
- `findByWixOrderId()` (line ~342) — drop airtable fallback.
- `mirrorAirtableOrder()` (line ~365–406) — delete entire function.
- `listByIds()` (line ~506) — drop airtable fallback.
- `listDeliveries()` (line ~550) — drop airtable fallback.
- `getDeliveryById()` (line ~588) — drop airtable fallback.
- `createOrder()` (line ~608) — already PG-only (orderService routes here). Verify no airtable references inside.
- `transitionStatus()` — verify PG-only.
- `cancelWithStockReturn()` — verify PG-only.
- `deleteOrder()` — verify PG-only.
- `editBouquetLines()` — verify PG-only.
- `updateOrder()` (line ~1101) — drop airtable cascade fallback (lines ~1109, 1113).
- `updateDelivery()` (line ~1167) — drop airtable cascade fallback (lines ~1177, 1178, 1184, 1188).
- `updateOrderLine()` (line ~1245) — drop airtable fallback (line ~1249).
- `convertToDelivery()` (line ~1280) — drop airtable fallback (lines ~1284, 1290, 1294).

**Delete imports:**
```js
import * as airtable from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
```

- [ ] **Step 1.1: Read the full `orderRepo.js` and inventory every airtable reference**

```bash
grep -n "airtable\\.\\|TABLES\\.\\|MODE\\|getBackendMode\\|mirrorAirtableOrder" backend/src/repos/orderRepo.js
```

Capture each line — count expected: ~30. For each, decide: drop (fallback branch), drop (dead constant), keep (none expected after this task).

- [ ] **Step 1.2: Strip fallbacks function-by-function**

For each function in the list above:
1. Find the `if (MODE !== 'postgres') { ... return ... }` block.
2. Delete the if-block entirely.
3. Verify the rest of the function (the PG path) stands alone with the same exported signature.
4. If the function relies on `db` being non-null (`if (!db) throw new Error(...)`) — keep that guard; it's defensive and survives.

For `mirrorAirtableOrder`: delete the entire function body + JSDoc + the export.

For `getBackendMode`/`_setMode`/`_resetMode`/`MODE` constants: delete. Update test files only if they use these helpers.

- [ ] **Step 1.3: Drop airtable + TABLES imports**

```js
// Delete these lines from the imports block:
import * as airtable from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
```

If TABLES is referenced anywhere remaining (shouldn't be), STOP and audit.

- [ ] **Step 1.4: Verify exports unchanged**

The file's `export` set should be identical to before EXCEPT:
- Remove: `getBackendMode`, `_setMode`, `_resetMode`, `mirrorAirtableOrder`.
- Keep: every other named export.

Confirm by `git diff` that the public API (every other function) keeps the same signature.

- [ ] **Step 1.5: Run tests**

```bash
cd backend && npx vitest run
```

Expected: same baseline (348+ passed). If any test references `getBackendMode` / `_setMode` etc., either:
- The test was an airtable-mode test → delete the test (it's testing dead code).
- The test was a sanity check → leave the test, replace the assertion with the PG-mode equivalent.

- [ ] **Step 1.6: Commit**

```bash
git add backend/src/repos/orderRepo.js
git commit -m "chore(orderRepo): strip Airtable fallback branches + dead mirror function"
```

---

### Task 2: Strip Airtable fallback from `stockRepo.js`

**Files:** Modify `backend/src/repos/stockRepo.js`

**Why:** Same pattern as orderRepo. The repo has ~14 airtable fallback branches across `list`, `listByIds`, `getById`, `create`, `update`, `delete`, `restore`, `purge`, `runParityCheck`, etc. After Phase 3 cutover, MODE is always 'postgres'. Strip them.

**Specific functions:**
- `getBackendMode`, `_setMode`, `_resetMode`, `MODE` — delete.
- `list()` (line ~190) — drop `return airtable.list(TABLES.STOCK, options)` early-return.
- `listByIds()` (line ~242) — drop the dynamic-import fallback (`const { listByIds: airtableListByIds } = await import('../utils/batchQuery.js')`). The function becomes a single PG path.
- `getById()` (line ~263) — drop airtable fallback.
- `create()` (line ~291, 296) — drop airtable + shadow-write paths if any (verify shadow is dead post-cutover).
- `update()` (line ~372, 376) — same.
- `delete` / `softDelete` (line ~576, 580) — same.
- `restore()` (line ~672) — drop airtable update.
- `purge()` (line ~707) — drop airtable deleteRecord.
- `runParityCheck()` (line ~748) — this function compares PG vs Airtable. After PR 2b there's no Airtable to compare against. Either delete `runParityCheck` entirely (dead), or stub it to return a sentinel "no parity check after Airtable retirement". Recommend: delete + remove its admin route (`/admin/parity/:e` if exists).

**Delete imports:**
```js
import * as airtable from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
```

- [ ] **Step 2.1: Inventory**

```bash
grep -n "airtable\\.\\|TABLES\\.\\|MODE\\|getBackendMode\\|runParityCheck" backend/src/repos/stockRepo.js
```

- [ ] **Step 2.2: Strip fallbacks per function**

Same pattern as Task 1: drop the if-block, keep the PG body.

For `runParityCheck`: confirm callers via `grep -rn "runParityCheck\\|/parity" backend/src --include="*.js"`. If only callable from `/admin/parity/...`, delete both the function and the admin route. If a test references it, delete that test.

For `listByIds` dynamic-import branch: delete the entire `if (MODE === 'postgres') { ... } else { ... airtableListByIds(...) }` and replace with the PG body unconditionally.

- [ ] **Step 2.3: Drop imports**

```js
import * as airtable from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
```

- [ ] **Step 2.4: Verify exports**

Same as Task 1: every public function keeps its signature; only the mode helpers + dead branches go.

- [ ] **Step 2.5: Run tests + commit**

```bash
cd backend && npx vitest run
git add backend/src/repos/stockRepo.js
git commit -m "chore(stockRepo): strip Airtable fallback branches + dead parity check"
```

If `runParityCheck`/admin parity route was deleted, also stage `backend/src/routes/admin.js` and add to the same commit.

---

### Task 3: Strip Airtable fallback from `orderService.js`

**Files:** Modify `backend/src/services/orderService.js`

**Why:** The largest single concentration of dead airtable code in the repo. Five public functions (`createOrder`, `transitionStatus`, `cancelWithStockReturn`, `deleteOrder`, `editBouquetLines`) each have a structure like:

```js
export async function X(...) {
  if (orderRepo.getBackendMode() !== 'airtable') {
    return await orderRepo.X(...);
  }
  // ↓↓↓ dead code from here to end of function ↓↓↓
  const r = await db.getById(TABLES.ORDERS, id);
  // ... lots of airtable orchestration ...
}
```

The early-return branch is the only one that fires in production. Delete everything below it (including the airtable createOrder rollback, the manual line/delivery deletion, the editBouquetLines manual transitions, etc.).

**Specific functions:**
- `createOrder()` (line ~117) — keep the early-return; delete lines ~126–353 (the rollback-tracking airtable orchestration).
- `transitionStatus()` (line ~370) — delete the airtable body.
- `cancelWithStockReturn()` (line ~487) — delete the airtable body (lines ~490–527).
- `deleteOrder()` (line ~545) — delete the airtable body (lines ~548–597).
- `editBouquetLines()` (line ~607) — delete the airtable body (lines ~610–712).
- `sendDeliveryCompleteAlert()` (line ~440) — already PG-only after PR 2a (uses `orderRepo.getById`, `customerRepo`, `orderRepo.getLinesByIds`). Verify no airtable refs.
- `findOrdersNeedingSubstitution()` — added in PR 1 as PG-only. Verify.
- `runPostCreateSideEffects()` — verify.
- `autoMatchStock()` — keeps the stock match logic (uses `stockRepo`). Verify no airtable refs.

**After deletion**, each migrated function becomes:
```js
export async function X(...) {
  return await orderRepo.X(...);
}
```

For `createOrder`: it does pre-processing (autoMatchStock, payment 1 backfill, etc.) before calling `orderRepo.createOrder`. Keep the pre-processing; delete only the dead airtable rollback branch.

**Delete imports:**
```js
import * as db from './airtable.js';
import { TABLES } from '../config/airtable.js';
```

- [ ] **Step 3.1: Read the file end-to-end**

```bash
grep -n "db\\.\\|TABLES\\.\\|getBackendMode" backend/src/services/orderService.js
```

Sketch which lines are inside an `if (orderRepo.getBackendMode() !== 'airtable') { return ... }` early-return block and which are above (the pre-processing).

- [ ] **Step 3.2: Strip fallbacks per function**

For each of `createOrder`, `transitionStatus`, `cancelWithStockReturn`, `deleteOrder`, `editBouquetLines`:
1. Find the early-return line.
2. Delete every line BELOW the early-return up to the closing `}` of the function.
3. The function should now end at the `return` statement.

For `createOrder` specifically: the early-return is at line ~117–122 (`if (...) { const result = await orderRepo.createOrder(...); runPostCreateSideEffects(result, params); return result; }`). Everything below that — the rollback try/catch, manual line creation, owner-price-override cascade fallback, stock adjustment fallback, delivery creation fallback — DELETE. The pre-processing above line 117 (param destructuring) stays.

For `transitionStatus`: similar — delete the post-early-return airtable body.

For `editBouquetLines`: this is the largest dead block (~100 lines). Delete carefully — verify the function ends at the `return await orderRepo.editBouquetLines(...)`.

- [ ] **Step 3.3: Drop imports + dead helpers**

```js
import * as db from './airtable.js';
import { TABLES } from '../config/airtable.js';
```

If `runPostCreateSideEffects` or `autoMatchStock` no longer needs `db`/`TABLES`, drop them from those functions too.

- [ ] **Step 3.4: Run tests**

```bash
cd backend && npx vitest run
```

Expected: same baseline. If a test references the airtable code path (e.g., `orderService.createOrder` with `ORDER_BACKEND=airtable` mocked), delete that test — it tests dead code.

- [ ] **Step 3.5: Commit**

```bash
git add backend/src/services/orderService.js
git commit -m "chore(orderService): strip Airtable fallback bodies — delegate to orderRepo only"
```

---

### Task 4: Strip Airtable fallback from `wix.js`, `routes/orders.js`, `routes/deliveries.js`, `routes/test.js`

**Files:** 
- Modify `backend/src/services/wix.js`
- Modify `backend/src/routes/orders.js`
- Modify `backend/src/routes/deliveries.js`
- Modify `backend/src/routes/test.js`

**Why:** These four files have residual airtable references inside fallback branches gated by `getBackendMode()`/`pgEmbeds`/`hasPgEmbeds`. PR 2a left them intact per the "fallback branches stay until PR 2b" rule. Now's the time.

**`wix.js` `reprocessWixOrder`:**
- The else-branch of `if (orderRepo.getBackendMode() === 'postgres') { orderRepo.deleteOrder(...) } else { ...db.deleteRecord(TABLES.X)... }` (lines ~503–517).
- Delete the entire else-block. The if-condition becomes unconditional: just call `orderRepo.deleteOrder(_pgId || id)`.
- Drop the airtable imports at the top of `wix.js`.

**`routes/orders.js`:**
- Three `db.getById(TABLES.DELIVERIES/ORDER_LINES)` calls inside fallback branches (lines ~293, 471, 592) gated by `pgEmbeds`/`hasPgEmbeds` (always true in PG mode).
- Replace each `pgEmbeds ? ... : db.getById(...)` ternary with the truthy branch unconditionally. The `pgEmbeds` checks become redundant — collapse them.
- Verify the post-collapse code paths still pass embed-aware logic to the response strip (`if (pgEmbeds) { delete order._lines; delete order._delivery; }`). Always delete embeds since embeds always exist now.
- Drop airtable + TABLES imports.

**`routes/deliveries.js`:**
- Imports airtable + TABLES at top. Run `grep -n "db\\.\\|TABLES\\." backend/src/routes/deliveries.js` to find live calls. If only inside fallback branches, strip those + drop imports. If no live calls (imports unused after recent PRs), just drop the imports.

**`routes/test.js`:**
- Single comment update (line ~66): "reading from the in-memory airtable-mock" — change to reflect post-Airtable reality. The fixture is still `airtable-test-base.json` (NICE-TO-FIX rename later); update the comment to mention "the JSON fixture file at __fixtures__/airtable-test-base.json (PR 2b retains filename for now)".

- [ ] **Step 4.1: Inventory remaining airtable refs across the 4 files**

```bash
grep -n "db\\.\\|TABLES\\.\\|airtable" backend/src/services/wix.js backend/src/routes/orders.js backend/src/routes/deliveries.js backend/src/routes/test.js
```

- [ ] **Step 4.2: `wix.js` — delete reprocessWixOrder airtable else-branch**

Find the block:
```js
if (orderRepo.getBackendMode() === 'postgres') {
  await orderRepo.deleteOrder(...);
} else {
  for (const lineId of lineIds) await db.deleteRecord(TABLES.ORDER_LINES, lineId).catch(...);
  for (const delId of deliveryIds) await db.deleteRecord(TABLES.DELIVERIES, delId).catch(...);
  await db.deleteRecord(TABLES.ORDERS, existing.id);
}
```

Replace with the unconditional PG path:
```js
await orderRepo.deleteOrder(existing._pgId || existing.id);
```

(Verify the variable name — it might be just `existing.id` if the PG id is what `findByWixOrderId` returns.)

Drop:
```js
import * as db from './airtable.js';
import { TABLES } from '../config/airtable.js';
```

- [ ] **Step 4.3: `orders.js` — collapse pgEmbeds ternaries**

For each of the three sites (lines ~293, 471, 592):
- The ternary `hasPgEmbeds ? Promise.resolve(order._lines) : listByIds/db.getById(...)` becomes `Promise.resolve(order._lines)` unconditionally.
- The cleanup `if (pgEmbeds) { delete order._lines; delete order._delivery; }` becomes unconditional (always delete the embeds since they're now always present).

Drop:
```js
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
```

(Unless other lines in orders.js still use them — verify after the strip.)

- [ ] **Step 4.4: `deliveries.js`**

Inspect each match. If unused (the imports are dead), just drop them. If a fallback branch exists, strip it.

- [ ] **Step 4.5: `routes/test.js` comment**

Update the comment near line 66 from "reading from the in-memory airtable-mock" to:
```js
// the JSON fixture at __fixtures__/airtable-test-base.json. PR 2b retains
// the filename for now; rename in a future cosmetic PR.
```

- [ ] **Step 4.6: Run full backend tests + harness**

```bash
cd backend && npx vitest run
cd /Users/oliwer/Projects/flower-studio/.worktrees/phase7-pr2b-airtable-retire
npm run harness > /tmp/harness-pr2b-t4.log 2>&1 &
HARNESS_PID=$!
sleep 7
npm run test:e2e 2>&1 | tail -10
kill $HARNESS_PID
```

Expected: backend tests stay green; E2E 186/186. If E2E breaks, the harness boot probably can't proceed without the airtable-mock — that's Task 5's territory (boot guard). Diagnose, then proceed if a fix is obvious.

- [ ] **Step 4.7: Commit**

```bash
git add backend/src/services/wix.js backend/src/routes/orders.js backend/src/routes/deliveries.js backend/src/routes/test.js
git commit -m "chore(routes+wix): strip remaining Airtable fallback branches"
```

---

### Task 5: Strip boot guard + harness env from `index.js` + `start-test-backend.js`

**Files:**
- Modify `backend/src/index.js`
- Modify `backend/scripts/start-test-backend.js`

**Why:** The boot guard validates `STOCK_BACKEND` / `ORDER_BACKEND` combinations, which are now meaningless. Drop the validation. Drop the `validateAirtableSchema` import + call. Drop the `TEST_BACKEND=mock-airtable` setter in the harness — without `airtable.js`, the harness boots without the mock shim (it only ever needed pglite + the seed).

**`index.js` changes:**
1. Drop import: `import { validateAirtableSchema } from './services/airtableSchema.js';`
2. Drop the call site (likely inside boot, near `connectPostgres()`).
3. Strip the `STOCK_BACKEND` / `ORDER_BACKEND` validation block (around line 95-100, the `[FATAL] ORDER_BACKEND=shadow requires STOCK_BACKEND in {shadow, postgres}` check). Replace with: nothing — just delete the block.
4. Update the boot banner if it logs which backend mode is active — should just say "Postgres" now.
5. Update the comment at line 160 about "services/airtable.js and db/index.js refuse to boot pglite or the mock" — replace with a comment about pglite-only boot mode.
6. Update line 198 comment "See backend/src/services/airtableSchema.js for the rationale" — delete the reference (file is gone in T6).

**`start-test-backend.js` changes:**
1. Drop `TEST_BACKEND: 'mock-airtable'` from the env setup block (line ~38).
2. Drop `STOCK_BACKEND: 'postgres'` and `ORDER_BACKEND: 'postgres'` setters (lines ~40, 48). The repos no longer read these env vars.
3. Drop log lines that print these values (line ~220, 222).
4. Update the header comment block — drop references to `TEST_BACKEND=mock-airtable` and the env-flag matrix.

- [ ] **Step 5.1: Inventory**

```bash
grep -n "validateAirtableSchema\\|STOCK_BACKEND\\|ORDER_BACKEND\\|TEST_BACKEND\\|airtable" backend/src/index.js backend/scripts/start-test-backend.js
```

- [ ] **Step 5.2: Edit `index.js`**

Apply all 6 changes from the bullet list above. Verify boot still works with: `cd backend && DATABASE_URL=pglite:memory NODE_ENV=test node src/index.js` — should print connection log + listen line, no errors.

- [ ] **Step 5.3: Edit `start-test-backend.js`**

Apply the 4 changes. Run the harness afterward to confirm it boots:
```bash
cd /Users/oliwer/Projects/flower-studio/.worktrees/phase7-pr2b-airtable-retire
npm run harness > /tmp/harness-pr2b-t5.log 2>&1 &
HARNESS_PID=$!
sleep 7
curl -s http://localhost:3001/api/health || curl -s http://localhost:3001/
kill $HARNESS_PID
```

Expected: 200 response. If boot fails, tail `/tmp/harness-pr2b-t5.log` and diagnose.

- [ ] **Step 5.4: Run E2E to confirm harness still drives the suite**

```bash
npm run harness > /tmp/harness-pr2b-t5b.log 2>&1 &
HARNESS_PID=$!
sleep 7
npm run test:e2e 2>&1 | tail -10
kill $HARNESS_PID
```

Expected: 186/186 green.

- [ ] **Step 5.5: Commit**

```bash
git add backend/src/index.js backend/scripts/start-test-backend.js
git commit -m "chore(boot): drop Airtable schema validator + dead mode-flag boot guard"
```

---

### Task 6: Delete the leaf files + drop npm dep

**Files:**
- Delete: `backend/src/services/airtable.js`
- Delete: `backend/src/services/airtable-real.js`
- Delete: `backend/src/services/airtable-mock.js`
- Delete: `backend/src/services/airtable-mock-formula.js`
- Delete: `backend/src/services/airtableSchema.js`
- Delete: `backend/src/config/airtable.js`
- Delete: `backend/src/utils/batchQuery.js`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`

**Why:** No imports remain after T1–T5. Time to delete and remove the npm dep.

- [ ] **Step 6.1: Confirm no remaining imports**

```bash
grep -rn "from.*airtable\\b\\|require.*airtable\\b\\|services/airtable\\|config/airtable\\|utils/batchQuery" backend/src --include="*.js" | grep -v __fixtures__
```

Expected: zero matches. If any match, fix the file BEFORE deleting (don't delete a file that's still imported).

- [ ] **Step 6.2: Delete the files**

```bash
git rm backend/src/services/airtable.js
git rm backend/src/services/airtable-real.js
git rm backend/src/services/airtable-mock.js
git rm backend/src/services/airtable-mock-formula.js
git rm backend/src/services/airtableSchema.js
git rm backend/src/config/airtable.js
git rm backend/src/utils/batchQuery.js
```

If any of those files don't exist (already removed by an earlier task), `git rm` will error — adjust accordingly.

- [ ] **Step 6.3: Drop `airtable` npm dep**

Edit `backend/package.json`:
```diff
   "dependencies": {
     "@anthropic-ai/sdk": "...",
-    "airtable": "...",
     "drizzle-orm": "...",
     ...
   }
```

Then update the lockfile:
```bash
cd backend && npm install --package-lock-only
```

(Or `npm uninstall airtable` from `backend/`.)

Verify `airtable` is gone:
```bash
grep -A 1 -B 1 "airtable" backend/package.json
```
Expected: no matches.

- [ ] **Step 6.4: Run full test suite + harness**

```bash
cd backend && npx vitest run
```

Expected: same baseline. Imports were already clean before this task; deleting the files just makes them unfindable. Any failure here is a missed import in T1–T5 — track it down and fix before proceeding.

```bash
cd /Users/oliwer/Projects/flower-studio/.worktrees/phase7-pr2b-airtable-retire
npm run harness > /tmp/harness-pr2b-t6.log 2>&1 &
HARNESS_PID=$!
sleep 7
npm run test:e2e 2>&1 | tail -10
kill $HARNESS_PID
```

Expected: 186/186.

- [ ] **Step 6.5: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore(deps): delete Airtable infrastructure + drop npm dep"
```

---

### Task 7: Update CLAUDE.md (root + backend) + CHANGELOG + BACKLOG

**Files:**
- Modify: `CLAUDE.md` (root)
- Modify: `backend/CLAUDE.md`
- Modify: `CHANGELOG.md`
- Modify: `BACKLOG.md`

**Why:** Per CLAUDE.md "Workflow Rules": *"Update the relevant CLAUDE.md in the same PR that adds/removes a route, page, service, repo, or shared util."* PR 2b removes 7 services/utils. The structure tables in both CLAUDE.md files reference Airtable as the live DB — that's now historically wrong.

**Root `CLAUDE.md` changes:**
1. **Stack** section, line "DB:" — change "Airtable (live) → Postgres (in transition)..." to: "Postgres (Drizzle ORM, hosted on Railway). Phase 7 PR 2b retired Airtable in 2026-05-09 — historical migration notes in `docs/migration/` archive."
2. **Airtable Rules (CRITICAL)** section — DELETE the whole section. Replace with a "Postgres Rules" section that distills what's still relevant: use repos (don't `db.execute` raw SQL from routes), prefer `db.transaction` for multi-row writes, audit_log writes happen in repos.
3. **Status Workflows** — unchanged. Already PG-only.
4. **Cascade Rules** — unchanged.
5. Any reference to `airtable.js` / `airtableSchema.js` / `config/airtable.js` / `STOCK_BACKEND` / `ORDER_BACKEND` / `TEST_BACKEND=mock-airtable` — delete or update.

**`backend/CLAUDE.md` changes:**
1. **Architecture** code block — change `config/          → Airtable table names (env-driven)` to drop the line, or change to `config/          → (empty after Phase 7)` — better to delete the line.
2. **Services table** — remove rows: `airtable.js`, `airtable-real.js`, `airtable-mock.js`, `airtable-mock-formula.js`, `__fixtures__/`, `airtableSchema.js`. Keep the rest.
3. **Database** section — change "PR 2 cleanup pending" to "complete". Update text: "Phases 3–7 complete; Airtable retired 2026-05-09."
4. **Airtable Tables (16 tables, env-var-driven)** section — DELETE the whole section.
5. **Key Patterns** → "Stock adjustments: always go through the serialized stock queue in `airtable.js`" — DELETE this bullet (the queue lived in airtable.js).

**`CHANGELOG.md`** — add PR 2b entry after PR 2a's:
```markdown
## Phase 7 PR 2b — Airtable retirement (2026-05-09)

Deletes the Airtable infrastructure now that no production code path reads from or writes to it. After this PR:
- 7 source files deleted: `airtable.js`, `airtable-real.js`, `airtable-mock.js`, `airtable-mock-formula.js`, `airtableSchema.js`, `config/airtable.js`, `utils/batchQuery.js`.
- `airtable` npm dep dropped (one less production dep).
- ~600 LOC of dead fallback branches stripped from `orderRepo`, `stockRepo`, `orderService`, `wix.js`, `routes/orders.js`, `routes/deliveries.js`.
- Boot guard for `STOCK_BACKEND` / `ORDER_BACKEND` mode-flag combinations dropped (env vars are now meaningless — Railway should remove them post-merge).
- Harness boots without `TEST_BACKEND=mock-airtable` (was pglite-only since PR 2a anyway).
- `mirrorAirtableOrder` deleted (no callers since PR 2a).
- `runParityCheck` (stockRepo) deleted (PG ↔ Airtable comparison meaningless).

### Owner action items post-merge
- Cancel Airtable subscription (annual or monthly).
- Remove `STOCK_BACKEND`, `ORDER_BACKEND`, `TEST_BACKEND` from Railway env (no longer read).
- Optionally take a final Airtable JSON export and store as a snapshot in `docs/migration/archive/`.

### Verification
- Backend Vitest: <count> passed (down from 348 — the airtable-fallback tests removed)
- Shared Vitest: 130 passed
- Apps build: 3 clean
- E2E harness: 186/186
```

**`BACKLOG.md`** — tick off PR 2b checklist items. Mark Phase 7 complete.

- [ ] **Step 7.1: Update root CLAUDE.md per the spec above**

Read `CLAUDE.md`, find each section listed, apply the changes. Verify no remaining "Airtable" references except in historical/archive notes (search: `grep -i airtable CLAUDE.md`).

- [ ] **Step 7.2: Update backend/CLAUDE.md**

Same. Verify: `grep -i airtable backend/CLAUDE.md` returns only historical references (e.g., "Phase 7 PR 2b retired Airtable").

- [ ] **Step 7.3: Update CHANGELOG.md**

Insert the PR 2b block above the PR 2a block. Fill in actual numbers from the verification step.

- [ ] **Step 7.4: Update BACKLOG.md**

- Mark `Phase 7 PR 2b checklist` items as `[x]` (done).
- Mark item 10 (`Phase 7 PR 2 — Retire Airtable`) as DONE in main numbered list.
- Move the "Migration cutover state" block (top of BACKLOG.md) into the historical/archive section. The state block becomes "Phases 3–7 complete (2026-05-09): Postgres is the only datastore."

- [ ] **Step 7.5: Commit**

```bash
git add CLAUDE.md backend/CLAUDE.md CHANGELOG.md BACKLOG.md
git commit -m "docs: phase 7 PR 2b — Airtable retired, post-migration architecture"
```

---

### Task 8: Verification + open PR

**Files:** None (verification + PR opening only)

- [ ] **Step 8.1: Backend tests**

```bash
cd backend && npx vitest run 2>&1 | tail -3
```

Capture the exact line. Expected: ≤ 348 (some tests may have been deleted as airtable-mode tests). Should be clean — no failures.

- [ ] **Step 8.2: Shared package tests**

```bash
cd packages/shared && ../../backend/node_modules/.bin/vitest run 2>&1 | tail -3
```

Expected: 130 passed (PR 2b doesn't touch shared).

- [ ] **Step 8.3: Build all three apps**

```bash
cd apps/florist  && ./node_modules/.bin/vite build 2>&1 | tail -3
cd ../dashboard  && ./node_modules/.bin/vite build 2>&1 | tail -3
cd ../delivery   && ./node_modules/.bin/vite build 2>&1 | tail -3
```

Expected: clean. PR 2b is backend-only — apps shouldn't notice.

- [ ] **Step 8.4: E2E harness**

```bash
cd /Users/oliwer/Projects/flower-studio/.worktrees/phase7-pr2b-airtable-retire
npm run harness > /tmp/harness-pr2b-t8.log 2>&1 &
HARNESS_PID=$!
sleep 7
npm run test:e2e 2>&1 | tail -10
kill $HARNESS_PID
```

Expected: 186/186 across 26 sections.

- [ ] **Step 8.5: Push branch + open PR**

```bash
git push -u origin chore/phase7-pr2b-airtable-retire
gh pr create --title "chore(phase7): PR 2b — Airtable retirement" --body "$(cat <<'EOF'
## Summary
After PR 2a left no production code path reading from or writing to Airtable, PR 2b deletes the dead infrastructure:
- **7 files deleted**: airtable.js, airtable-real.js, airtable-mock.js, airtable-mock-formula.js, airtableSchema.js, config/airtable.js, utils/batchQuery.js.
- **`airtable` npm dep dropped**.
- **~600 LOC of dead fallback branches stripped** from orderRepo, stockRepo, orderService, wix.js, routes/orders.js, routes/deliveries.js.
- **Boot guard** for STOCK_BACKEND / ORDER_BACKEND mode-flag combinations dropped (env vars now meaningless).
- **`mirrorAirtableOrder`** + **`runParityCheck`** deleted (no callers).
- **CLAUDE.md** (root + backend) updated to reflect Postgres-only architecture.

## Owner action items post-merge
- Cancel the Airtable subscription.
- Remove `STOCK_BACKEND`, `ORDER_BACKEND`, `TEST_BACKEND` env vars from Railway.
- (Optional) Take a final Airtable JSON snapshot for `docs/migration/archive/`.

## Verification
- Backend Vitest: <fill in>
- Shared Vitest: 130 passed (unchanged)
- Apps build: florist + dashboard + delivery clean
- E2E harness: 186/186 across 26 sections (incl. section 24 Wix HMAC replay — proves Wix path still works post-strip)

## Risk
- **Strip-only PR**: every deletion is dead code by PR 2a's definition. If E2E + backend tests stay green, the strip is safe.
- **Production smoke-test plan**: same as PR 2a. After deploy, watch the first Wix order land via `processWixOrder` (now the only Wix write path); verify audit_log captures the webhook actor.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8.6: Final code review**

Dispatch a code-reviewer (Opus) over the whole branch diff. Same shape as PR 2a's final review. Specifically check that no live import or call path was missed.

- [ ] **Step 8.7: Merge + cleanup**

After CI green + final review approves:
```bash
gh pr merge --squash --delete-branch <PR>
cd /Users/oliwer/Projects/flower-studio
git worktree remove .worktrees/phase7-pr2b-airtable-retire
git pull origin master
```

Owner: cancel Airtable subscription + remove Railway env vars.

---

## Phase / review summary

| Phase | Tasks | Per-task quality review | Phase-boundary quality review |
|-------|-------|--------------------------|------------------------------|
| A: Repo strip | T1, T2 | none — mechanical strip with full test suite as gate | After T2 (covers T1+T2 together) |
| B: Service strip | T3, T4 | T3 is large (~200 LOC removed); T4 is small. Per-task quality review on T3 only. | After T4 (covers T3+T4 together) |
| C: Boot + delete | T5, T6 | none | After T6 (covers T5+T6 together — sanity that no import survived) |
| D: Docs | T7 | none | none |
| E: Ship | T8 | n/a | Final reviewer over whole diff |

Spec-compliance reviewer (Sonnet) runs after every task.

## Out of scope (explicit non-goals)

- Renaming `__fixtures__/airtable-test-base.json` to a non-Airtable-flavoured filename (cosmetic; future PR).
- Cancelling Airtable subscription (owner action, post-merge).
- Removing Railway env vars (owner action, post-merge).
- Final Airtable JSON snapshot (owner choice, post-merge).
- Any feature work — strip-only.
- Wix-receival fidelity audit — separate plan, after PR 2b lands.
