-- Settled Demand Entry marker (#557 / #556).
-- A terminal-order Settlement releases a Demand Entry to 0 and stamps
-- settled_at instead of soft-deleting it (reverts the #516 soft-delete),
-- so the row stays visible in the per-Variety trace and remains a valid
-- target for the Order Line's stock_item_id. NULL for every other row.
ALTER TABLE stock ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
