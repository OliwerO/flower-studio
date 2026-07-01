# Super-Search — a linked-record explorer over Blossom's data (DRAFT / pre-grill)

**Status:** vision captured 2026-07-01, NOT yet grilled. Owner wants this as its own `/feature` AFTER the Ask Blossom drill-down suite lands (PR from `feat/assistant-drilldown-suite`). This doc is the grill starting point + PRD seed.

## The idea (owner's words, paraphrased)

Two kinds of answer the owner needs:
1. **Quick overview** — "how much did I pay Stefan in June?" → a number/short table. The **Ask Blossom** assistant already does this (and is stronger after the drill-down suite).
2. **Super-search** — a structured, interactive surface that queries the DB and displays results in a mostly-predefined grid (columns defined by the query, like SQL), **can merge tables**, and lets the owner **drill down through relationships**. Example: start from a flower → "who bought this batch?" → the list of orders → each order's full info + its customer + that customer's key person. Extensible, from a chosen starting point.

She wants a **connection from the quick overview into the drill-down**: the assistant answers, then a handoff ("Open in Explorer ▸") drops the same result into super-search, where she keeps digging by clicking — no more LLM calls needed.

## What it actually is

A **linked-record explorer** — the Airtable grid-and-linked-records experience lost in the Postgres cutover, but **query-driven** rather than hand-maintained. Not a new backend: a **second, human-driven front-end on the same query engine the assistant uses.**

```
        ┌─ Ask Blossom   → natural language → answer/number      (quick overview; LLM per turn)
engine ─┤        │  "Open in Explorer ▸" handoff (same spec)
        └─ Super-search  → clicks/filters/joins → navigable grid  (drill down; no LLM per click)
              ▲
   query_records = shared engine: declarative validated spec → safe joined SQL
   (allow-listed entities/fields/ops/joins; no raw SQL; row cap + statement timeout)
```

## Relationship to what we just built (the drill-down suite)

The drill-down suite (branches merged into `feat/assistant-drilldown-suite`) is **the foundation**, not a competing thing:
- **S1** expanded `query_records` to `purchases / writeoffs / deliveries / marketing` (+ orders/customers/order_lines/stock). That entity+join allow-list **is** the relationship graph super-search navigates.
- **S4** built the assistant→view handoff pattern (`open_orders_view` → "Open in Orders" button). Super-search generalizes S4 from one entity (orders) to any entity + follow-the-links.
- The **Tier-3 "generic result table"** idea = the seed of super-search's grid.

Nothing is wasted; super-search sits on top.

## Why it's safe by construction

The human UI can only emit the **same validated declarative spec** the assistant does. It can't run anything the allow-list forbids — no raw SQL, no injection, no unbounded queries. Same `validateSpec` + row cap + statement timeout.

## The one real engine gap for the full vision

`query_records` today does **shallow** joins (one hop). The owner's example is **multi-hop**: `order_lines → orders → customers → key_people` (3 hops). Deep/chained join traversal is the main engine extension super-search needs. Everything else is UI.

## Rough shape (to be refined in the grill)

- **Start-point picker:** choose an entity (flower/batch, order, customer, supplier, PO, write-off…).
- **Filters:** reuse the per-entity field allow-list (same as the assistant's spec).
- **Columns:** defined by the query; sensible defaults per entity, owner can add/remove.
- **Drill / follow-link:** from a row, "show related X" (batch → purchases → supplier; batch → order_lines → orders → customer → key_people).
- **Reuse the Orders-grid look** (sort headers, filter chips) for familiarity; generic columns.
- **Assistant handoff:** assistant returns an optional spec → "Open in Explorer ▸" seeds the grid.

## Open questions to grill (before PRD/build)

1. **Depth:** how many hops must drill-down support? Fixed chains (predefined paths) or arbitrary graph navigation? (Fixed chains are far cheaper + safer; arbitrary needs a cycle/row-explosion guard.)
2. **Entity set for v1:** which start-points matter most? (Likely orders + customers + purchases/suppliers + stock/batches.)
3. **One screen or per-app?** Dashboard-only (desktop, owner) first, or florist parity too? (Super-search is desktop-heavy; maybe dashboard-first, unlike most parity rules.)
4. **Column config persistence:** ephemeral per session, or saved "views" she can name and revisit? (Saved views = a small new table.)
5. **Export?** Does she need CSV/print of a result set, or purely on-screen exploration?
6. **Write actions from the grid?** Pure read explorer, or can she jump from a row into edit (open the order/customer)? (Read-only v1 recommended; deep-link to existing edit screens rather than editing in-grid.)
7. **Aggregations in-grid?** group-by + sum/count columns (a mini pivot), or flat rows only for v1?
8. **Relationship to the assistant:** is the handoff one-way (assistant → explorer), or can the explorer state be handed back to the assistant to summarize?

## Phasing (proposed)

- **P0 (done / landing):** drill-down suite — query_records entity expansion + purchase_detail + list_values + orders bridge.
- **P1 engine:** multi-hop joins in query_records + a stable "relationship graph" definition (which entity links to which, allowed hop paths).
- **P2 UI:** generic result grid (start-picker + filters + columns + sort) on dashboard, reading query_records.
- **P3 drill:** follow-link navigation between related entities.
- **P4 handoff:** "Open in Explorer ▸" from Ask Blossom.
- **P5 (maybe):** saved views, export.

## Next step

After the drill-down suite PR merges, run `/feature` starting with a grill on the open questions above (`grill-with-docs`), then `to-prd`. This doc is the grill input.
