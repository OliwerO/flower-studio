---
description: "One workflow: grill → PRD → plan → vertical-slice issues → worktree → execute → ship. Matt design + superpowers execution. Use for any change > one-line."
---

# /feature — flower-studio default workflow

Run for any change > one-line. Routes light work via bail-outs at bottom.

## Sequence

0. **Branch hygiene.** `BRANCH_AUDIT_FRESH=1 bash .claude/hooks/branch-audit.sh`. Resolve >2 stale branches, or any open PR by current user untouched >5d, before starting new work. Pile-new-onto-old caused the May 2026 branch graveyard.

1. **`grill-with-docs`.** Stress-test design vs `CONTEXT.md` + `docs/adr/`. Update glossary inline as terms resolve. Output: locked scope. Skip only if user pre-grilled this turn.

2. **`to-prd`** — *mandatory* if feature touches ≥2 of {schema, API route, UI page, integration}. Publish PRD as GitHub Issue, label `needs-triage`. Threshold-below: skip.

3. **`writing-plans`** with overrides. Plan saved to `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`:
   - **Vertical slices.** Each task = thin demoable path through all relevant layers (schema/API/UI/tests). Reject horizontal-only plans (Task 1 = all schema, Task 2 = all API…). Re-slice before continuing.
   - **CONTEXT.md vocabulary.** Domain entities use exact glossary terms in task names + module boundaries. "Customer" not "client", "Demand Entry" not "placeholder", "Stock Item" not "product".
   - **Deep modules.** For each new module: deletion test. If delete scatters complexity across N callers → keep (deep). If delete vanishes complexity → it's a shallow wrapper; merge inline.
   - **Right-size.** ≤15 tasks, ≤1500 lines, ≤300 LOC + ≤2 files per task. Above → split MVP + follow-ups.

4. **`to-issues`** — *mandatory* for ≥5-task plans. Break plan into AFK/HITL tracer-bullet GitHub Issues, label `needs-triage`. Issues track state; plan file = implementation reference.

5. **`using-git-worktrees`.** `.worktrees/<feature>/` on `feat/<name>` (or `fix/`/`chore/` per CLAUDE.md prefixes). Never `claude/*`. Two simultaneous sessions in this repo → each in its own worktree. `git worktree list` before any branch op.

6. **`subagent-driven-development`** with overrides:
   - **Models:** implementer + spec-reviewer = `sonnet`. Code-quality reviewer + final reviewer = `opus`. Explore agent inherits (sonnet). **Never default subagents to opus.**
   - **Review cadence:** spec-review per task (sonnet, cheap). Code-quality review **at phase boundaries only** (groups of 3–5 tasks, opus). Per-task code-quality only when task touches **Known Pitfalls**: statuses (`statuses.js`, `*Service.js` state machines), stock math (`stockMath.js`, `StockItem.jsx`, `StockTab.jsx`), cancel-with-return (3 lockstep files in CLAUDE.md Pitfall #7), Wix sync (`wix*.js`), shadow-window writes (anything via `stockRepo`/`orderRepo` while a `*_BACKEND` flag = `shadow`).
   - **TDD vertical.** Implementer writes one test → one impl → commit. **Never bulk-write tests then bulk-implement.** Bulk tests test imagined behavior; they pass when behavior breaks and break when behavior is fine (Matt's `tdd` skill).
   - **Skip TDD red phase** for: pure UI wiring, CSS/Tailwind, copy/translation, doc edits, route handlers composing existing services. **Mandatory red phase** for: new backend services, new shared utils/hooks, new repos, all Known Pitfall areas.
   - **Tight prompts.** Implementer subagent gets: that task's section verbatim + plan path + ≤5 file paths + spec excerpt. **No prior tasks, no future tasks, no chat history.**

7. **`verification-before-completion`.** Run Pre-PR matrix from `CLAUDE.md` § Pre-PR Verification (backend vitest + e2e if backend touched, shared vitest + build all 3 apps if shared touched, single app build for app-only changes, lab `lab:test:unit` + `lab:test:api` if backend/shared/lab touched). **Quote actual green output in chat.** Tracer-bullet tasks: also demo end-to-end (curl, screenshot, or Playwright run).

8. **`finishing-a-development-branch`.** PR body names verification path per CLAUDE.md Verification Gate. List slice issues with `Closes #N` **on separate lines** — comma-separated only closes the first (burned PR #259).

## Bail-outs

Tell user explicitly: "Lighter than `/feature` warrants — proposing X."

| Situation | Route |
|---|---|
| Bug touching prod data path | `diagnose` (Phase 0 prod sweep: Railway logs → PG → shadow-health, flower-studio-tuned). Fix → verify → PR. No plan, no worktree. |
| Single-file CSS / Tailwind / copy / translation | Direct edit + verify + commit. |
| 1–3 file mechanical refactor | `feature-dev:feature-dev` single guided pass. |
| Architecture audit before redesign | `/audit <area>`. |

## Cost target

Medium feature (5–15 files, no schema, no shadow writes) = **one** 5h Opus window when overrides above followed. Two windows likely → plan too big → split into MVP + follow-ups.
