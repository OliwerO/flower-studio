# Exploratory mode

Owner / agent invokes the lab interactively. Workflow:

1. Reset to a chosen scenario:
   ```
   npm run lab:template:rebuild -- --scenario=stock-overhaul
   npm run lab:reset
   ```
2. Boot dev stack: `npm run lab:dev`
3. Drive the UI manually OR have an agent drive it via Playwright + direct DB queries.

For an agent: read `lab/README.md`, then use the `api()` helper from `lab/helpers/api.js` to hit endpoints, and `labPool()` from `lab/helpers/db.js` to inspect rows. Reset between probes with `import { resetLabDb } from '../../helpers/reset.js'`.

Exploratory tests live here as named one-offs. They are NOT run in CI — exploratory mode is human-triggered. Stable findings should be promoted to `lab/tests/api/` or `lab/tests/ui/`.
