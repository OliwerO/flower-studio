# Lab harness — local Docker-Postgres rehearsal env with synthetic fixtures

For major overhauls (Stock redesign with stem-length tracking, future similar work) we need a way to seed realistic data and let an AI agent walk every path before code reaches prod. We are introducing a local "lab" harness: a Postgres 15 container booted via Docker Compose on `localhost:5433`, seeded by synthetic factory functions composed into named scenarios (`baseline`, `stock-overhaul`, …), with sub-second test isolation via a Postgres template-database clone. Both API tests (fast logic/data assertions) and Playwright UI tests (catches button-label / modal / toast bugs the API can't see) run against the same harness. External integrations stay mocked by default; the existing signed-Wix-replay covers webhook contract testing.

The lab is positioned as a rehearsal env for major overhauls, not a per-PR safety net — that role stays with the existing pglite-backed `npm run harness` + `npm run test:e2e` suite. The two harnesses coexist; pglite stays as the CI gate, lab adds new agent-drivable rehearsal capability. Once lab has parity with pglite E2E and proven CI history, pglite is replaced and CI converges on Docker PG.

## Considered Options

- **Deployed Railway/Vercel staging env.** Rejected for v1: the use case (test major-feature paths against seeded data) is dominated by business-logic and UI risk, both reproducible locally. Deploy-time issues are already caught by Vercel preview deploys. Real Railway staging revisited only if a future overhaul touches Wix sync, env-var drift, or other deploy-shaped risk.
- **Anonymised prod snapshots as fixtures.** Rejected for v1: doubles the v1 scope (PII scrubber + snapshot import + storage policy) and adds a real PII-leak surface — a single missed column on a free-text field (Card Message, Florist Note, Driver Note) leaks customer data. Synthetic fakers generate fake people by construction. Migration rehearsal (the use case that genuinely needs prod-shaped volume) is deferred to Phase 2 because no in-flight migration benefits from rehearsal tooling that ships after it; the lab's real-PG foundation makes Phase 2 additive.
- **Replace pglite immediately.** Rejected: the pglite harness is already in CI and works; replacing it requires migrating 153 assertions, getting Docker PG green in GitHub Actions, and producing zero rehearsal value until that plumbing lands. Coexist-then-converge ships rehearsal capability faster.
- **Hand-crafted SQL fixtures.** Rejected: too small to test prod-shape edge cases; not composable into scenarios.

## Consequences

- The lab does NOT replace the existing pglite E2E in CI. Two harnesses coexist for some weeks/months until lab earns convergence.
- The lab does NOT catch deploy-time issues (Vercel build failures, Railway env var drift, Wix integration drift beyond captured replay payloads). Vercel preview deploys + signed-Wix-replay continue to own those gaps.
- API tests join CI from day one (fast, low-flake). UI tests join CI selectively — only flows whose breakage warrants a merge block. Most UI tests run on-demand by the agent during overhaul work.
- Exploratory mode is never automated. It exists as a tool for the owner + agent during overhaul work, invoked manually ("Claude, run the lab against the stock-overhaul scenario").
- Migration rehearsal will need additional machinery (PII scrubber, snapshot import, timing instrumentation, storage policy) when first invoked. The lab's real-PG foundation means this is additive, not architectural rework.
- Schema changes during a shadow window must update the synthetic factories in the same PR, otherwise lab fixtures drift from reality. Discipline mirrors the existing rule for Airtable mappers.
