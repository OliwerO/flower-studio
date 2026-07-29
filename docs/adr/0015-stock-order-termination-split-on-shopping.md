# Stock Order termination splits on Shopping: delete before, cancel after

A Stock Order and its lines are **deleted outright** while the status is Draft or Sent, and **cancelled** (record retained) from Shopping onward. The same boundary applies to a single line and to a whole order. Cancelling an order mid-shopping cancels only its still-Pending lines; if any line already has stems found, the order moves to **Reviewing** rather than Cancelled so the purchased stems are still received. A line whose stems have already been found cannot be cancelled at all. A Cancelled Stock Order is reopenable to Draft.

## Why

The boundary is not arbitrary: `routes/stockOrders.js` auto-transitions Sent → Shopping on the Driver's first line PATCH. "Sent" therefore means *notified but has recorded nothing*, and "Shopping" means *actively at the market*. The split lands on the Driver's first keystroke rather than on a guess about what they are doing.

Before Shopping, nothing physical has happened — no stems, no money, no purchase rows — so a deleted order leaves nothing dangling and a tombstone would be noise. From Shopping onward the Driver is holding the list at a market stall, and a line that silently vanishes from their screen is worse than one shown struck-through.

The Reviewing routing exists because cancelling stems that are already bought would erase the record of the purchase, not the purchase itself. Those stems are in the van and were paid for; they must still be received. "Stop shopping and come back with what you have" is what physically happens when the Owner phones the Driver, so the state machine models that rather than pretending the run never occurred.

Reopening is safe because a genuinely cancelled Stock Order never touched stock — no Batches, no Demand Entries, no ADR-0003 markers — so there is nothing to unwind. It covers the real case of a run cancelled on Thursday and wanted unchanged on Friday.

## Considered alternatives

- **Cancel everything from Sent onward** (asymmetric: lines delete through Sent, whole orders cancel from Sent). Argued on blast radius — one row vanishing is a correction, a whole run vanishing is an event — and because `/send` has already pushed a Telegram. Rejected in favour of one rule that is easy to hold in your head; the deletion of a Sent order fires a cancellation Telegram, so the Driver is not left guessing.
- **Block mid-shopping cancellation entirely when stems are found.** Safest, no ambiguity. Rejected as too rigid: the Owner's real move is to stop the run, and forcing her to wait for the Driver to finish so she can zero lines in Reviewing does not match the situation.
- **Cancel everything regardless of what was found.** Simplest to build and explain. Rejected because it loses the record of stems that were actually purchased, which is a money-losing failure mode.
- **Make Cancelled terminal**, duplicating an order instead of reopening. Simpler state machine, but "duplicate a Stock Order" does not exist and would have to be built, for no gain over a reopen that costs nothing.

## Consequences

- `PO_STATUS` gains `CANCELLED`, reachable only from `SHOPPING`, with `CANCELLED → DRAFT` for reopen. Draft and Sent are deliberately *not* cancellable — they delete.
- Pending arrivals need no change. `GET /stock/pending-po` builds from an explicit status allow-list, so `CANCELLED` is excluded by construction. This is load-bearing and is pinned by a test, because the comment above that list already claimed the behaviour while nothing enforced it.
- Cancelled lines carry `cancelled_at` and are excluded from order totals and from pending arrivals. They remain visible, struck-through, in the Owner's view.
- "Cancel" does not always land on Cancelled. The confirm dialog must state which outcome applies before the Owner commits, naming how many lines were already bought.
- Deleting a Sent order must capture the order and driver data *before* the delete in order to send the notification.
- `nextPoSequence` is `MAX(N)+1` over surviving rows, so deleting frees a PO number for reuse. This is safe only because ADR-0003 markers also carry the line UUID, and only evaluated orders write markers — which are never deletable under this decision. Widening deletion past Sent would break that guarantee.
