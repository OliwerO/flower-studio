-- PO line Variety identity (issue #304).
--
-- Lets a draft PO line carry a Variety (Type + Colour + Size + Cultivar) when
-- the line is not linked to an existing Stock Item. PO evaluation reads these
-- to create a Stock Item with full Y-model identity instead of falling back
-- to a free-text flower_name.
--
-- All columns nullable: legacy lines that link to an existing stock_id leave
-- them NULL; new "Add new" lines populate them. type_name is the only
-- required field at evaluation time when stock_id is NULL (route enforces).

ALTER TABLE stock_order_lines
  ADD COLUMN IF NOT EXISTS type_name TEXT,
  ADD COLUMN IF NOT EXISTS colour    TEXT,
  ADD COLUMN IF NOT EXISTS size_cm   INTEGER,
  ADD COLUMN IF NOT EXISTS cultivar  TEXT;
