---
name: resume-plan
description: Pick up an in-flight multi-session plan from docs/superpowers/plans/ and the auto-memory index. Reads the plan doc, the matching project memory record, and the current repo state to find the exact resume point — then re-enters whichever upstream skill (grill-with-docs, writing-plans, executing-plans, /feature) the work was paused inside. Use when the user says "continue with X", "let's pick up the Y plan", "what's left from the migration", "resume the stock PRD", or anything that implies returning to paused multi-session work.
---

# Resume Plan

Multi-session work in flower-studio is checkpointed in two places:
- `docs/superpowers/plans/<YYYY-MM-DD>-<slug>.md` — the plan / PRD / grill transcript.
- `~/.claude/projects/-Users-oliwer-Projects-flower-studio/memory/project_<slug>_in_progress.md` — a short memory record that names the pause point and the resume instructions.

Resuming means: load both, reconcile against the current repo, then re-enter the right upstream skill — never re-grill answered questions, never re-plan a locked plan.

## Quick start

1. Identify the plan from the user's words (e.g. "stock PRD", "phase 7 migration", "Y-model stock foundation").
2. List candidates: `ls docs/superpowers/plans/ | grep -i <slug>` and `ls ~/.claude/projects/-Users-oliwer-Projects-flower-studio/memory/ | grep -i project_`.
3. Read the most recent matching plan doc end-to-end and any `project_*_in_progress.md` memory.
4. Verify against current state: `git log --oneline -10`, `CONTEXT.md`, `docs/adr/`, open GitHub issues / PRs for the same slug.
5. State the resume point out loud: "Resuming `<plan-name>` at `<checkpoint>`. Re-entering `<skill>`."
6. Invoke that upstream skill.

## Workflow

### Step 1 — Find the plan
Plans live in `docs/superpowers/plans/`. Naming is `YYYY-MM-DD-<slug>.md`. If the user said "stock PRD", that's `2026-05-09-stock-prd-grill.md`. If they said "phase 7", there are multiple — pick the most recent or ask one focused question.

```bash
ls docs/superpowers/plans/ | grep -i <slug>
ls ~/.claude/projects/-Users-oliwer-Projects-flower-studio/memory/ | grep -E "project_.*in_progress"
```

If nothing matches, the work probably never reached the plan-doc stage — exit this skill and start at `/feature` or `superpowers:writing-plans` instead.

### Step 2 — Load both checkpoints
- Read the entire plan doc. Note: locked decisions, in-flight question, queued questions.
- Read the matching `project_<slug>_in_progress.md` memory. Note: `description`, `originSessionId`, the **Why / How to apply / Verify before recommending** lines.

These two together name the exact checkpoint.

### Step 3 — Reconcile against current repo state
Plan docs and memory records are snapshots. Verify they're still load-bearing:
- `git log --since="<plan date>" --oneline` — what landed since.
- `git diff <plan-date>..HEAD -- <files plan touches>` — has the surface area moved?
- `gh issue list --search "<slug>"` and `gh pr list --search "<slug>"` — any new tickets the plan needs to fold in.
- `CONTEXT.md` and `docs/adr/` — has the domain language or a decision changed?

If the plan is clearly stale (more than ~30 days, surface heavily refactored, ADR retired), do not blindly resume — surface the staleness to the user and offer to either revise the plan or archive it under `docs/archive/`.

### Step 4 — Announce the resume point
One sentence, no hedging. Example:
> "Resuming `2026-05-09-stock-prd-grill.md` at Q2a (Y vs X model fork). Re-entering `grill-with-docs`. Locked priorities: time-phased demand, stem-length tracking, simplified inventory UI. Queued: Q3–Q8."

This makes the user's mental model match yours before either of you spend more time.

### Step 5 — Re-enter the upstream skill
Map the checkpoint to the right skill. **Do not re-do work the plan already records as done.**

| Checkpoint state | Re-enter |
|---|---|
| Grill paused mid-question (PRD not locked) | `grill-with-docs` (or `grill-me` if no domain docs) |
| PRD drafted but not posted to issue tracker | `to-prd` |
| PRD posted, no implementation issues yet | `to-issues` |
| Issues exist, no plan doc per slice | `superpowers:writing-plans` |
| Plan doc exists, implementation underway | `superpowers:executing-plans` (or `/feature` if from scratch) |
| Implementation done, PR pending | `pre-pr-matrix` then ship |

### Step 6 — Update the memory on pause
Whenever you pause again (end of session, user steps away, branch context-switch), update the matching `project_<slug>_in_progress.md`:
- Bump the description / date in the frontmatter.
- Replace the pause-point sentence with where the new pause is.
- Append a one-line note to the body if any new decision was locked.

This is the single most important rule of this skill — without the memory update, the next session walks in blind.

## Inventory of current in-flight plans (snapshot — verify before trusting)

| Slug | Plan doc | Memory |
|---|---|---|
| Stock PRD grill | `docs/superpowers/plans/2026-05-09-stock-prd-grill.md` | `project_stock_prd_grill_in_progress.md` |
| Stock Y foundation | `docs/superpowers/plans/2026-05-10-stock-y-foundation.md` | (check memory) |
| PG-reads dashboard analytics | `docs/superpowers/plans/2026-05-07-pg-reads-dashboard-analytics-stock.md` | (check memory) |
| Report system | `docs/superpowers/plans/2026-05-07-report-system.md` | (check memory) |
| Phase 7 PR 2b (Airtable retire) | `docs/superpowers/plans/2026-05-09-phase7-pr2b-airtable-retire.md` | retired — see `project_post_cutover_repo_bypasses.md` |

When in doubt, `ls docs/superpowers/plans/` and trust the filesystem over this table.

## Red flags

| Thought | Reality |
|---|---|
| "I remember where we paused" | Read the doc. Memory drifts; the doc is the source of truth. |
| "Let's re-grill to refresh context" | The grill already answered those — re-grilling is regression. |
| "The user said continue, I'll just do the next obvious thing" | The "next obvious thing" is in the plan. Read it. |
| "Plan looks stale, I'll just update the code" | Stale plan = decide: revise or archive. Do not silently diverge. |
| "I won't update the memory at end of session" | Then next session's resume costs 2× the time. Always update. |

## Related

- [grill-with-docs] — re-enter for PRD-not-yet-locked checkpoints.
- [superpowers:writing-plans] / [superpowers:executing-plans] — plan + execute checkpoints.
- [/feature] — full chain when starting from scratch.
- [dev-summary] — write at each pause so future sessions resume with a current mental model.
- [owner-summary] — write the owner-facing version when the pause point has shipped anything she'd see.
