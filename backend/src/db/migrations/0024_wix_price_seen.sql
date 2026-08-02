-- Pull price-clobber guard (#428 follow-up to PR #572).
--
-- `wix_price_seen` is the price Wix reported for this variant the LAST time
-- runPull looked at it. Pull mirrors a Wix price into `price` only when Wix's
-- price has MOVED since that observation — a price Wix has not changed is not
-- news, and must never overwrite a locally-set price that Push has not landed
-- yet. NULL means "no baseline recorded yet": the next Pull records one and
-- deliberately skips the mirror for that row (self-healing, no backfill).
ALTER TABLE product_config ADD COLUMN IF NOT EXISTS wix_price_seen NUMERIC(10,2);

-- How many rows Pull found diverging from Wix while Wix's own price had not
-- moved — i.e. local price edits that are not (yet) live on the storefront.
-- Recorded per run so this failure mode is diagnosable from sync_log alone;
-- the silent version of it went unnoticed on prod from 2026-06-23 to 2026-07-22.
ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS prices_not_on_wix INTEGER NOT NULL DEFAULT 0;
