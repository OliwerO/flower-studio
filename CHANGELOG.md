# Changelog — Blossom Flower Studio

Tracks all changes that may impact **go-live** (switching from dev base to production base).
Review this entire file before flipping to production.

---

## Schema Changes (Airtable)

Changes made to the **dev base** that must be replicated in **production** before go-live.

| Date | Table | Change | Applied to Prod? |
|------|-------|--------|:-:|
| 2026-03-05 | App Orders | Renamed `Deliveries` → `_Deliveries OLD`, `Deliveries 2` → `Deliveries` (duplicate link field fix) | ⚠️ Production field is already correct — no action needed |
| 2026-03-05 | App Orders | Renamed `Order Lines` → `_Order Lines OLD`, `Order Lines 2` → `Order Lines` (duplicate link field fix) | ⚠️ Production field is already correct — no action needed |
| 2026-03-09 | Webhook Log | New table for logging all incoming webhooks | ❌ |
| 2026-03-09 | Marketing Spend | New table for marketing cost tracking | ❌ |
| 2026-03-09 | Stock Loss Log | New table for waste/write-off tracking | ❌ |
| 2026-03-09 | App Settings | New table for persisted config (delivery fee, target markup, etc.) | ❌ |
| 2026-03-11 | Product Config | New table for Wix storefront product sync | ❌ |
| 2026-03-11 | Sync Log | New table for Wix ↔ Airtable sync history | ❌ |
| 2026-03-12 | Stock | New fields: `Lot Size` (Number, default 1) | ❌ |
| 2026-03-12 | Order Lines | New field: `Stock Deferred` (Checkbox) | ❌ |
| 2026-03-13 | Stock Orders | **New table** — PO header (Status, Created Date, Notes, Assigned Driver, Stock Order ID, Planned Date, Supplier Payments, Driver Payment, link: Order Lines → Stock Order Lines) | ✅ All fields exist |
| 2026-03-13 | Stock Order Lines | **New table** — PO lines (Flower Name, Quantity Needed, Lot Size, Driver Status, Supplier, Cost Price, Sell Price, Notes, Quantity Found, Quantity Accepted, Write Off Qty, Eval Status, Price Needs Review, Alt Supplier, Alt Quantity Found, Alt Flower Name, Alt Cost, Farmer, links: Stock Orders, Stock Item) | ✅ All fields exist |
| 2026-03-17 | Product Config | New fields: `Description` (Long text), `Translations` (Long text/JSON) | ✅ Already created |
| 2026-03-18 | Florist Hours | New field: `Rate Type` (Single line text) — stores rate type name per entry | ❌ |
| 2026-04-11 | Premade Bouquets | **New table** — standalone bouquet compositions the florist prepares before any order. Fields: `Name` (Single line text, required), `Created At` (Created time, auto), `Created By` (Single line text), `Price Override` (Number, optional), `Notes` (Long text), `Lines` (link → Premade Bouquet Lines). | ❌ |
| 2026-04-11 | Premade Bouquet Lines | **New table** — line items for a premade bouquet. Fields: `Premade Bouquet` (link → Premade Bouquets), `Stock Item` (link → Stock, required), `Flower Name` (Single line text), `Quantity` (Number), `Cost Price Per Unit` (Number, snapshot), `Sell Price Per Unit` (Number, snapshot). | ❌ |
| 2026-04-21 | App Orders | New field: `Florist Note` (Long text) — owner-authored guidance for the florist, separate from the customer's `Notes Original`. Visible on florist collapsed card + editable at every order stage from both dashboard and florist app. | ❌ |
| 2026-04-21 | Deliveries | New field: `Driver Instructions` (Long text) — owner-authored instructions for the driver, separate from the driver's own `Driver Notes`. Visible on delivery collapsed card + editable from dashboard and florist app. | ❌ |

### Env vars

Add to `.env.dev` and `.env` (before the feature ships):

```
AIRTABLE_PREMADE_BOUQUETS_TABLE=tbl...       # Premade Bouquets table ID
AIRTABLE_PREMADE_BOUQUET_LINES_TABLE=tbl...  # Premade Bouquet Lines table ID
```

---

## 2026-04-28 — Wix sync: drop Pull-side price overwrite (Airtable is the price owner)

`runPull()` was reverting owner-edited Airtable prices back to the stale
Wix value, then `runPush()` (which runs second inside `runSync`) saw no
diff and pushed nothing. Net effect: prices never synced and Airtable
edits were silently lost — exactly what the owner reported ("WixSync
doesn't sync prices, Pull overrides correct prices").

### Root cause

Commit `a44450f` (2026-04-22) added price reconciliation in `runPull`'s
update branch with the comment "Wix is the source of truth — reconcile
any drift on every pull." That contradicted the file header
(`backend/src/services/wixProductSync.js:7`) which states **Airtable
owns: prices**, and contradicted `runPush` which already pushes
Airtable→Wix on diff.

Two reconcilers pointing opposite directions on the same field, plus
`runSync` calling Pull before Push, meant every owner edit in Airtable
got clobbered before Push could see it.

### Fix

`backend/src/services/wixProductSync.js` — removed the price-overwrite
block in `runPull`'s update branch (lines 686-694 in the previous
revision). Price still imports on initial row creation for brand-new
variants pulled from Wix (the create branch is unchanged). For existing
rows, Pull leaves Price alone; Push remains the only path that touches
Wix prices.

### What to watch for

- An owner price edit done **directly in the Wix Editor** will no longer
  flow back into Airtable. That's the correct trade-off — the dashboard
  is the canonical price-editing surface, and Push handles the other
  direction. If the owner wants Wix-side edits to win, change the price
  in Airtable to match.
- After deploy, run a manual `POST /products/sync` to confirm prices
  flow: edit one Product Config row's Price in Airtable, hit sync, check
  Wix variant matches. Sync log row should show `Price Syncs > 0`.

---

## 2026-04-28 — SQL migration Phase 4: orderRepo implementation (transactional createOrder)

The headline architectural change of the entire migration ships in this
commit. **Default behaviour is unchanged** — `ORDER_BACKEND` defaults to
`airtable`, so production runs the existing path until the env var flips.

### What changes when ORDER_BACKEND flips

The 538-line manual try/catch + rollback in `orderService.createOrder`
collapses into a single `db.transaction(...)` that wraps:
1. Insert order row
2. Insert N order_line rows
3. Adjust stock for each line via `stockRepo.adjustQuantity({ tx })` —
   participates in the SAME transaction (the Phase 4 prep refactor enables this)
4. Insert delivery row if `Delivery Type === 'Delivery'`

Any throw from any step → PG rolls back EVERYTHING atomically. No
manual unwinding, no half-torn-down state, no `console.error` chains
trying to log all the failures of the cleanup pass.

### orderRepo.js — full implementation

Replaces every Phase 4 prep stub with real SQL. Methods covered:
- `list(options)` — supports both Airtable-shape `filterByFormula` (airtable+shadow)
  and PG-shape `pg.statuses / dateFrom / dateTo / customerId` filters
- `getById(id)` — accepts recXXX or uuid; returns order with lines + delivery populated
- `createOrder(params, config, opts)` — the transactional rewrite above
- `transitionStatus(orderId, newStatus, otherFields)` — enforces state
  machine, cascades order ↔ delivery status atomically
- `cancelWithStockReturn(orderId)` — single tx for cancel + N stock returns
  + delivery cascade
- `deleteOrder(orderId)` — relies on `ON DELETE CASCADE` for lines+delivery;
  returns stock first if non-terminal
- `editBouquetLines(orderId, args, isOwner)` — add/update/remove lines with
  corresponding stock adjustments, all in one transaction
- `runParityCheck()` — stubbed for now (full impl ships once shadow data exists)

### orderService.js — wired to delegate

Each entry point gains a 3-line preamble: when `orderRepo.getBackendMode()
!== 'airtable'`, delegate to orderRepo. Side effects (customer record
update, SSE broadcast, Telegram notification) extracted into helpers
that run from BOTH paths so behaviour is preserved during the cutover.

### Backfill script

- `backend/scripts/backfill-orders.js` — pulls every Airtable order +
  its lines + its delivery into PG. Idempotent (UPSERT on airtable_id).
  Skips orphan lines/deliveries (no parent order). Reports counts +
  flags any rows that failed to migrate.

### Integration tests (19 new)

- `backend/src/__tests__/orderRepo.integration.test.js` — exercises the
  repo against real PG (pglite) instead of mocks:
  - createOrder happy path: order + lines + delivery + stock all atomic
  - createOrder rollback when orphan line present: NOTHING persists
  - createOrder rollback when stock adjust fails mid-transaction: the
    earlier successful adjustment is undone (the test that proves
    Phase 4's central thesis works)
  - createOrder with skipStockDeduction: premade-bouquet flow
  - transitionStatus: state machine enforcement + delivery cascade for
    Out for Delivery / Delivered / Cancelled
  - cancelWithStockReturn: returns each line qty + cancels order +
    cascades delivery atomically
  - deleteOrder: ON DELETE CASCADE handles lines + delivery; non-terminal
    orders return stock first; terminal orders don't double-return
  - editBouquetLines: add new line deducts stock, remove with action=return
    refunds stock, qty change adjusts by delta, owner edit auto-reverts
    Ready → New
  - list: status filters work; getById populates lines+delivery; missing id throws 404

### Cutover playbook

Same shape as Phase 3:

1. Apply migration (no-op if already applied — idempotent).
2. `node --env-file=.env scripts/backfill-orders.js` — seeds PG from Airtable.
3. Set `ORDER_BACKEND=shadow` in Railway env vars, redeploy.
4. Watch parity dashboard for ~1 week. Critical signals to validate:
   a Wix-webhook order, an in-store order with delivery, a pickup order,
   a cancellation, a bouquet edit, and a status transition through to
   Delivered.
5. When parity is clean: set `ORDER_BACKEND=postgres`, redeploy.
   Airtable Orders / Order Lines / Deliveries become a frozen legacy
   snapshot.

### Wix webhook risk (call out before Step 3)

`services/wix.js`'s order-creation flow is webhook-triggered with no
replay safety net. Capture 2-3 real Wix payloads from prod's Webhook Log
table and replay them against a local backend BEFORE flipping
`ORDER_BACKEND=shadow`. The 3b E2E harness (separate session) will land
this validation step.

### Verification

- 201/202 tests pass (the 1 failure is the same pre-existing
  `analyticsService` test, unrelated to this work)
- 19 of those 201 are new orderRepo integration tests
- 0 lint errors (only pre-existing `eqeqeq` warnings)
- Backend boots without `DATABASE_URL` (mode stays on airtable)

### Deferred to follow-up

- `scripts/simulate-orders.js` — owner-runnable day-in-the-life walkthrough.
  The 19 integration tests cover the same scenarios; the simulator is
  convenience that ships best after this PR is reviewed.
- Order entity in admin tab + order parity dashboard UI. `orderRepo.runParityCheck`
  is stubbed — full implementation depends on `ORDER_BACKEND=shadow` having data,
  which depends on this PR landing first.

---

## 2026-04-28 — SQL migration Phase 3: real-SQL integration tests + simulator (caught 2 production bugs)

Added `@electric-sql/pglite` (PostgreSQL compiled to WASM) as a dev
dependency so we can validate the Phase 3 cutover against actual SQL
without needing a local DB install. **Pglite IS Postgres** — same query
parser, same transaction semantics — so behaviour validated here is
faithful to what Railway will do.

**Test harness:**
- `backend/src/__tests__/helpers/pgHarness.js` — boots in-process PG
  per-test, applies the same SQL migrations Railway runs, returns a
  Drizzle handle.
- `backend/src/__tests__/helpers/pgHarness.smoke.test.js` — 7 tests:
  PG version, tables apply, jsonb round-trip, unique-index enforcement,
  array column round-trip.

**Integration tests** (real SQL, not mocked):
- `backend/src/__tests__/stockRepo.integration.test.js` — 15 tests across
  postgres + shadow modes: create + audit, partial-field update with
  minimal diff, atomic adjustQuantity (single + 10x concurrent),
  negative qty allowed, soft-delete + restore + purge round-trip,
  listByIds with mixed UUID/airtable_id input, list-with-filter
  semantics.
- `backend/src/__tests__/backfillStock.integration.test.js` — 6 tests:
  initial insert, idempotent re-run, change propagation, missing-name
  skip, soft-deleted rows preserved across re-runs.
- `backend/src/__tests__/parityCheck.integration.test.js` — 7 tests:
  clean state produces zero parity rows, missing_pg / missing_at /
  field_mismatch detection, null-vs-empty-string treated as equal,
  combined drift counted independently.

**Two real bugs surfaced + fixed:**
1. `stockRepo.findPgByAirtableOrUuid()` ran against the top-level `db`
   handle instead of the surrounding transaction, deadlocking under
   concurrent writes (would have manifested on prod under any peak-
   Saturday burst). Fix: thread `tx` parameter through every callsite.
2. `stockRepo.restore()` filtered out soft-deleted rows in the lookup,
   so restore could never find what it needed to restore. Fix: bypass
   the deleted_at filter for restore's pre-read.

**Owner-runnable simulator:**
- `backend/scripts/simulate-stock.js` — "day in the life" walkthrough.
  Boots ephemeral PG, seeds 5 stock items, walks through 10 steps
  (bouquet compose / deliver / edit / cancel / PO receive / write-off /
  10x concurrent burst / soft-delete + restore), prints state after each
  step, asserts expected qty at each checkpoint, dumps audit log
  summary. Run with `node scripts/simulate-stock.js`. No DB install,
  no Airtable connection, no env vars needed.

**Verification:**
- 173/174 tests pass (the 1 failure is the same pre-existing
  `analyticsService` test on baseline). 35 of those 174 are new.
- Simulator runs end-to-end with all 17 quantity assertions holding.

---

## 2026-04-27 — SQL migration Phase 3: Stock cutover scaffolding (shadow-write ready)

The proof-of-concept entity migration. **Default behaviour is unchanged**
(STOCK_BACKEND defaults to 'airtable') — the cutover only activates when
the env var flips. This commit lands every piece needed to safely shadow-
write Stock to Postgres, then flip when parity is clean.

**Backend — schema + repo:**
- `backend/src/db/schema.js` — added `stock` table (mirrors all writable
  Airtable Stock fields plus `airtable_id` traceability column, `created_at`
  / `updated_at` / `deleted_at` for the Phase 2.5 soft-delete contract,
  unique index on `airtable_id`). Added `parity_log` table (records every
  shadow-write mismatch — kind = `missing_pg | missing_at | field_mismatch
  | write_failed`).
- `backend/src/db/migrations/0002_stock_and_parity_log.sql` — generated by
  `drizzle-kit`. Apply via `npm run db:migrate`.
- `backend/src/repos/stockRepo.js` — three-mode repo selectable via
  `STOCK_BACKEND=airtable | shadow | postgres`. Mirrors `customerRepo` shape
  (`list`, `getById`, `listByIds`, `create`, `update`, `adjustQuantity`,
  `softDelete`, `restore`, `purge`, `runParityCheck`). Wire format always
  matches Airtable's response — frontends and routes are unchanged across
  the cutover. PG mode uses `UPDATE stock SET current_quantity =
  current_quantity + $1 RETURNING current_quantity` for atomic adjust,
  retiring the serialised `stockQueue` once flipped.
- `backend/src/__tests__/stockRepo.test.js` — 26/26 pass. Covers field
  mapping round-trip, all three modes (airtable/shadow/postgres),
  PG-failure tolerance in shadow mode, allowlist enforcement, audit
  emission, and the `valuesEqual` parity helper.

**Backend — wiring:**
- `backend/src/routes/stock.js` — every Stock-table call swapped to
  `stockRepo.X(...)` (list, getById, create, update, listByIds). Routes
  thread `actor: actorFromReq(req)` so audit rows attribute writes
  correctly. Allowlist now lives in the repo; routes pass raw bodies and
  the repo silently drops disallowed keys.
- `backend/src/routes/dashboard.js` — low-stock + negative-stock queries
  go through `stockRepo.list()`. PG-mode falls back to JS-side filtering
  for `qty < threshold` (no column-vs-column SQL helper yet — minor TODO).
- `backend/src/services/orderService.js` — `autoMatchStock`, the in-flight
  price overrides, and every `db.atomicStockAdjust` call (7 sites) now
  route through `stockRepo`.
- `backend/src/services/wixProductSync.js` — `Available Today` stock check
  goes through `stockRepo.list()`.
- `backend/src/routes/admin.js` — populated the entity registry with
  `stock`. Added per-entity endpoints: `GET /admin/:entity`,
  `GET /admin/:entity/:id`, `PATCH /admin/:entity/:id`,
  `POST /admin/:entity/:id/restore`, `DELETE /admin/:entity/:id/purge`.
  Each delegates to the repo, which audits the mutation.
- `backend/src/routes/admin.js` — added Phase 3c verification endpoints:
  `GET /admin/parity/:entity` (drillable rows + count-by-kind),
  `POST /admin/parity/:entity/recheck` (triggers `runParityCheck()`).

**Backend — tooling:**
- `backend/scripts/backfill-stock.js` — pulls every Airtable Stock row
  (active + inactive) and UPSERTs into Postgres preserving `airtable_id`.
  Idempotent. Reports counts + flags negative-qty rows. Run BEFORE
  flipping `STOCK_BACKEND` from `airtable` to `shadow`.

**Dashboard:**
- `apps/dashboard/src/components/admin/entityRegistry.js` — `stock`
  registered with column metadata (display_name editable, qty editable,
  airtable_id read-only, etc). AdminTab will surface this entry once
  shadow-write parity stays clean for ≥1 week.

**Cutover playbook:**
1. Apply migration on prod: `npm run db:migrate` (creates `stock` +
   `parity_log` tables; non-destructive).
2. Backfill: `node --env-file=.env scripts/backfill-stock.js`.
3. Set `STOCK_BACKEND=shadow` in Railway env, redeploy. Watch
   `GET /api/admin/parity/stock` from the AdminTab over a week
   (especially Saturday — peak write volume).
4. When `field_mismatch` and `write_failed` counters are 0 across a
   full Saturday, set `STOCK_BACKEND=postgres`, redeploy. Airtable
   Stock table becomes a frozen legacy snapshot.

**Why this is safe to land now:** Default `STOCK_BACKEND=airtable`
means none of these code paths activate in production until the owner
deliberately flips the env var. The repo, tests, and tooling can all be
exercised against staging/local without affecting live behaviour.

**Verification:**
- `npx vitest run` — 138/139 pass (the one failure is the same pre-existing
  `analyticsService` test that's failing on the baseline branch — unrelated
  to this work).
- `npx eslint src/` — 0 errors, only pre-existing `eqeqeq` warnings.
- Backend boots without `DATABASE_URL` (mode stays on airtable), and
  with `DATABASE_URL` (admin endpoints active, mode still defaults to
  airtable until env var flips).

---

## 2026-04-27 — SQL migration Phase 2.5: audit log + Admin tab

Cross-cutting primitives shipped before any entity migrates, so Phase 3
(Stock cutover) inherits them for free.

**Backend:**
- `backend/src/db/schema.js` — added `audit_log` table (bigserial PK, text
  entity_id so it accepts uuids OR `recXXX` ids during the shadow window,
  jsonb diff column, indexes on `(entity_type, entity_id, created_at)` and
  `(created_at)`).
- `backend/src/db/migrations/0001_audit_log.sql` — applied to Railway prod.
- `backend/src/db/audit.js` — `recordAudit(tx, {...})` helper. Computes a
  minimal diff (only changed keys) and writes inside the caller's
  transaction so audit + entity write are atomic.
- `backend/src/__tests__/audit.test.js` — pins minimalDiff edge cases
  (create/delete/update/array-equality/no-change). 9/9 pass.
- `backend/src/routes/admin.js` — owner-only (`authorize('admin')`),
  503s when Postgres isn't configured. Phase 2.5 endpoints:
  `GET /admin/entities`, `GET /admin/audit?entityType=&entityId=&limit=`,
  `GET /admin/audit/stats`. Per-entity list/patch/restore/purge handlers
  arrive with the entityRegistry in Phase 3+.
- `backend/src/index.js` — admin route mounted at `/api/admin`.

**Dashboard:**
- `apps/dashboard/src/components/AdminTab.jsx` — read-only audit-log
  viewer with row-expand-to-show-diff. Renders an explanatory empty state
  when Postgres returns 503 (current state on prod, until Phase 3
  cutover). Tap-to-expand reveals the JSON diff.
- `apps/dashboard/src/components/admin/entityRegistry.js` — empty
  declarative registry; `stock` lands here with Phase 3.
- `apps/dashboard/src/pages/DashboardPage.jsx` — new `Admin` tab pill
  (between Products and Settings).
- `apps/dashboard/src/translations.js` — EN + RU keys for the new tab.

**Why:** The audit log + Admin tab are the migration's force multiplier.
Without them, every Phase 3+ entity would have to re-litigate "how do I
log writes" and "how does the owner inspect raw rows when something looks
off". Building these once now keeps Phases 3–6 to "just" repo + cutover
work per entity.

**Verification:**
- `audit.test.js` — 9/9 pass.
- `claude_ro` SELECT on `audit_log` confirmed live (default privileges
  auto-applied to the new table).
- `npx vite build` on dashboard succeeds.
- `node -e "import('./src/routes/admin.js')"` smoke-test green.
- Tab visible in dev when `VITE_OWNER_PIN` is set; 503 banner shown until
  the prod backend redeploys with `DATABASE_URL`.

---

## 2026-04-27 — SQL migration Phase 1: Postgres infra scaffolded (Railway)

Provider locked: Railway Postgres (vendor consolidation + `psql` introspection
for Claude). Strategic plan saved at
`docs/migration/execution-plan-2026-04-27.md`.

**Backend additions** (no entity migrated; nothing in routes changed):
- `backend/drizzle.config.js` — drizzle-kit config.
- `backend/src/db/index.js` — singleton `pg.Pool` + Drizzle handle, gated on
  `DATABASE_URL`. `connectPostgres()` no-ops when unset; called from boot
  after `validateAirtableSchema()` in `backend/src/index.js`.
- `backend/src/db/schema.js` — Drizzle schema. Phase 1 ships only
  `system_meta` (key/value tracking — entities arrive per-phase).
- `backend/src/db/migrate.js` — standalone migration runner.
- `backend/src/db/migrations/0000_init.sql` — first SQL migration.
- `backend/src/db/README.md` — file-layout doc + workflow.
- `backend/package.json` — `drizzle-orm@0.38.4`, `pg@8.13.1` deps;
  `drizzle-kit@0.30.6` devDep; new `db:generate` / `db:migrate` /
  `db:studio` scripts. (Side fix: `dev` script pointed at the long-removed
  `.env.dev` — corrected to `.env` so `npm run dev` works again.)
- `railway.toml` — env-var notes for `DATABASE_URL`,
  `PGSSL_REJECT_UNAUTHORIZED`, `PGSSL_DISABLE`.

**Owner-side actions completed via Railway CLI on 2026-04-27:**
1. Postgres plugin provisioned in Railway production environment
   (service name: `Postgres`, image: `postgres-ssl:18`, region: EU West).
2. `DATABASE_URL` set on `flower-studio-backend` service pointing to the
   internal hostname `postgres.railway.internal:5432`.
3. `npm run db:migrate` applied via the public proxy URL — `system_meta`
   table created, `__drizzle_migrations` tracking table initialised.
4. Read-only role `claude_ro` created with random password. Verified:
   `SELECT` succeeds, `INSERT/UPDATE/DELETE` denied. DSN stored in local
   memory file (`memory/project_postgres_access.md`) — owner should mirror
   to 1Password as a backup. Rotate via
   `ALTER ROLE claude_ro PASSWORD '<new>';`.

**Verification:**
- Backend boots without `DATABASE_URL`: `[PG] DATABASE_URL not set —
  Postgres disabled.` Confirmed.
- `npm run db:generate` produces SQL migration. Confirmed.
- Existing tests still pass except one pre-existing `analyticsService`
  failure unrelated to this work.

**Why this matters now:** stock-math drift, manual rollback ladders in
`orderService.js`, and the serialised `stockQueue` are all symptoms of
Airtable's lack of transactional writes. Phase 3 retires
`atomicStockAdjust`; the scaffolding here is what makes that possible.

---

## 2026-04-26 — Wix mobile menu: Contact label localized across PL/UK/RU

The "Contact" menu item rendered as `CONTACT` (Latin) in PL/UK/RU mobile
menus because the owner only translated EN in the Wix Editor — same
drift pattern as the seasonal slot, but for a static label instead of
a dynamic one.

`Blossom-Wix/src/pages/masterPage.js` — `transformMenuItems` now also
rewrites any item whose label contains the stem `CONTACT` / `KONTAKT` /
`КОНТАКТ` to the user's language: `CONTACT` (en), `KONTAKT` (pl),
`КОНТАКТИ` (uk), `КОНТАКТЫ` (ru). Link is left untouched — only the
label was wrong.

---

## 2026-04-25 — Wix mobile menu: seasonal slot self-heals across PL/UK/RU

Mobile menu in Polish / Ukrainian / Russian still showed the previous
seasonal (Valentine's labelled "Walentynki" / "Валентинки" / "День
Валентина") and clicked through to `/category/valentines-day` even after
the owner flipped the active seasonal in the dashboard to peonies.
UK additionally had a generic "СЕЗОННІ БУКЕТИ" item plus a manually-added
"ПІОНИ" item — three candidates for the same slot. Desktop was fine —
`#button7` is renamed directly by `masterPage.js` and its link was
updated per language manually. Mobile relied on `transformMenuItems`,
which only matched 4 hardcoded English/Polish-spring labels (`SEASONAL`,
`WIOSNA`, `SPRING`, `ВЕСНА`), only rewrote the **label** (never the
link), and didn't dedupe duplicates.

The canonical seasonal URL across all four languages is `/category/seasonal`
— a single Wix Stores category whose product membership flips automatically
as the active seasonal changes. Same pattern as `/category/available-today`.

Fix:
- `backend/src/routes/public.js` — `/api/public/categories` now returns
  `seasonalSlugs: [...]` (every configured seasonal slug, current + past).
- `Blossom-Wix/src/pages/masterPage.js`:
  1. Detect seasonal items three ways — link is `/category/seasonal`
     (canonical, EN today), OR link contains any historic seasonal slug
     (Valentine's, Easter, Christmas, …), OR label contains a seasonal
     stem (`SEASONAL`, `SEZON`, `СЕЗОН`, `SPRING`, `WIOSN`, `ВЕСН`).
     Stems chosen so UK "ВЕСІЛЛЯ" (Weddings) does NOT false-match `ВЕСН`
     (4th char differs).
  2. Rewrite BOTH label AND link of matched items — label = active
     seasonal title in user's language, link = `/category/seasonal`.
  3. Dedupe — keep only the first item pointing at `/category/seasonal`,
     drop later duplicates so UK's three candidates collapse to one.

Net effect: when the owner flips the seasonal in the dashboard, every
language and every menu element (`HorizontalMenu`, `VerticalMenu`,
`ExpandableMenu`, `DropDownMenu`) picks up the new label, URL, and
duplicate-free structure on the next page load — including EN, whose
"PEONIES" label will now auto-update when the seasonal flips. No
per-language Editor edits needed.

Out of scope (would require option B / canonical menu generation): the
PL mobile menu is missing an "Accessories" item the desktop has, and
Ukrainian "Available Today" / Russian "Доступно сегодня" are truncated
in the editor item width. Both fixable later by generating the full
mobile menu from category data instead of trusting per-language Editor
items.

---

## 2026-04-22 — Florist app cleanup (Phase B): Customers tab on mobile

Second PR of the three-part florist cleanup plan. Phase A shipped the nav
trim + Wix Pull/Push + stock ops grid. Phase B adds a full Customer tab
to the florist app so the owner can run CRM workflows from her phone —
same data, same filter logic, same segmentation as the dashboard
Customer tab v2.0, with mobile-native layout and a view-only gate for
florist role.

### Shared package
- **Moved** `customerFilters.js` from `apps/dashboard/src/utils/` to
  `packages/shared/utils/` (git-tracked rename). Dashboard's three
  import sites (`CustomersTab.jsx`, `CustomerListPane.jsx`,
  `CustomerFilterBar.jsx`) now import from `@flower-studio/shared`.
  Florist's Customer tab imports from the same location — single
  source of truth for filter/search semantics.
- **New tests** at `packages/shared/test/customerFilters.test.js`
  (33 assertions covering matchesSearch, matchesFilters, serialize
  round-trip, activeFilterCount, churn-risk via fake timers). The
  original dashboard file had no test coverage; this move upgrades it.
- Known gap: `packages/shared` can't `npm test` standalone (vitest only
  in backend/node_modules). Tests run via the backend vitest binary.
  Follow-up will add vitest as a shared devDep.

### New florist app surface (`apps/florist/src/`)
- `pages/CustomerListPage.jsx` — full-page list shell; loads
  `/customers` + `/customers/insights` in parallel; manages filter
  state persisted to localStorage (`florist_customer_filters`, version
  1); renders CustomerListPane.
- `pages/CustomerDetailPage.jsx` — reads `:id` from route, derives
  `canEdit = role === 'owner'`, renders CustomerDetailView; back
  button returns to the list with scroll preserved.
- `components/CustomerListPane.jsx` — mobile variant of dashboard's
  same-named component. Search, "Filters (N)" sheet trigger, sort
  dropdown, virtualized `react-window` list of 1094 rows. Tap row →
  `onSelect(id)` → parent routes.
- `components/CustomerFilterSheet.jsx` — bottom-sheet filter UX using
  the shared `Sheet` primitive. All 15 filter dimensions as
  always-visible sections (pill rows for multi-selects, toggles for
  presence, preset chips for recency, number inputs for minimums).
  Same state shape as dashboard's CustomerFilterBar — owner can save
  a filter on mobile and see it interpreted identically on the laptop.
- `components/CustomerDetailView.jsx` — mobile single-column detail.
  Composes CustomerHeader, ContactQuickLinks, StatStrip, ProfileGrid,
  KeyPersonChips, NotesSection, FlowersOrderedChips, CustomerTimeline.
  `canEdit` prop gates every InlineEdit/SelectField via new
  `EditOrText` / `SelectOrText` wrappers — florist sees values as
  plain text, owner sees full edit UI. Belt-and-braces guard in
  `patchField` blocks PATCH calls if the UI gate is ever bypassed.
- `components/CustomerHeader.jsx`, `CustomerTimeline.jsx`,
  `KeyPersonChips.jsx`, `InlineEdit.jsx` — ported from dashboard.
  KeyPersonChips gained a `canEdit` prop for view-only; other three
  are verbatim ports for visual parity.

### Navigation
- `components/BottomNav.jsx` — owner now sees 5 tabs (Orders · Stock ·
  **Customers** · Wix · More). Restored the `useNarrowViewport(360)`
  hook that Phase A removed — on narrow viewports (<360px) the Wix
  tab moves to the More burger to keep the primary bar at 4 tabs.
  Customers is 3rd (always on-screen) because CRM lookups are daily;
  Wix sync is occasional.
- Florist burger gained a Customers entry; florist's bottom nav
  unchanged (still Orders · Stock · Hours · More).

### Routes (`App.jsx`)
- `/customers`     → `CustomerListPage`    (PrivateRoute — both roles)
- `/customers/:id` → `CustomerDetailPage`  (PrivateRoute — both roles;
  edit capability gated by role inside the view)

### Dependencies
- Added `react-window: ^2.2.7` to `apps/florist/package.json` (same
  version dashboard already uses). Needed for the virtualized 1094-row
  list; mobile Safari handles it smoothly.

### Translations (~60 new keys × 2 languages)
Added to `apps/florist/src/translations.js` under a new "Customer Tab
v2.0" section. Covers the tab label, header badges, key-people chips,
timeline filters, list pane search/sort, filter-sheet dimensions,
detail-view stats, and the RU equivalents. English fallbacks in every
component mean missing keys degrade gracefully rather than crashing.

### Why it matters
- **Owner can run CRM from her phone.** Previously she had to switch
  to Airtable or the desktop dashboard to look up a customer, add a
  key person, or check last-order freshness. Same capabilities now
  fit in her pocket.
- **Florist gets customer context without risk.** Florist can see
  name, nickname, segment, key people, notes, timeline — useful for
  personalizing a delivery or reading context on a phone order —
  without any edit affordance. `canEdit=false` renders text instead
  of inputs, the `patchField` guard blocks any stray PATCH that
  somehow slipped past the UI.
- **Shared filter logic.** A filter state saved in localStorage on the
  phone interprets identically on the desktop because both apps run
  the exact same `matchesSearch` / `matchesFilters` predicates from
  `@flower-studio/shared`. One place to fix a rule, both apps update.

### What to watch for
- **Parity debt**: `CustomerHeader`, `CustomerTimeline`,
  `KeyPersonChips`, and `CustomerDetailView` now exist in both
  `apps/dashboard/src/components/` and
  `apps/florist/src/components/`. A future refactor should extract
  shared bodies to `packages/shared/components/` with thin app-specific
  wrappers; until then, any CRM-side change needs to land in both.
  Added to the "Parallel implementations" convention.
- **Backend role-gate**: view-only is enforced at the UI level today.
  A florist with devtools + a PIN can still PATCH the backend directly.
  Backend role enforcement is filed as a follow-up and is low-priority
  because the florist role doesn't currently escalate privilege through
  any other path either.
- **`onLocalPatch` no-op**: dashboard uses this callback to merge
  field changes into its in-memory customer list without a full
  refetch. On mobile the list page is a separate route, so I didn't
  wire this — next visit to the list re-fetches fresh data. Fine for
  1094 rows; revisit if the list gets bigger.

Builds: florist 595 KB / 168 KB gz (+47 KB from Phase A baseline).
Dashboard unchanged. Backend unchanged. Shared tests 33/33 pass.

---

## 2026-04-22 — Florist app cleanup (Phase A): nav trim + Shopping→Stock + Wix tab polish

Owner feedback made clear the florist app had accumulated UX debt: Catalog
tab didn't match its Wix content, Pull/Push sync wasn't discoverable
(single ambiguous refresh icon), Stock-adjacent workflows were scattered
across bottom nav + burger + inline buttons, and the burger had dead
entries. First PR of a three-part cleanup.

### Navigation
- **`components/BottomNav.jsx`** — Owner bottom nav trimmed from 5 to 4
  tabs (Shopping removed; folded into Stock page). Burger menu dropped
  Day Summary (unused), Purchase Orders + Waste Log (reachable from Stock
  now). Florist burger dropped Waste Log (same reason). The narrow-viewport
  collapse logic was removed since both roles now fit 4 tabs comfortably;
  Phase B will reintroduce it when the Customers tab becomes the 5th.

### Wix tab (was "Catalog")
- **`translations.js`** — `tabCatalog` renamed "Catalog"→"Wix" (EN) /
  "Каталог"→"Wix" (RU). Route `/catalog/bouquets` unchanged.
- **`pages/BouquetsPage.jsx`** — the single `RefreshCw` icon in the
  header is replaced by two explicit labeled buttons: blue
  `⬇ Pull` (bg-blue-50) and emerald `⬆ Push` (bg-emerald-50). Both
  always visible, backed by the existing `POST /products/pull` and
  `POST /products/push` endpoints — no backend changes.
- **`components/bouquets/PushBar.jsx`** — converted from a prominent
  brand-colored CTA button to a passive `role="status"` banner. Push is
  now one trigger (the header button); PushBar is a pure "N changes
  pending" indicator when scrolled. Still shows a "Syncing…" spinner
  while a push is in flight.
- **Translations** — new short keys `pullShort` ("Pull"/"Загрузить") and
  `pushShort` ("Push"/"Отправить") for the header buttons — the full
  "Pull from Wix" / "Отправить в Wix" strings were too long to fit
  alongside the title on narrow phones.

### Stock page
- **`pages/StockPanelPage.jsx`** — the three stacked full-width buttons
  (Purchase Orders, Waste Log, Receive Stock) are replaced for the owner
  with a compact 2×2 Operations tile grid: Purchase Orders · Active
  Shopping · Stock Evaluation · Waste Log. A new inline `OpsTile`
  sub-component renders each tile (icon-over-label, 80px tall, rounded
  2xl). Florist still sees only the red Waste Log button (PO + Shopping
  are owner-only flows).

### Why it matters
- **Discoverability.** The old refresh icon on the Wix tab gave no signal
  that sync was bidirectional. With two labeled buttons, the mental model
  "I can push changes to Wix from here" forms immediately.
- **Fewer buttons, more breathing room.** Stock page went from 3 stacked
  CTAs to a tidy 2×2 grid (same footprint, less visual noise).
- **Silent misconfigs now surface.** A missing `WIX_API_KEY` on Railway
  used to hide behind the ambiguous refresh icon — next pull/push tap
  now shows the backend error as a toast.

### What to watch for
- `/shopping-support` and `/day-summary` routes stay live (nothing
  deleted) — direct URL access still works even though the nav entries
  are gone. If owner confirms Day Summary truly isn't used, the page can
  be deleted in a follow-up.
- `runPush()` is idempotent — tapping Push on a clean catalog is a
  no-op on the Wix side. No confirmation dialog needed.
- Phase B (next PR) wires a new **Customers** tab into the 4th owner
  nav slot and adds it to the florist burger; Phase C wires
  order-card customer names to navigate there.

### Bug surfaced — silent Wix sync failures now visible

When the explicit Pull/Push buttons went live, the owner hit a
pre-existing silent-failure bug: Wix sync would report "completed"
but nothing would actually sync to Wix. Root cause was in
`backend/src/services/wixProductSync.js` — both `runPull()` (lines
727–730) and `runPush()` (lines 1039–1042) wrap their entire bodies
in try/catch blocks that push fatal errors into `stats.errors` and
still return HTTP 200. The frontend never inspected `data.errors`,
so a failed sync (expired token, Wix API error, network issue)
looked identical to a clean no-op success toast.

**Frontend fix** (both apps, maintains parity per CLAUDE.md):
- `apps/florist/src/pages/BouquetsPage.jsx` — `pullFromWix` and
  `pushToWix` now check `data.errors` before showing success. If
  errors present, show them joined with ` · ` as a red error toast.
- `apps/dashboard/src/components/ProductsTab.jsx` — `handlePull` and
  `handlePush` same check. Previously `handlePush` showed a count
  like "3 errors" with no explanation; now shows the actual error
  messages so the owner can diagnose (token expired, Wix API 429, etc.).

**Follow-up** (not in this PR): the backend should return HTTP 500
when `stats.errors.length > 0`. That's the proper contract — would
catch the issue in the frontend's existing `catch` block without
needing a defensive check — but changes endpoint behaviour for all
callers. Deferred to a separate ticket.

**Why this matters**: the old `RefreshCw` icon only ran Pull and
rarely got tapped on a failing setup, so the silent failure sat
hidden. Phase A's explicit buttons invited the owner to actually use
sync, and the cracks showed. Fix is mechanical — surface the error
array the backend was already collecting, stop pretending it was a
success.

### Zero-UUID variant price fix (simple Wix products)

Once the owner saw actual error messages, a second bug surfaced:

```
Price <productId>::00000000-0000-0000-0000-000000000000:
  requirement failed: Product variants must be managed
```

Wix represents products in two shapes: products WITH managed variants
(size/color options, each variant has a real UUID) and simple products
WITHOUT variants (single SKU — Wix exposes a synthetic "default variant"
with the all-zero UUID). The `PATCH /products/{id}/variants` endpoint
only works for the first shape. For simple products, price lives on
the product itself and has to be PATCHed via `/products/{id}`.

Inventory handling for zero-UUID variants was already fixed in commit
`8148b45` (the `updateWixInventory` batch endpoint accepts them), but
price had been missed — every push on a simple product generated one
of these errors.

**Fix** (`backend/src/services/wixProductSync.js`):
- New `updateWixProductPrice(productId, price)` helper using
  `PATCH /stores/v1/products/{id}` with `{ product: { priceData: { price } } }`.
  Same pattern as the existing `updateWixProductContent` helper.
- The push loop now branches: zero-UUID variant → product endpoint;
  real UUID → variant batch endpoint.

### Telegram alerts for Wix sync errors (owner-only)

Added `notifyWixSyncError({ direction, errors })` to
`backend/src/services/telegram.js`. Owner-only (uses `sendAlert`, not
`broadcastAlert` — florists don't need these pings). Formatted as:

```
🔴 Wix sync — Push errors
3 errors

• Price <id>: Wix price update failed for ...
• Price <id>: Wix price update failed for ...
• Price <id>: Wix price update failed for ...
…and 1 more
```

First 3 errors shown verbatim (truncated to 200 chars each); remainder
summarised. HTML-escaped inside `<code>` spans so angle brackets in
Wix payloads don't confuse Telegram's HTML parser.

Wired into both `runPull()` and `runPush()` after `logSync()`. Fires
when `stats.errors.length > 0`. No new env vars — reuses the existing
`TELEGRAM_BOT_TOKEN` + `TELEGRAM_OWNER_CHAT_ID` that already power
new-order alerts. If creds aren't set, `sendAlert` no-ops gracefully.

**Multi-recipient owner alerts** — `TELEGRAM_OWNER_CHAT_ID` now
accepts a comma-separated list of chat IDs (e.g.
`123456789,987654321`). A single value stays backward-compatible;
the split-parse pattern mirrors the existing `TELEGRAM_CHAT_IDS`
broadcast var. Lets the owner add a second owner-tier recipient —
co-owner, technical helper — for Wix sync error alerts through env
config alone, no code change required. `sendAlert` broadcasts to
every ID in the list.

**Why this matters**: sync can run without anyone watching the app
(scheduled runs, webhook-triggered refreshes, rapid manual taps). A
toast only helps if the owner happens to be looking at the screen.
Telegram routes the alert to her pocket so a failing token or API
change doesn't go unnoticed for hours.

---

## 2026-04-22 — Owner Telegram ping when a delivery lands (with on-time check)

The owner wanted to know the moment a bouquet is delivered, and
whether it landed inside the slot promised to the customer — without
having to refresh the dashboard to find out.

### Backend
- `services/telegram.js` — new `notifyDeliveryComplete({...})` formatter.
  Compares the planned slot (`HH:MM-HH:MM`, hyphen or en-dash) against
  the actual `Delivered At` converted to Europe/Warsaw via
  `Intl.DateTimeFormat` (handles CET/CEST transitions automatically).
  Output: `✅ on time`, `⚡ early by 15m`, or `⚠ late by 1h 30m`. HTML
  values are escaped since the module sends with `parse_mode: HTML`.
- `services/orderService.js` — new `sendDeliveryCompleteAlert(orderId)`
  that batches the three Airtable reads (order, customer, order lines /
  delivery) and hands structured data to the formatter. Called
  fire-and-forget from both code paths:
  - `transitionStatus()` when the owner marks Delivered from the
    dashboard or florist app.
  - `routes/deliveries.js` PATCH when the driver marks Delivered from
    the delivery app.
  Each HTTP request hits exactly one of those paths (the cascades are
  internal `db.update` calls), so there's no double-send risk.
- Notifications go to the owner only (`sendAlert` — reads
  `TELEGRAM_OWNER_CHAT_ID`), matching the user's request. Florists are
  not pinged — they already know the delivery landed.

### Tests
- New `backend/src/__tests__/telegram.test.js` — 18 tests covering slot
  parsing (hyphen + en-dash), minute-diff formatting, DST-aware
  timezone conversion (summer vs winter offsets), and every branch of
  the on-time judgement (inside slot, early, late, boundary cases,
  unparseable input). `_internals` export used so the pure helpers are
  testable without touching the public API.

### Why it matters
- Tightens the feedback loop: the owner sees delivery quality in real
  time, not when she next opens the app.
- Catches slipping delivery windows early — if late-by-an-hour alerts
  start repeating, it's a dispatch problem worth investigating.

### What to watch for
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_CHAT_ID` must be set in the
  backend env; otherwise `sendAlert` silently no-ops, matching the
  existing new-order behavior.
- The timing comparison uses Europe/Warsaw. If the studio ever moves
  to a different timezone, update the `'Europe/Warsaw'` literal in
  `telegram.js`.
- Slot parser accepts `HH:MM-HH:MM` and `HH:MM–HH:MM` only. If
  `Delivery Time` is empty or free-text ("whenever"), the alert still
  fires but without the punctuality verdict — just shows the delivered
  time. Not a bug; the owner-facing copy degrades gracefully.

---

## 2026-04-21 — Owner can hard-delete orders (dashboard + florist app)

The owner now has a hard-delete action separate from Cancel. Cancel
keeps the record around for audit (useful for business-reason
cancellations); Delete makes the order disappear entirely — intended
for test orders, accidental duplicates, and webhook noise from Wix
that never should have turned into a record in the first place.

### Backend
- `services/orderService.js` — new `deleteOrder(orderId)` cascades:
  returns stock for non-terminal orders (same rule as cancel, so a
  deleted "holding" order doesn't leave a ghost deduction), then
  deletes all order lines, the linked delivery, and finally the order
  itself. Terminal orders (Delivered / Picked Up / Cancelled) skip the
  stock return since stock was already consumed or returned.
- `routes/orders.js` — new `DELETE /api/orders/:id`, owner-only (403
  for other roles), broadcasts `order_deleted` over SSE so other open
  clients refresh.

### Dashboard (`apps/dashboard/src/components/OrderDetailPanel.jsx`)
- Red outlined "🗑 Delete order" button next to the existing Cancel
  button, with a two-step inline confirm. On delete, toast includes
  any returned stock summary and `onUpdate()` refreshes the list —
  which closes the panel since the order is gone.

### Florist app
- `components/OrderCard.jsx` — owner-only "Danger zone" block at the
  bottom of the expanded card with the same two-step confirm. Parent
  `OrderListPage` removes the card on success via new `onOrderDeleted`
  callback.
- `pages/OrderDetailPage.jsx` — owner-only delete block at the bottom;
  on success navigates back to `/orders`.

### Translations
- EN + RU in both florist and dashboard: `deleteOrder`,
  `deleteOrderConfirm`, `deleteOrderConfirmYes`, `orderDeleted`.

### Why it matters
- Cancel and Delete now mean different things. Cancel = "this order
  was a real order that fell through" (keep for stats, revenue
  tracking, refund audit). Delete = "this order should never have
  existed" (wipe so reports stay clean).
- Stock-return logic is reused so a non-terminal delete unwinds the
  reservation, matching what the owner would expect from cancel.

### What to watch for
- This is a hard-delete. Once an order is deleted, there is no undo —
  only the Airtable record's revision history (kept for a few weeks
  on the current Airtable plan).
- The route is owner-role only. If the florist logs in and sees the
  delete button, the UI hides it (`isOwner` gate), but the backend
  would also reject it with 403 — so no downgrade risk.

---

## 2026-04-21 — Role-specific owner notes, customer call button, driver nav options

The owner needed to direct the florist and the driver with separate
instructions on every order, and the florist / driver needed a one-tap
call to the customer (not the recipient). The driver card hid its
expand affordance behind call and navigate links, and Google Maps was
the only navigation option.

### Airtable schema (owner action required before deploy)
- **App Orders → new field `Florist Note` (Long text)** — owner-authored note for the florist, shown as a green 🌸 block on the florist card. Distinct from the customer's `Notes Original` (kept as a blue 📝 block).
- **Deliveries → new field `Driver Instructions` (Long text)** — owner-authored instructions for the driver, shown as an orange ⚠ block on the delivery card. Distinct from the driver's own `Driver Notes` (kept as the driver-editable note).

### Backend (`backend/src/`)
- `routes/orders.js` — `Florist Note` added to `ORDERS_PATCH_ALLOWED`; POST /orders accepts `floristNote`; convert-to-delivery accepts `driverInstructions`; list endpoint now enriches `Customer Phone` so florist cards can call the customer without an extra fetch.
- `routes/deliveries.js` — `Driver Instructions` added to `DELIVERIES_PATCH_ALLOWED`.
- `services/orderService.js` — `createOrder` writes `Florist Note` on order + `Driver Instructions` on delivery at creation time.
- `services/airtableSchema.js` — startup validator now checks both new fields so a missing field fails the boot instead of silently 422'ing PATCH calls.

### Shared package (`packages/shared/`)
- New `utils/phone.js` (`cleanPhone`, `telHref`) + tests.
- New `utils/navigation.js` (`googleMapsUrl`, `wazeUrl`, `appleMapsUrl`) + tests.
- New `components/CallButton.jsx` — consistent green click-to-call pill with `stopPropagation` so it can sit inside clickable cards.
- New `components/NavButtons.jsx` — three-up Google / Waze / Apple nav strip.
- 12 tests, all green. Package-level `npm test` script added.

### Dashboard (`apps/dashboard/`)
- `OrderDetailPanel.jsx` — Notes section restructured into three rows: customer note (read-only, `Notes Original`), florist note (editable, `Florist Note`), driver instructions (editable, delivery orders only). Recipient phone row gains a `CallButton` via the new `trailing` prop on `EditableRow`.
- New translation keys added (EN + RU): `customerNote`, `floristNote`, `driverInstructions`, placeholders, `callCustomer`, `callRecipient`, `customer`, `recipient`.

### Florist app (`apps/florist/`)
- `OrderCardSummary.jsx` — collapsed card now shows florist note in a green block (first) and customer note in the existing blue block; customer phone sits next to the customer name as a `CallButton`.
- `OrderCard.jsx` (expanded) — two inline editors added (green for florist note, orange for driver instructions). Editable at every status so the owner can add instructions after "Delivered" if needed.
- `OrderDetailPage.jsx` — same two editors, customer phone converted to `CallButton`.
- New translation keys mirroring the dashboard set.

### Delivery app (`apps/delivery/`)
- `DeliveryCard.jsx` — address is now plain text above the three-way nav strip (Google / Waze / Apple), two `CallButton`s (customer + recipient), owner's `Driver Instructions` shown in an orange block (falls back to the legacy `Special Instructions` for old data), explicit "Details ▾" button makes the expand action discoverable without competing with call/navigate.
- `DeliverySheet.jsx` — nav strip in its own section, both phone rows converted to `CallButton`, owner's driver instructions rendered read-only above the driver's own notes editor.
- New translation keys: `driverInstructions`, `callCustomer`, `callRecipient`, `customer`, `details`, `navigate`.

### Why it matters
- The owner now has a single, clear authoring surface (dashboard + florist mobile) to talk to each role independently; florists and drivers read the message meant for them on the collapsed card, not buried in the sheet.
- Drivers no longer have to guess where to tap to expand — the explicit "Details" button removes that ambiguity — and can choose their preferred map app instead of being forced into Google Maps.
- Customer phone is one tap away on every card the florist or driver touches, with `CallButton` centralizing formatting (`cleanPhone` strips spaces once, instead of four times).

### What to watch for
- `Driver Instructions` is separate from the existing `Driver Notes`. The driver's own post-delivery observations still live in `Driver Notes`; only the owner writes `Driver Instructions`. If anyone starts re-using `Driver Notes` for owner messages, it will collide with what the driver types.
- The florist card's florist-note block renders only when `Florist Note` is non-empty. Orders created before this deploy will have no green block — that's expected, not a regression.
- Apple Maps on Android falls back to Google Maps in the browser; this is acceptable but means Android drivers effectively see "Google Google Waze". Worth confirming on a real Android device during verification.
- `airtableSchema.js` will now fail boot if either new field is missing from the base. Create both in Airtable before deploying the backend.

---

## 2026-04-20 — Customer Tab v2.0 complete + legacy cleanup

Final iteration of the Customer Tab v2.0 rollout (PRs #101 + #102). The goal
of this work was for the owner to stop reaching for Airtable for CRM — every
order detail, every editable field, every filter she relied on in Airtable is
now available on the Dashboard.

### What landed across iterations

- **Split-view layout** (≥1280px) — left list pane (react-window virtualized,
  1094 customers), right detail pane. Below 1280px a `CustomerDrawer` slides
  in from the right, preserving list context.
- **Merged legacy + app order timeline** — `CustomerTimeline.jsx` fetches both
  `Legacy Orders` and `App Orders` via new `GET /customers/:id/orders`, sorted
  date-desc. Every row expands to reveal every raw Airtable field (ordered
  fields first, then "Other fields" catchall so nothing silently hides). App
  orders get an "Open in Orders tab" button that focuses the list to that
  single order with a dismissable banner (was the #1 pain point of the first
  iteration — it used to just expand the order buried in a long list).
- **Chip-based Key People** (`KeyPersonChips.jsx`) over the flat
  `Key person 1 (Name + Contact details)` / `Key person 2 (...)` fields.
  Designed so the future Postgres many-to-many migration needs no frontend
  rewrite — the UI already behaves like N slots.
- **Universal search + composable filter bar** (`CustomerFilterBar.jsx` +
  `utils/customerFilters.js`) — search walks every string field on the
  customer record plus `_agg.lastOrderDate`. Filters stack with AND logic.
  13 filter dimensions (Segment, Language, Sex/Business, Communication,
  Order Source, Found us from, Has Phone/Instagram/Email/KeyPerson, Last
  order within N days, Min order count, Min total spend, Churn risk). Filter
  state persisted to `localStorage` with a version tag for safe migration.
- **Segment + Acquisition Source pills** are clickable filters with the same
  interaction model (owner feedback: having two visually different control
  systems for the same job was confusing). Removed the top "Customer Health"
  RFM strip entirely — owner didn't find it useful.
- **Fixed the + Filter dropdown** — picking a multi-select dimension (e.g.
  Sex/Business) now actually opens the value picker. Previously the chip only
  rendered once the set was non-empty, but values could only be picked from
  inside the chip, so the picker was unreachable. Now `displayDims` includes
  whichever dimension is currently being edited.
- **Richer timeline rows** — description fallback chain
  (`Bouquet Summary → Customer Request → N × line items`), delivery/pickup
  icon, Unpaid badge, color-coded status pill matching the OrdersTab palette.
- **Cleanup (this commit)** — deleted legacy `CustomerDetailPanel.jsx`
  (~320 LOC, fully superseded), updated `apps/dashboard/CLAUDE.md` component
  table, updated `docs/technical-breakdown.md` component list.

### Backend changes

- `backend/src/routes/customers.js`: fixed `Segment (client)` /
  `Key person 1/2 (Name + Contact details)` field-name aliases in
  `CUSTOMERS_FIELD_MAP` — PATCH requests against these fields were silently
  no-oping, and `/insights` reported most customers as "Unassigned" because
  `c.Segment` read a non-existent field.
- New `GET /customers/:id/orders` — merges legacy + app orders with a single
  normalized shape `{ id, source, date, description, amount, status, raw }`.
- `GET /customers` now enriches each row with
  `_agg: { lastOrderDate, orderCount, totalSpend }` (60-sec in-process cache)
  so filter predicates run client-side without extra round-trips.
- Schema validator (`airtableSchema.js`) now covers the 20 writable Customer
  fields; future renames fail loudly at boot.

### Trade-offs to know

- `_agg` cold-load adds ~1.5–2.5s on the first `/customers` call per session
  (extra Airtable fetches). 60-sec cache absorbs repeat loads. At 10× the
  customer volume this will need moving to a backend-persisted aggregate.
- `CustomerDetailPanel.jsx` is fully removed, so if an older branch still
  imports it the merge will break — grep before rebasing any long-lived
  feature branch that predates 2026-04-20.
- The RFM distributions from `/insights` shifted significantly once the
  Segment field-name bug was fixed (Rare: 0 → 584, DO NOT CONTACT: 0 → 99).
  Anything downstream that hardcoded "Unassigned" as the dominant bucket
  needs re-reading.

---

## 2026-04-19 — Wix order defaults + diagnostic mode

Owner reported that a new Wix order (#11b47468…) came in as Pickup (Wix is
delivery-only today) with blank line items, price, payment method, and
delivery info. Three separate causes:

1. **Wrong fulfilment type.** `wix.js` flipped `Delivery Type` to `'Pickup'`
   whenever `shippingAddress` parsing returned null. That's a false negative
   — the parser missed some payload shapes, not that the order was pickup.
   Hard-coded to `'Delivery'` since Wix doesn't offer in-store pickup. The
   delivery record is now always created (previously skipped when no address
   was parsed, which left Delivery Type='Delivery' with no sub-record and
   broke driver assignment).

2. **"DELIVERY" header on Pickup orders in the detail panel.** Cosmetic but
   confusing. `OrderDetailPanel.jsx` now uses a type-aware label: the section
   heading and date row label read "Pickup" when `Delivery Type === 'Pickup'`,
   "Delivery" otherwise.

3. **Line items, prices, address, payment method still blank on new Wix
   orders.** Root cause: the payload shape Wix is sending doesn't match any
   of the field paths the parser tries. Can't fix blind — need the raw
   payload. Added a `DEBUG_WIX_PAYLOAD=1` env flag to `wix.js` that dumps
   the full payload to Railway logs on every incoming webhook. Owner: set
   that env var, wait for the next real Wix order, share the log, then turn
   it back off. The diagnostic block is small and gated so it's safe to
   leave merged even when disabled.

### What to watch for
- Once we have a real payload, expect a follow-up commit that rewrites the
  line-item / price / address / payment-method extraction paths in `wix.js`
  and then removes the `DEBUG_WIX_PAYLOAD` block.
- If the env flag is left on for long, the Railway log table grows faster
  and payloads can include PII (email, phone, address). 24h is enough.

---

## 2026-04-19 — Post-Tier-1 bug sweep (5 adjustments)

Follow-ups from the owner after testing the Tier 1 sweep.

### 1. Removed low/empty stock Telegram alerts

The `oversellCheck.js` service ran after every Wix webhook order and sent an
"OVERSELL ALERT" Telegram whenever any line exceeded current stock. Owner no
longer wants these — they were redundant with the dashboard's Flowers Needed
widget and noisy on peak days. Hard-deleted the service file and removed the
call in `backend/src/services/wix.js` (was wrapped in try/catch, non-blocking,
so removing it has no functional impact on order creation). Other Telegram
alerts (new-order notifications, Available Today cutoff reminder) remain.
Updated `backend/CLAUDE.md` services table.

### 2. Stock price change cascades to Premade Bouquet Lines

When the owner updates `Current Cost Price` or `Current Sell Price` on a Stock
row, every Premade Bouquet Line that references that Stock item now receives
the same price update, so premade bouquet totals follow. Delivered / Active
order lines are deliberately untouched — those are customer commitments and
must stay snapshot-based.

`backend/src/routes/stock.js` PATCH /:id: after the Stock row is updated, list
Premade Bouquet Lines, filter by `Stock Item[0] === stockId` in memory (can't
use `filterByFormula` on linked records per CLAUDE.md pitfall), patch matching
lines with the new `Cost Price Per Unit` / `Sell Price Per Unit`.

### 3. Dashboard Orders tab — column headers + fulfilment date shown for pickup too

- `apps/dashboard/src/components/OrdersTab.jsx` — added a header row above the
  list (there were no column labels at all). Columns: #, Order date,
  Customer, Bouquet, Status, Fulfilment, Total, Age (when unpaid-only is on).
- **Left date column** now shows `Order Date` (labelled "Order date") so the
  row answers "when was this logged". An earlier iteration of this commit
  tried showing the due date there, but with a "Due date" label the value
  was ambiguous against the Fulfilment column.
- **Fulfilment column** (right of the row, next to 🚗 / 🏪 icon) now shows
  the due date for pickup orders too, not just deliveries — previously the
  icon-only rendering for pickup made the due date invisible. Value is
  `Delivery Date ‖ Required By` plus the time slot if set.
- `OrderDetailPanel.jsx` — added a read-only Order Date row in the details
  block as additional context.
- New translation keys in both languages: `orderDate`, `colOrderId`,
  `colCustomer`, `colBouquet`, `colFulfillment`, `colAge`.

### 4. Filter rework — unstick the "Orders without a date" banner + universal reset

Follow-up to the banner introduced earlier today. When a user toggled the
orphan-date filter on and then switched to Premade view, the banner hid while
the filter stayed active — coming back to orders showed an empty list with
nothing to click. Also: the existing "Clear all" button only covered a
subset of filters, leaving `search`, `dateFrom`, `dateTo`, and `noDateOnly`
quietly applied.

Based on a short research pass on filter UX patterns
(Zendesk/Linear/Airtable style):
- Banner visibility now bound to `noDateCount > 0 || noDateOnly` — the toggle
  is never hidden while the filter is active. Same in florist
  `OrderListPage.jsx`.
- "Clear all" rebranded to "Reset filters", wired to clear every filter
  state (including `search` and `noDateOnly`). Shown whenever any filter is
  active (previously only when a cross-tab chip filter was set).
- Added active-filter chips for `search`, `noDateOnly`, `statusFilter`,
  `unpaidOnly` so they're visible and individually dismissible.
- Cross-mode guard: toggling the Premade view (dashboard) or switching the
  florist view away from Active resets `noDateOnly` so it can't silently
  carry across modes.
- New translation key: `resetFilters`.

### 5. Owner per-line cost/sell override → writes back to Stock

When the owner composes a new order using a flower that's currently out of
stock (`Current Quantity ≤ 0`), the last-known cost/sell snapshot on the
Stock row is likely stale — the owner knows the supplier's new price but had
no way to update it at composition time. Now there's inline cost + sell
inputs per out-of-stock line in both apps' bouquet builders, and on order
submit the backend:

- Writes the new prices to the Stock row (`Current Cost Price`,
  `Current Sell Price`). Combined with #2, premade bouquets using that Stock
  auto-recalc.
- Uses the new prices on the Order Line snapshot (existing behavior).

Gated owner-only on the backend (`isOwner` threaded from `POST /orders` and
`POST /premade-bouquets/:id/match` → `createOrder` → Stock write-back loop).
The UI hides the inputs for in-stock items since their prices reflect what
was actually paid.

Files:
- `apps/florist/src/components/steps/Step2Bouquet.jsx` — `CartLine` gets
  `isOwner` prop and inline cost/sell inputs; `commitPrices` handler in
  Step2Bouquet mutates the line.
- `apps/dashboard/src/components/steps/Step2Bouquet.jsx` — added a local
  `PriceOverride` component + `commitPrices` handler. Dashboard is
  PIN-gated to owner so no role check needed here.
- `backend/src/services/orderService.js` — new step 2c in `createOrder` runs
  pre-deduction: for each line, if the Stock row is at ≤0 qty and any price
  differs, PATCH Stock + cascade to Premade Bouquet Lines (same pattern as
  `PATCH /stock/:id`).
- `backend/src/routes/orders.js` + `backend/src/routes/premadeBouquets.js` —
  pass `isOwner: req.role === 'owner'` into `createOrder`.

### What to watch for
- Sandbox can't run vitest, so CI will verify. The new price-cascade logic
  hasn't been covered by a test yet — worth adding one for
  `stock.js PATCH /:id` once vitest has a supertest harness in this repo.
- The owner override fires only when the Stock row is at ≤0 qty. If the
  florist composes a bouquet with an in-stock flower and somehow ships with
  a changed price snapshot, the Stock row won't update — intentional, since
  in-stock items reflect what was actually paid.

---

## 2026-04-19 — Owner can edit bouquet in any status (migration-blocker)

Closed Tier 1 Bug 11 — the last thing that still required opening Airtable
directly. The owner can now add, remove, and adjust flowers on any order
regardless of status (Delivered, Picked Up, Cancelled included). This is
what lets the Airtable → Postgres migration proceed — Phase 0's stated
prerequisite "all reasons to edit the source of truth directly are gone"
is satisfied.

### Backend — `backend/src/services/orderService.js`

`editBouquetLines(orderId, body, isOwner)` now bypasses the editable-status
check when `isOwner === true`. Florists still get a 400 on terminal
statuses. The existing `Ready → New` auto-revert fires only when the
pre-edit status is literally `READY`, so editing a Delivered order never
rewrites it back to NEW (that would undo the delivery).

### Frontend — three UI gates removed

- `apps/florist/src/components/OrderCard.jsx:382` — edit-bouquet button
  shown when `(!isTerminal || isOwner) && !editingBouquet`. `isOwner` was
  already a prop from `OrderListPage`.
- `apps/florist/src/pages/OrderDetailPage.jsx:289` — same condition.
  Added `useAuth` import + `const isOwner = role === 'owner'`, since this
  page previously didn't know the role.
- `apps/dashboard/src/components/OrderDetailPanel.jsx:468` — dropped the
  `!isTerminal` guard entirely. The dashboard is PIN-gated to owner at
  login, so every user who reaches it is an owner. Backend still enforces
  the role check, so this can't leak to a florist via spoofed HTTP calls.

### Test — `backend/src/__tests__/editBouquetLines.test.js`

New Vitest file with 9 cases:
- owner allowed on Delivered / Picked Up / Cancelled (3)
- non-owner rejected with 400 on Delivered / Picked Up (2)
- non-owner allowed on New / Ready (2)
- Ready → New auto-revert fires on owner edit (1)
- Delivered / Cancelled status NOT reverted on owner edit (2)

### What to watch for

When the owner removes a flower from a Delivered order, the existing
return-to-stock / write-off dialog still applies — the florist chooses
the action per line. Adding a flower to a Delivered order deducts stock
immediately. This is intentional: a Delivered-order edit reflects a
correction of the historical record (late substitution, price fix), so
stock bookkeeping must match reality.

---

## 2026-04-19 — Florist Completed view no longer hides date-less orders

Follow-up to the orphan-date fixes below. The owner spotted order
`#202604-025` (Aleksander Sushko, Delivered) in the dashboard but **not**
in the florist app's Completed → Delivered view. Both queries hit the same
endpoint but with different params, so the filter divergence was hidden.

### Root cause

`backend/src/routes/orders.js` `completedOnly` branch used:
```
NOT(IS_BEFORE({Required By}, cutoff))
```
Airtable's `IS_BEFORE` returns empty on a blank field and `NOT(empty)` is
falsy, so every row with `Required By = null` was silently excluded. The
dashboard's `upcoming` branch happens to include blanks (its post-enrichment
filter treats `!dd` as "show"), so null-date orders were visible there —
creating the perceived discrepancy.

### Fix

Completed branch now also includes rows where `Required By` is blank but
`Order Date` is within the 30-day cutoff:
```
OR(
  NOT(IS_BEFORE({Required By}, cutoff)),
  AND({Required By} = BLANK(), NOT(IS_BEFORE({Order Date}, cutoff)))
)
```
Order Date is always set on creation (`orderService.js:82`), so this is a
safe fallback for legacy/imported rows.

**What to watch for:** orders with blank `Required By` will sort at the
bottom of the Completed list (Airtable sorts blanks last in `desc` order).
If the list gets long, the orphan-date banner on the florist app still
gives a one-tap path to find them. Going forward the backend validation
added earlier today prevents any new date-less orders from being created.

---

## 2026-04-19 — Block date-less orders + surface orphan-date orders

After the owner created a premade-bouquet order on the dashboard with no
delivery/pickup date, the order saved successfully but became invisible:
the dashboard's default sort puts null dates at position `'9999'`
(`OrdersTab.jsx`), the Today/upcoming filters drop them, and Airtable's
`IS_BEFORE` on a null `Required By` behaves unpredictably. The order existed
in Airtable but no list view showed it — it looked "lost".

Three layers of defence so this can't happen again:

### 1. Backend validation — `Required By` is now mandatory

- `backend/src/routes/orders.js` `POST /orders` — rejects `400` if no
  `requiredBy` (or `delivery.date`) in `YYYY-MM-DD` form.
- `backend/src/routes/premadeBouquets.js` `POST /:id/match` — same check.

The Wix webhook (`backend/src/services/wix.js`) bypasses these routes and
writes orders directly via `db.create`, so it's unaffected; Wix payloads
always include a delivery date.

### 2. Dashboard frontend parity — date now blocks Next + Submit

`apps/dashboard/src/components/NewOrderTab.jsx`:
- New `validateStep()` and `handleNext()` mirror the florist's flow
  (`apps/florist/src/pages/NewOrderPage.jsx`). Step 2 → 3 is blocked unless
  a date is set; Submit double-checks at line 113.
- `apps/dashboard/src/components/steps/Step3Details.jsx` — date label and
  field now show the same red `*` and `ring-1 ring-ios-red/30` the florist
  app uses, so the requirement is visible before the user tries to advance.

### 3. Orphan-date banner in both apps

If any legacy/imported order has `Required By` and `Delivery Date` both
empty, an amber banner appears with the count and a "Show only these"
toggle so the owner can triage them.

- `apps/dashboard/src/components/OrdersTab.jsx` — banner above the list,
  filter via `noDateOnly` state.
- `apps/florist/src/pages/OrderListPage.jsx` — same pattern, only shown in
  the Active view (terminal orders don't need triage).
- New translation keys in both `translations.js` files
  (`ordersWithoutDate`, `showOnlyTheseOrders`, `showAll`).

**Why it matters:** the backend is the only layer that can't be bypassed,
so it's the real fix. The dashboard validation gives the owner an instant
toast instead of a 400 from the server. The banner recovers any existing
orders that already slipped through (including the missing one from the
incident that prompted this change).

**What to watch for:** the new backend check fires on every `POST /orders`
and `POST /premade-bouquets/:id/match`. If any other client (e.g. a future
script, a manual `curl`) submits without a date, it now gets a 400 instead
of silently losing the order.

---

## 2026-04-19 — Owner can assign drivers from order detail + full florist parity

The owner reported that after creating a delivery order linked to a premade
bouquet, the full-page **OrderDetailPage** had no driver-picker (florist app,
logged in as owner). The driver picker existed in the expandable `OrderCard`
but not on the full-page detail view, so there was no way to assign a driver
without bouncing back to the list and expanding the card. Same gap also
existed for florists — neither role could assign a driver from the detail
page. Separately, several florist-only entry points blocked the owner.

### Frontend — `apps/florist/src/pages/OrderDetailPage.jsx`

- Pulls `drivers` from `useConfigLists()`.
- Adds a `patchDelivery()` helper that PATCHes `/deliveries/:id` (mirrors
  `OrderCard.patchDelivery` so both views stay consistent).
- Renders a driver-picker section after the read-only delivery details card,
  guarded by `isDelivery && order.delivery && drivers.length > 0`. Tap to
  toggle assignment; shows `t.noDriver` when none assigned.

### Frontend — full owner parity in florist app

- `apps/florist/src/App.jsx` — removed `FloristRoute` wrapper.
  `/stock-evaluation` is now `PrivateRoute`, so the owner can use it too.
- `apps/florist/src/pages/OrderListPage.jsx` — dropped the `!isOwner` guard on
  the stock-evaluation banner; the owner now sees the same alert.
- `apps/florist/src/components/BottomNav.jsx` — added "Stock Evaluation" entry
  to the owner's More menu.
- `apps/florist/CLAUDE.md` — `StockEvaluationPage` access changed from
  `florist` to `all`.

**Why it matters:** the owner uses the florist app on her phone for the same
daily-task control she has on the dashboard. Anywhere a florist can act, she
should be able to act too. Driver assignment from the detail page is the most
visible miss; the role-gated routes/banners were the structural ones.

**What to watch for:** the stock-evaluation flow assumes a single in-flight
evaluator; if both the florist and the owner load the page at the same time
they could race on accept/write-off actions. We don't have row-level locking
in Airtable, so coordinate verbally for now or split orders across roles.

---

## 2026-04-17 — Wix "Available Today" now multilingual

The "Available Today" nav item only rendered on the English version of the
storefront. Adding products with Lead Time = 0 and the `Available Today`
category assignment correctly populated the Wix collection, but:

- Polish / Russian / Ukrainian visitors never saw the menu link.
- Clicking the English link and then switching language kept an English
  heading on the category page.

### Root cause

Three gaps all pointing at the same pattern:

1. **`backend/src/routes/settings.js:44-56`** — the default auto-category
   entry shipped with empty `en/pl/ru/uk` translations. The Velo helper
   `applyLang()` in `docs/wix-velo-categories.js` falls through to the
   hardcoded English `cat.name` when translation strings are empty, so
   the menu label stayed in English for every locale.
2. **`docs/wix-velo-categories.js`** — a `getSeasonalMenuLabel()` helper +
   masterPage example existed for the seasonal category, but nothing
   equivalent for Available Today, so the owner had no language-aware way
   to swap the menu text or hide the item when `productCount === 0`.
3. **`backend/src/services/wixProductSync.js:637-674`** — the push path
   assigned products to the Wix collection but (unlike the seasonal path
   a few lines above) never called `updateWixCategory()` to sync the
   collection's own name + description, so Wix's native menu fallback
   stayed in whatever language the owner used when creating the
   collection manually.

### Changes

- `backend/src/routes/settings.js`
  - Seeded `storefrontCategories.auto[Available Today]` defaults with real
    `en/pl/ru/uk` titles and descriptions.
  - New `migrateAutoCategoryTranslations()` — on startup, backfills any
    empty title/description fields from the defaults so the Airtable-stored
    config catches up without the owner re-saving the settings tab.
- `docs/wix-velo-categories.js`
  - New helpers: `getAvailableTodayMenuLabel()`, `getAvailableTodayTitle()`,
    `getAvailableTodayDescription()`, `isAvailableTodayActive()`. Mirrors
    the seasonal helpers and reads `productCount` from
    `/api/public/categories` to drive visibility.
  - Extended the masterPage.js usage example to show how to set the menu
    label text and `.expand()/.collapse()` the nav item based on
    `isAvailableTodayActive()`. masterPage.js runs on every language
    version, so one piece of code handles EN/PL/RU/UK.
- `backend/src/services/wixProductSync.js`
  - `runPush()` now pushes the Available Today collection's EN title +
    description to Wix (only when a translation is configured), mirroring
    the seasonal path. Keeps the Wix-native collection label in sync with
    the owner's translations and prevents the nav item from disappearing
    in other languages when Wix Multilingual resolves the collection name.

### What to watch for

- **Backfill runs on the next backend restart.** The migration only writes
  back to Airtable when it actually fills in missing values, so a steady
  log line is `[SETTINGS] Backfilled auto-category translations` once,
  then silence.
- **Cutoff behavior unchanged** — products are still removed from the
  collection only by owner action (deactivating the product) or when
  stock drops below `Min Stems`. The new visibility helper just mirrors
  whatever the backend reports.

### Addendum — real root cause + follow-up fix

Two earlier guesses about the root cause were wrong. What actually
blocked the PL / RU / UK menu link:

- Wix Stores menu items are Store-page links. They don't get per-language
  translations from the Site Menu panel, and they don't get one from
  `masterPage.js` renaming either — if the linked **Wix Stores collection
  itself** has no translation for the visitor's locale, Wix strips the
  link from the non-primary-language site entirely. No amount of Velo
  mutation on `$w('#horizontalMenu1').menuItems` can add back a link
  Wix refused to render in the first place.
- 1fffa70 seeded PL / RU / UK strings in Airtable config and pushed the
  EN title/description to the Wix collection via `updateWixCategory()`,
  but never pushed the PL / RU / UK strings anywhere Wix would read them.

**Follow-up fix (this addendum):**

- New `pushCollectionTranslations()` helper in
  `backend/src/services/wixProductSync.js`. Writes PL / RU / UK
  titles + descriptions to the Wix Multilingual Translation Content
  API (schema `5b35dfe1-da21-4071-aab5-2cec870459c0` — Wix Stores
  collections; fields `collection-name` + `category-description`),
  marking them `published: true`. Runs after the existing EN
  `updateWixCategory()` call for both seasonal and Available Today.
  Query-then-create-or-update so re-runs are idempotent; skips any
  locale whose Airtable config has blank title + description so
  translations the owner typed by hand in the Wix Translation Manager
  aren't overwritten.
- Locale codes verified against `/locale-settings/v2/settings` — the
  site uses short codes (`en`, `pl`, `ru`, `uk`), not regional
  variants (`en-us`).
- One-shot API call from this session pushed the PL / RU / UK
  translations for Available Today directly, so the nav link appears
  on non-English sites without waiting for the next backend redeploy.

### What the earlier Velo correction is still good for

The masterPage example rewrite in `docs/wix-velo-categories.js`
(committed earlier on this branch) is independently useful: it matches
the deployed `blossom-wix/src/pages/masterPage.js` pattern
(`$w('#horizontalMenu1').menuItems` mutation) instead of the fictional
`#availableTodayMenu` / `#availableTodayMenuText` placeholder elements
that were in 1fffa70. So a future paste won't conflict with the
existing header wiring. The four helpers (`getAvailableTodayMenuLabel`,
`getAvailableTodayTitle`, `getAvailableTodayDescription`,
`isAvailableTodayActive`) remain available for any page that binds
Available Today to a standalone text element.

---

## 2026-04-16 — Bouquet Editor UX (florist app): live totals + single return-to-stock prompt

Two annoyances in the florist bouquet editor surfaced while editing an
existing order:

1. **Double "return to stock" prompt when removing a line.** Tapping ✕ on
   a flower already opens a per-line dialog (Return / Write-off). After
   picking an action, pressing **Save** would show the same question again
   as a second confirmation — the user had to re-choose for a decision
   they'd already made.
2. **Totals didn't refresh while editing.** The "Flowers" subtotal and
   "TOTAL" in the price-summary card kept showing the saved value. To see
   the effect of adding or removing stems, the owner had to save, see the
   new total, and decide if they needed to add more — a multi-round trip.
   Per-line sell price × qty was also not visible while editing.

### Frontend — `apps/florist/src/components/OrderCard.jsx`

- Save handler now only opens the spare-flowers dialog when a line
  quantity was **reduced inline** (e.g. 10 → 7). Lines fully removed via
  ✕ already carry `action: 'return' | 'writeoff'` from their per-line
  dialog, so the second prompt was redundant and has been dropped.
- Bouquet edit rows now render `{price} zł × {qty}` and `{line total}` under
  each flower, using the current stock sell price so the owner sees
  exactly what each line contributes.
- New live "Flowers" footer inside the editor — sums all lines as
  quantities change and shows the delta vs. the original order total in
  red (over) / green (under).
- Flower picker results now show sell price + quantity (e.g. `65 zł · 12 pcs`)
  so the owner can pick the right flower by price before adding.
- `flowerTotal` in the outer Price Summary card now reflects in-memory
  edits while `editingBouquet` is true (falls back to the saved total
  otherwise). This propagates to the grand total displayed at the top of
  the card and below the bouquet.

### Frontend — `packages/shared/hooks/useOrderEditing.js`

- Same single-prompt fix applied to the shared hook used by the dashboard
  flow and tests, for consistency.

### What to watch for

- The top-of-card price badge now moves while editing — that's intentional
  so the owner can gauge the new total at a glance, but it means the badge
  is no longer "what the customer owes right now" during edits.
- `sellPricePerUnit` on a line is a snapshot at add-time; the editor
  prefers the live `Current Sell Price` from stock so if an owner
  mid-editing changes a stock price elsewhere, the editor reflects that
  immediately. The committed line still snapshots the price at save.

---

## 2026-04-16 — PO Visibility Fix (partial qty + owner-added lines)

Three related symptoms in the PO flow collapsed onto the same root cause:
the florist's evaluation screen was only rendering lines whose `Driver Status`
was explicitly `Found All`, `Partial`, or `Not Found + alt qty`. Any line
where the owner entered a Qty Found (via Shopping Support) but did not tap
the status pill, or any line added mid-shopping through the "+ Add line"
button, stayed at `Pending` and was silently filtered out. Additionally,
the "+ Add line" button on both the dashboard and florist PO pages was
using a temp-local-line pattern that could drop the owner's entry on
refresh/navigate-away if the Flower Name wasn't filled first.

### Frontend — `apps/florist/src/pages/StockEvaluationPage.jsx`
- Evaluation filter (lines ~183-200) now includes any line with `Quantity Found > 0`
  **or** `Alt Quantity Found > 0`, regardless of `Driver Status`. Immediately
  rescues in-flight POs that had partial quantities stuck at `Pending`.
- `notFoundLines` tightened so it only shows lines with zero primary and zero alt.
- Alt-block render (line ~325) now shows whenever `altFound > 0`, even when
  `Alt Supplier` is blank (owner may have entered only the flower and qty).

### Frontend — `apps/florist/src/pages/ShoppingSupportPage.jsx`
- `ShoppingLineItem` auto-derives `Driver Status` on Qty Found / Alt Qty Found
  blur: `qty >= needed → Found All`; `0 < qty < needed → Partial`;
  `qty == 0 && altQty > 0 → Not Found`; `qty == 0 && altQty == 0 → no change`.
  Owner no longer has to tap the status pill for the florist to see her entries.
- New `AddExtraLineForm` component + `addExtraLine` handler — inline form with
  all four required fields (flower name, supplier, qty, cost) enforced up
  front; POSTs via `/stock-orders/:id/lines` and immediately stamps
  `Driver Status: Found All` + `Quantity Found = qty` so the florist sees the
  extra flower for evaluation. Visible only while PO is Sent/Shopping.

### Frontend — `apps/dashboard/src/components/StockOrderPanel.jsx` + `apps/florist/src/pages/PurchaseOrderPage.jsx`
- Replaced `addDraftLine` (temp-local-line) with `addPersistedLine` +
  `AddLineInlineForm`. Full fields required; POST fires only when all four
  are present. When the PO is already `Shopping`, the new line is auto-promoted
  to `Found All` + `Quantity Found` so the florist can evaluate it.
- Final overview (Reviewing/Evaluating/Complete read-only rows) now shows a
  grey "Не получено / Not received" chip on lines that stayed at `Pending`
  with no qty. Makes it obvious what slipped through so the owner can reconcile
  via Receive Stock if needed.

### Translations
- Dashboard + florist: added `addExtraFlower`, `addExtraHint`, `fillAllFields`,
  `lineAddedAndSent`, `notReceived`, `flowerNameLabel` (dashboard) /
  `shopping.flowerName`, `shopping.supplier` (florist).

### No schema or backend changes
Everything rides on existing endpoints:
- `POST /stock-orders/:id/lines` (already supports Draft/Sent/Shopping)
- `PATCH /stock-orders/:id/lines/:lineId` (always supported)
- `stock_order_line_updated` SSE broadcast (already fires) ensures the driver
  app refreshes when the owner adds/edits a line on a Sent PO.

### What to watch for
- The filter relaxation means ANY line with `Quantity Found > 0` is evaluable,
  even if Driver Status is `Not Found` (shouldn't happen, but be aware of
  the mismatch). Previously the owner had to tap a pill; now the qty alone
  is enough. If the florist complains about seeing lines she didn't expect,
  it's likely because the qty was saved but the owner never reconciled the
  pill — surface the qty in owner review, don't re-tighten the filter.
- Owner-added lines on a `Shopping` PO are auto-promoted to `Found All` even
  though no driver actually shopped them. Stock-wise this is fine (the flowers
  really were bought). For reporting, these lines will show `Assigned Driver`
  on the parent PO, not who physically bought them.

---

## 2026-04-11 — Premade Bouquets

A new flow that lets the florist compose bouquets **before** any order exists —
"display" bouquets prepared each day that walk-in clients or Instagram/Wix
buyers can later match to. Stock is deducted the moment the bouquet is built;
if nobody buys it the flowers are returned to stock; if a buyer is matched a
real order is created and the premade record is consumed (no re-deduction).

### Airtable (dev base)
Two new tables: `Premade Bouquets` and `Premade Bouquet Lines` (see schema
table above). Must be created in production before go-live.

### Backend
- `services/premadeBouquetService.js` (new) — `createPremadeBouquet`,
  `listPremadeBouquets`, `getPremadeBouquet`, `updatePremadeBouquet`,
  `returnPremadeBouquetToStock`, `matchPremadeBouquetToOrder`. All stock
  mutations run through the existing `atomicStockAdjust` queue so concurrent
  edits are serialized.
- `services/orderService.js:55` — `createOrder()` now accepts an internal
  `opts.skipStockDeduction` flag. Used only by the match flow, where the
  stock hold was already placed when the premade was built.
- `routes/premadeBouquets.js` (new) — 7 endpoints (`GET`, `POST`, `PATCH`,
  `PUT /lines`, `POST /return-to-stock`, `POST /match`).
- `middleware/auth.js:27` — added `premade-bouquets` resource; owner and
  florist allowed, driver blocked.
- `config/airtable.js` — two new `TABLES.PREMADE_BOUQUETS*` env-var hooks.
- `services/airtableSchema.js` — expected-fields validation for the two new
  tables (catches field-name drift at boot, not at runtime).
- `services/notifications.js` — three new SSE event types:
  `premade_bouquet_created`, `premade_bouquet_matched`,
  `premade_bouquet_returned`.
- `__tests__/premadeBouquetService.test.js` (new) — 9 unit tests covering
  create happy path, rollback, validation guards, return-to-stock, match-to-order
  (including confirmation that the match flow doesn't re-deduct stock and
  carries over the price override).

### Florist App (`apps/florist`)
- `pages/OrderListPage.jsx` — third FAB option ("Готовый букет" → new
  composition page); new "Готовые букеты" view-mode chip on the orders list
  with a live count badge; in that view the page renders a list of
  `PremadeBouquetCard` instead of `OrderCard`.
- `pages/PremadeBouquetCreatePage.jsx` (new, route `/premade-bouquets/new`) —
  name + notes + embedded `Step2Bouquet` picker + save button.
- `components/PremadeBouquetCard.jsx` (new) — expandable card with "Продано"
  and "Вернуть в склад" actions.
- `components/steps/Step2Bouquet.jsx` — accepts new `premadeBouquets` +
  `matchPremadeId` + `onSelectPremade` + `onUnlinkPremade` props. When a
  premade is locked in, the catalog and editable cart hide and a read-only
  composition preview replaces them.
- `pages/NewOrderPage.jsx` — fetches premade bouquets; handles
  `location.state.matchPremadeId` (Path A — "Sold" button on inventory) and
  the in-wizard "tap a premade" flow (Path B); on submit routes through
  `POST /api/premade-bouquets/:id/match` when locked.
- `hooks/useNotifications.js` — toasts for the three new SSE events.
- `App.jsx` — new route `/premade-bouquets/new`.

### Dashboard App (`apps/dashboard`)
Mirrors the florist parity per CLAUDE.md.
- `components/OrdersTab.jsx` — new "💐 Готовые букеты" chip; when active the
  tab renders `PremadeBouquetList` instead of the orders table.
- `components/PremadeBouquetList.jsx` (new) — expandable row list, matches
  the orders table density. Has a "+ Create premade bouquet" button in the
  header that opens `PremadeBouquetCreateModal`.
- `components/PremadeBouquetCreateModal.jsx` (new) — inline modal that
  reuses `Step2Bouquet` + name/notes/price fields for composition.
- `components/NewOrderTab.jsx` — accepts `initialFilter.matchPremadeId`;
  fetches available premades; Path A (from orders tab "Sold" button) and
  Path B (select premade inside Step 2) both route through the match
  endpoint on submit.
- `components/steps/Step2Bouquet.jsx` — same props + behavior as florist
  version (premade list on top, lock banner, read-only cart).
- `pages/DashboardPage.jsx` — passes `navigateTo` down to `OrdersTab` and
  `initialFilter` to `NewOrderTab` so cross-tab "Sold" navigation works.

### Translations
Added ~20 new keys per language to both `apps/florist/src/translations.js`
and `apps/dashboard/src/translations.js` (premade bouquet, inventory, match
to client, return to stock, locked banner, etc.).

### Known trade-offs
- **Florist can't edit a premade bouquet's line composition after save.**
  You can return it to stock and re-create it. Future work: surface the
  `PUT /api/premade-bouquets/:id/lines` endpoint in the card UI.
- **No Wix sync yet.** The bouquets live only in Airtable. If the owner
  wants to advertise them on the storefront we need a new sync integration.
- **No photo/advertised-text fields yet.** Name + notes only for v1.

---

## 2026-04-07 — Stock Workflow Hardening (orphan order/PO lines)

### Airtable (production base `appM8rLfcE9cbxduZ`)
- **Stock.Lot Size** — renamed to remove a trailing space. Symptom: `POST /api/stock` returned `UNKNOWN_FIELD_NAME: "Lot Size"`, breaking the florist "Add new flower" flow on iPad. Verified Airtable column was literally `Lot Size ` (one trailing space). No code change needed; just rename the column.
- **Stock.Farmer** — verified, no trailing space, no rename needed.

### Backend
- `services/orderService.js` — `createOrder` and `editBouquetLines` now hard-reject any new order line that ends up with `stockItemId === null` after `autoMatchStock` runs. Throws a 400 with the offending flower names. Rationale: orphan lines silently broke stock deduction, demand calc and PO generation.
- `routes/orders.js` — `POST /api/orders` now surfaces `statusCode === 400` errors verbatim instead of wrapping them as 500, so the dashboard/florist toast shows the real reason ("Create the flower in Stock first.").
- `routes/stockOrders.js` — `POST /:id/evaluate` now throws per-line if a PO line has any received/written-off quantity but no linked Stock Item. The existing partial-failure machinery flips the PO to `Eval Error` so the owner can fix the link and retry. Previously these lines were silently marked `Processed` and the flowers vanished from inventory.

### Dashboard (`apps/dashboard`)
- `components/steps/Step2Bouquet.jsx` — removed the silent `catch {}` fallback that pushed an inline order line with `stockItemId: null` whenever `POST /api/stock` failed. Now mirrors the florist app: shows the real error in a toast via `useToast`. This was the main producer of orphan order lines.

### Watch for
- Any historical Order Lines created via the dashboard "Add new" path between ~2026-03-16 and 2026-04-07 may already be orphans (no `Stock Item` link). They will not block new orders, but they are invisible to demand/stock calc. To find them in Airtable: filter Order Lines where `Stock Item` is empty.
- The new validation will reject orders that previously slipped through. If a florist hits "Order line(s) without a Stock Item are not allowed", the fix is to first add the flower in Stock (the same form they were already using), not to bypass the check.

---

## 2026-03-21 — Phase 4: Testing Foundation

### Backend
- **Vitest** added as test framework (`npm test` / `npm run test:watch`).
- **`vitest.config.js`** — sets dummy env vars so Airtable/auth imports don't crash during tests.
- **46 tests** across 3 test files, all passing in ~300ms:
  - `__tests__/utils.test.js` — `sanitizeFormulaValue` (formula injection prevention), `pickAllowed` (field whitelisting), `safeEqual` (timing-safe PIN comparison).
  - `__tests__/analyticsService.test.js` — 13 tests covering all pure computation functions: revenue, waste, funnel, product ranking, flower pairings, weekly rhythm, payment methods, prep time, inventory turnover, supplier scorecard, stock losses.
  - `__tests__/orderService.test.js` — `ALLOWED_TRANSITIONS` state machine: valid transitions, terminal states, legacy exits, full status coverage.

---

## 2026-03-21 — Phase 3: Input Validation + SSE Connection Limits

### Backend — Input Validation
- `routes/customers.js` — POST now validates Name/Nickname required, Phone type check, body goes through `pickAllowed` whitelist (was previously passing raw `req.body` to Airtable). PATCH rejects empty updates.
- `routes/floristHours.js` — PATCH rejects empty updates (already had POST validation).
- `routes/marketingSpend.js` — POST now validates: amount must be non-negative number, channel must be non-empty string, notes sanitized.

### Backend — SSE Connection Limits
- `services/notifications.js` — `addClient()` now enforces a max of 50 concurrent SSE connections (expected: ~7 users). Returns `false` when limit reached.
- `routes/events.js` — returns 503 when connection limit hit, preventing memory exhaustion from runaway reconnections or bot traffic.

---

## 2026-03-21 — Phase 2: ESLint, Service Layer Extraction, Logging Cleanup

### Backend — ESLint
- **New file `backend/eslint.config.js`** — ESLint 9 flat config with rules for: `no-unused-vars`, `no-undef`, `eqeqeq`, `prefer-const`, `no-async-promise-executor`, `require-atomic-updates`, `no-duplicate-imports`.
- Added `lint` and `lint:fix` scripts to `backend/package.json`.
- Auto-fixed 4 warnings (let→const, ==→===). Remaining 11 warnings are pre-existing and intentional.

### Backend — Service Layer Extraction
- **New file `backend/src/services/orderService.js`** — extracted business logic from `routes/orders.js`:
  - `createOrder()` — atomic order creation with rollback
  - `transitionStatus()` — status validation, cascade, broadcast
  - `cancelWithStockReturn()` — cancel + stock recovery
  - `editBouquetLines()` — bouquet editing with stock adjustments
  - `autoMatchStock()` — flower name → stock item matching
  - `ALLOWED_TRANSITIONS` — status state machine (now importable by tests)
- **New file `backend/src/services/analyticsService.js`** — extracted 14 pure computation functions from `routes/analytics.js`: `calculateRevenueMetrics`, `rankTopProducts`, `analyzeFlowerPairings`, `calculateWeeklyRhythm`, `calculateMonthlyBreakdown`, `calculateCompletionFunnel`, `analyzeSourceEfficiency`, `analyzePaymentMethods`, `calculatePrepTimeStats`, `calculateInventoryTurnover`, `buildSupplierScorecard`, `breakdownStockLosses`, etc.
- `routes/orders.js` — reduced from 710 to 290 lines (thin controller)
- `routes/analytics.js` — reduced from 570 to 230 lines (data fetcher + assembler)

### Backend — Logging Cleanup
- `routes/webhook.js` — removed `console.log` that dumped full Wix order payload (contained customer PII: names, phones, addresses, payment info). Key structure logging preserved.

---

## 2026-03-21 — Code Quality: Status Constants + Shallow Config Fix

### Backend
- **New file `backend/src/constants/statuses.js`** — centralized constants for all order, delivery, payment, PO, and stock loss statuses. Eliminates ~100 hardcoded status strings scattered across route files.
- **All route files** (`orders.js`, `dashboard.js`, `deliveries.js`, `analytics.js`, `stock.js`, `stockOrders.js`, `stockLoss.js`, `settings.js`, `intake.js`) now import and use status constants instead of string literals.
- **`settings.js`** — fixed shallow config copy bug: `{ ...DEFAULTS }` → `structuredClone(DEFAULTS)`. Previously, nested object mutations (e.g., `storefrontCategories.permanent`) could leak across requests.

---

## 2026-03-20 — Florist Display Restructure + Stock Shortfall Warnings

### Backend
- `GET /api/orders` — new `activeOnly` query param: returns all non-terminal orders (excludes Delivered/Picked Up/Cancelled), sorted by Required By ascending (earliest needed first)
- `GET /api/orders` — new `completedOnly` query param: returns terminal orders (Delivered/Picked Up/Cancelled), last 30 days by default, sorted by Required By descending
- `GET /api/stock/committed` — new endpoint: aggregates committed (deferred) quantities per stock item from future orders (Required By > today). Returns `{ stockId: { committed, orders } }`
- `POST /api/stock/:id/write-off` — removed `Math.min` cap: write-offs can now bring stock negative (intentional, signals demand gap for future orders)

### Florist App
- **Order list default view**: changed from date-filtered (today) to "Active" mode showing all non-terminal orders sorted by earliest needed. Calendar filter moved to "Completed" tab.
- **View mode toggle**: "Active" (default) vs "Completed" tabs. Active shows non-terminal orders. Completed shows last 30 days of terminal orders with optional date filter.
- **Status workflow**: added Accepted and In Preparation statuses with proper transitions, action buttons, styles, and translations (EN/RU)
- **Stock shortfall banner**: red warning banner on order list when any stock item has effective < 0 (current qty - committed from future orders)
- **Order card shortage indicators**: individual cards show red badges for flowers that have stock shortfalls
- **Stock panel**: shows committed quantities and effective stock per item. New "Shortfall" view filter with badge count. Supplier/price moved from collapsed row to expandable section for cleaner UI.
- **DatePicker**: calendar dropdown now uses portal rendering to prevent clipping by parent overflow containers
- **Flowers needed**: now computed from loaded orders instead of separate API calls

---

## Environment / Config Changes

| Date | File | Change | Go-Live Impact |
|------|------|--------|----------------|
| 2026-03-04 | `backend/.env` | Original production config — DO NOT EDIT | This IS the production config |
| 2026-03-04 | `backend/.env.dev` | Created — points to Blossom Dev base | Delete or ignore at go-live |
| 2026-03-04 | `backend/package.json` | `dev` script uses `--env-file=.env.dev` | Change to `--env-file=.env` or remove flag at go-live |
| 2026-03-04 | `backend/src/index.js` | Removed `import 'dotenv/config'` (replaced by `--env-file`) | No change needed — same flag works with `.env` |
| 2026-03-04 | `.gitignore` | Changed to `.env.*` glob pattern | Keep |
| 2026-03-04 | `scripts/seed-stock.js` | Removed `import 'dotenv/config'`, now uses `--env-file` | Run with `--env-file=.env` for production |
| 2026-03-08 | `apps/*/vercel.json` | Railway backend URL in Vercel rewrite configs | Set correct production Railway URL |
| 2026-03-09 | `backend/.env.dev` | Added `PIN_DRIVER_TIMUR`, `PIN_DRIVER_NIKITA`, `PIN_DRIVER_DMITRI` | Add per-driver PINs in production |
| 2026-03-11 | `backend/.env.dev` | Added `AIRTABLE_PRODUCT_CONFIG_TABLE`, `AIRTABLE_SYNC_LOG_TABLE`, `WIX_API_KEY`, `WIX_SITE_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID` | Add all Wix/Telegram env vars in production |
| 2026-03-12 | `backend/.env.dev` | Added `AIRTABLE_STOCK_ORDERS_TABLE`, `AIRTABLE_STOCK_ORDER_LINES_TABLE` | Add PO table IDs in production |

---

## Stock Visibility Overhaul (2026-04-13)

**6-part feature drop** improving stock supply chain visibility:
1. **Trace improvements**: delivery date + clickable order entries in stock trace (both apps)
2. **PO overview table** ("Pending Arrivals"): ordered vs committed flowers above stock table (both apps)
3. **PO substitution Phase B**: impacted orders during evaluation + reconciliation screen + swap endpoint + SSE notifications
4. **Waste log edit/delete**: PATCH + DELETE endpoints with stock restoration, inline UI in dashboard settings
5. **Stock reconciliation tool**: detect mismatches, let owner fix in bulk (dashboard)
6. **Translations**: all new keys in EN + RU for both apps

New endpoints: `PATCH/DELETE /stock-loss/:id`, `POST /orders/:id/swap-bouquet-line`, `GET /stock/reconciliation`, `POST /stock/reconciliation/apply`
New files: `PendingArrivalsSection.jsx` (both apps), `ReconciliationSection.jsx` (dashboard), `SubstituteReconciliationPage.jsx` (florist)
No schema changes — all existing Airtable fields.

---

## Code Changes Affecting Go-Live

| Date | File | Change | Go-Live Impact |
|------|------|--------|----------------|
| 2026-03-04 | `backend/src/services/airtable.js` | Added `typecast: true` to create/update | Keep — helps with new select values |
| 2026-03-04 | `apps/florist/src/components/steps/Step2Bouquet.jsx` | Stock oversell prevention | Keep |
| 2026-03-04 | `apps/florist/src/components/steps/Step3Details.jsx` | Payment method hidden when Unpaid | Keep |
| 2026-03-04 | `apps/florist/src/components/OrderDetailSheet.jsx` | New: order detail bottom sheet | Keep |
| 2026-03-04 | `apps/florist/src/pages/OrderListPage.jsx` | Orders clickable → detail sheet | Keep |
| 2026-03-05 | `backend/src/routes/orders.js` | Status transition validation + stock rollback on cancel | Keep |
| 2026-03-05 | `apps/florist/src/components/OrderDetailSheet.jsx` | Only show allowed next statuses, added "Picked Up" | Keep |
| 2026-03-05 | `backend/src/routes/orders.js` | Fixed field name `Assigned Delivery` → `Deliveries` (matches actual Airtable field) | Keep — same field name in production |
| 2026-03-20 | `backend/src/routes/orders.js` | Added `forDate` query param: unified OR filter on Order Date + Required By. Uses DATESTR() for timezone-safe matching. | Keep — fixes cross-app data consistency |
| 2026-03-20 | `apps/florist/src/pages/OrderListPage.jsx` | Florist now uses `forDate` to show orders placed on OR due on selected date, matching dashboard view | Keep |

---

## Development Log

### 2026-03-06

**Phase 3 — Delivery App + Phase 6 — Owner Dashboard**
- Delivery app: driver task board with self-assign model, map view, per-driver PINs (`48ea4c0`)
- Owner dashboard: day-to-day operations tab, new order tab, cross-app testing (`4d54192`)
- Shared delivery board — drivers self-assign on completion, not pre-assigned (`20ce237`)

### 2026-03-08

**Phase 7 — Financial KPIs + Phase 8 — SSE Notifications + Deployment**
- Phase 7: financial dashboard with RFM scoring, margin visibility, benchmarks (`45d03b9`, `55a378f`)
- Phase 8: SSE real-time notifications for Wix orders, florist + dashboard (`e7437f1`)
- Deployment: Vercel configs for frontends, Railway for backend (`952d242`)
- Dashboard intelligence: actionable metrics, best sellers, payment collection (`3db5fa7`)
- Customer tab: search, filters, clear button, acquisition source pills (`4618b5f`, `7c4f584`, `f53d126`)
- Security hardening: input sanitization, rate limiting, CORS (`40b8bba`, `11dea52`)
- Branding: Blossom logo icons, web app manifests (`edf276e`)

### 2026-03-09

**Phase 5 — Translation + Phase 9 — Polish + Audit V3 + Settings Tab**
- Phase 5: auto-translate order notes to Russian via Claude Haiku (`24fe060`)
- Phase 9: retry on error, README, error toasts, loading states (`c1f6421`)
- Audit V3 (6 phases): stock safety alerts, webhook logging, delivery results, driver-of-day, unpaid drill-down, flower pairings, prep time tracking, marketing spend, supplier scorecard, stock loss tracking, bulk order operations, skeleton loading, KPI tooltips (`0553b9f`, `4fed3f6`, `c1f49e6`, `2aa5859`, `affdd06`)
- Settings tab: centralized config, delivery fee, driver management, waste reasons (`8d7b488`, `125420d`)
- Bilingual UI (EN/RU): Proxy-based translations across all 3 apps (`d1ac8e6`, `e8c737a`)
- SSE expanded: notifications for all order events across all apps (`b5f1e23`)
- Backup driver PIN with daily name override (`87b0511`)
- Smart order intake: AI text parsing + expandable FAB (`98fd522`)
- Florist improvements: bouquet summary on cards, status-priority sort, order detail with customer info (`13c6dd6`, `ac10c14`, `5760ffd`)
- Security: role-based login restriction, webhook auth middleware (`debc525`, `2727ca1`)

### 2026-03-10

**Go-live prep**
- Removed translation feature (not needed for go-live) (`c04a8b8`)
- Comprehensive florist app tutorial — 30 bilingual Q&As (`4b40075`)

### 2026-03-11

**Wix Storefront Integration (Phases A+B)**
- Phase A1+A2: public API endpoints for Wix storefront (`550d3a1`)
- Phase A3: Wix ↔ Airtable bidirectional product sync (`d64c96a`)
- Phase A4+A5: Telegram alerts, oversell detection, sync failure alerts (`3f6f1a5`)
- Phase B1-B3: Products tab in dashboard — sync, review queue, suggested prices (`9c4fbdd`)
- Phase B4+B5: storefront category manager + delivery zones in Settings (`8b55b89`)
- Wix Available Today section in dashboard Today tab with variant size pills (`c3284e5`, `5151499`)
- Owner-only features in florist app: revenue card, margins, stock alerts, day summary (`4780b7a`)
- Settings config persisted to Airtable — survives server restarts (`3d25ea2`)
- Products tab fixes: category pills, key flower dropdown, available today filter (`08708c7`, `c927567`, `b339843`)

### 2026-03-12

**Negative Stock + Purchase Order System + Stock Improvements**
- Full PO system: negative stock allowed, PO CRUD, driver shopping, florist evaluation, SSE lifecycle events (`a4da7a0`)
- PO system hardening: 2 bugs, 6 HIGH, 13 MEDIUM issues fixed (double-evaluate guard, formula injection, batch logic, N+1 calls, role auth, status transitions) (`a4da7a0`)
- Deferred stock: per-line toggle for future orders — "use current stock" vs "order new" demand signal (`a4da7a0`)
- Lot size on stock items: driver sees "2 packs × 25" format (`a4da7a0`)
- Batch tracking: new stock record when qty > 0, reuse when qty ≤ 0 (`108b060`)
- Dashboard: sorting improvements, auto-refresh across tabs (`108b060`)
- Smart refresh: silent polling without UI disruption (`66d70e6`, `0eff88f`)
- Order IDs visible, unpaid payment banners, florist auto-refresh (`029a4f9`)
- Waste tracking redesign: supplier-grouped log + financial scorecard (`9b7a8a6`, `d645bc3`)
- Reorder threshold synced across all batches of same flower (`90a970f`)
- Florist: 5 UI improvements, card message display, European date format for batch labels (`58ce496`, `5a0e431`, `615b5b9`)
- Various fixes: depleted batch visibility, card message truncation, delivery/pickup date display (`c3698d5`, `df57145`, `1e977c4`)

### 2026-03-13

**PO System Polish + Order Form Alignment**
- Dashboard order form aligned with florist: time slot pills + payload fix (`baf4761`)
- Flowers needed section moved to bottom of Today tab + height capped (`818b64a`, `0ac41b5`)
- PO form: searchable stock dropdown for adding lines (`149ad93`)
- Shopping support page + role-based florist navigation (`2e3535a`)
- Stock Orders + Stock Order Lines Airtable setup CSVs added (`65e33d9`)
- Fixes: review step shows date/time/card text for both Pickup and Delivery (`896a0d8`)
- Fixes: removed Delivery Time from order record (field only on Deliveries table) (`58658de`)
- Fixes: removed Stock Deferred field write (not yet created in Airtable) (`25a00f2`)
- Fixes: PO dropdown overflow, negative stock query destructuring order (`0ac41b5`, `b7010d1`)

### 2026-03-14

**PO Owner Feedback — Blocks A-D**
- Block A: Kanban cards show bouquet/address/time/driver, orders bubble counts by Required By date, driver-of-day auto-assigns unassigned deliveries, alt field labels clarified (EN+RU), PO creation bugs fixed (`934dd5a`)
- Block B: Add unlisted flowers to bouquet builder (creates stock record with optional supplier/cost/sell/lot), edit bouquet after order creation with return-to-stock or write-off choice, auto-revert Ready→In Preparation on owner edit (`38f894e`)
- Block C: Driver PO UX overhaul (bigger buttons, always visible, status switchable), live SSE sync between owner and driver, new Reviewing status (Shopping→Reviewing→Evaluating), owner approve-review step, florist evaluation shows cost price/qty needed/alt flower names (`4c8af85`)
- Block D: Florist app dark mode — system preference + manual toggle, iOS-style dark palette, ThemeContext with localStorage persistence (`259c67f`)

### 2026-03-17

**Available Today + Product Descriptions + Wix Push Fixes**
- Available Today infrastructure: cutoff config (18:00 default), smart time slots in order forms, Telegram reminder at cutoff (`60f77ce`, `51c4cea`)
- Available Today category: requires explicit Category assignment + lead time 0 + stock check for Wix push (`c18b5cc`)
- Product descriptions: pull from Wix (HTML→plain text), edit in dashboard, translate to 4 languages via Claude Haiku, push to Wix (plain text→HTML) (`d98e7cd`, `fb02012`, `2f0f3d0`)
- ProductDescriptionEditor component: inline description editing with language tabs (EN/PL/RU/UK) matching category translation pattern (`d98e7cd`)
- Smart time slots: both dashboard + florist order forms gray out past delivery slots when date=today, auto-clear invalid selection on date change (`60f77ce`)
- Settings: Available Today cutoff time + slot lead time controls in Settings tab (`60f77ce`)
- Fix: Wix variant price push — endpoint changed from `/variants/{id}` to `/variants` with ID in body (`60f77ce`)
- Fix: Airtable Description/Translations fields must exist before read/write (`854cb2d`, `c09ad81`, `afdf501`)
- Wix setup: owner created "Available Today" category + page in Wix Editor
- Airtable: Description + Translations fields added to Product Config table

### 2026-03-18

**Bouquet Editing Overhaul + Batch Grouping + Translation Fixes**
- Kanban board fix: expand/collapse wasn't working due to truthy empty array (`173ae09`)
- Sell price auto-calc: entering cost price auto-fills sell using `targetMarkup` (×2.2) — dashboard OrderDetailPanel, dashboard Step2Bouquet, florist Step2Bouquet (`173ae09`)
- Bouquet edit UX: now matches new order wizard — per-line sell price × qty, running sell/cost totals with margin, +/− stepper buttons (`840b950`)
- Stock picker in bouquet edit: shows stock catalog immediately (no typing required) — dashboard shows cost/sell/qty, florist shows sell/qty only (`173ae09`)
- Batch grouping: negative stock in "Flowers Needed" section now grouped by `Purchase Name` (flower type), not by individual batch. "Tulip Red" + "Tulip Red (14.Mar.)" merge into one demand line (`173ae09`)
- Batch date tags: date suffixes like `(14.Mar.)` shown as subtle gray tags in stock pickers instead of embedded in flower name — all 4 bouquet builder views (`173ae09`)
- "Add flower" feature added to florist bouquet edit mode (was missing entirely) (`173ae09`)
- "Adjust PO" option: when removing flowers with negative stock, offers "Adjust purchase order" instead of "Write off" (`173ae09`)
- Double question fix: remove dialog and save dialog no longer both ask return/write-off for the same flowers (`840b950`)
- Missing translations: 8 keys added to dashboard + florist (EN+RU): editBouquet, addFlower, saveBouquet, bouquetUpdated, addToCart, returnOrWriteOff, adjustPO, notReceivedYet (`173ae09`)
- Backend logging: stock deduction during bouquet edits now logs to console for debugging (`840b950`)

### 2026-03-19

**Wave 2 — Shared Packages (partial)**
- Created `packages/shared/` monorepo workspace with `@flower-studio/shared` package
- Extracted `useOrderEditing` hook — shared bouquet editing state + business logic, used by both florist `OrderCard` and dashboard `OrderDetailPanel`. Eliminates ~200 lines of duplicated state management + save logic
- Extracted `parseBatchName` utility — replaces 4 inline copies across florist + dashboard
- Added new translation keys: `returnOrWriteOff`, `adjustPO`, `notReceivedYet`, `addNewFlower`, `addToCart`, `markup`, `deliveryMethod`, `deliveryMethodDriver/Taxi/Florist`, `taxiCost`
- Dashboard `OrderDetailPanel`: removed inline editing state (8 useState hooks), replaced with shared hook
- Florist `OrderCard`: removed inline editing state (7 useState hooks), replaced with shared hook
- Florist `OrderDetailPage`: replaced inline `parseBatchName` with shared import

---

## Go-Live Checklist

- [ ] Create all new Airtable tables in production (Webhook Log, Marketing Spend, Stock Loss Log, App Settings, Product Config, Sync Log, Stock Orders, Stock Order Lines)
- [x] **Stock Orders table** — all fields exist (Status, Created Date, Notes, Assigned Driver, Stock Order ID, Planned Date, Supplier Payments, Driver Payment, link: Order Lines)
- [x] **Stock Order Lines table** — all fields exist (Flower Name, Quantity Needed, Lot Size, Driver Status, Supplier, Cost Price, Sell Price, Notes, Quantity Found, Quantity Accepted, Write Off Qty, Eval Status, Price Needs Review, Alt Supplier, Alt Quantity Found, Alt Flower Name, Alt Cost, Farmer, links: Stock Orders, Stock Item)
- [ ] Add new fields to existing tables (Stock: Lot Size, Farmer; Order Lines: Stock Deferred)
- [ ] Apply all schema changes from "Schema Changes" table above to production base
- [ ] Set all new env vars in Railway (per-driver PINs, Wix API, Telegram, PO table IDs)
- [ ] Set correct Railway backend URL in all Vercel rewrite configs
- [ ] Grep codebase for `fld` — ensure no hardcoded field IDs
- [ ] Verify all Airtable select options exist in production (Source, Status, Payment, etc.)
- [ ] Switch backend to production env: `--env-file=.env` (or remove flag)
- [ ] Seed stock in production base (if not already there)
- [ ] Test one order end-to-end against production (delivery + pickup paths)
- [ ] Test PO lifecycle: Draft → Sent → Shopping → Evaluating → Complete
- [ ] Test deferred stock flow: future order → demand signal → PO
- [ ] Verify Telegram alerts reach owner
- [ ] Remove or archive `.env.dev`
