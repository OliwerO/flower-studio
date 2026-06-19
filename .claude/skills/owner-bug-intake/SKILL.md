---
name: owner-bug-intake
description: Flower-studio Phase 0 sweep before any bug-fix work — pull Railway logs, query prod Postgres via the read-only DSN, run shadow-health, then hand off to the diagnose skill with grounded evidence. Use when the owner reports a bug in production, says "X is broken", "an order is wrong in the app", "a customer complained", "report from owner", or any time you would otherwise jump straight to code inspection on a prod symptom.
---

# Owner Bug Intake

The owner reports bugs that happened minutes ago in production. There is no dev/staging — Postgres on Railway, Express on Railway, three Vercel frontends, and a live user base. Hypotheses written without prod evidence waste her time and usually fix the wrong thing.

This skill is the Phase 0 sweep: gather hard signal from prod, then enter [diagnose] with the evidence in hand. Stop guessing.

## Quick start

1. Pin the exact symptom: who, what, when, on which app, which order/stock/customer ID.
2. Tail Railway backend logs and grep for the timestamp.
3. Read the affected rows from prod Postgres via the `claude_ro` DSN.
4. Run `backend/scripts/shadow-health.js` for a system-wide sanity check.
5. Summarise findings (one paragraph) and **invoke the `diagnose` skill** with those findings as the symptom statement.
6. Never write to prod unless the owner explicitly approves the specific change.

## Phase 0 sweep checklist

### Step 1 — Pin the symptom
- [ ] Which app surfaced it (florist / dashboard / delivery)?
- [ ] Wall-clock time of the symptom (owner's phone says X — convert to UTC if needed).
- [ ] Concrete record IDs (order ID, stock item ID, customer ID). If the owner gave a screenshot, OCR/extract the IDs.
- [ ] What was the action performed and what was the unexpected result?

If any of the above is missing, ask the owner ONE focused question before sweeping. Do not guess.

### Step 2 — Railway backend logs
```bash
railway logs --tail 500 | grep -E "ERROR|FEEDBACK|PG|<order-id>"
```
Patterns worth grepping:
- The record ID(s) from Step 1.
- `[ERROR]`, `[PG]`, `[FEEDBACK]`, `[WIX]`, `[STOCK]` — service-prefixed log lines.
- HTTP status 4xx/5xx for the affected route.
- `railway logs --service Postgres` if the symptom smells like DB connectivity.

If logs are stale (rotated past), use `railway logs --tail 2000` and search for the surrounding minute.

### Step 3 — Prod Postgres read
Use the `claude_ro` DSN — it is read-only, cannot mutate. Two ways:
- One-shot from a script: `railway run node backend/scripts/<your-read-script>.js` (or write a tiny one-off under `backend/scripts/check_<thing>.mjs` — there is already a pattern; see `check_peony.mjs`).
- Interactive: `railway connect` opens a `psql` session against prod.

Read in this order:
- The affected record (`SELECT * FROM orders WHERE id = ...`).
- The `audit_log` rows for that record (`SELECT * FROM audit_log WHERE entity_id = ... ORDER BY created_at DESC LIMIT 20`).
- For stock symptoms, the `/stock/:id/usage` trace logic (also via `stockRepo`).
- For order ↔ delivery cascade symptoms, both rows side by side.

**Never run a write query from this skill.** If the owner asks to fix a row manually, exit to the explicit-approval write path documented in `CLAUDE.md`.

### Step 4 — Shadow-health snapshot
```bash
CLAUDE_RO_URL='postgresql://claude_ro:...@shuttle.proxy.rlwy.net:28897/railway' \
  node backend/scripts/shadow-health.js
```
The DSN lives in Railway (`railway variables --service Postgres | grep CLAUDE_RO`) or `~/.claude/projects/.../memory/project_postgres_access.md`. The script reports parity, audit-log activity, and PG row counts — quick "is the platform alive" check.

### Step 5 — Reconcile against Known Pitfalls
Open `CLAUDE.md` → "Known Pitfalls (prevent recurrence)" and compare the symptom against:
1. Stale state after conversion (Pickup→Delivery).
2. Delivery fee on the delivery sub-record.
3. Hardcoded fallbacks.
4. Feature gates excluding valid cases.
5. Silent `catch` blocks.
6. PO line identity.
7. Order Termination flow re-implemented inline.
8. Stock formula re-introducing `qty - committed`.

If the symptom matches one of these, do not invent a new hypothesis — fix at the known seam.

### Step 6 — Handoff to diagnose
Write a one-paragraph summary:
```
Symptom: <what the owner saw>
Affected record(s): <IDs>
Railway log evidence: <key line(s)>
PG state: <what the row(s) actually look like>
Known-pitfall match: <none | #N>
```
Then invoke the `diagnose` skill with that summary as the symptom statement. Phase 0 is done; Phase 1 of diagnose starts now.

## Hard rules

- **Read-only by default.** `claude_ro` DSN for any prod query. Only escalate to write access on explicit owner approval for the specific change.
- **Railway CLI before code.** The log usually names the error. Searching the codebase before reading the log wastes time.
- **No hypothesising before evidence.** If the owner reports a bug and you jump to "I think it is X" without running this sweep, you are in the failure mode this skill exists to prevent.
- **Verification gate still applies.** A fix to Wix, Telegram, order, or stock surfaces requires the verification path in `CLAUDE.md` before claiming done.

## Red flags

| Thought | Reality |
|---|---|
| "I know what this bug is" | Run the sweep anyway. The April 2026 Wix-fix cluster all started this way. |
| "Logs probably won't help" | They usually name the exception. 30 seconds well spent. |
| "I'll grep the code first" | Code is the same as last week. The runtime state isn't. |
| "Let me just fix this row in prod" | Read-only DSN by default. Ask the owner first. |
| "Shadow-health is overkill" | It is 5 seconds and rules out platform-wide problems. |

## Related skills

- [diagnose] — Phase 1+ disciplined diagnosis loop. This skill feeds it.
- [pre-pr-matrix] — verification gate before the fix ships.
- [wix-sync-debug] — Wix-specific extension when the symptom is product/webhook sync.
