# Stock model Y-form: dated Demand Entries + premade reservation model

The Stock model is restructured so each Stock Item row represents one Variety **on one date**, and stems committed to premade bouquets are tracked as a separate read-time bucket rather than by decrementing Batch quantity. Order creation routes Demand Entry writes through `getOrCreateDemandEntry(variety, date)` which yields one Demand Entry per (Variety, date), with the date defaulting to the linked Order's Required By (fallback chain: Required By → Order Date → today). At most one Demand Entry exists per (Variety, date) — enforced by a partial unique index — and updating an Order's Required By cascades to the linked Demand Entry's date column in place so the order_line FK stays valid.

Premade bouquets switch from a deduction model to a reservation model. Building a premade does not alter Batch quantity; the `premade_bouquet_lines` rows themselves are the truth for "stems reserved for premades." A read-time SUM joined per Variety produces the third UI bucket (`reservedForPremades`), distinct from `onHand` (Batches), `planned` (negative-quantity Demand Entries), and `net` (the four combined). Dissolve and reclaim paths simply delete the lines; sale-of-premade deletes the lines and routes the resulting Order through the normal Batch deduction or dated Demand Entry path with no `skipDeduction` special case. A `SELECT ... FOR UPDATE` on the relevant Batch rows inside the build transaction guards concurrent premade builds against over-allocation.

Supersedes ADR-0002 (the aggregate Demand Entry model).

## Why

The aggregate Demand Entry model conflated demand-needed-this-week with demand-needed-three-weeks-out into a single negative number per Variety. The Owner could not plan procurement against the actual timeline; a Stock Order placed against current shortage often forced buying stems that wilted before the late demand needed them. Pitfall #8 in the project's CLAUDE.md (two failed attempts at the per-row stock-math formula in April 2026) traces directly to the formula tweaks needed to paper over this conflation.

The premade-deduction model had a parallel problem: stems committed to a premade silently disappeared from the on-hand number, and a real customer order needing those stems left the Owner with no UI cue that the premade could be dissolved to reclaim them. Reads of `premade_bouquet_lines` already exist; treating them as the source of truth eliminates the silent decrement.

## Considered alternatives

- **Keep aggregate model, add a per-order-line "needed by" column** — would let the UI roll up demand by date virtually. Rejected because order_line.neededBy diverges from the Demand Entry's identity, and `getEffectiveStock` would need a date parameter at every call site. The model still hides the timeline at the Stock Item level.
- **Keep premade deduction model, add a "reconcile" repair tool** — already exists today (the `reconcile-premade` route gated on `showRepairTools`). Rejected because the bug is structural: any future code path that touches Batch quantity has to remember to coordinate with premade lines. Reservation makes the bug impossible.

## Consequences

- The `at most one Demand Entry per Variety` invariant from ADR-0002 is replaced by `at most one Demand Entry per (Variety, date)`. Existing aggregate Demand Entries are migrated by splitting linked order lines per their Order's Required By during the cutover.
- Stock list aggregation runs `GROUP BY (type, colour, size, cultivar)` (see ADR-0006 for the Variety identity rule) and reads premade reservation as a SUM-side bucket, not as a Batch decrement.
- The legacy `reconcile-premade` route, dashboard `ReconciliationSection.jsx`, `useReconcilePremade` hook, and `showRepairTools` settings flag are removed at cutover — the drift they repair becomes structurally impossible.
- Per-row `getEffectiveStock(qty)` is unchanged; per-row `qty` already represents a single dated quantity under Y. New helper `getFlowerTypeTotals(rows, reservations)` computes the four buckets per Variety and is the single source of truth for aggregation across the codebase.
- Migration script is one-shot, idempotent, supports `--dry-run`, and is verified against a lab scenario seeded with prod-shaped fixtures (orphan aggregate Demand Entries, positive-quantity manual edits, premade lines).
- Pitfall #8 is structurally retired: Batch quantity is the single source of truth for physical stems and is never juggled to track demand.
