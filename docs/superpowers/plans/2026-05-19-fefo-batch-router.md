# FEFO batch router for order-line stock attribution

**Closes:** #319 (Hydrangea White shortfall on 18.May batch)
**Precursor to:** #283 (Stock model v1 — Demand Entries + reservation model)
**Branch:** `feat/fefo-batch-router`
**Scope:** tactical patch. Schema unchanged. UI unchanged.

## Problem

Under `STOCK_Y_MODEL=true`, the bouquet picker groups `stock_items` by Variety
(four-tuple: `type_name`, `colour`, `size_cm`, `cultivar` — ADR-0006). When a Variety
has multiple positive Batches (different arrival dates), the picker returns a single
representative row. Whichever Batch's `id` the picker passes is decremented by
`orderRepo.createOrder` step 4 (`stockRepo.adjustQuantity(line.stockItemId, -qty)`).

Result on prod (#319): Hydrangea White had 7 stock rows. Orders bound to one row
(`recuxLEjqprNAttpr`) drained it to `qty=-2` while a newer Batch (`bd25114d`, qty=2,
18.May) sat untouched. Picker selection was arbitrary; the underlying model has no
notion of "which Batch should drain first".

## Fix

Backend self-heals at order-line write time. When a line's `stockItemId` resolves
to a Y-model Batch (`typeName` set, `currentQuantity >= 0`), reroute the FK to the
**oldest non-negative Batch** of the same Variety. If none has enough cover, pick
the oldest Batch period (let it go negative — current semantic). Schema, picker, and
UI unchanged. Pure backend behavior change inside one transaction.

## Locked design decisions (vs ADRs + CONTEXT.md)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | FEFO active only when `STOCK_Y_MODEL=true` | Legacy path uses display-name string match; Variety identity isn't reliable. ADR-0007 keeps Batch-decrement model regardless. |
| D2 | Lazy FEFO — single Batch per line, no splits | Schema `order_lines.stock_item_id` is 1:1. Splitting → multi-line shape, deferred to #283. |
| D3 | Order: `date ASC NULLS LAST`, then `created_at ASC` | `date` column on `stock_items` is Y-model arrival date (ADR-0005). NULL `date` = legacy/untyped row, deprioritise. |
| D4 | "Non-negative" = `current_quantity >= line.quantity` (full cover) | Pick oldest Batch that can fully cover. If none fully covers → pick oldest Batch period (will go negative — matches existing semantic that negative = shortfall signal). |
| D5 | Variety match = exact 4-tuple, NULL-aware | Per ADR-0006. NULL `colour` ≠ `colour='Green'`. |
| D6 | Apply at create AND edit (orderRepo.createOrder + editOrderBouquet) | Edit path also calls `adjustQuantity(stockItemId, delta)` for new/increased lines. Same drift risk. |
| D7 | Skip for Demand Entry rows (`current_quantity < 0`) | Step 3b already routes those through `getOrCreateDemandEntry`. FEFO is for Batches only. |
| D8 | Premade bouquet build path untouched | Under Y, builds use reservation (no Batch decrement). Sale path goes through `createOrder` → FEFO automatic. |
| D9 | Cancel-with-return unchanged | Refund returns to whichever Batch the line was bound to post-FEFO. Correct by construction. |
| D10 | Concurrency: `SELECT ... FOR UPDATE` on candidate Batches inside resolver | Production PG only. Pglite tests run single-connection; skip lock there per existing pattern in `getOrCreateDemandEntry`. |

## Out of scope (deferred to #283)

- Splitting a line across multiple Batches.
- Migrating already-drifted `order_lines.stock_item_id` FKs to point at the right Batch (one-time backfill, separate PR).
- Reservation model for orders (ADR-0007 explicitly defers).
- Driver-of-day rebalancing of already-negative Batches.

## Vertical slices

### Slice 1 — `resolveBatchByFEFO` helper

**Files:** `backend/src/repos/stockRepo.js` (+helper), `backend/src/__tests__/stockRepo.fefo.test.js` (new).

**Signature:**
```js
export async function resolveBatchByFEFO(varietyKey, lineQty, tx) {
  // 1. SELECT id, current_quantity, date FROM stock
  //    WHERE type_name = :typeName
  //      AND colour IS NOT DISTINCT FROM :colour
  //      AND size_cm IS NOT DISTINCT FROM :sizeCm
  //      AND cultivar IS NOT DISTINCT FROM :cultivar
  //      AND deleted_at IS NULL
  //      AND current_quantity >= 0          -- Batches only, not DEs
  //    ORDER BY date ASC NULLS LAST, created_at ASC
  //   (FOR UPDATE if production PG)
  // 2. From the result set, pick first row with current_quantity >= lineQty
  //    Fallback: pick first row (oldest, will go negative)
  //    If no rows at all: return null (caller skips FEFO)
}
```

**Tests (unit + pglite integration):**
- Single positive Batch → returns it.
- Two positive Batches (old short, new full) → returns NEW (full-cover wins over date).
- Two positive Batches (old full, new full) → returns OLD (date wins when both cover).
- Two positive Batches both short → returns OLD (fallback).
- Mix of Batch + DE rows → DE rows skipped (only Batches considered).
- No Batches at all → returns null.
- NULL `colour` matches only NULL `colour` (not `''`, not `'Green'`).

**LOC:** ~80 helper + ~150 test. **Files touched:** 2.

### Slice 2 — wire into `orderRepo.createOrder`

**Files:** `backend/src/repos/orderRepo.js`, `backend/src/__tests__/orderRepo.fefo.integration.test.js` (new).

Insert FEFO routing block between line insert (current line ~597) and Y-model DE step (current line ~608). For each line whose `stockItemId` resolves to a Batch with `typeName` set and `current_quantity >= 0`:

```js
const [stockRow] = await tx.select({ ... }).from(stock).where(...).limit(1);
if (stockRow?.typeName && stockRow.currentQuantity >= 0) {
  const varietyKey = { typeName, colour, sizeCm, cultivar };
  const targetId = await resolveBatchByFEFO(varietyKey, line.quantity, tx);
  if (targetId && targetId !== line.stockItemId) {
    await tx.update(orderLines)
      .set({ stockItemId: targetId, updatedAt: new Date() })
      .where(eq(orderLines.id, createdLines[i].id));
    createdLines[i] = { ...createdLines[i], stockItemId: targetId };
    line.stockItemId = targetId;  // so step 4 adjusts the right row
  }
}
```

**Tests (integration — pglite, mirrors #319 shape):**
- Variety with 2 positive Batches (old 5/16 qty=5, new 5/18 qty=2). Picker passes new (5/18). Create order with qty=3. → 5/16 decrements to 2, 5/18 stays at 2.
- Variety with 1 positive Batch + 1 DE → still routes to Batch (DE skipped).
- Variety with 1 positive Batch only → no rerouting, behavior unchanged.
- STOCK_Y_MODEL=false → no rerouting, behavior unchanged.

**LOC:** ~30 wiring + ~200 test. **Files touched:** 2.

### Slice 3 — wire into `orderRepo.editOrderBouquet`

**Files:** `backend/src/repos/orderRepo.js`, extend `backend/src/__tests__/orderRepo.fefo.integration.test.js`.

Same FEFO routing applied to:
- New lines added via edit (lines without `id`).
- Existing lines whose `quantity` is increased AND whose original Batch can no longer cover the new quantity (i.e. the delta would push it negative).

For pure quantity decreases or unchanged lines: skip (would churn FKs needlessly).

**Tests:**
- Edit adds new line → FEFO routes it.
- Edit increases qty on a line still covered by original Batch → no reroute.
- Edit increases qty beyond original Batch cover → reroute (no — DEFERRED, see note below).

**Note:** Re-routing an existing line on edit changes the audit trail (line started against Batch A, ends up against Batch B). Simpler v1: only route NEW lines added during edit. Existing-line quantity changes keep original FK. Deferred to a follow-up if drift is observed.

**LOC:** ~20 wiring + ~80 test. **Files touched:** 1 + 1 test extension.

### Slice 4 — pre-PR matrix + PR

Per CLAUDE.md Pre-PR Verification:

- `cd backend && npx vitest run` (unit + integration)
- `npm run harness &` + `npm run test:e2e` (E2E suite — no shape change, smoke only)
- `npm run lab:test:unit` + `npm run lab:test:api` (lab harness gate — backend changed)
- No frontend touched → no `vite build` needed.

PR body:
- Closes #319 (separate line — per memory `feedback_pr_closes_syntax`).
- Names verification path: backend vitest + lab:test:api integration test.
- Links #283 as structural follow-up.

## Cost target

≤300 LOC implementation, ≤500 LOC tests, ≤4 files touched. Single Opus 5h window
target. Sonnet implementer per task (no FEFO task touches Known Pitfall files
listed in CLAUDE.md — stock-math helpers + StockItem.jsx/StockTab.jsx are
read-only adjacent). Opus reviews only at end-of-feature.
