# Explorer deep-join reports follow fixed descriptor-edge chains, not arbitrary joins

**Status:** accepted (2026-07-02, Explorer v2 grill — see `docs/superpowers/plans/2026-07-02-explorer-v2.md`)

**Extends:** ADR-0010 (Explorer is a read-only second front-end on `query_records`). ADR-0010 deferred "flat multi-hop denormalized reports (the only case needing chained joins + a cycle/row-explosion guard)" to v2. This ADR decides how that engine work is done.

## Decision

Explorer v2's **deep-join report** flattens a **fixed chain of the relationship edges already declared in the schema descriptor** into one denormalized grid. The owner starts at an entity and appends hops by following the descriptor's existing drill edges (Flower → orders that used it → order's customer → customer's key person); each appended hop is one predefined edge, chained. The `query_records` engine gains chained-join support constrained to those edges. It does **not** become an arbitrary entity-to-entity join builder — the owner cannot pick two unrelated entities and join them on chosen keys. That (the **Arbitrary join builder**) is deferred to v3.

Guards, so the read-only safe-by-construction guarantee survives the new join depth:

1. **Edges only.** A hop must be a declared descriptor edge (same allow-list that powers navigation drilling). No free-form join predicates. This makes cartesian products structurally impossible — every join is along a known FK relationship.
2. **Fan-out cap + warning.** Following a "many" edge multiplies rows. The engine caps total output at the existing `ROW_CAP` and the UI warns when a chain fans out, rather than silently truncating.
3. **Cycle bound.** A chain has a fixed maximum hop count; revisiting an entity already in the chain is disallowed, so no infinite traversal.
4. Still read-only, still a validated declarative spec, still no raw SQL — the spec grammar gains a `chain` construct; the executor stays parameterized Drizzle.

## Why

The owner's stated need ("query anything, drill anywhere, see it as one grid") is fully served by chaining the edges that already exist — the same edges navigation drilling walks one at a time. Reusing them means:

- **Safe by construction, still.** Joining only along declared FK edges means no cartesian explosion and no injection surface; the deep-join engine inherits ADR-0010's guarantees instead of reopening them.
- **One relationship graph, two depths.** Navigation drilling (v1) walks one edge per click; a deep-join report (v2) walks N edges at once. Both read the *same* descriptor edge definitions — no second source of truth for "how entities relate."
- **Arbitrary joins are a different risk class.** Free-form entity-to-entity joins on chosen keys reintroduce cartesian/cycle risk and need a real query planner + explosion guard. That is a v3 decision with its own trade-offs; shipping fixed chains first delivers the owner's concrete examples with bounded risk and lets real usage inform whether arbitrary joins are ever needed.

## Considered and rejected

- **Arbitrary join builder in v2** — rejected (deferred to v3): reintroduces cartesian-explosion + cycle risk that ADR-0010 was designed to avoid; the owner's examples are all fixed chains along existing edges, so the power isn't needed yet. Captured as a v3 follow-up.
- **Materialized report views / a reporting API** — rejected (same reasoning as ADR-0010): duplicates access rules, drifts from Ask Blossom's canonical numbers.
- **Client-side stitching of multiple single-hop queries** — rejected: N sequential round-trips, no server-side row cap across the joined set, and the fan-out/dedup logic would live in the browser where it can't be enforced.

## Consequences

- `query_records` grammar gains a bounded `chain` construct; the allow-list of edges = the descriptor drill edges (already defined for v1). Widening reachable chains = adding descriptor edges, which also widens Ask Blossom — one allow-list, two front-ends (per ADR-0010).
- **Pivot** (Explorer v2, item B) is deliberately kept *out* of this engine change: a 2-D pivot is a client-side reshape of a two-field `group-by` result (measures the engine's `aggregate` already supports), so it emits an ordinary validated spec and needs no join-depth change. Pivot's safety story is unchanged from ADR-0010.
- A future arbitrary-join-builder (v3) must revisit this ADR — it is a different risk class, not an increment.
