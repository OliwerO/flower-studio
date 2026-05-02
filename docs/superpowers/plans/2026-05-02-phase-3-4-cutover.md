# Phase 3 + Phase 4 Postgres Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip Stock + Orders on prod from `STOCK_BACKEND=shadow` / `ORDER_BACKEND=airtable` to `STOCK_BACKEND=postgres` / `ORDER_BACKEND=postgres` in a single deploy, with backfill + Wix-webhook replay verification beforehand and a documented rollback path. After cutover, Postgres is the source of truth for orders, order lines, deliveries, and stock; Airtable becomes a frozen legacy snapshot for those tables (other tables — customers, POs, etc. — stay on Airtable until later phases).

**Architecture:** No application-code changes. `orderRepo` and `stockRepo` already implement all three modes. The cutover is driven entirely by Railway env-var flips + a one-shot backfill of orders/lines/deliveries from Airtable into prod PG. Boot guard at `backend/src/index.js:84-91` requires `ORDER_BACKEND=postgres` to flip *together* with `STOCK_BACKEND=postgres`, so this plan necessarily ends both shadow weeks at once. Stock shadow has been live since 2026-04-28 (day 4 of planned 7) with 0 parity issues; orders have no shadow history because the Phase 4 shadow path was never exercised on prod (orderRepo.createOrder shadow mode = PG-only — see Risks section). The replacement for the missing order shadow window is: backfill + spot-check + Wix webhook replay against harness in postgres mode.

**Tech Stack:** Railway CLI (env vars + redeploy), Drizzle (PG schema), `pg` driver (read-only DSN via `claude_ro` role), Airtable SDK (read for backfill + replay), pglite (test harness), Vitest (backend tests), Playwright (E2E harness via `npm run test:e2e`).

---

## Risks acknowledged before starting

1. **Stock shadow week cut short by 3 days.** Original plan was 7 clean days; today is day 4. Mitigation: shadow-health re-run as Task A1; abort if any parity_log row exists.
2. **No order shadow window.** `orderRepo.createOrder` in `shadow` mode is PG-only (line 517-523 throws the airtable-mode error path; lines 540-642 do PG inserts only — no Airtable mirror write). Running `ORDER_BACKEND=shadow` would silently lose every new order from Airtable. The plan therefore skips shadow and goes airtable → postgres in one step. Mitigation: backfill catches up history, Wix replay against harness validates the hot write path, post-flip monitoring catches any regression in the first 30 minutes.
3. **Order parity dashboard is a stub.** `orderRepo.runParityCheck` returns `{airtableCount: 0, postgresCount: 0}`. Spot-check by hand in Task B4 is the substitute.
4. **Wix webhook in PG mode is untested in prod.** Mitigation: Task C replays 3 recent webhooks against harness in `ORDER_BACKEND=postgres` mode before the flip.

If any task fails its expected output, halt and jump to **Phase F — Rollback** (or before any prod write happens, just re-evaluate without rolling back).

---

## File map

**Read-only references** — do not modify during execution:
- `backend/src/index.js:55-103` — boot guard (allowed combinations of the two flags)
- `backend/src/repos/orderRepo.js:506-642` — createOrder transactional impl (exercised live after flip)
- `backend/src/repos/stockRepo.js` — adjustQuantity + standalone shadow path
- `backend/scripts/backfill-orders.js` — idempotent UPSERT on airtable_id
- `backend/scripts/shadow-health.js` — reads parity_log + audit_log via CLAUDE_RO_URL

**Modified during plan**:
- `BACKLOG.md` — flip cutover state header (lines 11-13) + check off items in Phase 3 / Phase 4 sections
- `CHANGELOG.md` — append entry under today's date with env flips and timestamps
- Railway env: `STOCK_BACKEND`, `ORDER_BACKEND` (both → `postgres`)

**Created during plan** (working files, not committed):
- `/tmp/cutover-precheck.txt` — shadow-health output before flip
- `/tmp/cutover-railway-env-before.txt` — env snapshot for rollback
- `/tmp/cutover-railway-env-after.txt` — env snapshot after flip
- `/tmp/airtable-backup-pre-cutover/` — full Airtable snapshot via `scripts/airtable-backup.mjs`
- `/tmp/cutover-backfill-output.log` — backfill stdout/stderr
- `/tmp/cutover-spotcheck.txt` — manual diff results for 5 random orders
- `/tmp/cutover-replay-output.log` — Wix webhook replay results

---

## Decision gates

- **Gate 1 (after Phase A):** All checks green → proceed to backup + backfill
- **Gate 2 (after Phase B):** Backfill counts match Airtable + 5/5 spot-checks pass → proceed to replay
- **Gate 3 (after Phase C):** 3/3 Wix replays succeed + E2E suite 153/153 → owner final-go decision
- **Gate 4 (after Phase D flip):** Backend boots clean + manual smoke-test order succeeds → close cutover
- **Failure at any gate:** halt; if Phase D started, jump to Phase F

---

## Phase A — Pre-flight verification (read-only, safe)

### Task A1: Confirm stock shadow is clean

**Files:**
- Read: `backend/scripts/shadow-health.js`
- Output: `/tmp/cutover-precheck.txt`

- [ ] **Step 1: Pull CLAUDE_RO_URL**

Run:
```bash
railway variables --service Postgres | grep CLAUDE_RO_URL
```

Expected output (one line):
```
CLAUDE_RO_URL                  postgresql://claude_ro:<pwd>@<host>.railway.app:<port>/railway
```

Capture the full DSN value into shell variable `CLAUDE_RO_URL`. If absent, look in `~/.claude/projects/-Users-oliwer-Projects-flower-studio/memory/project_postgres_access.md`.

- [ ] **Step 2: Run shadow-health against prod PG**

Run:
```bash
CLAUDE_RO_URL="<value-from-step-1>" node backend/scripts/shadow-health.js | tee /tmp/cutover-precheck.txt
```

Expected output contains the line:
```
  ✓ Zero mismatches — shadow-write is clean.
```

If the output instead shows `⚠ Mismatches found — investigate before flipping to postgres mode:` followed by a table of entity_type/kind rows → **STOP**. Do not proceed. The shadow window must hit zero before cutover.

- [ ] **Step 3: Confirm row counts are sane**

Inspect `/tmp/cutover-precheck.txt`. Look at the "Tables (active rows)" section. Expected:
- `stock` rows ≥ 80 (currently 88)
- `audit_log` rows > 0 (writes have happened during shadow week)
- `parity_log` rows = 0
- `orders`, `order_lines`, `deliveries` may be 0 or partially populated from prior backfill attempts — neither blocks cutover

### Task A2: Snapshot current Railway env for rollback

**Files:**
- Output: `/tmp/cutover-railway-env-before.txt`

- [ ] **Step 1: Snapshot full env**

Run:
```bash
railway variables --service flower-studio-backend > /tmp/cutover-railway-env-before.txt
```

- [ ] **Step 2: Verify both flags + DATABASE_URL present**

Run:
```bash
grep -E '^(║ )?(ORDER_BACKEND|STOCK_BACKEND|DATABASE_URL|NODE_ENV)' /tmp/cutover-railway-env-before.txt
```

Expected: lines containing exactly `ORDER_BACKEND` = `airtable`, `STOCK_BACKEND` = `shadow`, `DATABASE_URL` set, `NODE_ENV` = `production`. If any line is absent or shows a different value → **STOP** and reconcile before continuing.

### Task A3: Verify backfill script is reachable + idempotent

**Files:**
- Read: `backend/scripts/backfill-orders.js`

- [ ] **Step 1: Confirm script imports resolve**

Run:
```bash
cd backend && node --check scripts/backfill-orders.js && echo "syntax-ok"
```

Expected output: `syntax-ok`. If a SyntaxError appears, fix before continuing.

- [ ] **Step 2: Sanity-check idempotency**

The script must UPSERT on `airtable_id`. Confirm by running:
```bash
grep -n "where(eq(orders.airtableId" backend/scripts/backfill-orders.js
```

Expected: at least one match in each of the orders / order_lines / deliveries upsert blocks (lines ~138, ~172, ~204).

If none found → **STOP**. The script is not idempotent and re-runs would create duplicates.

---

## Phase B — Airtable backup + Postgres backfill (DESTRUCTIVE: prod PG writes)

> **Owner approval gate**: Tasks B2 + B3 write to prod Postgres. The backup in B1 is read-only.

### Task B1: Full Airtable snapshot (read-only, recoverable safety net)

**Files:**
- Run: `scripts/airtable-backup.mjs`
- Output: `backups/<today>/Orders.json`, `Order Lines.json`, `Deliveries.json`, …

- [ ] **Step 1: Run the backup**

Run:
```bash
cd /Users/oliwer/Projects/flower-studio
node --env-file=backend/.env scripts/airtable-backup.mjs
```

Expected: prints "Saved Orders → backups/2026-05-02/Orders.json" lines for every Airtable table. Last line confirms total. Exit code 0.

- [ ] **Step 2: Sanity-check the order dump**

Run:
```bash
ls -la backups/2026-05-02/Orders.json && jq '.records | length' backups/2026-05-02/Orders.json
```

Expected: file exists, integer ≥ 100 (Blossom historic order count is in the thousands).

If file missing or count = 0 → **STOP**. Do not proceed to backfill — without a backup, there is no recovery if PG diverges from Airtable mid-cutover.

### Task B2: Run backfill-orders.js against prod PG

**Files:**
- Run: `backend/scripts/backfill-orders.js`
- Output: `/tmp/cutover-backfill-output.log`

> ⚠ **DESTRUCTIVE** — writes thousands of rows into prod `orders`, `order_lines`, `deliveries`. Idempotent (UPSERT on airtable_id), but still requires explicit owner OK before invoking.

- [ ] **Step 1: Confirm backend/.env has prod credentials**

Run:
```bash
grep -E '^(DATABASE_URL|AIRTABLE_API_KEY|AIRTABLE_BASE_ID)=' backend/.env | sed 's/=.*/=<set>/'
```

Expected:
```
DATABASE_URL=<set>
AIRTABLE_API_KEY=<set>
AIRTABLE_BASE_ID=<set>
```

If any missing → **STOP**. Do NOT add a placeholder; pull from Railway via `railway variables` and add to `backend/.env` first.

- [ ] **Step 2: Run backfill**

Run:
```bash
cd /Users/oliwer/Projects/flower-studio/backend
node --env-file=.env scripts/backfill-orders.js 2>&1 | tee /tmp/cutover-backfill-output.log
```

Expected: prints progress lines and ends with a `Summary:` block:
```
[backfill-orders] Summary:
  Airtable orders:     <N>
  Airtable lines:      <M>
  Airtable deliveries: <K>
  PG orders now:       <N>     ← matches Airtable
  PG lines now:        <M>
  PG deliveries now:   <K>
[backfill-orders] Done. ...
```

Exit code 0 (no issues) or 1 (issues encountered + listed in summary). For a fresh-after-shadow-week base, expect 0 issues; tolerate ≤ 5 individual orphan-line skips.

If exit code 1 with a non-trivial issue list (≥ 5 issues, or any "Order FAILED") → **STOP**. Investigate each error before continuing. Common causes: missing Customer link, malformed numeric field, duplicate airtable_id — fix at the data level, then re-run (idempotency makes this safe).

### Task B3: Verify counts match Airtable

**Files:**
- Output: append to `/tmp/cutover-backfill-output.log`

- [ ] **Step 1: Re-query PG counts via shadow-health**

Run:
```bash
CLAUDE_RO_URL="<from-A1>" node backend/scripts/shadow-health.js | grep -A 6 "Tables (active rows)"
```

Expected: `orders`, `order_lines`, `deliveries` row counts equal the Summary numbers from Task B2. parity_log still 0.

- [ ] **Step 2: Cross-check against Airtable backup**

Run:
```bash
echo "Airtable Orders: $(jq '.records | length' backups/2026-05-02/Orders.json)"
echo "Airtable Lines:  $(jq '.records | length' backups/2026-05-02/Order\ Lines.json)"
echo "Airtable Deliveries: $(jq '.records | length' backups/2026-05-02/Deliveries.json)"
```

Expected: each count within ±5 of the corresponding PG count from Step 1 (small drift is normal because backup + backfill aren't atomic — orders may have been created between the two reads). If drift > 50 → **STOP** and investigate (a routing bug or schema mismatch could be silently dropping rows).

### Task B4: Spot-check 5 random orders end-to-end

**Files:**
- Output: `/tmp/cutover-spotcheck.txt`

- [ ] **Step 1: Pick 5 random recent active orders**

Run:
```bash
jq -r '.records[] | select(.fields.Status != "Cancelled" and .fields.Status != "Delivered" and .fields.Status != "Picked Up") | .id' backups/2026-05-02/Orders.json | shuf -n 5 > /tmp/cutover-spotcheck-ids.txt && cat /tmp/cutover-spotcheck-ids.txt
```

Expected: prints 5 `recXXXX` ids. If `shuf` is not installed on macOS, fall back to:
```bash
jq -r '.records[] | select(.fields.Status != "Cancelled" and .fields.Status != "Delivered" and .fields.Status != "Picked Up") | .id' backups/2026-05-02/Orders.json | awk 'BEGIN{srand()} {print rand() "\t" $0}' | sort -k1 -n | cut -f2- | head -5 > /tmp/cutover-spotcheck-ids.txt && cat /tmp/cutover-spotcheck-ids.txt
```

- [ ] **Step 2: Diff each order's PG row vs Airtable backup**

For each id in `/tmp/cutover-spotcheck-ids.txt` run:
```bash
ID=<recXXXX>
echo "=== $ID ===" >> /tmp/cutover-spotcheck.txt

# Airtable view (from backup)
jq ".records[] | select(.id == \"$ID\") | {Status, Customer, \"Delivery Type\", \"Required By\", \"Order Date\", lines: (.fields[\"Order Lines\"] | length)}" backups/2026-05-02/Orders.json >> /tmp/cutover-spotcheck.txt

# PG view (read-only)
PGPASSWORD=<from-claude_ro-DSN> psql "<CLAUDE_RO_URL>" -c "SELECT status, customer_id, delivery_type, required_by, order_date, (SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = o.id AND ol.deleted_at IS NULL) AS lines FROM orders o WHERE airtable_id = '$ID';" >> /tmp/cutover-spotcheck.txt
echo "" >> /tmp/cutover-spotcheck.txt
```

Expected for each order:
- Status matches between Airtable and PG
- Customer id (single-element array on Airtable side, single column on PG side) matches
- Delivery Type matches
- Required By date matches (`null` ↔ `null` is ok)
- Line count matches

Inspect `/tmp/cutover-spotcheck.txt` after the loop.

If any field mismatches on any order → **STOP**. The mismatch points either to a backfill-mapper bug or to data Airtable wrote post-backfill. Re-run `backfill-orders.js` (idempotent) and recheck. If still mismatched after re-run, halt cutover and investigate.

- [ ] **Step 3: Commit progress note**

Run:
```bash
cd /Users/oliwer/Projects/flower-studio
git status   # confirm no uncommitted code
```

Expected: working tree clean (we only wrote to `/tmp/` and `backups/`). If the cutover is suspended for the day after this point, the engineer may want to capture progress in a planning note — but no code is committed in this phase.

---

## Phase C — Wix webhook replay validation (harness only, safe)

The Wix webhook is the only inbound write path that goes through `orderRepo.mirrorAirtableOrder` today and `orderRepo.createOrder` after cutover. Validate the post-cutover behaviour against the harness before flipping prod.

### Task C1: Pull 3 recent Wix webhook payloads

**Files:**
- Output: `/tmp/wix-replay-1.json`, `/tmp/wix-replay-2.json`, `/tmp/wix-replay-3.json`

- [ ] **Step 1: Query Webhook Log via airtable backup**

Run:
```bash
ls backups/2026-05-02/ | grep -i webhook
```

Expected: a `Webhook Log.json` file. If absent, the airtable-backup script's TABLES list does not include WEBHOOK_LOG — instead pull live:

```bash
node --env-file=backend/.env -e "
import('./backend/src/services/airtable.js').then(async (a) => {
  const rows = await a.list(process.env.AIRTABLE_WEBHOOK_LOG_TABLE, {
    filterByFormula: \"AND({Source}='wix', NOT({Raw Payload}=''))\",
    sort: [{field: 'Created Time', direction: 'desc'}],
    maxRecords: 3,
  });
  rows.forEach((r, i) => {
    require('fs').writeFileSync('/tmp/wix-replay-' + (i+1) + '.json', r['Raw Payload']);
    console.log('saved /tmp/wix-replay-' + (i+1) + '.json');
  });
});
"
```

Expected: prints 3 "saved" lines. Each `/tmp/wix-replay-N.json` should be a JSON object with `data.order` containing customer + lineItems. If a payload is empty string or malformed, replace it with one of the older Webhook Log rows.

### Task C2: Boot harness in postgres mode

**Files:**
- Run: `npm run harness` (under postgres flags)

- [ ] **Step 1: Launch harness**

In a dedicated terminal tab (or `run_in_background`):
```bash
cd /Users/oliwer/Projects/flower-studio
ORDER_BACKEND=postgres STOCK_BACKEND=postgres npm run harness
```

Expected log lines (within ~5 seconds):
```
[BACKEND] ORDER_BACKEND=postgres STOCK_BACKEND=postgres
🚀 Backend running on http://localhost:3002
```

If boot fails with `[FATAL]` → re-read `index.js:55-103` and reconcile env. The harness uses pglite + mock Airtable; `DATABASE_URL` is set internally to `pglite://...`.

- [ ] **Step 2: Health check**

Run:
```bash
curl -sS http://localhost:3002/api/health | jq .
```

Expected:
```json
{ "status": "ok", "timestamp": "2026-05-02T...", "testBackend": true }
```

### Task C3: Replay each webhook against harness

**Files:**
- Output: `/tmp/cutover-replay-output.log`

- [ ] **Step 1: Compute HMAC and POST each payload**

For N in 1..3:
```bash
N=1
PAYLOAD=$(cat /tmp/wix-replay-$N.json)
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$WIX_WEBHOOK_SECRET" -hex | awk '{print $2}')
curl -sS -X POST http://localhost:3002/api/webhook/wix \
  -H "Content-Type: application/json" \
  -H "x-wix-signature: $SIG" \
  -d "$PAYLOAD" 2>&1 | tee -a /tmp/cutover-replay-output.log
echo "--- end replay $N ---" >> /tmp/cutover-replay-output.log
```

`WIX_WEBHOOK_SECRET` should already be set in the same env as the harness (read from `backend/.env` if needed: `export WIX_WEBHOOK_SECRET=$(grep ^WIX_WEBHOOK_SECRET backend/.env | cut -d= -f2)`).

Expected: each call returns HTTP 200 with `{ "ok": true, ... }` or `{ "duplicate": true, ... }` (idempotent webhook). Anything else (4xx, 5xx, timeout) → **STOP**, capture error, investigate before any prod flip.

- [ ] **Step 2: Verify orders landed in pglite**

Run (against the harness's exposed test routes):
```bash
curl -sS http://localhost:3002/api/test/state | jq '.orders | length'
```

Expected: ≥ 3 (one row per replayed webhook, plus seed data). If fewer than 3, check `/tmp/cutover-replay-output.log` for which webhook was rejected.

- [ ] **Step 3: Stop the harness**

Send SIGINT to the harness process (Ctrl-C in its terminal, or `pkill -INT -f start-test-backend`).

### Task C4: Run full E2E suite in postgres mode

**Files:**
- Run: `npm run harness` + `npm run test:e2e`

- [ ] **Step 1: Boot fresh harness in postgres mode**

Same as Task C2 Step 1 but in a clean shell so the post-replay state doesn't interfere:
```bash
ORDER_BACKEND=postgres STOCK_BACKEND=postgres npm run harness
```

- [ ] **Step 2: Run E2E suite against it**

In another terminal:
```bash
cd /Users/oliwer/Projects/flower-studio
npm run test:e2e
```

Expected final line: `153 passed (24 suites)` or equivalent. Any failure → **STOP** and triage. The suite has been green in postgres mode since 2026-04-30 (commit 7f3a8bf), so a regression here means something in the env is off.

- [ ] **Step 3: Stop harness + clear PG state from harness pglite**

Pglite is in-memory and dies with the process. Just kill the harness with Ctrl-C.

---

## Phase D — Cutover env flip (DESTRUCTIVE: prod state change)

> ⚠ **Owner approval gate** — Tasks D2 + D3 + D4 are the actual prod cutover. They take ≤ 5 minutes total but require explicit OK from owner before each Railway mutation.

> **Recommended timing:** schedule for low-traffic window. Krakow 8:00 AM is typically before the order day starts. If running same-day after Phases A-C, confirm shadow-health is *still* clean (hour later may have new parity events).

### Task D1: Final shadow-health re-check

**Files:**
- Run: `backend/scripts/shadow-health.js`

- [ ] **Step 1: Re-run shadow-health**

```bash
CLAUDE_RO_URL="<from-A1>" node backend/scripts/shadow-health.js
```

Expected: still `✓ Zero mismatches`. If any new parity rows appeared between Phase A and now → **STOP**.

### Task D2: Flip STOCK_BACKEND to postgres

**Files:**
- Mutate: Railway env

- [ ] **Step 1: Set the variable**

Run:
```bash
railway variables --service flower-studio-backend --set STOCK_BACKEND=postgres
```

Expected output: `Updated 1 variable.` Railway will queue a redeploy.

- [ ] **Step 2: Confirm change pre-flight**

Run:
```bash
railway variables --service flower-studio-backend | grep -E '(ORDER|STOCK)_BACKEND'
```

Expected:
```
ORDER_BACKEND  airtable
STOCK_BACKEND  postgres
```

> ⚠ At this exact moment the boot guard would still **accept** this combination (`ORDER_BACKEND=airtable` is fine alongside any STOCK_BACKEND). The redeploy may complete between this step and Task D3. That's fine — the system runs cleanly with stock on PG and orders still on Airtable. The only invalid intermediate state would be `ORDER_BACKEND=postgres STOCK_BACKEND=airtable`, which is *not* a state we ever pass through.

### Task D3: Flip ORDER_BACKEND to postgres

**Files:**
- Mutate: Railway env

- [ ] **Step 1: Set the variable**

Run:
```bash
railway variables --service flower-studio-backend --set ORDER_BACKEND=postgres
```

Expected output: `Updated 1 variable.` Railway queues a second redeploy.

- [ ] **Step 2: Confirm both flags now postgres**

```bash
railway variables --service flower-studio-backend | grep -E '(ORDER|STOCK)_BACKEND'
```

Expected:
```
ORDER_BACKEND  postgres
STOCK_BACKEND  postgres
```

### Task D4: Wait for redeploy + verify boot

**Files:**
- Output: `/tmp/cutover-railway-env-after.txt`

- [ ] **Step 1: Wait for healthy redeploy**

Run:
```bash
until curl -sf "https://flower-studio-backend-production.up.railway.app/api/health" >/dev/null 2>&1; do sleep 2; done && echo "healthy"
```

Expected: prints `healthy` within 60 seconds. (Railway typically redeploys in 30-45s.) If it stays unhealthy past 3 minutes → check Railway logs (`railway logs --service flower-studio-backend`) for `[FATAL]` or stack traces.

- [ ] **Step 2: Confirm boot log shows postgres mode**

Run:
```bash
railway logs --service flower-studio-backend 2>&1 | grep -E '\[BACKEND\] ORDER_BACKEND' | tail -1
```

Expected:
```
[BACKEND] ORDER_BACKEND=postgres STOCK_BACKEND=postgres
```

If the line does not appear after the latest "Starting Container" → the redeploy didn't pick up the new env. Re-trigger via `railway redeploy --service flower-studio-backend`.

- [ ] **Step 3: Snapshot post-flip env**

Run:
```bash
railway variables --service flower-studio-backend > /tmp/cutover-railway-env-after.txt
```

This file is the rollback reference if anything breaks later.

---

## Phase E — Post-flip verification + monitoring

### Task E1: Manual smoke test — create a test order

**Files:**
- Use florist app (or dashboard) at https://florist-blossom.vercel.app

- [ ] **Step 1: Open the app + log in as Owner**

Navigate to "New Order" → fill in test customer ("Тест Каведж", 555-0000) → add 1 line item from any available stock → submit as Pickup.

Expected: order appears in the orders list within 1-2 seconds. Status: New. Customer + line + price all visible.

- [ ] **Step 2: Verify the order landed in PG, not Airtable**

Run:
```bash
psql "<CLAUDE_RO_URL>" -c "SELECT id, airtable_id, app_order_id, customer_id, status, created_at FROM orders ORDER BY created_at DESC LIMIT 1;"
```

Expected:
- One row, created within the last 2 minutes
- `airtable_id` is **NULL** (postgres-mode native row, never pushed to Airtable)
- `app_order_id` is the visible "F-XXXX" id from the app

If `airtable_id` is non-null → orderService didn't take the postgres path. Check `routes/orders.js` and `orderService.createOrder` for a stale env-flag read; halt and investigate before more orders flow.

- [ ] **Step 3: Confirm corresponding stock decrement**

Run:
```bash
psql "<CLAUDE_RO_URL>" -c "SELECT s.airtable_id, s.flower_name, s.current_quantity, sm.delta, sm.created_at FROM stock_movements sm JOIN stock s ON s.id = sm.stock_id ORDER BY sm.created_at DESC LIMIT 3;"
```

Expected: top row's `delta` is negative (the test-order line quantity), `created_at` matches the smoke-test time, `current_quantity` reflects the deduction. No movement here = stock dispatch failed silently.

- [ ] **Step 4: Cancel the test order via the app**

In the florist app, open the order → tap "Отменить заказ" → confirm. Expected: order moves to Cancelled, stock returns.

```bash
psql "<CLAUDE_RO_URL>" -c "SELECT delta FROM stock_movements ORDER BY created_at DESC LIMIT 2;"
```

Expected: top row delta is positive (return), second row negative (original deduction).

### Task E2: Monitor Railway logs + parity_log for 30 minutes

**Files:**
- Run: `railway logs --service flower-studio-backend`

- [ ] **Step 1: Tail logs in background**

Run:
```bash
railway logs --service flower-studio-backend 2>&1 | tee /tmp/cutover-postflip-logs.log &
```

Expected: a steady stream of GET /api/orders (florists polling) and per-action lines. Watch for:
- Any `Error:` or `[FATAL]` line → **investigate immediately**
- Any `parity_log` insert messages → indicates dual-write divergence (shouldn't happen in pure postgres mode, but worth flagging)

- [ ] **Step 2: Re-run shadow-health every 10 minutes**

For 3 cycles:
```bash
CLAUDE_RO_URL="<from-A1>" node backend/scripts/shadow-health.js | grep -E "(audit|parity|orders)"
```

Expected over 30 min: orders count growing as new orders come in, audit_log filling, parity_log staying at 0.

- [ ] **Step 3: Stop log tail**

```bash
pkill -INT -f "railway logs"
```

### Task E3: Update BACKLOG.md + CHANGELOG.md

**Files:**
- Modify: `BACKLOG.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update BACKLOG.md cutover state header**

Edit `BACKLOG.md` lines 11-13. Replace the existing block:
```markdown
**Migration cutover state:**
- Phase 3 (Stock) is IN SHADOW WEEK on prod since 2026-04-28. `STOCK_BACKEND=shadow` is live.
- Phase 4 (Orders) implementation + read-path migration both merged. Harness defaults to `ORDER_BACKEND=postgres` and runs 153/153 green. Prod cutover env flip NOT started — `ORDER_BACKEND` still defaults to `airtable` on Railway.
```

with:
```markdown
**Migration cutover state:**
- Phase 3 (Stock) **CUT OVER on 2026-05-02**. `STOCK_BACKEND=postgres` live on prod. Airtable Stock = frozen legacy snapshot.
- Phase 4 (Orders) **CUT OVER on 2026-05-02**. `ORDER_BACKEND=postgres` live on prod. Airtable Orders / Order Lines / Deliveries = frozen legacy snapshots. Order shadow window was skipped — backfill + harness Wix replay served as the verification gate (see `docs/superpowers/plans/2026-05-02-phase-3-4-cutover.md`).
```

- [ ] **Step 2: Check off completed BACKLOG items**

In the same file:
- Line 28 / "Stock cutover flip" item → mark `[x]`
- Line 29 / "Phase 4 cutover" item → mark `[x]`
- Line 325 / "Flip STOCK_BACKEND=postgres" → mark `[x]`
- Line 335 / "Cutover via single ORDER_BACKEND env var" → mark `[x]`
- Line 317 `[~] Phase 3 cutover — IN SHADOW WEEK` → change to `[x] Phase 3 cutover — COMPLETE 2026-05-02`

- [ ] **Step 3: Append CHANGELOG entry**

Edit `CHANGELOG.md`. At top under today's date (create date heading if absent):
```markdown
## 2026-05-02 — Phase 3 + Phase 4 Postgres cutover

- Flipped `STOCK_BACKEND=shadow → postgres` and `ORDER_BACKEND=airtable → postgres` on Railway in a single deploy window.
- Backfilled <N> orders, <M> order_lines, <K> deliveries via `backend/scripts/backfill-orders.js` (idempotent UPSERT on airtable_id).
- Verified pre-flip: shadow-health 0 parity, Wix webhook replay 3/3 green against harness in postgres mode, full E2E 153/153 in postgres mode.
- Verified post-flip: smoke-test order created in PG with `airtable_id = NULL`, stock decrement + cancel-return movements recorded in `stock_movements`.
- Airtable Stock / Orders / Order Lines / Deliveries are now frozen legacy snapshots — only read-path access for historical inspection. New writes never propagate back to Airtable for these tables.
- Plan: `docs/superpowers/plans/2026-05-02-phase-3-4-cutover.md`. Rollback procedure documented there in Phase F.
```

- [ ] **Step 4: Commit + push**

Run:
```bash
cd /Users/oliwer/Projects/flower-studio
git checkout -b chore/phase-3-4-cutover-record
git add BACKLOG.md CHANGELOG.md docs/superpowers/plans/2026-05-02-phase-3-4-cutover.md
git commit -m "$(cat <<'EOF'
chore(migration): record Phase 3 + Phase 4 Postgres cutover

Cuts both stock and orders over to Postgres as source of truth.
Airtable becomes a frozen legacy snapshot for those tables.
See docs/superpowers/plans/2026-05-02-phase-3-4-cutover.md for the runbook.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin chore/phase-3-4-cutover-record
```

Expected: branch pushes successfully. Open a PR via `gh pr create` (the cutover already happened — this PR is documentation-only, can be merged immediately).

---

## Phase F — Rollback procedure (only if cutover fails)

Trigger: Phase D failed boot, or Phase E surfaced a regression that the team can't fix forward within 30 min.

> **Cost of rollback after orders have been written in postgres mode:** any orders created during the window flipped to postgres-mode are in PG only — they have `airtable_id = NULL`. After rollback, those orders will not be visible in the airtable-backed app reads. They are **not lost** (they're still in `orders` table on PG), but they need to be manually replayed back into Airtable, or the team will operate without them in the UI until the next forward-cutover. Document this trade-off with the owner before pulling the rollback trigger.

### Task F1: Flip both flags back

- [ ] **Step 1: Revert env**

```bash
railway variables --service flower-studio-backend --set ORDER_BACKEND=airtable
railway variables --service flower-studio-backend --set STOCK_BACKEND=shadow
```

Expected: two `Updated 1 variable.` outputs.

- [ ] **Step 2: Wait for healthy redeploy**

```bash
until curl -sf "https://flower-studio-backend-production.up.railway.app/api/health" >/dev/null 2>&1; do sleep 2; done && echo "healthy"
railway logs --service flower-studio-backend 2>&1 | grep -E '\[BACKEND\]|Listening' | tail -3
```

Expected: a fresh `[BACKEND] ORDER_BACKEND=airtable STOCK_BACKEND=shadow` line followed by `Starting Container`.

### Task F2: Document the orphaned PG orders (if any were created)

- [ ] **Step 1: Count post-cutover PG orders**

```bash
psql "<CLAUDE_RO_URL>" -c "SELECT COUNT(*) FROM orders WHERE airtable_id IS NULL AND deleted_at IS NULL;"
```

Expected: 0 (clean rollback) or a small N (orders created in the postgres-mode window). If N > 0:

- [ ] **Step 2: Dump them to a recovery file**

```bash
psql "<CLAUDE_RO_URL>" -c "\\COPY (SELECT * FROM orders WHERE airtable_id IS NULL AND deleted_at IS NULL) TO '/tmp/cutover-rollback-orphaned-orders.csv' CSV HEADER;"
```

Tell the owner: "N orders are PG-only and won't be visible in the rolled-back app. CSV at /tmp/...; we'll re-import on the next forward-cutover or manually replay into Airtable."

### Task F3: File a post-mortem note

- [ ] **Step 1: Append a short post-mortem to BACKLOG.md**

Add under "Known Issues" the shape:
```markdown
- **Phase 3+4 cutover rollback on 2026-05-02** — root cause: <fill in>. Forward-cutover blocked on <X>. Orphaned PG-only orders during the window: <N> (CSV at /tmp/cutover-rollback-orphaned-orders.csv).
```

---

## Post-cutover follow-ups (NOT in this plan)

These are deliberate non-goals — separate plans should be opened later:

- **Order parity dashboard impl** — `orderRepo.runParityCheck` is a stub. Now that postgres is source of truth, this becomes a *historical* parity check (PG vs frozen-Airtable) and is lower priority. Schedule for the week after cutover.
- **Phase 5 — Customer dedup** — see `BACKLOG.md` line 338.
- **Phase 6 — Stock Loss Log** — still on Airtable. The `editBouquetLines` writeoff path uses Airtable today.
- **Wix webhook signed-replay harness** — referenced in CLAUDE.md "Verification Gate". Today's Task C3 is a manual one-off; building it into CI would prevent the next migration's verification debt.

---

## Self-review

**Spec coverage check** — every risk/concern from pre-plan discussion mapped to a task:
- ✓ Stock shadow short by 3 days → Task A1 (re-verify clean)
- ✓ No order shadow validation → Tasks B1-B4 (backup + spot-check) + C1-C3 (Wix replay)
- ✓ Order parity dashboard stub → noted in Risks + Post-cutover follow-ups; spot-check in B4 substitutes
- ✓ Wix webhook untested in PG → Task C3 explicit
- ✓ Boot guard forces simultaneous flip → Task D2-D3 sequenced explicitly
- ✓ Rollback path → Phase F dedicated
- ✓ Decision gates → 4 explicit gates between phases

**Placeholder scan** — searched plan for `TBD|TODO|fill in|TBD|implement later|appropriate|similar to`:
- "Add appropriate error handling" — not present
- "fill in" — appears once intentionally in F3 ("root cause: <fill in>") for the post-mortem template; this is owner-fill, not engineer-skip
- "<value-from-step-1>" / "<from-A1>" / "<recXXXX>" / "<N>" — these are placeholders the executor fills from prior steps' output; they reference concrete sources, not fictional values

**Type / command consistency check**:
- `CLAUDE_RO_URL` used identically in A1, B3, B4, D1, E1, E2, F2
- Railway service name `flower-studio-backend` used identically in A2, D2, D3, D4, E2, F1
- Postgres service name `Postgres` (not `flower-studio-backend`) used in A1 step 1 (different service, intentional)
- Backfill script path `backend/scripts/backfill-orders.js` consistent
- Airtable backup output path `backups/2026-05-02/` consistent
- Test harness env (`ORDER_BACKEND=postgres STOCK_BACKEND=postgres`) consistent in C2, C4

No issues found.

---

## Plan summary

- **Phases**: A pre-flight (3 tasks) → B backup+backfill (4 tasks) → C Wix replay (4 tasks) → D flip (4 tasks) → E verify (3 tasks) → F rollback (3 tasks, only on failure)
- **Total tasks**: 18 (sequential), plus 3 in rollback
- **Estimated time**: 4-6 hours if same-day; 2-3 hours prep + 30 min flip-and-verify if split across two days
- **Owner approval gates**: 3 (before B2, before D2, before D3)
- **Reversible until**: Task D3 (flip ORDER_BACKEND). After D3, rollback is possible but loses any orders created during the window unless manually replayed.
