# Per-Variety trace surface unions per-Batch usage; absorption deferred, drift surfaced as "unaccounted stems"

PRD #324 T5. Extends the per-Batch trace of ADR-0007 to the whole Variety. A new endpoint `GET /api/stock/varieties/:key/usage` returns `{ variety, events, unaccountedStems }`, where `events` is the union of the existing per-Batch usage trails across every non-deleted Stock row (all Batches + Demand Entries) sharing the Variety 4-tuple key, sorted oldest→newest. A new shared presenter `VarietyTracePanel` renders it: inline under the expanded Variety row on the Dashboard, in a modal on the Florist app (matching each app's existing Batch-trace convention). The Owner taps a Variety header to see "everything that ever happened to this flower across all its batches."

This is a **read-only** surface. It introduces no new table. Consumption events continue to come from the `order_line.stockItemId` FK (ADR-0007's authoritative link); the `order_line_consumptions` ledger named by the PRD #324 umbrella (slices T1–T4) is **not built here** — it is future work that will extend this surface, not replace it.

## Why

ADR-0007 already surfaces per-Batch consumers and noted that "unaccounted" stems require manual audit-log inspection. The Owner's question is usually Variety-level ("where did my Peony Pink go?"), which previously meant tapping each Batch in turn. Unioning the existing per-Batch trails answers it in one tap with zero new data model.

`unaccountedStems` is the signed sum of every event quantity (purchases positive; orders/write-offs/premades negative). Non-zero means the Variety's traced events don't reconcile to its net movement — drift. The footer surfaces it immediately instead of requiring an audit-log dig.

## Absorption events — deferred

PRD #324 specifies a fifth event kind, `absorption` (a PO receipt folding stems into a pre-existing negative Demand Entry in one transaction, ADR-0002), detected by a self-join of the audit log on `transaction_id`. **`audit_log` has no `transaction_id` column** (only `id`, `entity_type/id`, `diff` jsonb, `created_at`), and T5's no-migration boundary forbids adding one. Per the PRD's own stated fallback, un-paired absorptions therefore surface inside `unaccountedStems` rather than as paired rows. Real absorption events become a follow-up slice once a transaction id exists in the audit write path.

## Audit-marker visibility

`stockRepo.listGroupedByVariety` previously dropped a Variety group whose on-hand `totalQty === 0` and `reservedForPremades === 0` under `includeEmpty=false`. Relaxed: such a group is kept when at least one of its rows is still referenced by a non-deleted `order_line.stock_item_id` (an active consumer). This keeps the absorption-anchor Demand Entry behind #323 visible so its trace stays reachable. (Post-#327, the orig DE also carries `type_name`, so it already passes the `type_name IS NOT NULL` filter; this relax covers the remaining zero-qty-with-consumer case.)

## Considered alternatives

- **Timestamp-window heuristic for absorption** — pair same-Variety opposite-sign stock-qty audit rows within the same ~second. Rejected for the MVP: risks false pairings if two unrelated opposite-sign changes coincide; the unaccounted footer already exposes the same drift without the false-positive risk.
- **Add `transaction_id` to `audit_log`** — exact pairing, but a schema migration touching the audit writer used everywhere; out of T5's no-migration scope. Reserved for the absorption follow-up.

## Consequences

- The trace surface is correct the moment Variety attrs are present (precondition #327, already landed).
- When the consumption ledger (T1) lands, `getUsageByVarietyKey` switches its consumption source from `order_line.stockItemId` to the ledger without changing the response shape or the `VarietyTracePanel` contract.
- ADR-0007's "`order_line.stockItemId` is the authoritative trace link" remains live; #324's ledger will eventually supersede it, but not in T5.
