-- #607 — record the owner's "yes, this really is a new flower" on the line.
--
-- ADR-0016's confirm rule lived only in the request body: `New Variety: true`
-- opted one identity PATCH out of the must-match-an-existing-Variety guard and
-- was then thrown away. That is enough while the line is being edited, but not
-- at evaluation, which happens days later on a different screen and is the
-- moment a Stock Item is actually created. Without a stored answer, evaluation
-- cannot tell a flower she deliberately added from a typo nobody ever looked
-- at — so it created both (#562, rows 12/13 of the entry-surface inventory).
--
-- Default false: an existing line was composed under the old rules and has no
-- recorded confirmation. Prod carried zero open PO lines when this shipped
-- (verified 2026-08-02), so nothing in flight is affected.
ALTER TABLE stock_order_lines
  ADD COLUMN IF NOT EXISTS new_variety boolean NOT NULL DEFAULT false;
