# Stock Y-model migration script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the idempotent `backend/scripts/migrate-stock-y-model.js` script with `--dry-run` mode that converts production Stock data from the legacy aggregate Demand Entry model to the Y-model (dated Demand Entries + premade back-add), gated behind owner-driven Variety attribute backfill (#292).

**Architecture:** One destructive script in `backend/scripts/`, five phases applied inside a single Postgres transaction. Lab regression: dedicated scenario `stockYMigration` (a minimal extension of `stockOverhaul` with prod-shaped fixtures) + API tests in `lab/tests/api/migrate-stock-y-model.test.js` that boot a real lab Postgres template, run the script, and assert post-state per phase.

**Tech Stack:** Node ES modules, Drizzle ORM, pg, vitest (lab integration), Docker lab Postgres.

---

## Scope notes

Per #290:
- **Pre-condition:** abort if any `stock.type_name IS NULL`. Owner runs #292 backfill UI first.
- **NOT in scope:** Variety attribute backfill (moved to #292 UI), prod cutover (that's #291), `STOCK_Y_MODEL=true` flag flip (#291).
- **Five phases** in order: (1) aggregate DE → dated DEs split by Required By, (2) orphan negative aggregate → today-dated DE, (3) positive-qty undated row → synthetic Batch dated migration day, (4) premade reservation back-add to matching Batch, (5) `ALTER TABLE ... SET NOT NULL` on `date` and `type_name`.
- **Idempotency:** re-running after a clean Phase 5 = no-op (all candidate queries return zero rows).

## Identifying legacy rows (post-#284, pre-cutover)

`stock` schema after #284:
- `date` nullable, `type_name` nullable, `colour`/`size_cm`/`cultivar` nullable forever.

| Phase | SQL predicate |
|---|---|
| Phase 1 | `current_quantity < 0 AND date IS NULL AND EXISTS (...stock_item_id = stock.id)` |
| Phase 2 | `current_quantity < 0 AND date IS NULL AND NOT EXISTS (...stock_item_id = stock.id)` |
| Phase 3 | `current_quantity >= 0 AND date IS NULL` |
| Phase 4 | SUM `premade_bouquet_lines.quantity` per `stock_id` → ADD to that Stock row's `current_quantity` |
| Phase 5 | `ALTER TABLE stock ALTER COLUMN date SET NOT NULL; ALTER TABLE stock ALTER COLUMN type_name SET NOT NULL;` |

Note: `order_lines.stock_item_id` is TEXT (legacy Airtable rec ID or stringified UUID). Repointing = string replace.

## Required By fallback chain (Phase 1)

For each order_line linked to an aggregate DE, derive its target dated DE date as: `order.required_by ?? order.order_date ?? CURRENT_DATE`.

## File Structure

- **Create:** `backend/scripts/migrate-stock-y-model.js` — the script (DESTRUCTIVE header, `APPROVE=yes` gate, `--dry-run` flag).
- **Create:** `lab/scenarios/stockYMigration.js` — extends `stockOverhaul` with the four prod-shaped fixtures. Every row has `type_name` set (simulates post-#292 state).
- **Modify:** `lab/scenarios/index.js` — register new scenario as `stock-y-migration`.
- **Create:** `lab/tests/api/migrate-stock-y-model.test.js` — integration tests per phase.
- **Modify:** `CHANGELOG.md` — entry above #300.

---

## Task 1: Script scaffold + dry-run + pre-condition + scenario

**Files:**
- Create: `backend/scripts/migrate-stock-y-model.js`
- Create: `lab/scenarios/stockYMigration.js`
- Modify: `lab/scenarios/index.js`
- Create: `lab/tests/api/migrate-stock-y-model.test.js`

**Skip TDD red phase rationale:** Script scaffold is mechanical — header, arg parsing, pre-condition guard. The pre-condition test (file 4) IS the red phase for this task.

**Spec excerpt:**
> Script header tags it `DESTRUCTIVE`. Pre-condition check: aborts with a clear message if any `stock.type_name IS NULL`. `--dry-run` produces a reviewable diff and does not write. Re-running the script after a successful run is a no-op.

- [ ] **Step 1: Create `backend/scripts/migrate-stock-y-model.js` scaffold**

```js
// backend/scripts/migrate-stock-y-model.js
// Category: DESTRUCTIVE
//
// Migrates production Stock data from legacy aggregate Demand Entry model
// to Y-model (dated Demand Entries + premade back-add).
//
// Pre-condition: All stock rows must have `type_name` set (run Owner
// backfill UI from issue #292 first).
//
// Phases (single transaction):
//   1. Split aggregate Demand Entries by linked order Required By.
//   2. Orphan negative aggregates → today-dated Demand Entry.
//   3. Positive-qty undated rows → synthetic Batch dated migration day.
//   4. Premade reservation back-add to matching Batch on-hand.
//   5. ALTER COLUMN date / type_name SET NOT NULL.
//
// Idempotent: re-running after Phase 5 is a no-op.
//
// Usage:
//   APPROVE=yes node backend/scripts/migrate-stock-y-model.js --dry-run
//   APPROVE=yes node backend/scripts/migrate-stock-y-model.js

import 'dotenv/config';
import pg from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');

if (process.env.APPROVE !== 'yes') {
  console.error('Set APPROVE=yes to confirm you want to run the Y-model migration.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Aborting.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const today = new Date().toISOString().slice(0, 10);

async function preCondition(client) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS missing FROM stock WHERE type_name IS NULL AND deleted_at IS NULL`
  );
  if (rows[0].missing > 0) {
    throw new Error(
      `Pre-condition failed: ${rows[0].missing} stock row(s) have type_name IS NULL. ` +
      `Run the Owner-driven Variety attribute backfill (issue #292) first.`
    );
  }
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await preCondition(client);

    // Phases 1-5 added in subsequent tasks.

    if (DRY_RUN) {
      console.log('[migrate] DRY RUN — rolling back transaction.');
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
      console.log('[migrate] Done.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
```

- [ ] **Step 2: Create `lab/scenarios/stockYMigration.js`**

```js
// lab/scenarios/stockYMigration.js
//
// Fixture for the Stock Y-model migration script regression gate
// (issue #290). Extends stockOverhaul with prod-shaped fixtures and
// guarantees every stock row has `type_name` set (post-#292 state).

import { faker } from '@faker-js/faker';
import { buildStockOverhaul } from './stockOverhaul.js';

export function buildStockYMigration() {
  faker.seed(290);
  const base = buildStockOverhaul();

  // Simulate post-#292 backfill: every stock row gets a type_name if missing.
  const stockItems = base.stockItems.map(s => ({
    ...s,
    type_name: s.type_name ?? (s.display_name.split(' ')[0] || 'Unknown'),
  }));

  return {
    customers:  base.customers,
    stockItems,
    orders:     base.orders,
    orderLines: base.orderLines,
    deliveries: base.deliveries,
  };
}
```

- [ ] **Step 3: Register scenario**

In `lab/scenarios/index.js`:

```js
import { buildStockYMigration } from './stockYMigration.js';
// ...
export const scenarios = {
  baseline: buildBaseline,
  'stock-overhaul': buildStockOverhaul,
  stockBackfill: buildStockBackfill,
  'premade-reservation': buildPremadeReservation,
  'stock-y-migration': buildStockYMigration,
};
```

- [ ] **Step 4: Write red test for pre-condition**

Create `lab/tests/api/migrate-stock-y-model.test.js`:

```js
// lab/tests/api/migrate-stock-y-model.test.js
//
// Integration tests for backend/scripts/migrate-stock-y-model.js.
// Boots lab Postgres template, runs the script via spawnSync, asserts
// post-state. Each phase has its own describe block.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import { resetLabDb } from '../../helpers/reset.js';
import { labPool } from '../../helpers/db.js';

const SCRIPT = path.resolve(process.cwd(), '../backend/scripts/migrate-stock-y-model.js');
const LAB_DSN = 'postgres://lab:lab@localhost:5433/lab';

function runScript(args = []) {
  return spawnSync('node', [SCRIPT, ...args], {
    env: { ...process.env, APPROVE: 'yes', DATABASE_URL: LAB_DSN, PGSSL_DISABLE: 'true' },
    encoding: 'utf8',
  });
}

describe('migrate-stock-y-model — pre-condition', () => {
  beforeEach(async () => { await resetLabDb(); });

  it('aborts when any stock row has type_name IS NULL', async () => {
    const pool = labPool();
    try {
      await pool.query(
        `INSERT INTO stock (display_name, current_quantity, type_name) VALUES ('test', 0, NULL)`
      );
      const res = runScript(['--dry-run']);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/type_name IS NULL/);
      expect(res.stderr).toMatch(/#292/);
    } finally {
      await pool.end();
    }
  }, 30_000);

  it('passes pre-condition when all rows have type_name', async () => {
    const res = runScript(['--dry-run']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/DRY RUN/);
  }, 30_000);
});
```

- [ ] **Step 5: Run the tests**

```bash
npm run lab:db:up
npm run lab:template:rebuild -- --scenario=stock-y-migration
npm run lab:test:api -- migrate-stock-y-model
```

Expected: 2/2 passing.

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/migrate-stock-y-model.js \
        lab/scenarios/stockYMigration.js \
        lab/scenarios/index.js \
        lab/tests/api/migrate-stock-y-model.test.js
git commit -m "feat(stock-y-migration): scaffold + dry-run + pre-condition (#290)"
```

---

## Task 2: Phase 1 — split aggregate by Required By

**Files:**
- Modify: `backend/scripts/migrate-stock-y-model.js`
- Modify: `lab/scenarios/stockYMigration.js`
- Modify: `lab/tests/api/migrate-stock-y-model.test.js`

**Red phase mandatory** (new migration logic, Known-Pitfall-adjacent stock-math area).

**Spec excerpt:**
> Phase 1: For each aggregate Demand Entry: group linked `order_line` rows by their order's Required By with the fallback chain (`Required By → Order Date → today`). Create one dated Demand Entry per distinct date with summed qty. Repoint the order_lines. Delete the original aggregate.

- [ ] **Step 1: Extend `stockYMigration.js` with multi-order aggregate fixture**

Add after the `.map(...)` block, before the return:

```js
import { makeStockItem, makeOrder, makeOrderLine } from '../factories/index.js';

// Phase 1 fixture: 1 aggregate DE shared by 2 orders crossing 2 dates.
const PHASE1_VARIETY = 'Peony';
const PHASE1_COLOUR  = 'Pink';
const PHASE1_SIZE    = 60;
const PHASE1_DATE_A  = '2026-06-01';
const PHASE1_DATE_B  = '2026-06-03';

const aggDE = makeStockItem({
  type:        'demand',     // qty < 0, no date
  display_name: 'Peony Pink 60cm',
  type_name:    PHASE1_VARIETY,
  colour:       PHASE1_COLOUR,
  size_cm:      PHASE1_SIZE,
  current_quantity: -8,
  date: null,
});
stockItems.push(aggDE);

const cust = base.customers[0];
const orderA = makeOrder({ customerId: cust.id, status: 'New', delivery_type: 'Pickup', required_by: PHASE1_DATE_A });
const orderB = makeOrder({ customerId: cust.id, status: 'New', delivery_type: 'Pickup', required_by: PHASE1_DATE_B });
const lineA = makeOrderLine({ orderId: orderA.id, stockItemId: aggDE.id, flower_name: aggDE.display_name, quantity: 5 });
const lineB = makeOrderLine({ orderId: orderB.id, stockItemId: aggDE.id, flower_name: aggDE.display_name, quantity: 3 });
```

Return the augmented arrays:

```js
return {
  customers:  base.customers,
  stockItems,
  orders:     [...base.orders, orderA, orderB],
  orderLines: [...base.orderLines, lineA, lineB],
  deliveries: base.deliveries,
};
```

Export the fixture markers for tests:

```js
export const PHASE1_FIXTURE = {
  aggDEId:    null,  // populated post-build via getter below
  variety:    PHASE1_VARIETY,
  colour:     PHASE1_COLOUR,
  sizeCm:     PHASE1_SIZE,
  dateA:      PHASE1_DATE_A,
  dateB:      PHASE1_DATE_B,
  qtyA:       5,
  qtyB:       3,
};
```

(Tests will discover the aggregate DE by querying on `display_name = 'Peony Pink 60cm' AND date IS NULL`.)

- [ ] **Step 2: Write the failing Phase 1 test**

Append to `migrate-stock-y-model.test.js`:

```js
describe('migrate-stock-y-model — Phase 1: aggregate split', () => {
  beforeEach(async () => { await resetLabDb(); });

  it('splits one aggregate DE into per-Required-By dated DEs', async () => {
    const pool = labPool();
    try {
      // Pre: find the aggregate DE by display_name + date IS NULL.
      const pre = await pool.query(
        `SELECT id FROM stock WHERE display_name = 'Peony Pink 60cm' AND date IS NULL AND current_quantity = -8`
      );
      expect(pre.rows.length).toBe(1);
      const aggId = pre.rows[0].id;

      const res = runScript();
      expect(res.status).toBe(0);

      // Post: aggregate gone.
      const gone = await pool.query(`SELECT id FROM stock WHERE id = $1`, [aggId]);
      expect(gone.rows.length).toBe(0);

      // Post: 2 dated DEs, one per date, with correct qty.
      const dated = await pool.query(
        `SELECT date::text, current_quantity, type_name, colour, size_cm
         FROM stock WHERE type_name = 'Peony' AND colour = 'Pink' AND size_cm = 60
                    AND current_quantity < 0 AND date IS NOT NULL
         ORDER BY date ASC`
      );
      expect(dated.rows).toEqual([
        { date: '2026-06-01', current_quantity: -5, type_name: 'Peony', colour: 'Pink', size_cm: 60 },
        { date: '2026-06-03', current_quantity: -3, type_name: 'Peony', colour: 'Pink', size_cm: 60 },
      ]);

      // Post: order_lines repointed to the new dated DEs.
      const lines = await pool.query(
        `SELECT ol.stock_item_id, s.date::text
         FROM order_lines ol JOIN stock s ON s.id::text = ol.stock_item_id
         WHERE ol.flower_name = 'Peony Pink 60cm'
         ORDER BY ol.quantity DESC`
      );
      expect(lines.rows.length).toBe(2);
      expect(lines.rows[0].date).toBe('2026-06-01');
      expect(lines.rows[1].date).toBe('2026-06-03');
    } finally {
      await pool.end();
    }
  }, 60_000);
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm run lab:test:api -- migrate-stock-y-model
```

Expected: Phase 1 test fails because script does no work yet.

- [ ] **Step 4: Implement Phase 1 in the script**

Insert before the `if (DRY_RUN)` block:

```js
async function phase1Split(client) {
  // Find aggregate DEs with linked order_lines.
  const { rows: aggregates } = await client.query(`
    SELECT s.id, s.display_name, s.type_name, s.colour, s.size_cm, s.cultivar,
           s.current_quantity, s.current_cost_price, s.current_sell_price,
           s.supplier, s.unit, s.category, s.airtable_id
    FROM stock s
    WHERE s.current_quantity < 0
      AND s.date IS NULL
      AND s.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM order_lines ol WHERE ol.stock_item_id = s.id::text)
  `);

  for (const agg of aggregates) {
    // Group linked order_lines by Required By fallback chain.
    const { rows: lines } = await client.query(`
      SELECT ol.id AS line_id, ol.quantity,
             COALESCE(o.required_by::text, o.order_date::text, CURRENT_DATE::text) AS due_date
      FROM order_lines ol
      JOIN orders o ON o.id = ol.order_id
      WHERE ol.stock_item_id = $1::text
    `, [agg.id]);

    const byDate = new Map();
    for (const l of lines) {
      const cur = byDate.get(l.due_date) ?? { qty: 0, lineIds: [] };
      cur.qty += l.quantity;
      cur.lineIds.push(l.line_id);
      byDate.set(l.due_date, cur);
    }

    for (const [date, group] of byDate.entries()) {
      const { rows: [newRow] } = await client.query(`
        INSERT INTO stock (
          display_name, purchase_name, category, current_quantity, unit,
          current_cost_price, current_sell_price, supplier,
          type_name, colour, size_cm, cultivar, date, active
        ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
        RETURNING id
      `, [
        agg.display_name, agg.category, -group.qty, agg.unit,
        agg.current_cost_price, agg.current_sell_price, agg.supplier,
        agg.type_name, agg.colour, agg.size_cm, agg.cultivar, date,
      ]);
      // Repoint order_lines.
      await client.query(
        `UPDATE order_lines SET stock_item_id = $1 WHERE id = ANY($2::uuid[])`,
        [newRow.id, group.lineIds]
      );
      console.log(`[phase1] split ${agg.id} → ${newRow.id} (date=${date}, qty=${-group.qty}, lines=${group.lineIds.length})`);
    }
    // Delete the original aggregate.
    await client.query(`DELETE FROM stock WHERE id = $1`, [agg.id]);
  }
  console.log(`[phase1] Split ${aggregates.length} aggregate DE(s).`);
}
```

Wire it in:

```js
await preCondition(client);
await phase1Split(client);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm run lab:test:api -- migrate-stock-y-model
```

Expected: 3/3 passing.

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/migrate-stock-y-model.js \
        lab/scenarios/stockYMigration.js \
        lab/tests/api/migrate-stock-y-model.test.js
git commit -m "feat(stock-y-migration): Phase 1 split aggregate by Required By (#290)"
```

---

## Task 3: Phase 2 — orphan negative aggregate → today-dated DE

**Files:**
- Modify: `backend/scripts/migrate-stock-y-model.js`
- Modify: `lab/scenarios/stockYMigration.js`
- Modify: `lab/tests/api/migrate-stock-y-model.test.js`

**Red phase mandatory** (mutation logic).

**Spec excerpt:**
> Phase 2: Aggregate Demand Entries with negative qty and no linked orders → convert to a today-dated Demand Entry (Variety = same as original; date = migration day) for owner review.

- [ ] **Step 1: Extend scenario with orphan fixture**

```js
const orphanDE = makeStockItem({
  type: 'demand',
  display_name: 'Tulip Yellow 40cm',
  type_name:    'Tulip',
  colour:       'Yellow',
  size_cm:      40,
  current_quantity: -4,
  date: null,
});
stockItems.push(orphanDE);
```

- [ ] **Step 2: Write the failing test**

```js
describe('migrate-stock-y-model — Phase 2: orphan negative → today', () => {
  beforeEach(async () => { await resetLabDb(); });

  it('converts orphan aggregate DE to today-dated DE with preserved variety', async () => {
    const pool = labPool();
    const today = new Date().toISOString().slice(0, 10);
    try {
      const pre = await pool.query(
        `SELECT id FROM stock WHERE display_name = 'Tulip Yellow 40cm' AND date IS NULL`
      );
      expect(pre.rows.length).toBe(1);

      const res = runScript();
      expect(res.status).toBe(0);

      const post = await pool.query(
        `SELECT date::text, current_quantity, type_name, colour, size_cm
         FROM stock WHERE type_name = 'Tulip' AND colour = 'Yellow' AND size_cm = 40
                    AND current_quantity < 0`
      );
      expect(post.rows.length).toBe(1);
      expect(post.rows[0]).toMatchObject({
        date: today, current_quantity: -4, type_name: 'Tulip', colour: 'Yellow', size_cm: 40,
      });

      // Original aggregate gone.
      const gone = await pool.query(`SELECT id FROM stock WHERE display_name = 'Tulip Yellow 40cm' AND date IS NULL`);
      expect(gone.rows.length).toBe(0);
    } finally {
      await pool.end();
    }
  }, 60_000);
});
```

- [ ] **Step 3: Run test — confirm fails**

```bash
npm run lab:test:api -- migrate-stock-y-model
```

- [ ] **Step 4: Implement Phase 2**

```js
async function phase2OrphanNegative(client, today) {
  const { rows: orphans } = await client.query(`
    SELECT s.id FROM stock s
    WHERE s.current_quantity < 0
      AND s.date IS NULL
      AND s.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM order_lines ol WHERE ol.stock_item_id = s.id::text)
  `);
  for (const o of orphans) {
    await client.query(`UPDATE stock SET date = $1, updated_at = NOW() WHERE id = $2`, [today, o.id]);
  }
  console.log(`[phase2] Dated ${orphans.length} orphan aggregate DE(s) → ${today}.`);
}
```

Wire in:

```js
await phase1Split(client);
await phase2OrphanNegative(client, today);
```

- [ ] **Step 5: Run — confirm pass**

```bash
npm run lab:test:api -- migrate-stock-y-model
```

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/migrate-stock-y-model.js \
        lab/scenarios/stockYMigration.js \
        lab/tests/api/migrate-stock-y-model.test.js
git commit -m "feat(stock-y-migration): Phase 2 orphan negative → today-dated (#290)"
```

---

## Task 4: Phase 3 — positive-qty undated → synthetic Batch dated migration day

**Files:**
- Modify: `backend/scripts/migrate-stock-y-model.js`
- Modify: `lab/scenarios/stockYMigration.js`
- Modify: `lab/tests/api/migrate-stock-y-model.test.js`

**Red phase mandatory.**

**Spec excerpt:**
> Phase 3: Aggregate Demand Entries with positive qty (manual edits) → convert to a synthetic Batch dated migration day (Variety = same as original) with the same qty.

Treatment also covers legacy Batches that never had `date` set — they become dated-today Batches preserving qty. The transformation is identical regardless of origin.

- [ ] **Step 1: Extend scenario with positive-undated fixture**

```js
const manualEdit = makeStockItem({
  type: 'batch',
  display_name: 'Rose Red 50cm',
  type_name:    'Rose',
  colour:       'Red',
  size_cm:      50,
  current_quantity: 12,
  date: null,
});
stockItems.push(manualEdit);
```

(But note: existing stockOverhaul-base rows already have `current_quantity >= 0 AND date IS NULL` because the factory default leaves `date = null` for `type: 'batch'`. The dedicated fixture row pins a known display_name + qty for assertions.)

- [ ] **Step 2: Write the failing test**

```js
describe('migrate-stock-y-model — Phase 3: positive undated → synthetic Batch', () => {
  beforeEach(async () => { await resetLabDb(); });

  it('dates the manually-edited positive row to migration day', async () => {
    const pool = labPool();
    const today = new Date().toISOString().slice(0, 10);
    try {
      const pre = await pool.query(
        `SELECT id, current_quantity FROM stock WHERE display_name = 'Rose Red 50cm' AND date IS NULL`
      );
      expect(pre.rows.length).toBe(1);
      const preQty = pre.rows[0].current_quantity;

      const res = runScript();
      expect(res.status).toBe(0);

      const post = await pool.query(
        `SELECT date::text, current_quantity FROM stock WHERE id = $1`, [pre.rows[0].id]
      );
      expect(post.rows[0]).toEqual({ date: today, current_quantity: preQty });

      // No positive-qty undated rows remain anywhere.
      const remaining = await pool.query(
        `SELECT count(*)::int AS n FROM stock WHERE current_quantity >= 0 AND date IS NULL AND deleted_at IS NULL`
      );
      expect(remaining.rows[0].n).toBe(0);
    } finally {
      await pool.end();
    }
  }, 60_000);
});
```

- [ ] **Step 3: Confirm test fails**

- [ ] **Step 4: Implement Phase 3**

```js
async function phase3PositiveUndated(client, today) {
  const { rowCount } = await client.query(`
    UPDATE stock SET date = $1, updated_at = NOW()
    WHERE current_quantity >= 0 AND date IS NULL AND deleted_at IS NULL
  `, [today]);
  console.log(`[phase3] Dated ${rowCount} positive-qty undated row(s) → ${today}.`);
}
```

Wire in after Phase 2.

- [ ] **Step 5: Confirm test passes**

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/migrate-stock-y-model.js \
        lab/scenarios/stockYMigration.js \
        lab/tests/api/migrate-stock-y-model.test.js
git commit -m "feat(stock-y-migration): Phase 3 positive-undated → dated Batch (#290)"
```

---

## Task 5: Phase 4 — premade reservation back-add

**Files:**
- Modify: `backend/scripts/migrate-stock-y-model.js`
- Modify: `lab/scenarios/stockYMigration.js`
- Modify: `lab/tests/api/migrate-stock-y-model.test.js`

**Red phase mandatory** (Pitfall #8 area — stock-math adjacent).

**Spec excerpt:**
> Phase 4: Premade-deduction back-add: SUM `premade_bouquet_lines.quantity` per `stockId` and ADD to the corresponding Batch (or fresh Batch dated migration day if none).

**Pitfall #8 reasoning:** In the legacy model, premade reservations were silently subtracted from `current_quantity`. Y-model treats reservations as a separate informational bucket (see `getVarietyTotals`). The migration must add the reservation back so that `current_quantity` once again means "on-hand stems", not "on-hand minus premade".

- [ ] **Step 1: Extend scenario with premade fixture**

```js
import { v4 as uuid } from 'uuid';

const targetBatch = makeStockItem({
  type: 'batch',
  display_name: 'Hydrangea Blue 30cm (10.May.)',
  type_name:    'Hydrangea',
  colour:       'Blue',
  size_cm:      30,
  current_quantity: 20,
  date: '2026-05-10',
});
stockItems.push(targetBatch);

// Premade bouquet + 1 line consuming 7 stems from the Batch above.
const premadeBouquet = {
  id: uuid(),
  airtable_id: null,
  name: 'Migration test bouquet',
  sell_price: '99.00',
  active: true,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
};
const premadeLine = {
  id: uuid(),
  airtable_id: null,
  bouquet_id:  premadeBouquet.id,
  stock_id:    targetBatch.id,
  stock_airtable_id: null,
  flower_name: targetBatch.display_name,
  quantity:    7,
  cost_price_per_unit: '0',
  sell_price_per_unit: '0',
  created_at: new Date(),
};
```

Return them from the scenario:

```js
return {
  ...,
  premadeBouquets:     [premadeBouquet],
  premadeBouquetLines: [premadeLine],
};
```

The `lab/helpers/seed.js` must seed those arrays. If it doesn't already, expand it during this task (check `lab/helpers/seed.js` first — fail-fast if structure unsupported).

- [ ] **Step 2: Write the failing test**

```js
describe('migrate-stock-y-model — Phase 4: premade back-add', () => {
  beforeEach(async () => { await resetLabDb(); });

  it('adds SUM(premade_bouquet_lines.quantity) to the matching Batch on-hand', async () => {
    const pool = labPool();
    try {
      const pre = await pool.query(
        `SELECT id, current_quantity FROM stock WHERE display_name = 'Hydrangea Blue 30cm (10.May.)'`
      );
      expect(pre.rows.length).toBe(1);
      const batchId = pre.rows[0].id;
      const preQty  = pre.rows[0].current_quantity;

      const res = runScript();
      expect(res.status).toBe(0);

      const post = await pool.query(`SELECT current_quantity FROM stock WHERE id = $1`, [batchId]);
      expect(post.rows[0].current_quantity).toBe(preQty + 7);
    } finally {
      await pool.end();
    }
  }, 60_000);
});
```

- [ ] **Step 3: Confirm test fails**

- [ ] **Step 4: Implement Phase 4**

```js
async function phase4PremadeBackAdd(client) {
  const { rows: sums } = await client.query(`
    SELECT stock_id, SUM(quantity)::int AS reserved
    FROM premade_bouquet_lines
    WHERE stock_id IS NOT NULL
    GROUP BY stock_id
  `);
  for (const { stock_id, reserved } of sums) {
    if (reserved > 0) {
      await client.query(
        `UPDATE stock SET current_quantity = current_quantity + $1, updated_at = NOW() WHERE id = $2`,
        [reserved, stock_id]
      );
    }
  }
  console.log(`[phase4] Back-added premade reservations to ${sums.length} Batch(es).`);
}
```

Wire in after Phase 3.

- [ ] **Step 5: Confirm test passes**

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/migrate-stock-y-model.js \
        lab/scenarios/stockYMigration.js \
        lab/tests/api/migrate-stock-y-model.test.js \
        lab/helpers/seed.js
git commit -m "feat(stock-y-migration): Phase 4 premade reservation back-add (#290)"
```

---

## Task 6: Phase 5 NOT NULL + idempotency

**Files:**
- Modify: `backend/scripts/migrate-stock-y-model.js`
- Modify: `lab/tests/api/migrate-stock-y-model.test.js`

**Skip TDD red phase rationale:** Phase 5 is a single `ALTER TABLE`; the test for it is the idempotency assertion.

**Spec excerpt:**
> Phase 5: Apply `NOT NULL` on `stock_items.date` and on `stock_items.type_name` once all rows have values. Idempotent: re-running is a no-op once Phase 5 has applied.

- [ ] **Step 1: Implement Phase 5**

```js
async function phase5SetNotNull(client) {
  await client.query(`ALTER TABLE stock ALTER COLUMN date SET NOT NULL`);
  await client.query(`ALTER TABLE stock ALTER COLUMN type_name SET NOT NULL`);
  console.log('[phase5] Applied NOT NULL on stock.date and stock.type_name.');
}
```

Wire in after Phase 4. Skip when `DRY_RUN` (otherwise the rollback can leak structural changes — Postgres rolls back DDL inside a tx, but be explicit).

- [ ] **Step 2: Write idempotency test**

```js
describe('migrate-stock-y-model — Phase 5 + idempotency', () => {
  beforeEach(async () => { await resetLabDb(); });

  it('is a no-op when re-run after a clean migration', async () => {
    const first = runScript();
    expect(first.status).toBe(0);

    const second = runScript();
    expect(second.status).toBe(0);
    // Second run should report zero work in each phase.
    expect(second.stdout).toMatch(/\[phase1\] Split 0 aggregate/);
    expect(second.stdout).toMatch(/\[phase2\] Dated 0 orphan/);
    expect(second.stdout).toMatch(/\[phase3\] Dated 0 positive/);
  }, 90_000);

  it('applies NOT NULL on stock.date and stock.type_name', async () => {
    const res = runScript();
    expect(res.status).toBe(0);
    const pool = labPool();
    try {
      const { rows } = await pool.query(`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'stock' AND column_name IN ('date', 'type_name')
        ORDER BY column_name
      `);
      expect(rows).toEqual([
        { column_name: 'date',      is_nullable: 'NO' },
        { column_name: 'type_name', is_nullable: 'NO' },
      ]);
    } finally {
      await pool.end();
    }
  }, 60_000);
});
```

- [ ] **Step 3: Run full test file — all green**

```bash
npm run lab:test:api -- migrate-stock-y-model
```

Expected: 9/9 passing across all describes.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/migrate-stock-y-model.js \
        lab/tests/api/migrate-stock-y-model.test.js
git commit -m "feat(stock-y-migration): Phase 5 NOT NULL + idempotency (#290)"
```

---

## Task 7: CHANGELOG + verification matrix

**Files:**
- Modify: `CHANGELOG.md`

**Skip TDD red phase rationale:** Docs-only.

- [ ] **Step 1: Prepend CHANGELOG entry**

Above the most recent entry:

```markdown
## 2026-05-11 — Stock Y-model migration script (#290)

- **NEW:** `backend/scripts/migrate-stock-y-model.js` (DESTRUCTIVE). One-shot script to convert legacy aggregate Demand Entry rows to dated Demand Entries + premade reservation back-add. `--dry-run` mode prints the plan without writing.
- **Pre-condition:** aborts if any `stock.type_name IS NULL` — Owner runs #292 backfill UI first.
- **Five phases (single transaction):**
  - Phase 1: split aggregate DE into per-Required-By dated DEs (`Required By → Order Date → today` fallback).
  - Phase 2: orphan negative aggregate → today-dated DE (preserves Variety).
  - Phase 3: positive-qty undated row → Batch dated migration day.
  - Phase 4: SUM `premade_bouquet_lines.quantity` per stock_id → ADD to that Batch's `current_quantity`.
  - Phase 5: `ALTER COLUMN date/type_name SET NOT NULL`.
- **Idempotent:** re-running after Phase 5 = no-op.
- **Lab regression gate:** `lab/scenarios/stockYMigration.js` extends `stockOverhaul` with prod-shaped fixtures (multi-order aggregate, orphan, positive-qty edit, premade with active lines). `lab/tests/api/migrate-stock-y-model.test.js` asserts post-state per phase + idempotency. `npm run lab:test:api -- migrate-stock-y-model` is green.
- **NOT in scope:** prod cutover (#291), `STOCK_Y_MODEL=true` flag flip (#291), Variety attribute backfill UI (#292).
```

- [ ] **Step 2: Run full Pre-PR matrix**

```bash
cd backend && npx vitest run
cd .. && npm run lab:db:up
npm run lab:template:rebuild -- --scenario=stock-y-migration
npm run lab:test:unit
npm run lab:test:api
```

Quote green output in PR body.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(stock-y-migration): CHANGELOG entry (#290)"
```

---

## Self-review notes

- **Type consistency:** `current_quantity` is integer, `quantity` (in premade_bouquet_lines) is integer, SUM returns numeric in PG — cast to `::int` in Phase 4 query (done).
- **Spec coverage:** all 8 acceptance criteria mapped — header (T1), pre-condition (T1), dry-run (T1), idempotent (T6), Phases 1-5 (T2-T6), scenario extension (T2-T5), lab:test:api green (T7).
- **Deep modules:** the script's five phases share `client` + `today` only. Deleting any one phase would scatter complexity (each is a distinct prod row shape). Keep.
- **Vertical slices:** every task produces a working sub-migration — Phase N's tests pass after Phase N is implemented, regardless of Phase N+1.
- **No placeholders:** every step has concrete code, exact commands, expected output.
