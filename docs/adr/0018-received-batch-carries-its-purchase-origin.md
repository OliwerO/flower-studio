# Every received Batch records the Stock Order line that bought it

`receiveIntoStock` stamps the originating `stock_order_lines.id` onto every Batch it creates. Nothing reads the column yet. It is written now because it cannot be reconstructed later.

## Why

Purchase spend cannot currently be traced to the customer Orders it fulfils. Measured against production on 2026-08-01: of 406 Order Lines, 398 (98%) link to a stock row, but only **20 (4.9%)** can be traced back to the Stock Order that bought the stems.

The chain snaps at receipt, and it snaps by design. `stock_order_lines.stock_id` points at the row that was *ordered*; `receiveIntoStock` then creates a **new dated Batch** for what *arrived* (this is deliberate — see pitfall `batch-variety-attrs`), and the Order Line consumes that Batch. The two rows are different and nothing connects them, so the link dies the moment goods land.

The consequence is that the Owner cannot ask what the flowers in a given customer's order actually cost at the market — only what cost price happened to be stamped on the stock row when the Florist added it. Every question she has named about customer behaviour, spending patterns, and business efficacy runs through that broken chain.

The decision to write the column now rather than with the feature that needs it is the whole point of this ADR: a foreign key to a purchase can be captured only at the moment of the purchase. Adding it in six months means every Batch received before then is permanently unattributable, and the history that makes the analysis worth doing is exactly the history that would be missing.

## Considered alternatives

- **Build the Consumption ledger now** (`order_line_consumptions`, [PRD #324](https://github.com/OliwerO/flower-studio/issues/324)). This is the real fix and the glossary already describes it as "the authoritative trace link" ([CONTEXT.md](../../CONTEXT.md)) — but the table does not exist in production. Rejected as scope: it touches the Y-model, receiving, and the order picker, and would sink the feature it was bundled into.
- **Reconstruct the link later by matching name and date.** Rejected: the same Variety is received from several Stock Orders, receipts absorb into existing rows, and the display name is exactly the field that has drifted repeatedly (#558, #562). A heuristic join over ambiguous history is how wrong numbers get produced confidently.
- **Do nothing until a feature needs it.** Honest and cheap, and it is what has happened so far. Rejected because the cost is asymmetric: carrying an unread nullable column costs approximately nothing, while not having it costs the entire back-history.

## Consequences

- One nullable column on `stock`. No behaviour change, no UI, no read path. It will look like dead weight to a future reader — that is why this ADR exists, and it should not be removed as unused.
- It joins the list of fields that must be carried forward whenever a Batch is created from another row, alongside the Variety four-tuple (pitfall `batch-variety-attrs`) and `stock_kind` ([ADR-0017](0017-non-flower-stock-kinds-and-recount-depletion.md)). The sibling absorption site in `stockPurchases.js` needs the same treatment.
- Absorption (`batchQty = qty + existingQty`, ADR-0002) merges an arrival into an existing row, so one Batch can have more than one purchase origin. The column records the receipt that created the row; full fidelity across absorptions is a problem for the Consumption ledger to solve, not this column.
- Manual stock additions have no Stock Order line, so the column stays NULL for them. A NULL means "not bought through a Stock Order", never "unknown".
- When per-Order true cost is eventually built, this column plus the Consumption ledger closes the chain end-to-end. Until then it is inert.
