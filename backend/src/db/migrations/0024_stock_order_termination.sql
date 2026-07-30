-- Stock Order termination (ADR-0015) + the Owner/Driver line-note split.
--
-- cancelled_at: a line cancelled once the Driver is Shopping. Before Shopping a
-- line is deleted outright, so this is only ever set from Shopping onward. A
-- cancelled line stays visible (struck through) and is excluded from order
-- totals and from pending arrivals.
--
-- driver_notes: the Driver's Market Note, written at the stall to explain a
-- Partial or Not Found result. Until now the Driver's expander wrote the SAME
-- `notes` column the Owner uses for purchasing instructions, so "было только 8"
-- silently destroyed "возьми потемнее" with no trace.

ALTER TABLE stock_order_lines
  ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz,
  ADD COLUMN IF NOT EXISTS driver_notes  text NOT NULL DEFAULT '';

-- Cancelled lines are filtered out of totals and pending-arrival aggregation on
-- every read of an active PO; the partial index keeps that predicate cheap
-- without indexing the (overwhelming) majority of live lines.
CREATE INDEX IF NOT EXISTS stock_order_lines_cancelled_idx
  ON stock_order_lines (po_id)
  WHERE cancelled_at IS NOT NULL;
