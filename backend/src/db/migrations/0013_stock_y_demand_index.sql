-- Stock Y-model dated Demand Entry deduplication (issue #286).
--
-- Enforces at-most-one Y-model Demand Entry per (Variety, date).
-- Predicate: current_quantity < 0 AND type_name IS NOT NULL — Y-model
-- Demand Entries only. Legacy aggregate Demand Entries (pre-Y-model:
-- no type_name, no date) are intentionally excluded so the baseline
-- scenario and prod's pre-cutover state remain valid. The cutover
-- script (#291) sets type_name on every legacy aggregate before the
-- flag flips, at which point all DEs become Y-model and fall under
-- this constraint. The legacy aggregate "at most one DE per Variety"
-- invariant from ADR-0002 holds organically (one row, type_name null,
-- date null — not in the index).
--
-- NULLS NOT DISTINCT: NULL colour and colour='Green' are different
-- Varieties per ADR-0006 strict identity. Without this clause, PG
-- would treat all NULL-colour rows as equal and collapse different
-- cultivar-null Varieties.
--
-- Postgres 15+ / pglite 0.4.5 (PG 17 WASM) both support NULLS NOT
-- DISTINCT. Railway Postgres plugin provisions PG 16+. No fallback.

CREATE UNIQUE INDEX IF NOT EXISTS stock_demand_variety_date_idx
  ON stock (type_name, colour, size_cm, cultivar, date)
  NULLS NOT DISTINCT
  WHERE current_quantity < 0 AND type_name IS NOT NULL;

--> statement-breakpoint

-- Performance index: find all Y-model Demand Entries for a given Variety fast.
-- Used by getOrCreateDemandEntry's SELECT and the Required By cascade.
-- Predicate matches the unique index above so the planner picks one of them.
CREATE INDEX IF NOT EXISTS stock_demand_variety_idx
  ON stock (type_name, colour, size_cm, cultivar)
  WHERE current_quantity < 0 AND type_name IS NOT NULL;
