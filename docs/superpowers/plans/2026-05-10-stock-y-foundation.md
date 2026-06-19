# Stock Y-model Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the no-behavior-change scaffolding that every subsequent Stock Y-model slice depends on: 5 new nullable columns on `stock`, a `STOCK_Y_MODEL` env flag exposed to the UI, factory support for Variety-shaped rows, three ADRs and the CONTEXT.md vocabulary update.

**Architecture:** Pure additive. SQL migration adds columns nullable so existing code paths keep working unchanged. Flag defaults to `false`, so even when reads/writes touch the new columns, no app-visible behavior changes. Production safety is the load-bearing constraint — every task ends green on `npm run harness`/`npm run test:e2e`.

**Tech Stack:** Postgres (Drizzle ORM), Node.js + Express, Vitest, pglite test harness, faker-based lab factories.

**Issue:** [#284](https://github.com/OliwerO/flower-studio/issues/284). Parent PRD: [#283](https://github.com/OliwerO/flower-studio/issues/283).

---

## File Structure

| Path | Status | Responsibility |
|------|--------|----------------|
| `CONTEXT.md` | modify (already drafted) | Adds Type/Colour/Size/Cultivar/Variety canonical terms; rewrites Stock Item, Batch, Demand Entry; adds Variety identity relationship |
| `docs/adr/0002-demand-entry-aggregate-model.md` | modify (already drafted) | Adds "Superseded by ADR-0005" banner |
| `docs/adr/0005-stock-y-model-dated-demand-entries.md` | create (already drafted) | Y-model: dated Demand Entries + premade reservation |
| `docs/adr/0006-variety-four-tuple-identity.md` | create (already drafted) | Variety = (Type, Colour?, Size?, Cultivar?) inline columns, strict identity |
| `docs/adr/0007-batch-decrement-model-retained.md` | create (already drafted) | Order-line consumption keeps Batch decrement; per-Batch trace via existing `/stock/:id/usage` |
| `backend/src/db/migrations/0012_stock_y_foundation.sql` | create | 5 new nullable columns on `stock` (`date`, `type_name`, `colour`, `size_cm`, `cultivar`) |
| `backend/src/db/schema.js` | modify | Add the 5 column definitions to the `stock` Drizzle table so reads/writes can address them by camelCase name |
| `backend/src/__tests__/stockYFoundation.integration.test.js` | create | Boots pglite, asserts the 5 columns exist on `stock`, are nullable, and accept a Variety-shaped insert + read-back |
| `backend/src/services/configService.js` | modify | Read `process.env.STOCK_Y_MODEL` once at module load; export `getStockYModelEnabled()` |
| `backend/src/routes/settings.js` | modify | Include `stockYModelEnabled` in the `GET /api/settings` payload |
| `backend/src/__tests__/configService.test.js` | modify | Add 2 tests: default-false when env unset; true when env=`'true'` |
| `lab/factories/stockItem.js` | modify | Accept optional `date`, `type_name`, `colour`, `size_cm`, `cultivar` overrides; default to `null` |
| `lab/factories/stockItem.test.js` | modify | Add 2 tests: legacy shape unchanged; Variety-shaped row carries the 4 attributes through |
| `CHANGELOG.md` | modify | New `## Stock Y-model — schema foundation (2026-05-10)` entry summarising the diff and flag |

**Why these files together:** the schema column add (Task 2) and the schema.js Drizzle definition (Task 2) must change in lockstep — pglite tests boot from the SQL files but every backend caller addresses columns via Drizzle. The flag wiring (Task 3) is its own vertical slice because it's the first piece any future Y-model PR will branch on. The factory update (Task 4) is independent from both.

---

## Task 1: Land CONTEXT.md vocabulary + three ADRs

**Files:**
- Modify: `CONTEXT.md` (already on disk, uncommitted)
- Modify: `docs/adr/0002-demand-entry-aggregate-model.md` (already on disk, uncommitted)
- Create: `docs/adr/0005-stock-y-model-dated-demand-entries.md` (already on disk, uncommitted)
- Create: `docs/adr/0006-variety-four-tuple-identity.md` (already on disk, uncommitted)
- Create: `docs/adr/0007-batch-decrement-model-retained.md` (already on disk, uncommitted)

These four ADRs and the CONTEXT.md edits already exist on disk from the 2026-05-09 grill-with-docs session. This task is the commit only — no further edits.

- [ ] **Step 1: Verify the diffs are exactly what was approved**

Run:
```bash
git diff CONTEXT.md docs/adr/0002-demand-entry-aggregate-model.md
git diff --stat docs/adr/
```

Expected: only the 5 paths listed above show changes (CONTEXT.md modified, ADR-0002 modified with banner, ADR-0005/0006/0007 untracked). No unrelated edits.

- [ ] **Step 2: Stage exactly those five paths**

```bash
git add CONTEXT.md \
  docs/adr/0002-demand-entry-aggregate-model.md \
  docs/adr/0005-stock-y-model-dated-demand-entries.md \
  docs/adr/0006-variety-four-tuple-identity.md \
  docs/adr/0007-batch-decrement-model-retained.md
```

Then `git status` and confirm only those five are staged.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(stock-y): land CONTEXT.md vocabulary + ADR-0005/0006/0007 (#284)

CONTEXT.md gains Type, Colour, Size, Cultivar, Variety as canonical
terms; rewrites Stock Item, Batch, Demand Entry; adds Variety identity
relationship.

ADR-0005 — Y-model dated Demand Entries + premade reservation. Supersedes
ADR-0002 (banner added in same commit).

ADR-0006 — Variety four-tuple identity. Type required; Colour/Size/Cultivar
nullable; strict NULL-aware equality; inline columns chosen over a
separate cultivar table.

ADR-0007 — Order-line consumption keeps the Batch decrement model;
per-Batch traceability comes from the existing /stock/:id/usage endpoint.

No code change. Foundation for #284 schema and flag work.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds, no hooks fail (this is docs-only).

---

## Task 2: Add 5 nullable columns to `stock` (SQL migration + Drizzle schema)

**Files:**
- Create: `backend/src/db/migrations/0012_stock_y_foundation.sql`
- Modify: `backend/src/db/schema.js` (extend the `stock` table block — currently lines 70–100)
- Create: `backend/src/__tests__/stockYFoundation.integration.test.js`

This is the load-bearing schema task. Red phase mandatory: the integration test must fail before the migration is added, prove the migration applies on pglite, prove all five columns are nullable, prove a Variety-shaped insert round-trips.

- [ ] **Step 1: Write the failing integration test**

Create `backend/src/__tests__/stockYFoundation.integration.test.js`:

```javascript
// Verifies the Stock Y-model schema foundation (issue #284).
//
// What we're proving:
//   • Migration 0012 adds five columns to `stock`: date, type_name,
//     colour, size_cm, cultivar.
//   • All five are nullable so existing inserts (which omit them)
//     keep working unchanged.
//   • A Variety-shaped insert round-trips: write all four attributes
//     + a date, read them back exactly as written.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import { stock } from '../db/schema.js';
import { eq } from 'drizzle-orm';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); });
afterEach(async () => { await teardownPgHarness(harness); });

describe('stock Y-model foundation columns (migration 0012)', () => {
  it('all five new columns exist on the `stock` table', async () => {
    const r = await harness.pg.exec(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'stock'
        AND column_name IN ('date', 'type_name', 'colour', 'size_cm', 'cultivar')
      ORDER BY column_name
    `);
    const rows = r[0].rows;
    expect(rows.map(x => x.column_name).sort()).toEqual(
      ['colour', 'cultivar', 'date', 'size_cm', 'type_name']
    );
    // Every new column is nullable in this foundation slice. The NOT NULL
    // constraints land later in #290 (date) and #292 (type_name).
    for (const r of rows) expect(r.is_nullable).toBe('YES');
  });

  it('a legacy-shaped insert (no Y-model fields) still works', async () => {
    const [row] = await harness.db.insert(stock).values({
      displayName: 'Pink Peonies (10.May.)',
      currentQuantity: 25,
    }).returning();
    expect(row.id).toBeTruthy();
    expect(row.typeName).toBeNull();
    expect(row.colour).toBeNull();
    expect(row.sizeCm).toBeNull();
    expect(row.cultivar).toBeNull();
    expect(row.date).toBeNull();
  });

  it('a Variety-shaped insert round-trips through Drizzle', async () => {
    const [row] = await harness.db.insert(stock).values({
      displayName: 'Pink Peony 60cm Sarah Bernhardt',
      currentQuantity: -10,
      typeName: 'Peony',
      colour: 'Pink',
      sizeCm: 60,
      cultivar: 'Sarah Bernhardt',
      date: '2026-05-12',
    }).returning();
    const [readback] = await harness.db.select().from(stock).where(eq(stock.id, row.id));
    expect(readback.typeName).toBe('Peony');
    expect(readback.colour).toBe('Pink');
    expect(readback.sizeCm).toBe(60);
    expect(readback.cultivar).toBe('Sarah Bernhardt');
    expect(readback.date).toBe('2026-05-12');
    expect(readback.currentQuantity).toBe(-10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/stockYFoundation.integration.test.js`

Expected: all three tests FAIL — `column_name` query returns 0 rows; the second/third tests fail at insert with `column "type_name" of relation "stock" does not exist` (or Drizzle reports the camelCase mapping doesn't exist yet).

- [ ] **Step 3: Write the SQL migration**

Create `backend/src/db/migrations/0012_stock_y_foundation.sql`:

```sql
-- Stock Y-model foundation (issue #284, ADR-0005/0006/0007).
--
-- Adds the five Variety-identity columns to `stock`. All nullable here so
-- existing inserts (legacy display-name-only shape) keep working unchanged.
-- NOT NULL is applied later — `date` in the cutover script (#290) after
-- backfill, `type_name` in the cutover script (#291) after #292's UI fills
-- every row. Colour, size_cm, and cultivar stay nullable forever per ADR-0006.

ALTER TABLE stock
  ADD COLUMN IF NOT EXISTS date      DATE,
  ADD COLUMN IF NOT EXISTS type_name TEXT,
  ADD COLUMN IF NOT EXISTS colour    TEXT,
  ADD COLUMN IF NOT EXISTS size_cm   INTEGER,
  ADD COLUMN IF NOT EXISTS cultivar  TEXT;

--> statement-breakpoint

-- Lookups by Variety identity (Type + Colour + Size + Cultivar). Used by
-- #287's allocation engine to find candidate Stock Items per Variety and
-- by #289's Variety collapse aggregation. NULLS NOT DISTINCT keeps two
-- "Pink Peony 60cm" rows with NULL cultivar from being treated as
-- different Varieties at index lookup time. The unique-per-(Variety,date)
-- constraint lands in #286.
CREATE INDEX IF NOT EXISTS stock_variety_idx
  ON stock (type_name, colour, size_cm, cultivar);

--> statement-breakpoint

-- Lookups by date (Stock list grouping by needed-by date in #289).
CREATE INDEX IF NOT EXISTS stock_date_idx
  ON stock (date) WHERE date IS NOT NULL;
```

- [ ] **Step 4: Extend the Drizzle schema**

Open `backend/src/db/schema.js`. Locate the `export const stock = pgTable('stock', { ... })` block (currently around lines 70–100). Add five fields immediately after `lastRestocked`, before `substituteFor`:

```javascript
  // ── Stock Y-model identity columns (issue #284, ADR-0006) ──
  // All nullable in the foundation slice so legacy inserts keep working.
  // type_name → NOT NULL applied at #291 cutover after #292 backfill.
  // date      → NOT NULL applied at #290 cutover after migration script.
  // colour, size_cm, cultivar stay nullable forever (ADR-0006).
  date:      date('date'),
  typeName:  text('type_name'),
  colour:    text('colour'),
  sizeCm:    integer('size_cm'),
  cultivar:  text('cultivar'),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/stockYFoundation.integration.test.js`

Expected: all three tests PASS. If the round-trip test fails because Drizzle returned `'2026-05-12T00:00:00.000Z'` instead of `'2026-05-12'`, the column type is wrong (use `date('date')`, not `timestamp`). Drizzle's `date` type emits ISO date strings like the assertion expects.

- [ ] **Step 6: Run the full backend test suite to confirm no regressions**

Run: `cd backend && npx vitest run`

Expected: every test green. If any pre-existing integration test now fails because pglite picked up the new columns, the failure is in the test fixture (it inserts a hand-rolled stock row without the new fields). Since the new fields are nullable, the only realistic failure is a Drizzle insert that uses `select * from stock` style typing — those should also stay green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/migrations/0012_stock_y_foundation.sql \
  backend/src/db/schema.js \
  backend/src/__tests__/stockYFoundation.integration.test.js

git commit -m "$(cat <<'EOF'
feat(stock-y): add Variety identity columns to stock (#284)

Five new nullable columns on `stock`:
  - date      DATE     — needed-by date for Demand Entries / arrival for Batches
  - type_name TEXT     — required after #291 cutover; nullable here
  - colour    TEXT     — nullable forever (ADR-0006)
  - size_cm   INTEGER  — nullable forever (ADR-0006)
  - cultivar  TEXT     — nullable forever (ADR-0006)

Two indexes:
  - stock_variety_idx (type_name, colour, size_cm, cultivar) — drives #287
    allocation engine + #289 Variety collapse aggregation.
  - stock_date_idx (date) WHERE date IS NOT NULL — drives needed-by-date
    grouping in #289.

No production behavior change — all existing reads/writes ignore the new
columns. Legacy inserts continue to work unchanged. NOT NULL is applied
later by #290 (date) and #291 (type_name).

Verified:
  - new integration test asserts columns exist + nullable + Variety-shaped
    insert round-trips via Drizzle.
  - full backend vitest suite green (no regressions in 60+ existing tests).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire `STOCK_Y_MODEL` env flag through to the UI

**Files:**
- Modify: `backend/src/services/configService.js`
- Modify: `backend/src/routes/settings.js`
- Modify: `backend/src/__tests__/configService.test.js`

The flag is read once at module-load time from `process.env.STOCK_Y_MODEL` (string `'true'` → boolean `true`, anything else → `false`). It's exposed by the existing `GET /api/settings` endpoint as a top-level `stockYModelEnabled` field — siblings of `config`, not inside it, because the flag is environment-derived not user-editable.

Red phase mandatory: configService is a known-pitfall area (it owns config bootstrapping for every consumer).

- [ ] **Step 1: Write the failing unit test**

Open `backend/src/__tests__/configService.test.js`. Add a new `describe` block at the bottom:

```javascript
describe('STOCK_Y_MODEL env flag (issue #284)', () => {
  // The flag is read once at module load. To test the env→exported-value
  // wiring we must vi.resetModules() and re-import after setting the env.

  it('defaults to false when STOCK_Y_MODEL is unset', async () => {
    vi.resetModules();
    delete process.env.STOCK_Y_MODEL;
    vi.doMock('../repos/appConfigRepo.js', () => ({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      nextOrderId: vi.fn().mockResolvedValue('test'),
    }));
    vi.doMock('../repos/productConfigRepo.js', () => ({ list: vi.fn().mockResolvedValue([]) }));
    vi.doMock('./telegram.js', () => ({ sendAlert: vi.fn() }));
    vi.doMock('../db/index.js', () => ({ db: {} }));
    vi.doMock('../db/audit.js', () => ({ recordAudit: vi.fn() }));

    const { getStockYModelEnabled } = await import('../services/configService.js');
    expect(getStockYModelEnabled()).toBe(false);
  });

  it('returns true only when STOCK_Y_MODEL=true (string)', async () => {
    vi.resetModules();
    process.env.STOCK_Y_MODEL = 'true';
    vi.doMock('../repos/appConfigRepo.js', () => ({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      nextOrderId: vi.fn().mockResolvedValue('test'),
    }));
    vi.doMock('../repos/productConfigRepo.js', () => ({ list: vi.fn().mockResolvedValue([]) }));
    vi.doMock('./telegram.js', () => ({ sendAlert: vi.fn() }));
    vi.doMock('../db/index.js', () => ({ db: {} }));
    vi.doMock('../db/audit.js', () => ({ recordAudit: vi.fn() }));

    const { getStockYModelEnabled } = await import('../services/configService.js');
    expect(getStockYModelEnabled()).toBe(true);
    delete process.env.STOCK_Y_MODEL;
  });

  it('returns false for any non-true string ("1", "yes", "TRUE")', async () => {
    for (const v of ['1', 'yes', 'TRUE', 'false', '']) {
      vi.resetModules();
      process.env.STOCK_Y_MODEL = v;
      vi.doMock('../repos/appConfigRepo.js', () => ({
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        nextOrderId: vi.fn().mockResolvedValue('test'),
      }));
      vi.doMock('../repos/productConfigRepo.js', () => ({ list: vi.fn().mockResolvedValue([]) }));
      vi.doMock('./telegram.js', () => ({ sendAlert: vi.fn() }));
      vi.doMock('../db/index.js', () => ({ db: {} }));
      vi.doMock('../db/audit.js', () => ({ recordAudit: vi.fn() }));

      const { getStockYModelEnabled } = await import('../services/configService.js');
      expect(getStockYModelEnabled()).toBe(false);
      delete process.env.STOCK_Y_MODEL;
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/configService.test.js -t "STOCK_Y_MODEL"`

Expected: all three tests FAIL with `getStockYModelEnabled is not a function` or `(intermediate value).getStockYModelEnabled is not a function`.

- [ ] **Step 3: Implement the flag in configService.js**

Open `backend/src/services/configService.js`. After the `let configLoaded = false;` line near the top, add:

```javascript
// ── STOCK_Y_MODEL feature flag (issue #284) ─────────────────
// Read once at module load. String 'true' → boolean true; anything
// else → false. Strict equality keeps "1", "yes", "TRUE" all false
// so a typo in Railway never silently turns the rollout on.
const STOCK_Y_MODEL_ENABLED = process.env.STOCK_Y_MODEL === 'true';
```

Then add a getter near the bottom of the file, alongside `getConfig` / `getAllConfig`:

```javascript
export function getStockYModelEnabled() {
  return STOCK_Y_MODEL_ENABLED;
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `cd backend && npx vitest run src/__tests__/configService.test.js`

Expected: all configService tests PASS, including the three new STOCK_Y_MODEL tests.

- [ ] **Step 5: Expose the flag through `GET /api/settings`**

Open `backend/src/routes/settings.js`. Update the import at the top:

```javascript
import {
  getConfig, getAllConfig, updateConfigBulk,
  getDriverOfDay, setDailyDriver, getDailyState,
  driverNames, autoClearIfNewDay,
  getStockYModelEnabled,
} from '../services/configService.js';
```

Update the `GET /` handler body so the response includes the flag:

```javascript
router.get('/', authorize('orders'), (req, res) => {
  autoClearIfNewDay();
  const backupName = getBackupDriverName();
  const daily = getDailyState();
  const config = getAllConfig();
  const resolvedDrivers = [...new Set([...driverNames, ...config.extraDrivers])]
    .map(name => name === 'Backup' && backupName ? backupName : name);
  res.json({
    driverOfDay:        daily.driverOfDay,
    backupDriverName:   backupName,
    drivers:            resolvedDrivers,
    pinDrivers:         driverNames,
    config,
    stockYModelEnabled: getStockYModelEnabled(),
  });
});
```

- [ ] **Step 6: Run the full backend test suite**

Run: `cd backend && npx vitest run`

Expected: every test green. The settings route doesn't have a dedicated test file, but `apps/florist` and `apps/dashboard` consume `/settings` via `cachedGet('/settings')` — adding a new field is additive and never breaks consumers.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/configService.js \
  backend/src/routes/settings.js \
  backend/src/__tests__/configService.test.js

git commit -m "$(cat <<'EOF'
feat(stock-y): add STOCK_Y_MODEL env flag exposed via /api/settings (#284)

Backend reads `process.env.STOCK_Y_MODEL` once at boot. Exact match
against the string `'true'` toggles the flag on; anything else
(unset, '1', 'yes', 'TRUE', 'false') leaves it off.

The flag rides on the existing GET /api/settings response as a
top-level `stockYModelEnabled` boolean — sibling of `config`, not
nested inside it, because the flag is environment-derived and not
user-editable.

Default in prod: false. The flag stays off for every deployment until
the cutover slice (#291) flips it. Subsequent slices (#285 premade
reservation, #286 dated Demand Entries, #287 allocation, #288 picker,
#289 Variety collapse) branch on this flag in their own PRs.

Verified: 3 new unit tests in configService.test.js — default-false,
env-true→true, non-true-string→false. Full backend vitest suite green.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Extend `lab/factories/stockItem.js` with Variety attribute overrides

**Files:**
- Modify: `lab/factories/stockItem.js`
- Modify: `lab/factories/stockItem.test.js`

The factory must produce both shapes — legacy (no Y fields) and Variety-shaped (caller passes any of the 5 new keys). Default behavior must not change so existing scenarios that don't pass Y keys keep their byte-for-byte same output.

Red phase mandatory: shared lab utility, deterministic-test contract.

- [ ] **Step 1: Write the failing factory tests**

Open `lab/factories/stockItem.test.js`. Add at the bottom:

```javascript
describe('Stock Y-model attribute overrides (issue #284)', () => {
  it('legacy call produces null for the Y-model fields by default', () => {
    const s = makeStockItem();
    expect(s.date).toBeNull();
    expect(s.type_name).toBeNull();
    expect(s.colour).toBeNull();
    expect(s.size_cm).toBeNull();
    expect(s.cultivar).toBeNull();
  });

  it('honours the four Variety overrides + date', () => {
    const s = makeStockItem({
      type_name: 'Peony',
      colour:    'Pink',
      size_cm:   60,
      cultivar:  'Sarah Bernhardt',
      date:      '2026-05-12',
    });
    expect(s.type_name).toBe('Peony');
    expect(s.colour).toBe('Pink');
    expect(s.size_cm).toBe(60);
    expect(s.cultivar).toBe('Sarah Bernhardt');
    expect(s.date).toBe('2026-05-12');
  });

  it('partial overrides leave the rest null', () => {
    const s = makeStockItem({ type_name: 'Eucalyptus' });
    expect(s.type_name).toBe('Eucalyptus');
    expect(s.colour).toBeNull();   // empty colour ≠ "Green" — strict identity (ADR-0006)
    expect(s.size_cm).toBeNull();
    expect(s.cultivar).toBeNull();
    expect(s.date).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd lab && ./node_modules/.bin/vitest run factories/stockItem.test.js`

Expected: all three new tests FAIL — the factory's returned row has no `date`/`type_name`/`colour`/`size_cm`/`cultivar` keys, so accessing them returns `undefined` (not `null`).

- [ ] **Step 3: Extend the factory**

Open `lab/factories/stockItem.js`. Replace the `return { ... }` block with the version below:

```javascript
  return {
    id: faker.string.uuid(),
    airtable_id: null,
    display_name,
    purchase_name: null,
    category: faker.helpers.arrayElement(['Flowers', 'Greenery', 'Filler', null]),
    current_quantity,
    unit: faker.helpers.arrayElement(['stem', 'bunch', null]),
    current_cost_price: Number(faker.commerce.price({ min: 3, max: 20 })),
    current_sell_price: Number(faker.commerce.price({ min: 8, max: 60 })),
    supplier: faker.helpers.arrayElement(['Ekipa', 'Hurt', 'Direct', null]),
    reorder_threshold: null,
    active: true,
    supplier_notes: null,
    dead_stems: 0,
    lot_size: null,
    farmer: null,
    last_restocked: null,
    substitute_for: null,
    // ── Stock Y-model identity columns (issue #284) ────────────
    // Default null so existing scenarios behave identically. Pass any
    // of these in `overrides` to produce a Variety-shaped row.
    date:      null,
    type_name: null,
    colour:    null,
    size_cm:   null,
    cultivar:  null,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    // Apply column-level overrides last, excluding already-handled keys.
    ...columnOverrides,
    // Ensure derived values are always correct even if columnOverrides re-set them.
    display_name,
    current_quantity,
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd lab && ./node_modules/.bin/vitest run factories/stockItem.test.js`

Expected: all 8 tests PASS (5 pre-existing + 3 new). The deterministic-seed test in particular must stay green — adding always-null fields after seeded random draws can't shift the seed.

- [ ] **Step 5: Run the broader lab unit suite**

Run: `npm run lab:test:unit`

Expected: every lab unit test green. If any peer factory's test compares `Object.keys(stockItem).length` it will break — there are five new keys. The fix in that case is to update the count assertion in the peer test. Pause and check before adjusting.

- [ ] **Step 6: Commit**

```bash
git add lab/factories/stockItem.js lab/factories/stockItem.test.js

git commit -m "$(cat <<'EOF'
feat(lab): stockItem factory accepts Y-model attribute overrides (#284)

Five new optional override keys mirror the schema columns added in
0012_stock_y_foundation.sql:
  - date, type_name, colour, size_cm, cultivar

Default for all five is null, so every existing lab scenario behaves
identically — the row produced is byte-for-byte the same as before
the override map is applied. Pass any of the keys to produce a
Variety-shaped row for tests that exercise the Y-model code paths
landing in #285 / #286 / #287 / #289.

Verified: 3 new factory tests (legacy default null, full Variety
override, partial override). Full lab unit suite green.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

A single new section at the top of the file in the same style as the 2026-05-09 entries. Records the schema diff, the env flag, and the docs landed under #284 so the next reader can reconstruct the rollout from the changelog alone.

- [ ] **Step 1: Add the entry**

Open `CHANGELOG.md`. Locate the line `Review this entire file before flipping to production.` followed by `---` (around line 4). Insert a new section immediately after the first `---`, before the existing `## Order Termination shared seam (2026-05-09)` heading:

```markdown
## Stock Y-model — schema foundation (2026-05-10)

First slice of PRD [#283](https://github.com/OliwerO/flower-studio/issues/283) (Stock Y-model). No production behavior change; lays the columns, flag, and vocabulary every subsequent slice depends on. Issue: [#284](https://github.com/OliwerO/flower-studio/issues/284).

### Schema diff

Migration `0012_stock_y_foundation.sql` adds five nullable columns to `stock`:

| Column | Type | Lifecycle |
|---|---|---|
| `date` | DATE | NOT NULL applied at #290 cutover after backfill |
| `type_name` | TEXT | NOT NULL applied at #291 cutover after #292 backfill UI |
| `colour` | TEXT | nullable forever (ADR-0006) |
| `size_cm` | INTEGER | nullable forever (ADR-0006) |
| `cultivar` | TEXT | nullable forever (ADR-0006) |

Plus two indexes: `stock_variety_idx (type_name, colour, size_cm, cultivar)` for #287 allocation lookups, `stock_date_idx (date) WHERE date IS NOT NULL` for #289 needed-by grouping.

### New env var

`STOCK_Y_MODEL` (default `false`). Strict equality against `'true'` — `1`/`yes`/`TRUE` are all rejected so a typo never silently flips the rollout on. Read once at backend boot; surfaced through `GET /api/settings` as `stockYModelEnabled`. Subsequent slices (#285 / #286 / #287 / #288 / #289) branch on this flag.

### Docs

- ADR-0005 — Y-model dated Demand Entries + premade reservation. Supersedes ADR-0002.
- ADR-0006 — Variety four-tuple identity (Type required; Colour/Size/Cultivar nullable; strict identity).
- ADR-0007 — Order-line consumption keeps Batch decrement; per-Batch trace via existing `/stock/:id/usage`.
- CONTEXT.md — Type, Colour, Size, Cultivar, Variety added; Stock Item / Batch / Demand Entry rewritten.

### Verification

- `backend/src/__tests__/stockYFoundation.integration.test.js` (new) — pglite asserts columns exist, are nullable, accept Variety-shaped insert.
- `backend/src/__tests__/configService.test.js` (extended) — env-flag default-false / env-true / non-true-string→false.
- `lab/factories/stockItem.test.js` (extended) — legacy shape unchanged + Variety overrides honoured.
- Full backend vitest, lab unit, lab API, and 25-section E2E suites green.
- All three Vite app builds succeed (no shared-package ripple).

### Go-live impact

None. Migration is pure-additive (`IF NOT EXISTS`); idempotent. `STOCK_Y_MODEL` defaults to `false`, so no code path branches into Y-model behavior in this PR. Setting `STOCK_Y_MODEL=true` in Railway before #285 ships is harmless — there are no Y-model code paths yet.

---

```

- [ ] **Step 2: Verify the entry parses cleanly**

```bash
head -50 CHANGELOG.md
```

Expected: the new section appears between the file header and the existing `## Order Termination shared seam (2026-05-09)` entry. No duplicated `---` separators, no malformed markdown.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md

git commit -m "$(cat <<'EOF'
docs(changelog): record Stock Y-model schema foundation (#284)

Single entry covering the migration, env flag, and ADRs landed under
#284. Notes the lifecycle of each new column (which slice flips the
NOT NULL constraint) and confirms zero production behavior change for
this PR.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Pre-PR verification matrix

**Files:** None — verification only.

Per CLAUDE.md § Pre-PR Verification, this slice touches `backend/`, `packages/shared/` (no — it doesn't, but `lab/` does), and `lab/`. Run the full applicable matrix and quote the green output in the PR body. Do not open the PR until every check below has produced green output.

- [ ] **Step 1: Backend vitest (unit + integration)**

Run: `cd backend && npx vitest run`

Expected: every test PASS. Quote the final summary line ("Test Files  N passed | Tests  N passed").

- [ ] **Step 2: Lab unit tests**

Run: `npm run lab:test:unit`

Expected: every test PASS.

- [ ] **Step 3: Lab API regression**

If you haven't booted lab Postgres in this session:
```bash
npm run lab:db:up
npm run lab:template:rebuild -- --scenario=baseline
```

Then:
```bash
npm run lab:test:api
```

Expected: every test PASS. The `cancel-with-return` regression gate is the canary — if it fails the schema change broke the factory contract.

- [ ] **Step 4: API E2E suite**

Boot the test backend in the background, run E2E, then stop it:

```bash
npm run harness &
HARNESS_PID=$!
sleep 3
npm run test:e2e
kill $HARNESS_PID
```

Expected: 25/25 sections PASS.

- [ ] **Step 5: Build all three Vite apps**

Run each in turn:
```bash
cd apps/florist && ./node_modules/.bin/vite build && cd -
cd apps/dashboard && ./node_modules/.bin/vite build && cd -
cd apps/delivery && ./node_modules/.bin/vite build && cd -
```

Expected: every build produces a `dist/` with no errors. Vercel runs each app in isolation, so building all three locally is the only way to catch shared-package import drift before push.

- [ ] **Step 6: Open the PR**

Push the branch:
```bash
git push -u origin feat/stock-y-foundation
```

Open with `gh pr create` (HEREDOC body), title `feat(stock-y): schema foundation + STOCK_Y_MODEL flag + factory + ADRs (#284)`. Body includes the quoted green output from steps 1–5 and `Closes #284` on its own line.

---

## Self-Review

**Spec coverage** (against issue #284 acceptance criteria):
- ☑ Migration applied locally + on lab harness; all five new columns present, all nullable → Task 2 step 5 + Task 6 steps 2–3.
- ☑ `STOCK_Y_MODEL` flag readable on backend, propagated to florist + dashboard configs → Task 3.
- ☑ ADR-0005, ADR-0006, ADR-0007 merged. ADR-0002 carries banner → Task 1.
- ☑ CONTEXT.md updated with Type / Colour / Size / Cultivar / Variety + rewritten Stock Item / Batch / Demand Entry → Task 1.
- ☑ `lab/factories/stockItem.js` supports new fields; `npm run lab:test:unit` green both shapes → Task 4 + Task 6 step 2.
- ☑ No production behavior change; existing E2E sections green → Task 6 step 4.
- ☑ `CHANGELOG.md` records schema diff and flag introduction → Task 5.

**Placeholder scan:** every code block above is a complete, runnable snippet. No `TODO`, no "implement appropriate handling", no "similar to Task N".

**Type / name consistency:**
- SQL columns `date`, `type_name`, `colour`, `size_cm`, `cultivar` ↔ Drizzle camelCase `date`, `typeName`, `colour`, `sizeCm`, `cultivar` ↔ factory snake_case `date`, `type_name`, `colour`, `size_cm`, `cultivar`. Each layer matches its own convention (raw SQL, Drizzle, raw row factories).
- Flag function `getStockYModelEnabled()` used in Task 3 step 3, Task 3 step 5, and the imports in Task 3 step 5. Spelling consistent.
- Index names `stock_variety_idx` and `stock_date_idx` referenced only in Task 2 step 3 (creation). Not assumed elsewhere.

No issues found — plan ready to execute.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-10-stock-y-foundation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh sonnet implementer per task, review between tasks, opus code-quality review at the phase boundary (after Task 5, before Task 6).
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
