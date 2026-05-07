# Demand Entries aggregate all future demand for a variety into one Stock Item record

When stems are added to an order but no Batch exists (or the owner explicitly declines to use an existing Batch), the system creates or deepens a single undated Stock Item — a Demand Entry — for that variety. All future orders drawing on the same variety share this one record; the quantity goes increasingly negative as more demand is committed. When a Stock Order arrives and is evaluated, the Demand Entry is converted in-place into a Batch: its quantity is topped up and the arrival date suffix is added.

This is a deliberate simplification. The correct model is time-phased: each order's demand should carry a "needed by" date so the owner can see which stems are needed when, allocate incoming Batches to specific orders, and spot shortfalls before they occur. That model was deferred because it requires a broader Stock redesign (also covering stem-length tracking and simplified inventory UI) that will be handled in a dedicated Stock PRD.

## Consequences

- A variety with demand from multiple future orders shows a single aggregated negative quantity. The owner cannot see from the stock list alone which order each unit of negative stock belongs to. This is a known gap, managed operationally until the Stock PRD lands.
- Incoming stems are not auto-allocated to outstanding demand. The owner decides manually at Stock Order evaluation time whether to fill the Demand Entry or keep the arriving stems as a fresh Batch for daily orders.
- At most one Demand Entry per variety exists at any time. This invariant must be enforced at creation time: if a Demand Entry already exists, deepen it rather than creating a second record.
