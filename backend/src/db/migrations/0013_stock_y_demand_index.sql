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
  NULLS NOT DISTINCT
  WHERE current_quantity < 0;

--> statement-breakpoint

-- Performance index: find all Demand Entries for a given Variety fast.
-- Used by getOrCreateDemandEntry's SELECT and the Required By cascade.
CREATE INDEX IF NOT EXISTS stock_demand_variety_idx
  ON stock (type_name, colour, size_cm, cultivar)
  WHERE current_quantity < 0;
