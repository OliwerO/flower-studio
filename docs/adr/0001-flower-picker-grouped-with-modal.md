# Flower picker groups by variety; selection always opens a disambiguation modal

When building a bouquet, a flower variety can exist as multiple Stock Items simultaneously — one or more dated Batches (physically arrived stems) and at most one undated Demand Entry (future stock committed to an order). The picker groups all Stock Items by base variety name into a single row. Clicking any row always opens a modal listing every available Batch (with date and quantity), the current Demand Entry (if any, with its negative quantity), and a "Create Demand Entry" option (if none exists). The modal fires unconditionally — even when only one Batch exists — so the owner always has an explicit path to create a new Demand Entry for a far-future order without drawing from stems that will be old or gone by that date.

## Considered Options

**Flat list** — show every Stock Item (Batch + Demand Entry) as a separate row in the picker dropdown. Rejected because dated suffixes ("Pink Peonies (06.May.)") are internal plumbing; surfacing them inline clutters the picker for the common case where the owner just wants to add a flower.

**Modal only on ambiguity (>1 match)** — skip the modal when exactly one Batch exists and add it directly. Rejected because this suppresses the "Create Demand Entry" path in the most common far-future-order scenario (one existing Batch, owner doesn't want to use it). A single rule is also simpler to reason about.

## Consequences

Order creation requires one extra click for the common case (select variety → confirm Batch in modal). This is acceptable because order creation is a low-volume operation and the modal also surfaces Batch age and quantity, which informs quality decisions.
