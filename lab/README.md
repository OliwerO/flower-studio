# Lab Harness

Local Docker-Postgres rehearsal environment for major overhauls. See `docs/adr/0004-lab-harness-rehearsal-env.md` for the architecture decision.

## Quick start

```bash
# 1. Boot Postgres + apply migrations + build a seeded template
npm run lab:db:up
npm run lab:migrate
npm run lab:template:rebuild -- --scenario=baseline

# 2. Reset lab to seeded state and boot the dev stack
npm run lab:reset
npm run lab:dev
```

Open:
- Dashboard: http://localhost:5177
- Florist:   http://localhost:5176
- Delivery:  http://localhost:5178
- API:       http://localhost:3003

PINs: owner `1111`, florist `2222`, drivers `3333` / `4444`.

(Dashboard auto-authenticates as owner via `VITE_OWNER_PIN`; florist/delivery may show a PIN entry screen depending on their auto-auth wiring.)

Connect with psql / TablePlus: `postgres://lab:lab@localhost:5433/lab`.

## Switching scenarios

```bash
npm run lab:template:rebuild -- --scenario=stock-overhaul
npm run lab:reset
```

Available scenarios: `baseline`, `stock-overhaul`. Add new ones in `lab/scenarios/` and register in `lab/scenarios/index.js`.

## Running tests

```bash
npm run lab:test:unit   # vitest: factories + scenarios + helpers
npm run lab:test:api    # vitest: API integration tests against lab backend
npm run lab:test:ui     # Playwright: UI smoke + flow tests
```

## Tearing down

```bash
npm run lab:db:down                              # stop container, keep volume
docker volume rm featlab-harness_lab-pg-data     # nuke data (verify with `docker volume ls | grep lab`)
```

## What this is NOT

- Not a replacement for the existing pglite harness (`npm run harness` / `npm run test:e2e`). That harness still gates CI and runs the 153-assertion suite.
- Not a deployed staging environment — runs only on the local Mac.
- Not a place for real prod data. Synthetic-only by design (per ADR 0004).

## When to use

Major overhauls where you want to walk every path against realistic data before merge: Stock redesign, new CRM flows, payment overhaul, etc. Routine PRs use CI as the safety net; lab is for rehearsal-grade validation.
