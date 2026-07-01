-- Purchase Found-vs-Accepted split (issue #492).
-- quantity_purchased now always means "Found/bought" (the money-spend basis);
-- this new column carries the post-write-off "Accepted/kept" quantity for
-- traceability. Nullable — historical rows are NOT backfilled since the true
-- historical Found quantity isn't reconstructable from the polluted
-- quantity_purchased value alone.

ALTER TABLE "stock_purchases" ADD COLUMN "quantity_accepted" integer;
