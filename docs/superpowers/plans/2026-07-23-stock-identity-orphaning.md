# Stock-Identity Orphaning Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop retiring a Stock Item while an Order Line still references it, so editing a delivered Order no longer crashes, the per-Variety trace stays complete, and a substituted original stops double-counting.

**Architecture:** Two vertical slices → two PRs. Slice A fixes terminal-order **Settlement**: it stamps a new `stock.settled_at` marker instead of soft-deleting the Demand Entry, and the line-reversal seam treats a settled Demand Entry as a no-op (covering both the new marked rows and the legacy soft-deleted ones). A one-time guarded script repairs the 57 already-soft-deleted rows. Slice B derives a "substituted" tag for a Not-Found original from the existing `Substitute For` link and renders it in both stock views.

**Tech Stack:** Node 20 + Express + Drizzle ORM (Postgres / pglite for tests), Vitest, React (Vite + Tailwind), npm workspaces.

## Global Constraints

- Stock reads/writes go through `stockRepo` — never raw SQL on the `stock` table from routes/services. (backend/CLAUDE.md)
- Status comparisons use `ORDER_STATUS.*` from `backend/src/constants/statuses.js` — never raw strings.
- Multi-row writes run inside `db.transaction(...)`; audit rows are written inside the repo transaction via `tryAudit`.
- **Known Pitfall area — mandatory red-phase TDD** (settlement, DE math): follow CLAUDE.md pitfalls `stock-math` (never `qty - committed`; per-row `getEffectiveStock(qty)`) and `batch-variety-attrs`.
- **Schema change → update `lab/factories/stock.js` in the same PR** (CLAUDE.md), or the `lab-api` CI job fails on unknown-column.
- UI strings are Russian via `t.xxx` from each app's `translations.js`. Comments in English.
- Cross-app parity: Slice B touches florist `StockItem.jsx` AND dashboard `StockTab.jsx` in lockstep.
- Pre-PR matrix (workflow-config): backend → `cd backend && npx vitest run` + `npm run harness & && npm run test:e2e`; shared/app UI → build the touched app(s); lab → `npm run lab:test:unit` + `npm run lab:test:api`.

---

## SLICE A — Settled Demand Entries stay visible; editing a delivered Order does not crash (#556)

Branch: `fix/settled-de-audit-marker`. Closes #556 (and restores the trace).

### Task A1: Add the `settled_at` marker column

**Files:**
- Create: `backend/src/db/migrations/0022_stock_settled_at.sql`
- Modify: `backend/src/db/schema.js` (the `stock` table definition — add `settledAt`)
- Modify: `lab/factories/stock.js` (add `settled_at: null` default so factory rows satisfy the column)

**Interfaces:**
- Produces: `stock.settledAt` (nullable `timestamptz`) — `NULL` for open/normal rows; set when an Order Line's demand is settled at terminal transition. A row with `settled_at IS NOT NULL` is a **settled Demand Entry** (kept visible at qty 0), unambiguously distinct from a depleted Batch at qty 0.

- [ ] **Step 1: Write the migration**

```sql
-- Settled Demand Entry marker (#557 / #556).
-- A terminal-order Settlement releases a Demand Entry to 0 and stamps
-- settled_at instead of soft-deleting it (reverts the #516 soft-delete),
-- so the row stays visible in the per-Variety trace and remains a valid
-- target for the Order Line's stock_item_id. NULL for every other row.
ALTER TABLE stock ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
```

- [ ] **Step 2: Add the column to the Drizzle schema**

In `backend/src/db/schema.js`, in the `stock` table, next to `deletedAt`:

```js
settledAt: timestamp('settled_at', { withTimezone: true }),
```

- [ ] **Step 3: Add the factory default**

In `lab/factories/stock.js`, add to the row defaults: `settled_at: null,`.

- [ ] **Step 4: Verify migrations + factories apply**

Run: `cd backend && npx vitest run src/__tests__/orderRepo.integration.test.js`
Expected: PASS (pglite boots, all migrations apply cleanly — proves the new column parses).
Run: `npm run lab:test:unit`
Expected: PASS (factory still builds a valid stock row).

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/0022_stock_settled_at.sql backend/src/db/schema.js lab/factories/stock.js
git commit -m "feat(stock): add settled_at marker column for settled Demand Entries (#556)"
```

### Task A2: Settlement stamps `settled_at` instead of soft-deleting

**Files:**
- Modify: `backend/src/repos/stockRepo.js` — `reverseLineStockEffect` DE-release branch (currently lines ~302-326, the `if (isDe) { ... if (newQty >= 0) { soft-delete } }`).
- Test: `backend/src/__tests__/orderRepo.integration.test.js` (new `it` in the settlement/transitionStatus area)

**Interfaces:**
- Consumes: `stock.settledAt` (Task A1).
- Produces: after a terminal transition, the line's Demand Entry has `currentQuantity = 0`, `deletedAt IS NULL`, `settledAt` set. `reverseLineStockEffect(...).released === true` for the release, but the row is no longer soft-deleted.

- [ ] **Step 1: Write the failing test**

```js
it('(#556) settling a delivered order keeps the Demand Entry visible at 0 (settled_at set, not soft-deleted)', async () => {
  // A future order with no Batch → creates a negative Demand Entry.
  const demandDate = '2026-08-01';
  const { order, orderLines } = await orderRepo.createOrder(makeOrderPayload({
    requiredBy: demandDate,
    lines: [{ flowerName: 'Ranunculus', typeName: 'Ranunculus', quantity: 10 }],
  }));
  const deId = orderLines[0].stockItemId;

  await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);
  await orderRepo.transitionStatus(order.id, ORDER_STATUS.OUT_FOR_DELIVERY);
  await orderRepo.transitionStatus(order.id, ORDER_STATUS.DELIVERED);

  const de = await stockRepo.getByIdIncludingSettled(deId); // helper added below
  expect(de).not.toBeNull();
  expect(de.deletedAt).toBeNull();          // NOT soft-deleted anymore
  expect(Number(de.currentQuantity)).toBe(0);
  expect(de.settledAt).not.toBeNull();      // marked settled
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/orderRepo.integration.test.js -t "keeps the Demand Entry visible"`
Expected: FAIL — currently the DE is soft-deleted (`deletedAt` set), and `getByIdIncludingSettled` does not exist.

- [ ] **Step 3: Implement — stamp settled_at, drop the soft-delete**

In `stockRepo.js` `reverseLineStockEffect`, replace the `if (newQty >= 0) { soft-delete }` block (the `deletedAt: new Date()` update + its `action: 'delete'` audit) with a `settledAt` stamp:

```js
    const newQty = Number(after.currentQuantity);
    if (newQty >= 0) {
      // Settled: release complete. Keep the row VISIBLE (ADR-0012 audit
      // marker) — stamp settled_at instead of soft-deleting (reverts #516).
      await tx.update(stock)
        .set({ settledAt: new Date(), updatedAt: new Date() })
        .where(eq(stock.id, row.id));
      await tryAudit(tx, {
        entityType: 'stock', entityId: after.id, action: 'update',
        before: { settled_at: null }, after: { settled_at: 'set' }, ...actor,
      });
    }
    return { kind: 'de', stockId: after.airtableId || after.id, newQty, released: true };
```

Add a read helper near `getById`:

```js
// Like getById but does not filter soft-deleted/settled — used by the
// reverse seam + tests to inspect a settled Demand Entry.
export async function getByIdIncludingSettled(id) {
  const isAirtableId = typeof id === 'string' && id.startsWith('rec');
  const [row] = await db.select().from(stock)
    .where(isAirtableId ? eq(stock.airtableId, id) : eq(stock.id, id)).limit(1);
  return row ? pgToResponse(row) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/orderRepo.integration.test.js -t "keeps the Demand Entry visible"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/stockRepo.js backend/src/__tests__/orderRepo.integration.test.js
git commit -m "feat(stock): settlement marks Demand Entry settled_at instead of soft-deleting (#556)"
```

### Task A3: Reversing a settled line is a no-op (the crash fix)

**Files:**
- Modify: `backend/src/repos/stockRepo.js` — `reverseLineStockEffect` (the row-resolution + branch selection at the top, ~294-337).
- Test: `backend/src/__tests__/orderRepo.integration.test.js`

**Interfaces:**
- Consumes: `stock.settledAt`, `getByIdIncludingSettled`.
- Produces: `reverseLineStockEffect(stockItemId, qty, 'return'|'writeoff', tx)` returns `{ kind: 'de', released: false }` and moves **no stock** when the resolved row is a settled Demand Entry (`settledAt` set) OR already soft-deleted (`deletedAt` set) — instead of throwing "Stock record not found".

- [ ] **Step 1: Write the failing test (reproduce #556)**

```js
it('(#556) editing a Delivered order to remove the settled placeholder line does not throw and moves no stock', async () => {
  const { order, orderLines } = await orderRepo.createOrder(makeOrderPayload({
    requiredBy: '2026-08-01',
    lines: [{ flowerName: 'Ranunculus', typeName: 'Ranunculus', quantity: 10 }],
  }));
  const placeholderLine = orderLines[0];

  await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);
  await orderRepo.transitionStatus(order.id, ORDER_STATUS.OUT_FOR_DELIVERY);
  await orderRepo.transitionStatus(order.id, ORDER_STATUS.DELIVERED);

  const deBefore = await stockRepo.getByIdIncludingSettled(placeholderLine.stockItemId);

  // Owner edits the delivered order and removes the placeholder line.
  await expect(orderRepo.editBouquetLines(order.id, {
    lines: [],
    removedLines: [{ stockItemId: placeholderLine.stockItemId, quantity: placeholderLine.quantity, action: 'return' }],
  }, /* isOwner */ true)).resolves.toBeDefined();   // NO throw

  const deAfter = await stockRepo.getByIdIncludingSettled(placeholderLine.stockItemId);
  expect(Number(deAfter.currentQuantity)).toBe(Number(deBefore.currentQuantity)); // unchanged (no phantom +qty)
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/__tests__/orderRepo.integration.test.js -t "remove the settled placeholder"`
Expected: FAIL — throws `Stock record not found: <deId>` (the current #556 crash) OR pushes the DE positive.

- [ ] **Step 3: Implement the settled-row no-op**

In `reverseLineStockEffect`, resolve the row **including** settled/soft-deleted state and short-circuit before the batch path. Replace the top of the function:

```js
export async function reverseLineStockEffect(stockItemId, quantity, mode, tx, actor = { actorRole: 'system', actorPinLabel: null }) {
  const qty = Number(quantity) || 0;
  // Resolve INCLUDING settled/soft-deleted so a settled Demand Entry is
  // recognised, not treated as a missing Batch.
  const anyRow = await findPgByAirtableOrUuidAnyState(stockItemId, tx);

  // Already-settled Demand Entry (new: settled_at set; legacy: soft-deleted)
  // → the demand was reconciled at delivery. Nothing physical to return. No-op.
  if (anyRow && (anyRow.settledAt || anyRow.deletedAt)) {
    return { kind: 'de', stockId: anyRow.airtableId || anyRow.id, newQty: Number(anyRow.currentQuantity), released: false };
  }

  const row = anyRow && !anyRow.deletedAt ? anyRow : null;
  const isDe = !!row && !!row.typeName && Number(row.currentQuantity) < 0;
  // ... (rest unchanged: DE-release branch from Task A2, then writeoff, then batch return)
```

Add the any-state resolver next to `findPgByAirtableOrUuid`:

```js
async function findPgByAirtableOrUuidAnyState(id, handle = db) {
  if (!id || !handle) return null;
  const isAirtableId = typeof id === 'string' && id.startsWith('rec');
  const [row] = await handle.select().from(stock)
    .where(isAirtableId ? eq(stock.airtableId, id) : eq(stock.id, id)).limit(1);
  return row ?? null;
}
```

(Guidance: the batch-`return` path still delegates to `adjustQuantity` for real Batches — a depleted Batch at qty 0 with `settled_at IS NULL` correctly returns stems. Only `settled_at`/`deleted_at` rows no-op.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/__tests__/orderRepo.integration.test.js -t "remove the settled placeholder"`
Expected: PASS. Also run the whole file: `cd backend && npx vitest run src/__tests__/orderRepo.integration.test.js` — Expected: PASS (idempotency + cancel/delete paths unaffected; a settled row no-ops there too).

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/stockRepo.js backend/src/__tests__/orderRepo.integration.test.js
git commit -m "fix(stock): reversing a settled Order Line is a no-op, not a 'not found' crash (#556)"
```

### Task A4: Adding a real flower to a delivered order decrements the batch; trace stays complete

**Files:**
- Test: `backend/src/__tests__/orderRepo.integration.test.js` (edit-adds-real-batch) + `backend/src/__tests__/varietyUsageTrace.integration.test.js` (trace includes settled DE)

**Interfaces:**
- Consumes: Tasks A2–A3. No new production code expected — these tests lock the Q2 decision ("terminal edits adjust stock normally") and the trace-completeness behavior that A2 restores by not deleting.

- [ ] **Step 1: Write the failing/locking tests**

```js
// in orderRepo.integration.test.js
it('(#556) adding a real Batch line to a Delivered order decrements that Batch', async () => {
  const { order } = await orderRepo.createOrder(makeOrderPayload({
    requiredBy: '2026-08-01',
    lines: [{ flowerName: 'Ranunculus', typeName: 'Ranunculus', quantity: 10 }],
  }));
  await orderRepo.transitionStatus(order.id, ORDER_STATUS.READY);
  await orderRepo.transitionStatus(order.id, ORDER_STATUS.OUT_FOR_DELIVERY);
  await orderRepo.transitionStatus(order.id, ORDER_STATUS.DELIVERED);

  const batch = await stockRepo.create({ 'Display Name': 'Pink Peonies (2026-08-02)', 'Type': 'Pink Peonies', 'Current Quantity': 15, date: '2026-08-02' });
  await orderRepo.editBouquetLines(order.id, {
    lines: [{ stockItemId: batch._pgId || batch.id, flowerName: 'Pink Peonies', quantity: 5 }],
    removedLines: [],
  }, true);

  const after = await stockRepo.getById(batch._pgId || batch.id);
  expect(Number(after['Current Quantity'])).toBe(10); // 15 - 5
});
```

```js
// in varietyUsageTrace.integration.test.js — trace still shows the settled DE's events
it('(#556) per-Variety trace includes a settled (qty-0) Demand Entry with its order deduction', async () => {
  // Build a DE-bound order, deliver it (settles the DE, keeps it visible),
  // then fetch the Variety trace and assert the order event is present.
  // (Mirror the existing setup in this file; key: after DELIVERED, the DE row
  // is settled_at-marked, deleted_at NULL, so getUsageByVarietyKey unions it.)
  // assert: events.some(e => e.type === 'order' && e.quantity === -<qty>)
});
```

- [ ] **Step 2: Run to verify status**

Run: `cd backend && npx vitest run src/__tests__/orderRepo.integration.test.js src/__tests__/varietyUsageTrace.integration.test.js`
Expected: the trace test PASSES if A2 restored visibility; the edit-decrement test PASSES if the existing edit path already decrements added lines. If either fails, fix minimally in `editBouquetLines` / `getUsageByVarietyKey` (the latter needs no change — it already unions non-deleted rows).

- [ ] **Step 3: Commit**

```bash
git add backend/src/__tests__/orderRepo.integration.test.js backend/src/__tests__/varietyUsageTrace.integration.test.js
git commit -m "test(stock): lock terminal-edit stock decrement + settled-DE trace completeness (#556)"
```

### Task A5: One-time data-repair script for the 57 pre-fix landmines

**Files:**
- Create: `backend/scripts/undelete-settled-des.mjs`

**Interfaces:**
- Produces: a GUARDED (`--dry-run` default; `--apply` required to write; refuses without `CLAUDE_RW`/explicit DSN) script that, for every soft-deleted `stock` row that (a) has `deleted_at IS NOT NULL` and (b) is referenced by a non-deleted `order_line.stock_item_id` on a terminal Order, clears `deleted_at` and sets `settled_at = deleted_at`. Prints every affected row in dry-run.

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
// Category: DESTRUCTIVE (writes prod when --apply). Default --dry-run is SAFE.
// Repairs the 57 pre-#556 landmines: settled Demand Entries that were
// soft-deleted by the #516 code but are still referenced by a live Order Line
// on a terminal Order. Clears deleted_at and stamps settled_at so the trace
// returns and edits stop crashing. Idempotent.
import pg from 'pg';
const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_PUBLIC_URL || process.env.CLAUDE_RW_URL;
if (apply && !url) { console.error('refusing --apply without a write DSN'); process.exit(2); }
const roUrl = process.env.CLAUDE_RO_URL || url;
const c = new pg.Client({ connectionString: apply ? url : roUrl });
await c.connect();
const SELECT = `
  select distinct s.id, s.display_name, s.deleted_at
  from stock s
  join order_lines ol on ol.stock_item_id = s.id::text and ol.deleted_at is null
  join orders o on o.id = ol.order_id and o.deleted_at is null
  where s.deleted_at is not null and s.settled_at is null
    and o.status in ('Delivered','Picked Up')`;
const rows = (await c.query(SELECT)).rows;
console.log(`${rows.length} settled Demand Entries to repair:`);
for (const r of rows) console.log(`  ${r.id}  ${r.display_name}`);
if (apply) {
  const ids = rows.map(r => r.id);
  if (ids.length) {
    await c.query(`update stock set settled_at = deleted_at, deleted_at = null, updated_at = now() where id = any($1::uuid[])`, [ids]);
    console.log(`APPLIED: repaired ${ids.length} rows.`);
  }
} else {
  console.log('\n(dry-run — re-run with --apply and a write DSN to repair)');
}
await c.end();
```

- [ ] **Step 2: Run dry-run against prod (read-only)**

Run: `CLAUDE_RO_URL='<claude_ro DSN>' node backend/scripts/undelete-settled-des.mjs`
Expected: prints ~57 rows, no write. **Do not run `--apply` — the owner approves the exact row list first.**

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/undelete-settled-des.mjs
git commit -m "chore(stock): guarded data-repair for pre-#556 soft-deleted settled DEs"
```

---

## SLICE B — Substituted original is tagged, not double-counted (#376)

Branch: `fix/substituted-original-tag`. Closes #376.

### Task B1: Grouped stock view exposes the substituted-by relationship

**Files:**
- Modify: `backend/src/repos/stockRepo.js` — `listGroupedByVariety` (attach a `substitutedBy` field to a group/row whose stock id appears in another non-deleted row's `substitute_for` array).
- Test: `backend/src/__tests__/stockRepo.grouped.integration.test.js` (or the existing grouped-view test file if present; otherwise create).

**Interfaces:**
- Produces: each Variety group in `listGroupedByVariety` carries `substitutedBy: string | null` — the display name of the substitute Variety when this group's original was substituted (its id ∈ some row's `Substitute For`), else `null`.

- [ ] **Step 1: Write the failing test**

```js
it('(#376) a Variety whose row was substituted carries substitutedBy = the substitute display name', async () => {
  const orig = await stockRepo.create({ 'Display Name': 'Dahlia Pink', 'Type': 'Dahlia', 'Colour': 'Pink', 'Current Quantity': -10, date: '2026-08-01' });
  await stockRepo.create({ 'Display Name': 'Dahlia Peach', 'Type': 'Dahlia', 'Colour': 'Peach', 'Current Quantity': 10, date: '2026-08-02', 'Substitute For': [orig._pgId || orig.id] });

  const groups = await stockRepo.listGroupedByVariety({ includeEmpty: true });
  const g = groups.find(x => x.type_name === 'Dahlia' && x.colour === 'Pink');
  expect(g.substitutedBy).toBe('Dahlia Peach');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run -t "carries substitutedBy"`
Expected: FAIL — `substitutedBy` is `undefined`.

- [ ] **Step 3: Implement**

In `listGroupedByVariety`, after building groups, resolve substitute links: collect all non-deleted rows' `substituteFor` arrays into a Map<originalId, substituteDisplayName>, then set `group.substitutedBy = map.get(anyRowIdInGroup) ?? null`. (Read `substitute_for` from the same rows already fetched; no extra round-trip if possible.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run -t "carries substitutedBy"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/stockRepo.js backend/src/__tests__/stockRepo.grouped.integration.test.js
git commit -m "feat(stock): expose substitutedBy on grouped Variety view (#376)"
```

### Task B2: Florist stock card renders the "substituted" tag

**Files:**
- Modify: `apps/florist/src/components/StockItem.jsx` (render a small badge when `substitutedBy` is set)
- Modify: `apps/florist/src/translations.js` (add `substitutedBy` label, e.g. `substitutedBy: 'заменён на'`)
- Test: `apps/florist/src/components/__tests__/StockItem.test.jsx` (create if absent; render with `substitutedBy` prop, assert badge text)

**Interfaces:**
- Consumes: `group.substitutedBy` (Task B1).

- [ ] **Step 1: Write the render test**

```jsx
it('shows a substituted badge when the Variety was substituted', () => {
  render(<StockItem item={{ type_name: 'Dahlia', colour: 'Pink', current_quantity: 0, substitutedBy: 'Dahlia Peach' }} />);
  expect(screen.getByText(/заменён на .*Dahlia Peach/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails** — `cd apps/florist && ./node_modules/.bin/vitest run src/components/__tests__/StockItem.test.jsx` → FAIL.

- [ ] **Step 3: Implement** — near the Variety name/height render, add:

```jsx
{item.substitutedBy && (
  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
    {t.substitutedBy} {item.substitutedBy}
  </span>
)}
```

- [ ] **Step 4: Run to verify it passes** — same command → PASS.

- [ ] **Step 5: Build** — `cd apps/florist && ./node_modules/.bin/vite build` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/florist/src/components/StockItem.jsx apps/florist/src/translations.js apps/florist/src/components/__tests__/StockItem.test.jsx
git commit -m "feat(florist): tag substituted original in stock list (#376)"
```

### Task B3: Dashboard stock tab renders the same tag (parity)

**Files:**
- Modify: `apps/dashboard/src/components/StockTab.jsx`
- Modify: `apps/dashboard/src/translations.js` (same `substitutedBy` key)
- Test: `apps/dashboard/src/components/__tests__/StockTab.test.jsx` (or the nearest existing dashboard stock test)

**Interfaces:**
- Consumes: `group.substitutedBy` (Task B1). Renders the identical badge next to the Variety identity string (dashboard uses the `ident` string around `StockTab.jsx:279`).

- [ ] **Step 1: Write the render test** (mirror B2, asserting the badge appears in the dashboard row).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the same amber badge next to the Variety identity in `StockTab.jsx`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Build** — `cd apps/dashboard && ./node_modules/.bin/vite build` → succeeds.
- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/StockTab.jsx apps/dashboard/src/translations.js apps/dashboard/src/components/__tests__/StockTab.test.jsx
git commit -m "feat(dashboard): tag substituted original in stock tab — parity with florist (#376)"
```

---

## Verification (before each PR)

- **Slice A** (backend + lab): `cd backend && npx vitest run`; `npm run harness &` + `npm run test:e2e`; `npm run lab:test:unit` + `npm run lab:test:api`. Quote green output. Run the A5 dry-run against prod and paste the row list into the PR / owner chat for approval before any `--apply`.
- **Slice B** (backend + two apps): `cd backend && npx vitest run`; build florist AND dashboard; `npm run lab:test:unit`.
- PR bodies name `.github/workflows/test.yml` (Vitest + E2E + `lab-api`) as the gate, and `Closes #556` / `Closes #376` on separate lines.

## ADR (fold into Slice A)

Add `docs/adr/0013-settled-demand-entries-retained-as-audit-markers.md`: settlement releases a Demand Entry to 0 and stamps `settled_at` rather than soft-deleting it, so a live Order Line's link stays valid and the trace stays complete. Reverses #516's soft-delete; grounded in ADR-0012's audit-marker-visibility rule. Trade-off recorded: kept-visible zero rows vs the phantom-FEFO concern that motivated the soft-delete (mitigated because FEFO, get-or-create, and the unique index are all gated on `quantity < 0`, so a settled 0-qty row is inert).
