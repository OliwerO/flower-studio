## Summary

<!-- 1-3 bullets: what changed and why. Skip the "what" if the diff is obvious; focus on "why". -->

## Test plan

<!-- Which checks did you run locally? Check what applies. -->

- [ ] `cd backend && npx vitest run`
- [ ] `npm run harness &` + `npm run test:e2e`
- [ ] `npm run lab:test:unit`
- [ ] `npm run lab:test:api`
- [ ] `npm run lab:test:ui` (only if UI / scenarios changed)
- [ ] `cd packages/shared && ../../backend/node_modules/.bin/vitest run` (only if shared changed)
- [ ] Built all three apps locally (only if shared changed): `vite build` in `apps/florist`, `apps/dashboard`, `apps/delivery`
- [ ] Manually clicked through the affected UI in `npm run lab:dev` (only for UI changes)

## Lab harness discipline (per `lab/WORKFLOW.md`)

<!-- Mandatory checklist for any PR that touches schema or lab/. Skip if neither. -->

- [ ] **Schema change?** Updated `lab/factories/<entity>.js` in this PR with sensible defaults for new columns
- [ ] **Schema change?** Updated factory test if behaviour matters
- [ ] **New entity factory?** Test file colocated, exported from `lab/factories/index.js`
- [ ] **New scenario?** Registered in `lab/scenarios/index.js`, scenario builder is deterministic (`faker.seed(N)`)
- [ ] **Determinism tests** compare only faker-derived stable fields — never `created_at` / `updated_at`

## Risk surface

<!-- Anything to watch for in prod after merge: data migrations, integration changes, status-workflow tweaks, etc. Skip if low-risk. -->

## Verification gate (per CLAUDE.md "Verification Gate")

<!-- Required for: Wix integration changes, Telegram, order/stock cutover, Wix webhook. Skip if N/A. -->

- [ ] Named the automated path that proved this fix (E2E section, integration test, signed Wix replay, or harness + e2e)
- [ ] N/A — no Wix/Telegram/cutover/webhook touched

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
