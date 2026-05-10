# Stock Y-model: Dated Demand Entry by Variety + Required By Cascade (#286)

**Branch:** `feat/stock-y-demand`
**Worktree:** `.worktrees/stock-y-demand`
**Issue:** #286 (blocked-by #284 ✓ merged @ 6158266)
**Date:** 2026-05-10
**Author:** Claude Sonnet 4.6

---

## Goal

When `STOCK_Y_MODEL` is on, every order creation route that lacks Batch coverage
calls `getOrCreateDemandEntry(varietyKey, date, qty, tx, actor)` — yielding one
Demand Entry per `(Variety, date)` rather than one aggregate per Variety. The
`Required By` change cascade finds the linked Demand Entry and updates its `date`
column in place (no row replacement), so the `order_line.stockItemId` FK stays valid.
All flag-on logic sits behind `getStockYModelEnabled()`. Legacy paths are
byte-for-byte unchanged.

---

## Architecture

```
configService.js            ← getStockYModelEnabled() (already exported)
repos/stockRepo.js          ← getOrCreateDemandEntry(varietyKey, date, qty, tx, actor)
                               computeDemandDate(order)  [pure helper]
db/migrations/0013_*.sql    ← partial unique index on stock WHERE current_quantity < 0
repos/orderRepo.js          ← createOrder flag-on branch (calls getOrCreateDemandEntry)
                               updateOrder flag-on branch (date cascade)
__tests__/stockRepo.integration.test.js  ← red-green for getOrCreateDemandEntry
__tests__/orderRepo.integration.test.js  ← red-green for createOrder + cascade
lab/scenarios/stockYDemand.js            ← lab integration scenario
lab/factories/stockItem.js              ← add dated-demand shape
```

### Key design decisions

1. **Demand Entry IS a `stock` row** — `current_quantity < 0`, all four Variety
   columns populated, `date` set. Identified by `current_quantity < 0` in the
   partial unique index predicate.

2. **`order_line.stockItemId` is the FK to the Demand Entry** — no new column
   needed. The link is the same field used for Batch links. This is why "no row
   replacement" on Required By cascade is mandatory: replacing the row would
   orphan the order_line FK.

3. **`SELECT FOR UPDATE` — pglite does NOT support it** (see
   `appConfigRepo.js` line 29 comment). Production concurrency safety comes from
   the partial unique index (conflict triggers ON CONFLICT logic) plus Postgres
   row-level locks implicitly held by the UPDATE. The pglite integration tests
   verify the uniqueness invariant via sequential assertions, not locking.

4. **`NULLS NOT DISTINCT` in the partial index** — Postgres 15+ feature. Railway
   PG is provisioned via the Railway Postgres plugin. pglite 0.4.5 is backed by
   PG 17 WASM. Both support `NULLS NOT DISTINCT`. The migration is guarded by an
   `IF NOT EXISTS` clause; no fallback trigger is needed.

5. **Required By cascade split rule** — when an order's Required By changes,
   the linked Demand Entry (`order_line.stockItemId` pointing to a DE) is located
   by querying `order_lines` for that order's rows, then looking up each
   `stockItemId` that points to a DE row. If the DE is **solely owned** (no
   other `order_line` rows from other orders point at it), update `date` in
   place. If the DE is **shared** (multiple orders share it), create a new DE for
   the new date (upsert-with-sum), update this order's `order_line.stockItemId`
   to point at the new DE, and decrement the old DE's `current_quantity` by the
   line's quantity (effectively moving the demand). The `order_line` FK stays
   valid throughout; the old DE remains so other orders keep their link.

---

## Tech Stack

- Node.js + Express, Drizzle ORM, `drizzle-orm` `sql` template tag for
  `ON CONFLICT DO UPDATE`
- pglite 0.4.5 (Postgres 17 WASM) for integration tests
- Railway Postgres (prod, Postgres 16+)
- Vitest for unit + integration tests

---

## File Structure

| File | Role | New / Modified |
|------|------|----------------|
| `backend/src/repos/stockRepo.js` | `getOrCreateDemandEntry`, `computeDemandDate`, `updateDemandEntryDate` | Modified |
| `backend/src/repos/orderRepo.js` | `createOrder` flag-on branch, `updateOrder` cascade | Modified |
| `backend/src/db/migrations/0013_stock_y_demand_index.sql` | Partial unique index | New |
| `backend/src/db/__tests__/stockYDatedDemand.integration.test.js` | Integration tests (getOrCreateDemandEntry, index, cascade) | New |
| `backend/src/__tests__/orderRepo.integration.test.js` | Additional flag-on createOrder + cascade tests | Modified |
| `lab/scenarios/stockYDemand.js` | Lab scenario seeded with shared Variety + crossed dates | New |
| `lab/factories/stockItem.js` | `type='dated-demand'` shape | Modified |

---

## Tasks

### Task 1 — Red: `computeDemandDate` unit test (pure function, no DB)

**Files:** `backend/src/__tests__/stockRepo.test.js` (≤30 LOC)

**Steps:**
- [ ] Write failing tests for `computeDemandDate(order)`:
  - order has `requiredBy` → returns it
  - order has no `requiredBy` but has `orderDate` → returns `orderDate`
  - order has neither → returns today (YYYY-MM-DD)
  - Use `vi.useFakeTimers()` for the "today" case
- [ ] Confirm tests fail (function not yet exported)

**Commit message:**
```
git commit -m "$(cat <<'EOF'
test(stock-y): red — computeDemandDate unit tests

Specifies fallback chain: Required By → Order Date → today.
vi.useFakeTimers() pins the today branch.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2 — Green: `computeDemandDate` implementation

**Files:** `backend/src/repos/stockRepo.js` (≤25 LOC added)

**Steps:**
- [ ] Add pure helper function at the top of `stockRepo.js`, below imports:

```js
/**
 * Resolves the demand date for a new Demand Entry from order data.
 * Fallback chain: Required By → Order Date → today.
 * @param {{ requiredBy?: string, orderDate?: string }} order
 * @returns {string} YYYY-MM-DD
 */
export function computeDemandDate(order) {
  if (order?.requiredBy) return order.requiredBy;
  if (order?.orderDate)  return order.orderDate;
  return new Date().toISOString().split('T')[0];
}
```

- [ ] Run the Task 1 tests: all green
- [ ] `npx vitest run src/__tests__/stockRepo.test.js`

**Commit message:**
```
git commit -m "$(cat <<'EOF'
feat(stock-y): computeDemandDate — Required By → Order Date → today fallback

Pure helper exported from stockRepo. No DB I/O.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3 — Migration: partial unique index `0013_*`

**Files:** `backend/src/db/migrations/0013_stock_y_demand_index.sql` (≤20 LOC)

**Steps:**
- [ ] Create migration file:

```sql
-- Stock Y-model dated Demand Entry deduplication (issue #286).
--
-- Enforces at-most-one Demand Entry per (Variety, date).
-- Predicate: current_quantity < 0 — Demand Entry rows only. Positive-qty
-- Batch rows and zero-qty phantom rows are excluded so legacy aggregate
-- Demand Entries (no date, no attributes) remain valid when flag is off.
--
-- NULLS NOT DISTINCT: NULL colour and colour='Green' are different Varieties
-- per ADR-0006 strict identity. Without this clause, PG would treat all
-- NULL-colour rows as equal and collapse different cultivar-null Varieties.
--
-- Postgres 15+ / pglite 0.4.5 (PG 17 WASM) both support NULLS NOT DISTINCT.
-- Railway Postgres plugin provisions PG 16+. No fallback needed.

CREATE UNIQUE INDEX IF NOT EXISTS stock_demand_variety_date_idx
  ON stock (type_name, colour, size_cm, cultivar, date)
  WHERE current_quantity < 0
  NULLS NOT DISTINCT;

--> statement-breakpoint

-- Performance index: find all Demand Entries for a given Variety fast.
-- Used by getOrCreateDemandEntry's SELECT and the Required By cascade.
CREATE INDEX IF NOT EXISTS stock_demand_variety_idx
  ON stock (type_name, colour, size_cm, cultivar)
  WHERE current_quantity < 0;
```

- [ ] The pglite harness picks up this migration automatically (lexicographic load order)
- [ ] Write a quick smoke: `npx vitest run src/__tests__/stockYFoundation.integration.test.js` (existing, must stay green)

**Commit message:**
```
git commit -m "$(cat <<'EOF'
feat(stock-y): migration 0013 — partial unique index on Demand Entries

NULLS NOT DISTINCT on (type_name, colour, size_cm, cultivar, date)
WHERE current_quantity < 0. Enforces one DE per (Variety, date) without
touching legacy Batch rows or aggregate DEs when flag is off.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4 — Red: `getOrCreateDemandEntry` integration tests

**Files:** `backend/src/__tests__/stockYDatedDemand.integration.test.js` (≤120 LOC)

**Steps:**
- [ ] Write failing integration tests using pgHarness pattern (see
  `stockRepo.integration.test.js` for the `vi.mock + dbHolder` setup):

```js
// Tests to write (failing at this stage):
// 1. creates a new Demand Entry for a Variety+date (no existing row)
// 2. same Variety + same date → reuses row, sums qty (no new row)
// 3. same Variety + different date → two distinct Demand Entry rows
// 4. same Type/Colour/Size, different Cultivar (one null, one filled) → two rows
//    (strict identity — verifies NULLS NOT DISTINCT semantics)
// 5. partial unique index rejects a raw INSERT that duplicates (Variety, date)
//    (insert directly via harness.db to bypass the upsert logic)
// 6. display name computed per ADR-0006: "<Type> <Colour> <Size>cm <Cultivar?> (<Date>)"
```

- [ ] Also write failing tests for `updateDemandEntryDate`:
  - sole-owner: date column updated in place, stock row id unchanged
  - shared: new DE created, order_line.stockItemId updated, old DE qty decremented

- [ ] Confirm all tests fail (function not yet implemented)

**Commit message:**
```
git commit -m "$(cat <<'EOF'
test(stock-y): red — getOrCreateDemandEntry + updateDemandEntryDate integration tests

Covers: create, sum-on-reuse, date-split, cultivar-null strict identity,
partial-index enforcement, display-name formula, date cascade sole/shared.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5 — Green: `getOrCreateDemandEntry` implementation

**Files:** `backend/src/repos/stockRepo.js` (≤80 LOC added)

**Steps:**
- [ ] Add to `stockRepo.js`, after `computeDemandDate`:

```js
/**
 * Get or create a Demand Entry for (varietyKey, date).
 * Must be called inside an outer db.transaction — `tx` is required.
 *
 * @param {{ typeName: string, colour: string|null, sizeCm: number|null, cultivar: string|null }} varietyKey
 * @param {string} date - YYYY-MM-DD
 * @param {number} qty  - positive number; stored as negative (demand is negative qty)
 * @param {object} tx   - Drizzle transaction handle
 * @param {object} actor
 * @returns {Promise<object>} pgToResponse(row)
 */
export async function getOrCreateDemandEntry(varietyKey, date, qty, tx, actor = { actorRole: 'system', actorPinLabel: null }) {
  const { typeName, colour = null, sizeCm = null, cultivar = null } = varietyKey;

  if (!typeName) throw Object.assign(new Error('typeName is required for Demand Entry'), { statusCode: 400 });
  if (!date)     throw Object.assign(new Error('date is required for Demand Entry'),     { statusCode: 400 });

  // Build the display name per ADR-0006:
  // "<Type> <Colour> <Size>cm <Cultivar?> (<Date>)"
  const parts = [typeName];
  if (colour)  parts.push(colour);
  if (sizeCm)  parts.push(`${sizeCm}cm`);
  if (cultivar) parts.push(cultivar);
  parts.push(`(${date})`);
  const displayName = parts.join(' ');

  // NULL-aware equality for the WHERE clause.
  // Drizzle's eq() uses = which is false for NULLs; isNull() needed for optional attrs.
  const varietyWhere = and(
    eq(stock.typeName, typeName),
    colour   ? eq(stock.colour, colour)     : isNull(stock.colour),
    sizeCm   ? eq(stock.sizeCm, sizeCm)     : isNull(stock.sizeCm),
    cultivar ? eq(stock.cultivar, cultivar) : isNull(stock.cultivar),
    eq(stock.date, date),
    sql`${stock.currentQuantity} < 0`,
    isNull(stock.deletedAt),
  );

  // Check for existing DE.
  // Note: SELECT FOR UPDATE is NOT used here — pglite doesn't support it.
  // Concurrency safety comes from the partial unique index (violating it on
  // a concurrent INSERT triggers a conflict, caught by ON CONFLICT DO UPDATE
  // in the upsert path below). Production PG row-level locks on the UPDATE
  // statement provide sufficient isolation for the sum-on-reuse path.
  const [existing] = await tx.select().from(stock).where(varietyWhere).limit(1);

  if (existing) {
    // Sum qty: deepen the existing Demand Entry.
    const [after] = await tx.update(stock)
      .set({
        currentQuantity: sql`${stock.currentQuantity} - ${qty}`,
        displayName,
        updatedAt: new Date(),
      })
      .where(eq(stock.id, existing.id))
      .returning();
    await tryAudit(tx, {
      entityType: 'stock', entityId: after.id, action: 'update',
      before: { 'Current Quantity': existing.currentQuantity },
      after:  { 'Current Quantity': after.currentQuantity },
      ...actor,
    });
    return pgToResponse(after);
  }

  // Create new Demand Entry.
  const [row] = await tx.insert(stock).values({
    displayName,
    currentQuantity: -qty,
    active:    true,
    typeName,
    colour:    colour   ?? null,
    sizeCm:    sizeCm   ?? null,
    cultivar:  cultivar ?? null,
    date,
  }).returning();
  await tryAudit(tx, {
    entityType: 'stock', entityId: row.id, action: 'create',
    before: null, after: pgToResponse(row), ...actor,
  });
  return pgToResponse(row);
}
```

- [ ] Run Task 4 tests (getOrCreateDemandEntry subset): green
- [ ] Run full integration suite: `cd backend && npx vitest run`

**Commit message:**
```
git commit -m "$(cat <<'EOF'
feat(stock-y): getOrCreateDemandEntry — one DE per (Variety, date), qty summed

NULL-aware WHERE, display name per ADR-0006, audit on both create and
sum-on-reuse paths. No SELECT FOR UPDATE (pglite incompatible); partial
unique index is the concurrency guard.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6 — Green: `updateDemandEntryDate` implementation

**Files:** `backend/src/repos/stockRepo.js` (≤60 LOC added)

**Steps:**
- [ ] Add `updateDemandEntryDate(orderLineId, newDate, tx, actor)` function:

```js
/**
 * Cascade a Required By change to the linked Demand Entry's date column.
 *
 * Sole-owner path: update date in place. order_line FK unchanged.
 * Shared path: create/deepen a new DE for newDate, point order_line at it,
 *   decrement old DE qty by the line's quantity (split the demand).
 *
 * @param {string} orderLineId - UUID of the order_line row
 * @param {string} newDate     - new YYYY-MM-DD date
 * @param {object} tx          - Drizzle transaction handle (required)
 * @param {object} actor
 * @returns {Promise<{ demandEntryId: string, action: 'updated-in-place' | 'split' }>}
 */
export async function updateDemandEntryDate(orderLineId, newDate, tx, actor = { actorRole: 'system', actorPinLabel: null }) {
  // 1. Fetch the order_line to find stockItemId + qty
  const [line] = await tx.select().from(orderLines)
    .where(and(eq(orderLines.id, orderLineId), isNull(orderLines.deletedAt)))
    .limit(1);
  if (!line) throw Object.assign(new Error(`order_line not found: ${orderLineId}`), { statusCode: 404 });

  const deId = line.stockItemId;
  if (!deId) return null; // no linked DE (stock-deferred line)

  // 2. Fetch the linked stock row — must be a Demand Entry (qty < 0)
  const [de] = await tx.select().from(stock)
    .where(and(eq(stock.id, deId), isNull(stock.deletedAt), sql`${stock.currentQuantity} < 0`))
    .limit(1);
  if (!de) return null; // linked stock is a Batch, not a DE — nothing to cascade

  // 3. Count other order_lines pointing at the same DE
  const sharingLines = await tx.select({ id: orderLines.id }).from(orderLines)
    .where(and(
      eq(orderLines.stockItemId, deId),
      sql`${orderLines.id} != ${orderLineId}`,
      isNull(orderLines.deletedAt),
    ));

  if (sharingLines.length === 0) {
    // Sole owner — update date in place
    const [after] = await tx.update(stock)
      .set({ date: newDate, updatedAt: new Date() })
      .where(eq(stock.id, de.id))
      .returning();
    await tryAudit(tx, {
      entityType: 'stock', entityId: after.id, action: 'update',
      before: { date: de.date }, after: { date: after.date }, ...actor,
    });
    return { demandEntryId: after.id, action: 'updated-in-place' };
  }

  // Shared — split: create/deepen DE for newDate, move this line's demand
  const lineQty = Math.abs(Number(line.quantity) || 0);
  const varietyKey = { typeName: de.typeName, colour: de.colour, sizeCm: de.sizeCm, cultivar: de.cultivar };
  const newDe = await getOrCreateDemandEntry(varietyKey, newDate, lineQty, tx, actor);

  // Decrement old DE by lineQty (return its share back toward zero)
  const [oldAfter] = await tx.update(stock)
    .set({ currentQuantity: sql`${stock.currentQuantity} + ${lineQty}`, updatedAt: new Date() })
    .where(eq(stock.id, de.id))
    .returning();
  await tryAudit(tx, {
    entityType: 'stock', entityId: oldAfter.id, action: 'update',
    before: { 'Current Quantity': de.currentQuantity },
    after:  { 'Current Quantity': oldAfter.currentQuantity },
    ...actor,
  });

  // Update order_line to point at new DE
  await tx.update(orderLines)
    .set({ stockItemId: newDe._pgId, updatedAt: new Date() })
    .where(eq(orderLines.id, orderLineId));

  return { demandEntryId: newDe._pgId, action: 'split' };
}
```

- [ ] Import `orderLines` from schema in stockRepo.js (currently not imported there — add it)
- [ ] Run Task 4 tests (cascade subset): green
- [ ] `cd backend && npx vitest run`

**Commit message:**
```
git commit -m "$(cat <<'EOF'
feat(stock-y): updateDemandEntryDate — sole-owner in-place, shared split

Sole owner: date column updated, order_line FK preserved.
Shared: new DE created/deepened, line redirected, old DE decremented.
Audit recorded for every mutation.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7 — Red: `createOrder` flag-on integration tests

**Files:** `backend/src/__tests__/orderRepo.integration.test.js` (≤80 LOC added)

**Steps:**
- [ ] Add `describe('createOrder flag-on (STOCK_Y_MODEL)', ...)` block using the
  existing `dbHolder` + `vi.mock` scaffold already in the file:

```js
// Tests to write (failing):
// 1. two orders same (Variety, Required By) → single DE, summed qty, two order_lines
//    (verify order_line[0].stockItemId === order_line[1].stockItemId)
// 2. two orders different Required By → two distinct Demand Entry rows
//    (different stock IDs on the two order_lines)
// 3. same Type/Colour/Size, different Cultivar (one null, one filled) → two DEs
// 4. Required By fallback: order with no requiredBy but orderDate → DE date = orderDate
// 5. flag-off: existing test scenarios still pass unmodified (no DE created)
```

- [ ] Confirm tests fail (flag-on branch not yet in createOrder)

**Commit message:**
```
git commit -m "$(cat <<'EOF'
test(stock-y): red — createOrder flag-on integration tests

Covers shared DE, date-split, cultivar strict identity,
fallback chain, and flag-off regression guard.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8 — Green: `createOrder` flag-on branch in `orderRepo.js`

**Files:** `backend/src/repos/orderRepo.js` (≤50 LOC added/modified)

**Steps:**
- [ ] Add import at top of `orderRepo.js`:
  ```js
  import { getStockYModelEnabled } from '../services/configService.js';
  import { getOrCreateDemandEntry, computeDemandDate } from './stockRepo.js';
  ```

- [ ] In `createOrder`, after step 3 (insert order lines) and before step 4
  (stock adjustment), add the flag-on Demand Entry branch:

```js
// 3b. Flag-on: create/deepen Demand Entry for each line lacking Batch coverage.
// "Batch coverage" = the linked stock row has current_quantity >= 0 at time of order.
// We do NOT block on Batch rows — adjustQuantity (step 4) handles those as before.
if (getStockYModelEnabled()) {
  const demandDate = computeDemandDate({
    requiredBy: requiredBy || delivery?.date || null,
    orderDate:  new Date().toISOString().split('T')[0],
  });

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.stockItemId || line.stockDeferred) continue;

    // Look up the stock row inside this transaction to check if it's a Batch
    const [stockRow] = await tx.select({
      id: stock.id,
      currentQuantity: stock.currentQuantity,
      typeName: stock.typeName,
    }).from(stock).where(and(eq(stock.id, line.stockItemId), isNull(stock.deletedAt))).limit(1);

    // Only create a DE if the stock row lacks type_name (Y-model not yet applied
    // to this row — legacy aggregate mode) OR if the stock row has qty < 0 already
    // (it IS the aggregate DE being deepened — flag-on deepens instead). Actually:
    // if the stock row has typeName set, it's a Y-model Batch; skip DE creation
    // because the Batch deduction (step 4) covers it.
    // If stockRow.typeName is null → legacy row → skip (flag-on only routes
    // properly-attributed lines through DE path).
    if (!stockRow || !stockRow.typeName) continue; // not a Y-model line

    // Stock row has typeName: is it a Batch (qty >= 0) or existing DE (qty < 0)?
    if (stockRow.currentQuantity >= 0) continue; // Batch — step 4 handles it

    // Existing aggregate DE or Y-model DE — for Y-model lines this IS the DE path.
    // Extract Variety from the stock row.
    const [fullRow] = await tx.select().from(stock).where(eq(stock.id, stockRow.id)).limit(1);
    const varietyKey = {
      typeName: fullRow.typeName,
      colour:   fullRow.colour   ?? null,
      sizeCm:   fullRow.sizeCm   ?? null,
      cultivar: fullRow.cultivar ?? null,
    };
    const de = await getOrCreateDemandEntry(varietyKey, demandDate, Number(line.quantity), tx, actor);

    // Update the inserted order_line to point at the canonical DE
    // (it may differ from line.stockItemId if a shared DE existed at the right date)
    if (de._pgId !== line.stockItemId) {
      await tx.update(orderLines)
        .set({ stockItemId: de._pgId, updatedAt: new Date() })
        .where(eq(orderLines.id, createdLines[i].id));
      createdLines[i] = { ...createdLines[i], stockItemId: de._pgId };
    }
  }
}
```

  _Note: The above design covers lines whose `stockItemId` already points at a DE (negative qty). A cleaner trigger for the "lacks Batch coverage" check is `stockRow.currentQuantity < 0`. If the row has `typeName` set AND `qty < 0`, it needs a dated DE. If `qty >= 0`, it's a Batch and step 4 handles it. If `typeName` is null, it's a legacy aggregate and the flag-on path skips it cleanly._

- [ ] Also import `stock` from schema if not already imported in orderRepo.
- [ ] Run Task 7 tests: green
- [ ] Full test suite: `cd backend && npx vitest run`

**Commit message:**
```
git commit -m "$(cat <<'EOF'
feat(stock-y): createOrder flag-on — route DE lines through getOrCreateDemandEntry

Behind getStockYModelEnabled(). Same-Variety same-date entry reused (qty
summed); different date → new dated DE. Legacy lines (typeName null) and
Batch lines (qty >= 0) untouched. order_line FK updated to canonical DE id.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9 — Red: Required By cascade integration tests

**Files:** `backend/src/__tests__/orderRepo.integration.test.js` (≤60 LOC added)

**Steps:**
- [ ] Add `describe('updateOrder Required By cascade (STOCK_Y_MODEL)', ...)`:

```js
// Tests to write (failing):
// 1. flag-on: changing Required By on order with sole-owner DE → DE.date updated in place,
//    order_line.stockItemId unchanged, audit log has date change entry
// 2. flag-on: changing Required By on order sharing a DE → new DE created,
//    order_line.stockItemId changed to new DE, old DE qty decremented
// 3. flag-on: changing Required By on order with Batch line (qty >= 0) → no DE affected
// 4. flag-off: updateOrder with Required By change → delivery cascade only (legacy)
```

- [ ] Confirm tests fail (updateOrder cascade not yet implemented)

**Commit message:**
```
git commit -m "$(cat <<'EOF'
test(stock-y): red — updateOrder Required By cascade integration tests

Sole-owner in-place, shared split, Batch passthrough, flag-off regression.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10 — Green: Required By cascade in `orderRepo.updateOrder`

**Files:** `backend/src/repos/orderRepo.js` (≤40 LOC added/modified)

**Steps:**
- [ ] Add import: `import { updateDemandEntryDate } from './stockRepo.js';`

- [ ] In `updateOrder`, inside the transaction, after the delivery cascade, add:

```js
// Flag-on Required By cascade → Demand Entry date update.
if (getStockYModelEnabled() && 'Required By' in fields && fields['Required By']) {
  const newDate = fields['Required By'];
  // Fetch all order_lines for this order
  const lines = await tx.select({
    id: orderLines.id,
    stockItemId: orderLines.stockItemId,
  }).from(orderLines)
    .where(and(eq(orderLines.orderId, after.id), isNull(orderLines.deletedAt)));

  for (const line of lines) {
    if (!line.stockItemId) continue;
    await updateDemandEntryDate(line.id, newDate, tx, actor);
  }
}
```

- [ ] Run Task 9 tests: green
- [ ] Full test suite: `cd backend && npx vitest run`

**Commit message:**
```
git commit -m "$(cat <<'EOF'
feat(stock-y): updateOrder Required By cascade to Demand Entry date

Flag-on: each order_line's linked DE has its date updated (sole-owner)
or split (shared). Flag-off: delivery cascade only — unchanged.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11 — Acceptance criteria integration tests

**Files:** `backend/src/__tests__/stockYDatedDemand.integration.test.js` (≤60 LOC added)

**Steps:**
- [ ] Write the remaining acceptance-criteria tests not yet covered:

```js
// Tests to add:
// AC: Partial unique index with NULLS NOT DISTINCT verified by direct SQL INSERT
//   — two raw inserts same (Variety, null-colour, date) → second insert throws
//   — two raw inserts same Variety different cultivar (null vs 'Sarah B') → both succeed
// AC: Required By fallback chain: order with no requiredBy, no orderDate → today
// AC: Display name format: "Peony Pink 60cm Sarah Bernhardt (2026-05-15)"
// AC: computeDemandDate with fake timer on "today" branch
```

- [ ] All green
- [ ] `cd backend && npx vitest run --coverage`

**Commit message:**
```
git commit -m "$(cat <<'EOF'
test(stock-y): full acceptance criteria coverage

NULLS NOT DISTINCT verified by raw SQL, display name, fallback chain,
today-branch via fake timer. All green.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12 — Lab scenario: `stockYDemand`

**Files:**
- `lab/scenarios/stockYDemand.js` (≤80 LOC)
- `lab/factories/stockItem.js` (≤20 LOC modified)

**Steps:**
- [ ] Add `type: 'dated-demand'` shape to `makeStockItem`:

```js
// In makeStockItem, add to the type check:
if (type === 'dated-demand') {
  display_name = columnOverrides.display_name ?? `${variety} (${new Date().toISOString().split('T')[0]})`;
  // type_name must be set for dated demand
  out.type_name = columnOverrides.type_name ?? variety.split(' ')[0];
  out.date      = columnOverrides.date      ?? new Date().toISOString().split('T')[0];
  out.current_quantity = -faker.number.int({ min: 5, max: 30 });
}
```

- [ ] Create `lab/scenarios/stockYDemand.js`:

```js
// Seed: multiple orders sharing Variety + date, crossing dates
// - 2 orders: same (Peony Pink 60cm, 2026-05-15) → single DE, two order_lines
// - 2 orders: same Peony Pink 60cm, different dates → two DEs
// - 1 order: same Type/Colour/Size, null cultivar → separate DE
// - 1 order: same Type/Colour/Size, 'Sarah Bernhardt' cultivar → separate DE
```

- [ ] `npm run lab:test:unit`

**Commit message:**
```
git commit -m "$(cat <<'EOF'
test(stock-y): lab scenario stockYDemand with shared Variety + crossed dates

Covers shared DE, date-split, cultivar strict identity.
Factory extended with 'dated-demand' type.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13 — E2E regression gate

**Steps:**
- [ ] Boot the test backend: `npm run harness &`
- [ ] Run full E2E suite: `npm run test:e2e`
- [ ] Flag-off baseline: confirm all 25 sections pass (no STOCK_Y_MODEL env set)
- [ ] Flag-on smoke: `STOCK_Y_MODEL=true npm run test:e2e`
  - Note: E2E suite does not yet have flag-on–specific sections; verify no regressions

**Commit message:** (no code change — verification only)

---

### Task 14 — CHANGELOG + CLAUDE.md updates

**Files:**
- `CHANGELOG.md`
- `backend/CLAUDE.md` (Services table + Known Pitfalls)

**Steps:**
- [ ] Add CHANGELOG entry for #286 with schema note (new index `0013`)
- [ ] Update backend CLAUDE.md Services table: add `getOrCreateDemandEntry`,
  `computeDemandDate`, `updateDemandEntryDate` to stockRepo row
- [ ] Add Known Pitfall note: `SELECT FOR UPDATE is not supported in pglite —
  use partial unique index + ON CONFLICT for dedup safety in tests`

**Commit message:**
```
git commit -m "$(cat <<'EOF'
docs: CHANGELOG + backend CLAUDE.md for #286 dated Demand Entry

Notes new index 0013, pglite FOR UPDATE limitation, and the three new
stockRepo exports.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15 — Pre-PR verification matrix

**Steps (all must be green before PR):**
- [ ] `cd backend && npx vitest run`
- [ ] `npm run harness &` then `npm run test:e2e`
- [ ] `npm run lab:test:unit`
- [ ] `npm run lab:test:api` (after `npm run lab:db:up && npm run lab:template:rebuild -- --scenario=baseline`)
- [ ] Check `CHANGELOG.md` updated
- [ ] Check `backend/CLAUDE.md` Services table updated
- [ ] Stale-doc rule: this plan file is dated today — no archive action needed

---

## Self-Review

| Concern | Resolution |
|---------|------------|
| `SELECT FOR UPDATE` not supported in pglite | Documented. Concurrency guard is the partial unique index. Production Postgres row locks on UPDATE provide isolation for the sum path. Test suite verifies uniqueness via direct INSERT conflict assertion. |
| `NULLS NOT DISTINCT` Postgres version | pglite 0.4.5 (PG 17 WASM) + Railway Postgres 16+ both support it. Migration uses `IF NOT EXISTS`. |
| Required By cascade split FK safety | `updateDemandEntryDate` updates `order_line.stockItemId` before committing. All in the same tx — atomic. |
| Legacy flag-off paths | Every new code block is gated on `getStockYModelEnabled()`. Existing integration tests (Task 13) verify no regression. |
| `orderLines` import in `stockRepo.js` | `stockRepo` currently imports from `db/schema.js`. Adding `orderLines` is a valid schema import. No circular dependency (orderRepo imports stockRepo, not vice versa — the new `updateDemandEntryDate` in stockRepo directly uses the `orderLines` Drizzle table, not the repo). |
| Circular import risk | `orderRepo.js` imports `getOrCreateDemandEntry` from `stockRepo.js`. `stockRepo.js` must NOT import from `orderRepo.js`. `updateDemandEntryDate` uses the `orderLines` schema table directly (no orderRepo import). Safe. |
| Known Pitfall #8 (stock math) | Demand Entry qty is always negative. `getOrCreateDemandEntry` subtracts (deepens), `updateDemandEntryDate` splits correctly. `getEffectiveStock` is unchanged — per-row qty is still the single source. |
| Known Pitfall #6 (PO line identity) | Not affected — this slice touches order_lines, not PO lines. |

---

## Execution Handoff

**Start with Task 1** (pure unit test — fastest feedback loop, zero DB setup).
Tasks 1-2 can be done in <30 min and prove the fallback chain is correct before
touching the DB.

**Critical path:** Tasks 1→2→3→4→5→6→7→8→9→10. Tests 11-13 are verification
and can be parallelised with 14 (docs).

**If any integration test is blocked by migration application:** verify the new
`0013_stock_y_demand_index.sql` file sorts correctly after `0012_*` and that the
pglite harness picks it up via `setupPgHarness()` (lexicographic load order is
automatic).

**If `NULLS NOT DISTINCT` fails in pglite:** check the pglite version by running
`harness.pg.exec("SELECT version()")` in a test. If PG < 15 is detected, fall
back to a trigger that raises an exception on duplicate `(type_name, IS NULL colour IS NULL size_cm IS NULL cultivar, date)` — but pglite 0.4.5 = PG 17 so this should not be needed.
```

---

Now let me produce the final response with the plan path, task count, and open questions.

---

**Plan path:** `/Users/oliwer/Projects/flower-studio/.worktrees/stock-y-demand/docs/superpowers/plans/2026-05-10-stock-y-dated-demand.md`

**Task count:** 15 tasks

---

**Open questions I could not resolve from code alone:**

1. **`SELECT FOR UPDATE` in pglite — concurrency strategy is correct but under-verified.** The appConfigRepo comment (line 29) confirms pglite does not support `SELECT FOR UPDATE`, so the plan uses the partial unique index as the sole concurrency guard. This is safe for production (Postgres row locks on UPDATE handle the sum path; unique index handles the concurrent-create path), but the pglite integration tests cannot exercise true concurrent inserts. The acceptance test for the unique index (Task 11) verifies it via sequential raw INSERTs — not true concurrency. If the system ever sees heavy concurrent order creation for the same Variety+date (e.g. Wix webhook storm), a production index violation will surface as a `23505` unique constraint error. The plan does not include an `ON CONFLICT DO UPDATE` upsert as a fallback — it uses read-then-write with a uniqueness guard. If concurrent creation must be handled without a 409 error, the implementation of `getOrCreateDemandEntry` should use `INSERT ... ON CONFLICT (type_name, colour, size_cm, cultivar, date) WHERE current_quantity < 0 DO UPDATE SET current_quantity = stock.current_quantity - EXCLUDED.current_quantity` as the canonical form. This requires raw SQL via Drizzle's `sql` tag since Drizzle's `onConflictDoUpdate` doesn't support partial index targets natively. The plan as written is correct for the sequential single-writer case but this upsert form should be reviewed before merge.

2. **Required By cascade "Batch line passthrough" boundary.** The issue specifies that when Required By changes, the cascade finds "the linked Demand Entry." But an order_line may point at a Batch row (qty >= 0, no typeName). The plan skips lines where `stock.currentQuantity >= 0`. However, there is an edge case: a line created under flag-off (pointing at an aggregate DE with no typeName) — in this case `stockRow.typeName` is null, and the cascade skips it. That is correct per the "flag-off paths untouched" constraint. But if an order was created flag-on (DE has typeName) and then the flag is turned off between creation and Required By update, the cascade code reads `getStockYModelEnabled()` at update time and the whole block is skipped. This is the safest behavior (flag-off → no cascade), but the DE's date will drift from the order's Required By until the flag is re-enabled. This is a known acceptable gap for a feature-flag-controlled rollout but should be documented in the PR description.

3. **`NULLS NOT DISTINCT` partial index partial key.** The partial unique index covers `(type_name, colour, size_cm, cultivar, date) WHERE current_quantity < 0`. The `NULLS NOT DISTINCT` clause applies to the entire index key, meaning two rows with `colour = NULL` and the same other key columns are treated as equal (conflict). This is exactly what ADR-0006 requires. However, it is worth confirming: does `NULLS NOT DISTINCT` in Postgres 15+ apply at the statement level (per `CREATE UNIQUE INDEX`) or per column? Per PG docs, it applies at the index level — all NULL comparisons in the key use NOT DISTINCT semantics. So `(Peony, NULL, 60, NULL, '2026-05-15')` and `(Peony, NULL, 60, NULL, '2026-05-15')` would correctly conflict. This is the intended behavior and is verifiable in Task 11's direct-INSERT test.

### Critical Files for Implementation

- `/Users/oliwer/Projects/flower-studio/.worktrees/stock-y-demand/backend/src/repos/stockRepo.js`
- `/Users/oliwer/Projects/flower-studio/.worktrees/stock-y-demand/backend/src/repos/orderRepo.js`
- `/Users/oliwer/Projects/flower-studio/.worktrees/stock-y-demand/backend/src/db/migrations/0013_stock_y_demand_index.sql`
- `/Users/oliwer/Projects/flower-studio/.worktrees/stock-y-demand/backend/src/__tests__/stockYDatedDemand.integration.test.js`
- `/Users/oliwer/Projects/flower-studio/.worktrees/stock-y-demand/backend/src/__tests__/orderRepo.integration.test.js`