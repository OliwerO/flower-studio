# Explorer — a linked-record explorer over Blossom's data (GRILLED / PRD-ready)

**Status:** vision captured 2026-07-01; **grilled 2026-07-01** (all 8 open questions resolved — see decisions below); **PRD published as GitHub issue #485** (`needs-triage`). Canonical name is now **Explorer** (see CONTEXT.md; "super-search" was the origin term). Next: `to-issues` (tracer-bullet slices from #485). Foundation (Ask Blossom drill-down suite, #484) is merged and live in prod.

## The idea (owner's words, paraphrased)

Two kinds of answer the owner needs:
1. **Quick overview** — "how much did I pay Stefan in June?" → a number/short table. **Ask Blossom** already does this.
2. **Explorer** — a structured, interactive grid that queries the DB, displays results in a mostly-predefined grid (columns from the query, like SQL), can merge tables, and lets her **drill through relationships**. Example: flower → "who bought this batch?" → the orders → each order's full info + its customer + that customer's Key Person. Extensible, from a chosen start-point.

She wants a **connection from the quick overview into the drill-down**: Ask Blossom answers, then a handoff ("Open in Explorer ▸") drops the same result into the grid, where she keeps digging by clicking — no more LLM calls needed.

## What it actually is

A **linked-record explorer** — the Airtable grid-and-linked-records experience lost in the Postgres cutover, but **query-driven** rather than hand-maintained. Not a new backend: a **second, human-driven front-end on the same query engine (`query_records`) the assistant uses.**

```
        ┌─ Ask Blossom   → natural language → answer/number      (quick overview; LLM per turn)
engine ─┤        │  "Open in Explorer ▸" handoff (same spec)   ── ONE-WAY in v1
        └─ Explorer      → clicks/filters/joins → navigable grid  (drill down; no LLM per click)
              ▲
   query_records = shared engine: declarative validated spec → safe parameterized read-only Drizzle
   (allow-listed entities/fields/ops/joins; no raw SQL; row cap + statement timeout)
```

## Resolved decisions (grill 2026-07-01)

| # | Question | Decision | Consequence |
|---|----------|----------|-------------|
| 1 | Drill depth: navigation vs flat report | **Both — navigation drill in v1, flat multi-hop report in v2** | v1 drilling = each hop is a fresh **single-hop `query_records` seeded by the clicked row's FK**. No deep-join engine work in v1. Flat denormalized multi-table reports (one grid spanning 3 chained tables) = v2, needs the deep-join extension. |
| 2 | Entity set for v1 | **Core: Stock/Flowers, Orders, Customers, Key People, Order Lines, Purchases, Deliveries. Plus: Stock Orders (POs), Write-offs, Florist Hours, Marketing. Premade Bouquets deferred.** | New tables to add to the `query_records` allow-list: **`key_people`, `stock_orders` (+ lines), `florist_hours`**. Already present: orders, customers, order_lines, stock, purchases, writeoffs, deliveries, marketing. Hours & Marketing are near-standalone → filterable list surfaces more than drill targets. |
| 3 | App scope | **Dashboard only** | Explicit, documented exception to the florist↔dashboard parity rule — Explorer is an owner exploration tool, not a shared operational feature. Desktop-only, owner-only. |
| 4 | Saved views | **Yes in v1** | New `saved_views` table (owner-scoped) + save/rename/delete + a views list. The single biggest scope-add. |
| 5 | Export | **CSV of current grid** | Client-side dump of loaded rows (respects the row cap). Print piggybacks on the browser. |
| 6 | Editing from the grid | **Read-only + deep-link** | The grid never mutates data — preserves the "only emits the validated read spec" safety guarantee. A row deep-links into the EXISTING edit screen (OrderDetailPanel, CustomerDetailView, StockTab). |
| 7 | In-grid aggregation | **Flat rows + optional group-by / count-sum** | The engine already supports `groupBy` + `aggregate`, so this is mostly a UI toggle. Full 2D pivot stays v2. |
| 8 | Assistant handoff direction | **One-way in v1** (Ask Blossom → Explorer) | Two-way (send grid state back to the assistant to summarize) deferred to v2. |

## Architecture (the load-bearing constraints — see ADR-0010)

1. **Explorer is a read-only second front-end on `query_records`.** The UI can only emit the same validated declarative spec the assistant emits — allow-listed entities/fields/ops/joins, row cap, statement timeout, no raw SQL. This is what makes an owner-facing "query anything" surface safe.
2. **Navigation drill = a sequence of seeded single-hop queries, NOT deep joins.** Clicking a row opens a fresh `query_records` on the related entity, filtered by the clicked row's key. This reuses today's engine untouched and sidesteps cycle/row-explosion risk. (Flat multi-hop reports in v2 are the only thing that needs the deep-join engine extension.)
3. **Edits happen only via deep-link into existing screens** — never in-grid — so the read-only spec-only guarantee holds and cascade/validation logic is never duplicated.

## Why it's safe by construction

The human UI can only emit the **same validated declarative spec** the assistant does. It can't run anything the allow-list forbids — no raw SQL, no injection, no unbounded queries. Same `validateSpec` + row cap + statement timeout. Read-only; the only "write" path is a deep-link that opens the record's real edit screen.

## Rough shape (for the PRD)

- **Start-point picker:** choose an entity (flower/batch, order, customer, supplier, PO, write-off, delivery, hours, marketing).
- **Filters:** reuse the per-entity field allow-list (same as the assistant's spec).
- **Columns:** defined by the query; sensible defaults per entity; owner can add/remove.
- **Drill / follow-link:** from a row, curated "show related X" actions (flower → purchases → supplier; flower → order_lines → orders → customer → key_people). Each = a seeded single-hop query.
- **Summarize toggle:** optional group-by + count/sum (engine-backed).
- **Saved views:** name + revisit a start-point + filters + columns.
- **Export CSV** of the current result set.
- **Reuse the Orders-grid look** (sort headers, filter chips) for familiarity; generic columns.
- **Assistant handoff:** Ask Blossom returns an optional spec → "Open in Explorer ▸" seeds the grid.

## Relationship to the drill-down suite (#484, merged)

The drill-down suite is **the foundation**, not a competing thing:
- **S1** expanded `query_records` to `purchases / writeoffs / deliveries / marketing` (+ orders/customers/order_lines/stock). That entity+join allow-list **is** the relationship graph Explorer navigates.
- **S4** built the assistant→view handoff pattern (`open_orders_view` → "Open in Orders" button). Explorer generalizes S4 from one entity (orders) to any entity + follow-the-links.
- The **Tier-3 "generic result table"** idea = the seed of Explorer's grid.

## Phasing (proposed for the PRD)

- **P0 (done / live):** drill-down suite — query_records entity expansion + purchase_detail + list_values + orders bridge (#484).
- **P1 engine:** add `key_people`, `stock_orders`, `florist_hours` to the `query_records` allow-list (+ their drill joins). Still single-hop.
- **P2 UI:** generic result grid (start-picker + filters + columns + sort + summarize toggle) on the Dashboard, reading `query_records`.
- **P3 drill:** curated follow-link navigation between related entities (seeded single-hop queries) + row deep-links into existing edit screens.
- **P4 saved views + export:** `saved_views` table + CRUD + list; CSV export.
- **P5 handoff:** "Open in Explorer ▸" from Ask Blossom (one-way).
- **v2 (out of scope):** flat multi-hop reports (deep-join engine), two-way assistant handoff, Premade Bouquets entity, florist-app parity.

## Next step

Run `to-prd` on this doc → GitHub Issue, then `to-issues` for tracer-bullet slices. This doc is the PRD input; all 8 design forks are resolved above.
