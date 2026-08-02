-- backend/src/db/migrations/0025_delivery_pricing.sql
--
-- Delivery pricing (issue #618 / ADR-0019): Delivery Cost is computed from
-- driving distance against an editable Distance Band table, instead of both
-- Delivery Fee and Driver Payout resolving to the same flat 35 zł constant.
--
-- distance_km / distance_band: stored, never recomputed — the band table is
-- editable config, so a row that stored only the price would lose *why* once
-- the table changes. distance_band is a snapshot ({upToKm, price}), not an FK.
--
-- driver_payment_status / taxi_cost / delivery_result: these three were
-- already in the PATCH /deliveries/:id allow-list and silently dropped — no
-- column ever existed. driver_payment_status defaults 'Unpaid' so every
-- existing row is well-formed with no backfill needed.

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS distance_km           numeric(6,2),
  ADD COLUMN IF NOT EXISTS distance_band         jsonb,
  ADD COLUMN IF NOT EXISTS driver_payment_status text NOT NULL DEFAULT 'Unpaid',
  ADD COLUMN IF NOT EXISTS taxi_cost             numeric(10,2),
  ADD COLUMN IF NOT EXISTS delivery_result       text;
