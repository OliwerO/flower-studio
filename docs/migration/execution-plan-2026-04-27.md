# Airtable → Postgres migration — execution plan

_Drafted: 2026-04-27 · Owner-approved: 2026-04-27 (Railway PG)_

## Context

The strategic shape is locked in `docs/migration/session-2026-04-17-consolidation.md`
(7 phases, Strangler Fig per entity, Postgres + Drizzle, no permanent dual-write).
That document is decided — this plan is the *executable* layer underneath it.

Where we are right now (verified against code on 2026-04-27):

- **Phase 0 (stabilize)**: substantially done. Tier 1 owner-feedback bugs marked
  `[x]` in `BACKLOG.md`. Wix webhook live in `backend/src/services/wix.js`.
- **Phase 2 (Dashboard CRM MVP)**: **done**. Customer Tab v2.0 shipped
  (`apps/dashboard/src/components/CustomersTab.jsx` + `CustomerDetailView.jsx`,
  florist mobile equivalent in `apps/florist/src/pages/CustomerListPage.jsx`).
  Filter logic centralised in `packages/shared/utils/customerFilters.js`.
- **Repo abstraction (the Strangler-Fig seam)**: only `customerRepo` exists
  (`backend/src/repos/customerRepo.js`, 338 lines). The README at
  `backend/src/repos/README.md` lists `orderRepo.js` and `stockRepo.js` as TODO.
  16 routes still call `db.list()/db.getById()` directly against `services/airtable.js`.
- **Frontend coupling**: clean. `grep` for `airtable`/`rec[A-Z]` across
  `apps/` returns nothing — IDs are treated as opaque strings via
  `packages/shared/api/client.js`. The migration is a backend-only swap.
- **Provider decision**: **Railway Postgres** (locked 2026-04-27). Same vendor
  as backend hosting; Claude introspects via `psql` with read-only role.

The next executable arc is **Phase 1 (DB infra) → Phase 2.5 (cross-cutting
primitives) → Phase 3 (Stock first cutover)**. After Phase 3 proves the
shadow-write pattern, Phases 4–7 are the same recipe applied per entity. This
plan covers 1 / 2.5 / 3 in detail and sketches 4–7.

## Dependency shape

```
Phase 1: DB infra            ──►  Phase 2.5: cross-cutting primitives
(provider, drizzle, schema,        (audit log, soft delete, Admin mode)
 backup, claude_ro)                            │
                                               ▼
Phase 3: Stock cutover       ──►  Phase 4: Orders + Lines + Deliveries
(shadow-write → parity →           (transactional createOrder, drop manual rollback)
 flip)                                         │
                                               ▼
Phase 5: Customer dedup      ──►  Phase 6: Config + misc
(Universe A + B merge)             (App Config, Florist Hours, logs)
                                               │
                                               ▼
                                  Phase 7: Retire Airtable
                                  (delete airtable.js, cancel sub)
```

Each entity migration follows the same shape:

```
write path:                    read path:
┌──────────┐                   ┌──────────┐
│  route   │                   │  route   │
└────┬─────┘                   └────┬─────┘
     ▼                              ▼
┌──────────┐                   ┌──────────┐
│ xxxRepo  │                   │ xxxRepo  │
└─┬───────┬┘                   └────┬─────┘
  │       │                         │
  ▼       ▼                         ▼
┌────┐ ┌────┐  shadow-write    ┌────────┐
│ PG │ │ AT │  for ~1 week     │ PG xor │  cutover toggle
└────┘ └────┘                  │   AT   │  per entity (env var)
                               └────────┘
```

---

## Phase 1 — DB infrastructure

Goal: stand up Postgres, define the schema, wire backups, give Claude
sessions a read-only role. **No entity migrated yet.**

### 1a. Provider — Railway Postgres _(decided)_

Vendor consolidation wins: backend already on Railway, Claude can introspect
via `psql` with the read-only role `claude_ro`. Cost ~$5–10/mo at our size.

### 1b. Project scaffolding

- `backend/package.json` — add `drizzle-orm`, `pg`, `drizzle-kit` (last in
  devDependencies). Keep `drizzle-orm` and `pg` in `dependencies` (runtime).
- `backend/drizzle.config.js` — points at `src/db/schema.js`, output to
  `src/db/migrations/`.
- `backend/src/db/index.js` — singleton `pg` Pool + Drizzle instance, both
  gated on `DATABASE_URL`. Export `db` (drizzle handle), `pool` (raw, for the
  occasional `LISTEN/NOTIFY` use we'll want later for SSE), and a
  `connectPostgres()` helper called from boot.
- `backend/src/db/schema.js` — Drizzle table definitions. Day 1 ships an empty
  `system_meta` tracking table; entities are added as their phase arrives.
- `backend/src/db/migrate.js` — standalone migration runner, invoked by
  `npm run db:migrate`.
- Boot sequence in `backend/src/index.js`: validate Airtable schema (existing),
  then call `connectPostgres()`. Backend stays bootable without Postgres
  until Phase 3 cutover (no-op when `DATABASE_URL` unset).

### 1c. Backups + Claude access _(owner runs in Railway dashboard)_

- Add Postgres plugin in Railway dashboard → it auto-injects `DATABASE_URL`
  into the backend service.
- Secondary nightly `pg_dump` to S3 (or Dropbox via `rclone`) — implemented
  as a separate Railway cron service (one-shot container, not in-process).
  Vendor-independent per the locked-in decision.
- Read-only DB role `claude_ro`. Connection string lives in 1Password /
  Railway env, never in code. Claude sessions get this; writes always
  through the app per the consolidation-doc guardrail.

### 1d. What does NOT change in Phase 1

No route, no service, no repo file is modified. The Postgres pool exists but
nothing uses it yet. **Verifiable by `git log`: only `backend/{package.json,
src/db/*, drizzle.config.js}`, `backend/src/index.js` (gated connect call),
and `railway.toml` (DATABASE_URL note) should change.**

---

## Phase 2 .5 — Cross-cutting primitives (before any entity moves)

Goal: every entity migrated in Phases 3–6 inherits audit log, soft delete,
and the Admin-mode raw-edit panel for free. Building these per-entity later
is 3–5× the work.

### 2.5a. Audit log table

```
audit_log (
  id          uuid pk default gen_random_uuid(),
  entity_type text not null,
  entity_id   uuid not null,
  action      text not null,          -- 'create' | 'update' | 'delete' | 'restore'
  diff        jsonb not null,         -- { before: {...}, after: {...} }
  actor_role  text not null,          -- 'owner' | 'florist' | 'driver' | 'webhook'
  actor_pin_label text null,          -- which named PIN; never the PIN itself
  created_at  timestamptz default now()
)
```

`backend/src/db/audit.js` — `recordAudit({ entityType, entityId, action,
before, after, req })`. Repo writes call this in the same transaction as
the entity write. No background queue, no fire-and-forget — auditing is
part of the write, not an observer.

### 2.5b. Soft delete

- All entity tables get `deleted_at timestamptz null`.
- Repo `delete(id)` sets `deleted_at = now()` and writes audit; a separate
  `purge(id)` (owner-only, behind Admin mode) actually removes the row.
- Default queries auto-filter `deleted_at IS NULL`. Drizzle helper
  `whereActive(table)` returns `isNull(table.deletedAt)` — used in every
  repo list query.

### 2.5c. Admin-mode raw-edit panel

Dashboard-only, owner-only.

- Backend: `backend/src/routes/admin.js`, mounted at `/api/admin`, guarded
  by `authorize('admin')`. Endpoints: `GET /admin/:entity`,
  `GET /admin/:entity/:id`, `PATCH /admin/:entity/:id`,
  `POST /admin/:entity/:id/restore`, `DELETE /admin/:entity/:id/purge`.
- Frontend: `apps/dashboard/src/components/AdminTab.jsx` with a generic
  table renderer reading column metadata from `admin/entityRegistry.js`.
  Editable cells via existing `InlineEdit.jsx`. Confirmation modal on
  purge. Audit history sidebar driven by `entity_id`.

### 2.5d. What still works on Airtable in Phase 2.5

Every entity is still backed by Airtable. Audit log + soft delete + Admin
mode exist in Postgres but only point at Postgres rows. **The first entity
to populate the audit log is the first one cutover in Phase 3.** Until
then, audit log is empty, Admin tab shows zero rows. That's intended.

---

## Phase 3 — Stock cutover (the proof-of-concept)

Stock is the right first entity for three reasons:

1. Smallest blast radius — fewer cross-entity cascades than orders.
2. Highest rate-limit pain — `atomicStockAdjust`
   (`backend/src/services/airtable.js:107`) serialises via `stockQueue`
   because Airtable can't do `UPDATE ... SET qty = qty + $1` atomically.
   Postgres can. This is the first place the migration *visibly improves
   correctness*, not just storage.
3. Fewest fields — Stock has ~14 columns
   (`airtableSchema.js:45-50`). Mapping is trivial.

### 3a. Build `stockRepo.js`

Mirror the `customerRepo.js` shape: `list / getById / create / update /
adjustQuantity / softDelete`. For the cutover window each method has two
implementations behind one flag — `STOCK_BACKEND=airtable | shadow | postgres`:

- `airtable`: today's behaviour, untouched.
- `shadow`: writes BOTH stores in the same logical operation; reads from
  Airtable (the trusted store); on every read, asynchronously diffs PG
  vs Airtable and logs mismatches to a new `parity_log` table. PG-write
  failure logs but does not fail the request.
- `postgres`: writes to Postgres only; Airtable becomes read-only legacy.

### 3b. Wire `stockRepo` into existing routes

`db.list(TABLES.STOCK, ...)` calls in `backend/src/routes/stock.js` (17
references), `routes/dashboard.js` (4), `services/orderService.js`
(`autoMatchStock` helper at line 32), and `services/wixProductSync.js`
all become `stockRepo.list(...)`. Same pattern as the customers swap that
already happened in `routes/customers.js`.

The serialised stock queue (`services/airtable.js:11`) becomes unnecessary
in Postgres mode — `UPDATE stock SET current_quantity = current_quantity
+ $1 WHERE id = $2 RETURNING current_quantity` is atomic at the row level.
Keep `stockQueue` only on the Airtable branch of `adjustQuantity` so we
don't break the legacy path during shadow.

### 3c. Shadow-write parity verification

- Run `STOCK_BACKEND=shadow` for ~1 week.
- New endpoint `GET /api/admin/parity/stock` → mismatch counts from
  `parity_log`, drillable to records.
- Cutover criterion: 0 unexplained mismatches across a full Saturday
  (highest write volume — receiving + bouquet composition + Wix orders).
- One-shot backfill `backend/scripts/backfill-stock.js`: reads every active
  Airtable Stock row, inserts into Postgres preserving traceability
  (`airtable_id` column holds `recXYZ`; PG primary key is fresh UUID).
  Run before flipping `STOCK_BACKEND=shadow`.

### 3d. Flip to `postgres`

- Set env var, redeploy. Airtable Stock table now read-only legacy.
- Startup check that warns if `STOCK_BACKEND=postgres` AND any code path
  still calls `db.update(TABLES.STOCK, ...)` directly — fail-fast.
- Wix product sync still pushes to Wix as before, sources from PG. Sync
  log stays in Airtable for now — Phase 6 concern.

### 3e. What "done" looks like

- Owner sees no behavioural difference in dashboard Stock tab.
- `atomicStockAdjust` replaced. The 538-line rollback in `orderService.js`
  is *still there* (orders haven't moved), but its stock leg becomes
  transactional.
- Audit log starts populating. Admin tab can list/edit/restore/purge stock.

---

## Phases 4–7 — sketch

Each follows the Phase 3 recipe (build repo, shadow, backfill, cutover).
Specifics that distinguish each phase:

- **Phase 4 — Orders + Order Lines + Deliveries**. Biggest win: replace
  the manual rollback in `services/orderService.js:73-296` with a single
  Postgres transaction wrapping order + lines + delivery + stock
  adjustments. `cancelWithStockReturn`, `deleteOrder`, `editBouquetLines`
  collapse considerably. Cascades (order ↔ delivery status) become
  single-transaction updates. Wix webhook (`services/wix.js`) is the
  riskiest consumer — must be tested against a recorded webhook payload
  before flip (BACKLOG `WIX-BACKLINK`).
- **Phase 5 — Customer dedup + cutover**. Universe A
  (`Clients (B2C)` / `LEGACY_ORDERS`) imported as read-only reference rows
  first; Universe B already lives in `App Orders` linked to the same
  `Clients (B2C)` table via the `App Orders` linked field. Build assisted
  dedup tool — auto-merge high-confidence pairs (exact phone OR exact
  email), owner-review for ambiguous (similar nickname, no phone).
  `customerRepo` swaps backing store; the merged-timeline join in
  `customerRepo.listOrders` becomes a single SQL query.
- **Phase 6 — Config + misc**. `App Config`, `Florist Hours`,
  `Marketing Spend`, `Stock Loss Log`, `Webhook Log`, `Sync Log`,
  `Product Config`. Each gets a thin repo + Admin entry. No shadow needed
  for write-only log tables — just stop writing to Airtable on a date.
- **Phase 7 — Retire**. Delete `services/airtable.js`,
  `services/airtableSchema.js`, `config/airtable.js`. Cancel Airtable
  subscription. Take final snapshot. Replace `EXPECTED_WRITE_FIELDS`
  startup check with PG schema introspection.

---

## Critical files to touch (chronological)

| Phase | Files added | Files modified |
|---|---|---|
| 1 | `backend/src/db/{index.js,schema.js,migrate.js,migrations/}`, `backend/drizzle.config.js` | `backend/package.json`, `backend/src/index.js`, `railway.toml` |
| 2.5 | `backend/src/db/audit.js`, `backend/src/routes/admin.js`, `apps/dashboard/src/components/AdminTab.jsx`, `apps/dashboard/src/components/admin/entityRegistry.js` | `backend/src/index.js` (mount admin), `apps/dashboard/src/App.jsx` (route + nav) |
| 3 | `backend/src/repos/stockRepo.js`, `backend/src/__tests__/stockRepo.test.js`, `backend/scripts/backfill-stock.js` | every route in §3b above |

Existing files to reuse:

- `backend/src/repos/customerRepo.js` — copy alias / allowlist / cache
  shape into `stockRepo.js`.
- `backend/src/__tests__/customerRepo.test.js` — testing pattern.
- `backend/src/utils/fields.js` (`pickAllowed`) — same allowlist plumbing.
- `backend/src/middleware/auth.js` (`authorize(scope)`) — extend with
  `'admin'` scope rather than a new middleware.
- `apps/dashboard/src/components/InlineEdit.jsx` — drives editable cells
  in `AdminTab.jsx`.

## Verification

Each phase has an objective test, not just a code review.

- **Phase 1 done**: `npm run db:migrate` produces a Postgres schema;
  backend boots with and without `DATABASE_URL`; `pg_dump` lands in S3
  nightly; Claude session can `psql` as `claude_ro` and is denied on any
  `INSERT`.
- **Phase 2.5 done**: AdminTab loads (zero rows is fine); creating + editing
  + soft-deleting + purging a hand-inserted Postgres row writes 4
  `audit_log` entries with correct diffs and `actor_role`.
- **Phase 3 done**: shadow-write week ends with a Saturday containing >50
  stock writes and `parity_log` shows 0 unexplained mismatches; flip to
  `postgres`; receive a fresh delivery, deduct via a new order, return
  via cancel — all three reflected immediately in dashboard Stock tab and
  in `audit_log`; Wix `/api/products/push` still produces a clean diff
  against the Wix storefront.
- **Phase 7 done**: backend builds with `airtable` removed from
  `package.json`; no env var prefixed `AIRTABLE_*` remains in
  `railway.toml`; final Airtable snapshot stored alongside the last
  `pg_dump`.

## Out of scope for this plan

- **Universe A profiling** — schedule when Phase 4 is mid-flight.
- **Owner Airtable walkthrough** (Move 1 in consolidation doc) — separate
  observation exercise; not on the critical path now that Customer Tab
  v2.0 is shipped.
- **Wix storefront stock projection** (BACKLOG `WIX-STOCK-PROJECTION`) —
  cross-cuts Phase 3 but is its own product decision. Park until after
  the Postgres Stock cutover proves stable.
