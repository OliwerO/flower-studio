# Workflow Config — flower-studio

Per-project data for `/feature`. Distilled from CLAUDE.md (2026-06-26). Refresh if stack drifts.

## Domain docs
- `CONTEXT.md` (repo root) — domain glossary / vocabulary.
- `docs/adr/` — architecture decisions (0001–0007+). Grill against these.
- `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md`.

## Issue tracker
GitHub Issues (`OliwerO/flower-studio`). Label new PRDs/issues `needs-triage`.

## Branch Policy
- Prefixes: `feat/ fix/ chore/ docs/ test/`. **Never `claude/*`.**
- Intent-driven names. One branch per feature. Land or kill within 7 days; open a (draft) PR within a day.
- >100 commits behind master → re-cut, don't rebase.
- Worktree mandatory for parallel sessions: `.worktrees/<feature>/`. `git worktree list` before any branch op.

## Self-audit
SessionStart hook `.claude/hooks/branch-audit.sh` (read-only) flags `[gone]` upstreams, stale branches, open PRs. Run `/branches` before new work if flagged. Only `/branches` + `/feature` take destructive action.

## Subagent Models (cost discipline — never default to opus)
- Implementer + spec-reviewer = `sonnet`.
- Code-quality review + final review = `opus`, at **phase boundaries** (3–5 tasks), not per-task.
- Per-task code-quality only when task touches a Known Pitfall file.
- Explore inherits sonnet.

## Review Cadence
Spec-review per task (sonnet). Code-quality at phase boundaries (opus). Pitfall-area tasks get per-task review.

## TDD Policy
- Vertical TDD: one test → one impl → commit. Never bulk tests then bulk impl.
- **Mandatory red phase:** new backend services, new shared utils/hooks, new repos, all Known Pitfall areas.
- **Skip red phase:** pure UI wiring, Tailwind/CSS, copy/translation, route handlers composing existing services.

## Known Pitfalls (per-task review triggers)
See CLAUDE.md "Known Pitfalls" #1–9. High-relevance for Wix work:
- Wix sync seams: `webhook.js`, `orderService.createWixOrder`, `wixProductSync.js`, `wixPushJob.js`, `wixMediaClient.js`.
- Cross-app parity: florist ↔ dashboard ↔ delivery must stay in lockstep (parity table in CLAUDE.md).
- Verification gate for Wix/Telegram/cutover: PR must name the automated proof or be prefixed `[unverified]`.

## Pre-PR Verification Matrix (run what the diff touches)
- **backend/**: `cd backend && npx vitest run`; then `npm run harness &` + `npm run test:e2e`.
- **packages/shared/**: `cd packages/shared && ../../backend/node_modules/.bin/vitest run`; build ALL THREE apps (florist, dashboard, delivery).
- **single app**: `cd apps/<app> && ./node_modules/.bin/vite build` (+ any app importing a touched shared file).
- **backend/ | packages/shared/ | lab/**: `npm run lab:test:unit`, `npm run lab:test:api` (needs `npm run lab:db:up && npm run lab:template:rebuild -- --scenario=baseline` first).
- Quote green output in chat before claiming done.

## CI gate
`.github/workflows/test.yml` — Vitest (backend + shared) + API E2E + `lab-api` job on every PR + push to master. Vercel preview deploys gated by prod build pipeline (build all 3 apps locally first). Name this in PR body.

## Cost Target
Medium feature (5–15 files, no schema, no cross-cutting) = one Opus window with overrides applied. Two-window forecast → split MVP + follow-ups.

## Prod access (read-only by default)
- Reads: `claude_ro` DSN (from `railway variables --service Postgres --kv | grep CLAUDE_RO_URL`). `pg` driver hoisted to repo-root `node_modules`.
- Railway backend service: `flower-studio-backend`. Wix creds (`WIX_API_KEY`, `WIX_SITE_ID`) live there; run prod-env scripts via `railway run --service flower-studio-backend node <script>`.
- Writes to prod/Wix require explicit owner approval for the specific change.
