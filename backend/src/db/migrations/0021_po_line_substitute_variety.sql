-- PO line SUBSTITUTE Variety identity (#2 — classify the substitute at shopping entry).
--
-- The primary line already carries type_name/colour/size_cm/cultivar (migration
-- 0014) for "Add new" Varieties. A SUBSTITUTE (alt-supplier flower) is its OWN
-- distinct Variety and had no place to store a Type/Colour — the florist could
-- only classify it later on the evaluation screen (W1), where a mistyped Type
-- once mislabelled a whole batch. These columns let the OWNER classify the
-- substitute where she records it (the shopping-support view); evaluation then
-- pre-fills from them instead of asking again.
--
-- All nullable: lines with no substitute leave them NULL. Evaluation prefers the
-- florist's eval-time value when present and falls back to these persisted ones.

ALTER TABLE stock_order_lines
  ADD COLUMN IF NOT EXISTS substitute_type_name TEXT,
  ADD COLUMN IF NOT EXISTS substitute_colour    TEXT,
  ADD COLUMN IF NOT EXISTS substitute_size_cm   INTEGER,
  ADD COLUMN IF NOT EXISTS substitute_cultivar  TEXT;
