# Explorer is a read-only second front-end on the `query_records` spec

**Status:** accepted (2026-07-01, grill for the Explorer feature — see `docs/superpowers/plans/2026-07-01-super-search-vision.md`)

## Decision

**Explorer** (the owner-facing linked-record grid; "super-search" was the origin term) is built as a **second human-driven front-end on the same `query_records` engine Ask Blossom uses** — not as a bespoke reporting API and not as a SQL console. The UI can only emit the same **validated declarative spec** the assistant emits (allow-listed entities/fields/ops/joins in `dataQueryPack.js`, row cap, statement timeout, parameterized read-only Drizzle, no raw SQL). Two further constraints follow:

1. **Navigation drilling is a sequence of seeded single-hop queries, not deep joins.** Clicking a row opens a fresh `query_records` on the related entity filtered by the clicked row's key. v1 reuses the single-hop engine untouched; flat multi-hop denormalized reports (the only case needing chained joins + a cycle/row-explosion guard) are deferred to v2.
2. **Explorer never mutates data.** Rows deep-link into the *existing* edit screens (OrderDetailPanel, CustomerDetailView, StockTab); there is no in-grid editing.

## Why

The owner wants a "query anything, drill anywhere" surface. The naive implementations are dangerous or expensive: a raw-SQL console is an injection/foot-gun surface on the live production DB; a bespoke reporting API duplicates access rules and drifts from the assistant's numbers. Reusing `query_records` means Explorer inherits the allow-list, row cap, timeout, and read-only guarantee **for free** — it is safe by construction and can never reach data or run a query the assistant couldn't. Keeping edits behind deep-links means the order↔delivery cascades and stock math (which already live in the real screens) are never re-implemented, so the read-only spec-only guarantee holds.

## Considered and rejected

- **Raw-SQL console for the owner** — rejected: injection/mistake surface on the production DB; no allow-list.
- **Bespoke read API per report** — rejected: duplicates access rules, drifts from Ask Blossom's canonical numbers, doesn't generalize to arbitrary drill paths.
- **In-grid editing** — rejected for v1: would duplicate cascade/validation logic and break the "only emits a validated read spec" safety story. Deep-link to existing screens instead.
- **Deep/chained joins in v1** — rejected: navigation drilling via seeded single-hop queries covers the owner's stated examples with zero engine change and no cycle/row-explosion risk. Deep joins revisited in v2 for flat multi-hop reports.

## Consequences

- Extending Explorer's reach = extending the `query_records` allow-list (v1 adds `key_people`, `stock_orders`, `florist_hours`), which simultaneously widens what Ask Blossom can answer — one allow-list, two front-ends.
- Any future "edit from Explorer" request must reopen this ADR; it is not a small change.
- Dashboard-only + owner-only is a deliberate, documented exception to the florist↔dashboard parity rule (Explorer is an exploration tool, not a shared operational feature).
