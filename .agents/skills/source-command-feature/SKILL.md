---
name: "source-command-feature"
description: "Tuned superpowers chain for flower-studio: brainstorm → plan → worktree → subagent-driven exec → finish. Cost-disciplined defaults (Sonnet executors, batched reviews, tight prompts, MVP-sized plans)."
---

# source-command-feature

Use this skill when the user asks to run the migrated source command `feature`.

## Command Template

# /feature — tuned superpowers for flower-studio

Run the full superpowers chain with the cost-discipline rules from `AGENTS.md` enforced as hard defaults. Use this for any feature/bugfix that takes more than a one-line change. For typo fixes, dependency bumps, or doc-only PRs, skip and edit directly.

The user invoked this with `/feature <one-line description>` (or no args; ask once if missing).

## Hard-coded defaults (do not deviate without owner sign-off)

These override the generic superpowers skill defaults. They exist to keep a feature inside one 5h Opus window instead of two.

### Model selection per subagent role

When spawning subagents via the `Agent` tool, **pass `model` explicitly**:

| Role | Model | Why |
|------|-------|-----|
| `code-architect` / `writing-plans` driver / brainstorming partner | `opus` | Reasoning-heavy. Bad designs cost more than the model premium. |
| `code-reviewer` (final pass + phase-boundary passes) | `opus` | Catches the bugs that ship. |
| `systematic-debugging` driver | `opus` | Root-cause work. |
| Implementer subagent (executes a written plan task) | `sonnet` | ~5× cheaper, adequate for "follow these steps + run these commands". |
| Spec-compliance reviewer | `sonnet` | Mechanical diff vs. plan. |
| Code-quality reviewer (between phases, not per task) | `opus` | The one place quality reviews actually pay off. |
| `Explore` agent (greps, file lookups) | inherit (defaults to `sonnet`) | Fine. Don't override. |

**Never default subagents to Opus.** That's the single biggest waste lever from the bouquet-image-upload burn (2× 5h Opus windows for one feature).

### Review cadence: phase boundaries, not per task

The default `subagent-driven-development` skill spec runs spec-reviewer + code-quality-reviewer **after every task**. For a 17-task plan that's ~34 review subagents, each re-reading AGENTS.md + plan + spec.

**Override:** group tasks into phases of 3–5. Run spec-compliance review **after each task** (cheap, Sonnet). Run code-quality review **only at phase boundaries** (Opus, expensive). Final code-reviewer pass over the whole branch diff before PR.

**Exception — keep per-task code-quality review** when the task touches a Known Pitfall area from `AGENTS.md`:
- Status workflows (`backend/src/constants/statuses.js`, any `*Service.js` state machine)
- Stock math (`packages/shared/utils/stockMath.js`, `StockItem.jsx`, `StockTab.jsx`)
- Cancel-with-return (three lockstep files in AGENTS.md Known Pitfalls #7)
- Wix sync / webhook (`backend/src/services/wix*.js`, `backend/src/routes/wix*.js`)
- Shadow-window writes (anything routed through `stockRepo` / `orderRepo` while a `*_BACKEND` flag is at `shadow`)

### Pre-trim subagent prompts

Don't paste the full plan into every executor subagent. The plan exists on disk under `docs/superpowers/plans/`. Each implementer gets:
- The single task's section (verbatim, including its checklist)
- The plan path so the subagent can read more if it needs to
- The 3–5 file paths that task touches
- The spec excerpt that constrains the task (1–2 paragraphs, not the whole spec)
- Pointer to `AGENTS.md` for repo conventions (subagent reads automatically)

That's it. No prior tasks, no future tasks, no chat history.

### Right-size plans

Hard limits before starting `subagent-driven-development`:
- ≤ 15 tasks
- ≤ 1500 lines of plan markdown
- Each task = one commit's worth (≤ ~300 LOC, ≤ 2 files in most cases)

If `writing-plans` produces something larger, **split**: land an MVP first (≤ 8 tasks), file follow-up plans for the rest. The 2300-line bouquet-image-upload plan was a smell that cost a full Opus window.

### Skip TDD red phase for low-signal task types

TDD red/green stays mandatory for: new backend services, new shared utils, new shared hooks, new repos, anything in `Known Pitfalls`.

**Skip the formal red phase** (write the test alongside or after instead) for:
- Pure UI wiring (importing an existing shared component into a page)
- CSS / Tailwind tweaks
- Copy / translation changes (`packages/shared/translations.js`)
- Doc-only edits
- Simple route handlers that compose existing services with no new logic

Verification via `superpowers:verification-before-completion` stays mandatory regardless.

### Worktree mandatory

If two Codex sessions might run in this repo, create a worktree under `.worktrees/<feature>/` via `superpowers:using-git-worktrees`. The cross-session git collisions of 2026-05-02 (stray commits, branch flips mid-task, mangled commit messages) were caused by skipping this.

### Pre-PR verification gate

Before announcing the PR is ready, run the check matrix from `AGENTS.md` § "Pre-PR Verification". Specifically:
1. Backend changes → `cd backend && npx vitest run` + `npm run harness &` then `npm run test:e2e`
2. Shared changes → `cd packages/shared && ../../backend/node_modules/.bin/vitest run` AND build all three apps (`apps/florist`, `apps/dashboard`, `apps/delivery`)
3. Single-app frontend changes → build that app, plus any other app touching files you changed in `packages/shared/`

Quote the actual output. No "tests pass" claims without the green output in the conversation.

## Sequence

0. **Branch hygiene gate** — before anything else, run `BRANCH_AUDIT_FRESH=1 bash .Codex/hooks/branch-audit.sh` (or invoke `/branches` for an interactive audit). If the audit reports >2 stale branches >7d old without an open PR, OR any open PR by the current user that hasn't been touched in >5 days, **stop and resolve those first**. Land them, close them, or salvage to BACKLOG. The "pile new work onto whatever branch is checked out" trap that produced the May 2026 branch graveyard happens because new features get started while old ones are still half-shipped. Don't add to the pile.
1. **`superpowers:brainstorming`** — explore intent + design. Skip if the user's prompt to `/feature` already pins scope down to file-level decisions.
2. **`superpowers:writing-plans`** — write the plan to `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`. Enforce the right-size limits above. If the plan exceeds them, propose an MVP split before continuing.
3. **`superpowers:using-git-worktrees`** — `.worktrees/<feature>/` with branch `feat/<feature>` (or `fix/`, `chore/`, etc. per `AGENTS.md`).
4. **`superpowers:subagent-driven-development`** — execute with the model + review-cadence overrides above. Use phase-boundary reviews; per-task only for Known-Pitfall tasks.
5. **`superpowers:verification-before-completion`** — run the check matrix, paste output.
6. **`superpowers:finishing-a-development-branch`** — propose merge / PR / cleanup. PR description must name the verification path per `AGENTS.md` § "Verification Gate".

## When to bail to a lighter flow

If after `brainstorming` it's clear the work is:
- A single-file copy / Tailwind / translation change → drop the chain. Just edit + verify + commit.
- A bug obvious from a stack trace → skip to `superpowers:systematic-debugging`, then edit + verify + commit. No plan, no worktree.
- 1–3 file mechanical refactor → use `feature-dev:feature-dev` (single guided pass, no subagent fanout) instead of this command.

Tell the user explicitly: "This looks lighter than `/feature` warrants — proposing X instead."

## Cost target

A medium feature (5–15 files, no schema change, no shadow-window write) should fit in **one** 5h Opus window when this command's defaults are followed. If two windows look likely, the plan is too big — split it.
