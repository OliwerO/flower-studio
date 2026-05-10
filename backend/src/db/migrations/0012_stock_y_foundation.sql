-- Stock Y-model foundation (issue #284, ADR-0005/0006/0007).
--
-- Adds the five Variety-identity columns to `stock`. All nullable here so
-- existing inserts (legacy display-name-only shape) keep working unchanged.
-- NOT NULL is applied later — `date` in the cutover script (#290) after
-- backfill, `type_name` in the cutover script (#291) after #292's UI fills
-- every row. Colour, size_cm, and cultivar stay nullable forever per ADR-0006.

ALTER TABLE stock
  ADD COLUMN IF NOT EXISTS date      DATE,
  ADD COLUMN IF NOT EXISTS type_name TEXT,
  ADD COLUMN IF NOT EXISTS colour    TEXT,
  ADD COLUMN IF NOT EXISTS size_cm   INTEGER,
  ADD COLUMN IF NOT EXISTS cultivar  TEXT;

--> statement-breakpoint

-- Lookups by Variety identity (Type + Colour + Size + Cultivar). Used by
-- #287's allocation engine to find candidate Stock Items per Variety and
-- by #289's Variety collapse aggregation. NULLS NOT DISTINCT keeps two
-- "Pink Peony 60cm" rows with NULL cultivar from being treated as
-- different Varieties at index lookup time. The unique-per-(Variety,date)
-- constraint lands in #286.
CREATE INDEX IF NOT EXISTS stock_variety_idx
  ON stock (type_name, colour, size_cm, cultivar);

--> statement-breakpoint

-- Lookups by date (Stock list grouping by needed-by date in #289).
CREATE INDEX IF NOT EXISTS stock_date_idx
  ON stock (date) WHERE date IS NOT NULL;
