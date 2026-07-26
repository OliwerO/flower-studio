---
status: accepted
---

# Pull mirrors a Wix price only when Wix's price changed

`runPull` imports a Product variant's price from Wix into `product_config.price`
**only when Wix's own price has moved since the previous Pull**. A price Wix has
not changed is not new information, so it must never overwrite the local value.
The comparison baseline is a new column, `product_config.wix_price_seen` — the
price Wix reported the last time Pull looked at that variant.

This makes the "flower-studio owns prices" line in `wixProductSync.js`'s header
true on the Pull side, the way `localNameOwned` (ADR-0008) already makes it true
for Product names. Unlike names, price is **not** locked outright: a genuine
Wix-admin price change still imports on the next Pull.

## Why

Pull previously overwrote `price` with whatever Wix reported, on every run,
with no guard. So any Pull taken before Wix reflected a Push re-stamped the
stale Wix value over the owner's edit — and, because `product_config` has no
price history and price edits are not audit-logged, destroyed the only record
that she had asked for a different price. The owner-visible symptom is the one
from issue #428: "I set it, it says success, and it's still wrong."

Two distinct mechanisms produce it, and Pull could not tell them apart:

- the Push silently lost the write (the concurrent per-variant PATCH race fixed
  in PR #572), so Wix legitimately still reports the old price; or
- the Push landed but Wix's read path had not caught up yet. Wix's catalog API
  was independently observed returning gRPC `deadline exceeded` on
  `updateProduct` in `sync_log` on 2026-06-22, the day before #428 was filed.

PR #572 removes the dominant *cause* of the first. It does not touch Pull, so
in every remaining case where a Push does not land — a 5xx that outlives the
retries, `PRODUCT_NOT_FOUND`, a partial push, read lag — the next Pull still
silently discards the owner's intent. This ADR closes that amplifier.

**Evidence (prod `sync_log`, read-only via `claude_ro`).** Of 17 Pulls that
immediately followed a Push reporting `price_syncs > 0`, **7 rewrote exactly as
many rows as the Push had just reported syncing**:

| push | prices pushed | pull | rows rewritten | gap |
|---|---|---|---|---|
| 2026-06-23 12:43:41 | 8 | 12:50:30 | 8 | 6.8 min |
| 2026-06-23 12:52:37 | 15 | 12:53:26 | 15 | 49 s |
| 2026-07-08 15:24:57 | 1 | 16:04:11 | 1 | 39 min |
| 2026-07-08 16:05:12 | 1 | 16:06:02 | 1 | 49 s |
| 2026-07-13 21:59:25 | 3 | 2026-07-14 08:21:50 | 3 | 10.4 h |
| 2026-07-16 11:00:17 | 2 | 11:04:00 | 2 | 3.7 min |
| 2026-07-22 13:04:29 | 1 | 16:27:50 | 1 | 3.4 h |

In the two control buckets (Pull after a no-op Push, Pull after a Pull) every
exact match is the trivial 0 = 0, so the correlation is specific to price
pushes. `sync_log.updated` counts any field change, not price alone, so this is
strong circumstantial evidence rather than proof — but it recurred seven times
across two months and was still happening four days before this was written.

## Considered alternatives

- **A short "just-pushed, don't re-pull this field for N seconds" cooldown**
  (the original suggestion on #428). **Rejected on the evidence above:** the
  observed gaps span 49 seconds to 10.4 hours. No N separates the two cases —
  a window generous enough to catch the 10.4-hour case would suppress genuine
  Wix edits for half a day, and a tight one misses 4 of the 7 occurrences.
  Time is simply not the variable that distinguishes them; "did Wix's own value
  change" is.
- **Lock price outright, ADR-0008 style** — once flower-studio has a price,
  Pull never overwrites it. Simplest rule, and defensible given the Dashboard is
  where the owner re-prices. Rejected because a real Wix-admin price edit would
  then never reach the app, with no signal that it had been ignored. The owner
  confirmed the Dashboard is her editing surface but asked to keep Wix-side
  edits working.
- **A push watermark storing what we sent plus Wix's pre-push value**
  (three columns). Equivalent accuracy, but `wix_price_seen` gets there with one
  column and — decisively — requires **no change to `runPush` at all**, so this
  work does not touch or conflict with the in-flight PR #572.

## Consequences

- **`product_config.wix_price_seen`** (`NUMERIC(10,2)`, nullable). Written only
  by `runPull`; deliberately absent from `productConfigRepo`'s
  `EDITABLE_FIELD_MAP` so no route can forge Pull's baseline and re-open the
  clobber.
- **NULL means "no baseline yet".** The first Pull after this ships records a
  baseline per row and skips that row's price mirror — it cannot yet tell a Wix
  edit from an echo of a Push. This costs one Pull of latency for a genuine Wix
  edit, once per row, ever, and is why the migration ships **no data backfill**.
  Baseline-only writes are excluded from `stats.updated` so that first Pull does
  not report every row as updated.
- **New signal: `stats.pricesNotOnWix`**, persisted as
  `sync_log.prices_not_on_wix`. Counts rows where local and Wix disagree while
  Wix has not moved — i.e. price edits the storefront has not taken. Both the
  Dashboard and Florist Pull buttons show it as an amber toast telling her to
  Push again. This bug survived two months precisely because `sync_log` recorded
  counts but never recorded divergence.
- **Known gap:** two Wix-side edits between consecutive Pulls that net back to
  the previously seen value are indistinguishable from no change and will not
  mirror. Self-corrects on the next real change; accepted as vanishingly rare.
- **Not addressed:** the `Description` mirror in the same loop has the identical
  unconditional-clobber shape. Out of scope here; tracked separately.
