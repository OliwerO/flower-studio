---
name: pre-pr-matrix
description: Run the correct subset of CI checks locally before pushing a PR, computed from the actual git diff. Inspects which paths changed (backend, packages/shared, single app, lab/) and prescribes only the relevant Vitest/E2E/Vite-build/lab-harness commands. Use before opening or pushing any PR, when finishing a worktree, when the user says "verify before PR", "run the checks", "pre-PR", "ready to push", or any time you are about to claim work is complete.
---

# Pre-PR Matrix

Vercel previews are gated by production builds. A failed preview lands in the owner's inbox. The Mac has the compute — running CI locally first saves the round-trip and avoids the "passed locally, broke on Vercel" embarrassment that hit the `lucide-react` shared peer dep in May 2026.

This skill picks the *minimum* matrix that still catches the common breakages, based on what the diff actually touches.

## Quick start

1. Print the changed paths: `git diff --name-only origin/master...HEAD`.
2. Run `.claude/skills/pre-pr-matrix/scripts/pick-matrix.sh` (also embedded below) — it lists the commands you need.
3. Execute each command from repo root in order. Stop and fix on first failure.
4. Only after **every** applicable command passes green: commit, push, open PR.
5. If any check is broken for unrelated reasons (harness won't boot, etc.), note it explicitly in the PR body — never silently skip.

## Path → check mapping

| Path touched | Run this |
|---|---|
| `backend/**` | `cd backend && npx vitest run` |
| `backend/**` or harness-relevant changes | `npm run harness &` then `npm run test:e2e` (kill harness after) |
| `packages/shared/**` | `cd packages/shared && ../../backend/node_modules/.bin/vitest run` |
| `packages/shared/**` | Build **all three** apps (see below) |
| `apps/florist/**` (only) | `cd apps/florist && ./node_modules/.bin/vite build` |
| `apps/dashboard/**` (only) | `cd apps/dashboard && ./node_modules/.bin/vite build` |
| `apps/delivery/**` (only) | `cd apps/delivery && ./node_modules/.bin/vite build` |
| `backend/**`, `packages/shared/**`, or `lab/**` | `npm run lab:test:unit` |
| `backend/**`, `packages/shared/**`, or `lab/**` | `npm run lab:test:api` (rebuild template first if it changed) |
| `lab/scenarios/**` or UI scenarios changed | `npm run lab:test:ui` (slower, optional) |
| New `catch(...) {}` block in backend | Manual scan for silent catches — the CI guard will flag, fix locally first |

### The "build all three" rule

If `packages/shared/` is touched, Vercel builds each app in isolation. npm-workspace hoisting hides missing deps locally. The only way to catch a missing shared peer-dep is to build all three:

```bash
cd apps/florist  && ./node_modules/.bin/vite build && cd -
cd apps/dashboard && ./node_modules/.bin/vite build && cd -
cd apps/delivery && ./node_modules/.bin/vite build && cd -
```

### Lab-harness preconditions

`npm run lab:test:api` needs a template. First time per session (or after a schema or scenario change):

```bash
npm run lab:db:up
npm run lab:template:rebuild -- --scenario=baseline
```

## Workflow

### Step 1 — Diff
```bash
git diff --name-only origin/master...HEAD
```
Memorise the top-level path buckets that show up: `backend/`, `packages/shared/`, `apps/<name>/`, `lab/`, `.github/`, `docs/`, root scripts.

Docs-only and `docs/`-only changes are exempt from the matrix (still run `git status` to confirm nothing else slipped in).

### Step 2 — Compose the matrix
For each bucket above, list every check from the mapping table. De-duplicate. Run in this order:
1. Unit tests (fast, fail fast).
2. Vite builds (catches missing deps).
3. E2E (slow, run last — but mandatory if backend touched).
4. Lab API (cancel-with-return regression gate).

### Step 3 — Run and watch
- Use one terminal per long-running step. The harness needs to stay up while E2E runs.
- Fail-fast: on first red, stop, fix, re-run *that* check, then continue.
- Capture the green line(s) from the output — useful for the PR body.

### Step 4 — Announce truthfully
Only after every check green:
- "All applicable Pre-PR matrix checks green: <list>. Pushing."
If a check is broken for unrelated reasons, write that in the PR body explicitly:
- "`npm run test:e2e` not run because the harness fails to boot on this machine — verified manually via Section 14 of the suite. Owner: please confirm CI before merge."

### Step 5 — Push, open PR
- Commit first, push second, open PR third.
- The PR body must reference the matrix you ran (one bullet per check + green status).

## Embedded picker script

A tiny script in this skill's `scripts/` directory computes the matrix from `git diff`:

```bash
./.claude/skills/pre-pr-matrix/scripts/pick-matrix.sh
```

It prints, one command per line, exactly what to run.

## Red flags

| Thought | Reality |
|---|---|
| "It's a small change" | The May `lucide-react` break was a one-line import. Run the matrix. |
| "Just the frontend, skip backend tests" | Confirm via diff — if `packages/shared/` was touched you owe three builds. |
| "Tests pass locally" | Only true after **every applicable check**, not just the obvious one. |
| "Lab harness is overkill for this" | If `backend/` or `packages/shared/` is in the diff, lab-api guards cancel-with-return. Run it. |
| "I'll run E2E in CI" | CI will. Vercel will too. But Vercel failures land in the owner's inbox. Run locally first. |

## Related

- [parity-sync] — drives the "build all three apps" rule when shared is touched.
- [superpowers:verification-before-completion] — the discipline this skill operationalises.
- [owner-bug-intake] — if the matrix fails on prod-only behavior, that skill comes next.
