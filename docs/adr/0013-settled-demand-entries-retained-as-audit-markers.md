# Settlement stamps settled_at instead of soft-deleting a released Demand Entry

Issue #556 (crash) / #557 (root cause). A terminal-order Settlement (`stockRepo.settleLineDemand`, via the shared `reverseLineStockEffect` release branch) reconciles a Demand Entry's remaining shortfall to 0 — FEFO-consuming real Batches for the stems that physically shipped, then releasing whatever the DE still owes. When that release brings the row to `current_quantity >= 0`, the row is now marked **settled** — a new `stock.settled_at` timestamp is stamped — instead of being soft-deleted (`deleted_at`). `deleted_at` stays `NULL`. This applies to every release path that shares the branch: terminal settlement, order cancellation, order deletion, and a bouquet-edit line removal (`return` or `writeoff`) — any of them can drive a Demand Entry to 0.

This reverses the soft-delete introduced by #516 (the original terminal-settlement implementation), which is why the four existing DE-family regression tests (`orderRepo.deFamily.integration.test.js`, C5/C19) and three of the Y-model settlement tests (`orderRepo.integration.test.js`) needed their assertions flipped from "soft-deleted" to "settled, kept visible" in the same change.

## Why

A settled Demand Entry does not disappear from the world just because its quantity reached zero — it is still the thing a real, past Order Line's `stock_item_id` points at. Soft-deleting it severed that link:

- **The crash (#556).** `stockRepo.reverseLineStockEffect` resolved the linked row via `findPgByAirtableOrUuid`, which filters `deleted_at IS NULL`. Once #516 soft-deleted a settled DE, any later attempt to touch that same Order Line again — an owner editing a Delivered order to add/remove a bouquet line — resolved to "row not found," fell through to the Batch/legacy branch, and `adjustQuantity` threw `Stock record not found`. Editing a delivered order became a 500.
- **The trace gap (#557).** `getUsageByVarietyKey` unions every non-deleted row in a Variety. A soft-deleted settled DE vanished from the per-Variety trace (ADR-0012) even though it drove a real order's consumption — the owner's "where did my Peony Pink go" answer silently lost an event.

Both symptoms have the same root cause: the settlement code treated "demand fully reconciled" as synonymous with "this row no longer exists," when in fact the row is exactly what ADR-0012 calls an audit marker — evidence of something that happened, which must stay reachable even at zero quantity.

## The fix

- New nullable `stock.settled_at` column (migration `0022_stock_settled_at.sql`). `NULL` for every row except a Demand Entry whose full release brought it to `current_quantity >= 0` via `reverseLineStockEffect`.
- `reverseLineStockEffect` resolves the target row **including** settled/soft-deleted state (`findPgByAirtableOrUuidAnyState`, no `deleted_at` filter) before branching. If the resolved row already carries `settled_at` OR (legacy) `deleted_at`, the function returns `{ kind: 'de', released: false }` — a no-op that moves no stock — instead of falling through to the Batch path. A genuinely depleted Batch (`settled_at` and `deleted_at` both `NULL`, `current_quantity = 0`) is unaffected and still returns stems normally through `adjustQuantity`.
- `getByIdIncludingSettled` (a `getById` that doesn't filter `deleted_at`/`settled_at`) lets both the reverse seam's tests and any future caller inspect a settled row directly.
- A one-time GUARDED script (`backend/scripts/undelete-settled-des.mjs`, dry-run by default) repairs the rows #516 already soft-deleted on prod before this fix landed: it clears `deleted_at` and stamps `settled_at = deleted_at` for any soft-deleted row still referenced by a live Order Line on a terminal Order.

## Trade-off: kept-visible zero rows vs. the phantom-FEFO risk that motivated the soft-delete

#516 soft-deleted a released DE specifically so it could never resurface as a phantom 0-qty Batch candidate — `resolveBatchByFEFO` selects `current_quantity >= 0`, and an unmarked zero-qty DE row is indistinguishable from a genuinely empty Batch.

A settled row (kept visible, `deleted_at` still `NULL`) is inert for exactly the same reason a soft-deleted row was, because every consumer of Demand-Entry identity gates on `current_quantity < 0`, not on `deleted_at`:
- `resolveBatchByFEFO` only considers `current_quantity >= 0` rows as Batch candidates — a settled DE at 0 qualifies by quantity, same as before, so this was never the real guard; the guard that actually matters is downstream (see below).
- `getOrCreateDemandEntry`'s "existing DE" lookup requires `current_quantity < 0` — a settled row at 0 can never be re-adopted as a Demand Entry.
- The `stock_demand_variety_date_idx` partial unique index (migration `0013`) is itself a partial index gated on `current_quantity < 0` — a settled row at 0 falls outside it and cannot collide with a fresh DE for the same Variety + date.

So the settled row can appear in a FEFO scan as an available (empty) Batch — the same as any other spent Batch at 0 stems always could. That is an existing, accepted behavior of the Batch model (ADR-0007), not a new risk this ADR introduces.

## Considered alternatives

- **Keep the soft-delete, add a separate "was settled" audit table.** Rejected — a new table duplicates identity that already lives on the `stock` row, and the crash's root cause (a live FK pointing at a deleted row) would remain unfixed; the Order Line's `stock_item_id` still needs to resolve to *something*.
- **Keep the soft-delete, teach every caller to resolve `stockItemId` including deleted rows.** Rejected — this is what Task A3 already does at the one seam that needs it (`reverseLineStockEffect`), but it doesn't fix the trace gap (#557): `getUsageByVarietyKey` would still need a matching "including deleted" relaxation, which is a second, parallel special case for what is really the same underlying fact (the row is settled, not gone).

## Consequences

- `getUsageByVarietyKey` needed **no change** — it already unions every `deleted_at IS NULL` row; a settled DE simply stays inside that set instead of being excluded.
- `stockRepo.listGroupedByVariety`'s existing audit-marker-visibility relax (ADR-0012, "kept when at least one row is still referenced by a non-deleted Order Line") already covers a settled DE at qty 0 the same way it covers any other zero-qty audit marker — no change needed there either.
- Any future release path that reaches zero via `reverseLineStockEffect` gets this behavior automatically — there is exactly one place a "should this row disappear" decision is made.
- The `settled_at` column is a pure audit marker: no code branches read it for business logic other than the no-op check in `reverseLineStockEffect` and the (for now, dry-run-only) data-repair script. It answers "did this row reach zero via settlement" for a human or a future trace feature, not "is this row usable."
