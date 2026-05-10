# Order-line consumption keeps the Batch decrement model; per-Batch traceability comes from the existing usage trace

When an Order is created against an existing Batch, the Batch's `current_quantity` is decremented atomically at creation time (the current behavior, preserved). Order-line reservations against a Batch are NOT introduced as part of the Stock Y-model rework, even though premade bouquets are switching to a reservation model under ADR-0005.

When the Owner expands a Variety in the new Stock list and asks "which orders consumed stems from this specific Batch?", the answer comes from the existing `GET /api/stock/:id/usage` trace endpoint, which walks `order_line.stockItemId` foreign keys and assembles a chronological consumption history per Stock Item. Under Y, that endpoint filters by exact Batch ID rather than aggregating across siblings by display-name string match. Florist app surfaces the trace as a tap-opens-modal interaction; Dashboard surfaces it inline under the expanded Variety row.

## Why

The premade reservation model in ADR-0005 was justified by structural pitfall #8 — silent decrement of Batch quantity by the premade-build code path created a class of bugs that recurred every time the math was tweaked. Orders do not have the same problem: order_line.stockItemId is the authoritative link, the audit log records each adjustment, and the current decrement happens through `stockRepo.atomicAdjust` with one well-tested call site (`orderService.createOrder`).

Extending reservations from premades to orders would mean a much larger architectural change: Batch.qty would become "total ever received" rather than "currently on hand," every cancel-with-return path would change, every write-off path would change, and the moment of reservation→consumption (Out for Delivery? Picked Up? Delivered?) would need a new design pass. PRD #283 is already a big-bang cutover; piling that on top is a cost-discipline violation.

The Owner's actual requirement — "see which orders consumed which Batch" — is a traceability requirement, not a model requirement. The trace already exists in `GET /api/stock/:id/usage`. Surfacing it in the new Stock list expand interaction satisfies the requirement without a model change.

## Considered alternatives

- **Full reservation model for orders (mirror of premade reservation)** — orders reserve from Batches at creation; Batch.qty decrements only when stems physically leave the studio (Out for Delivery / Picked Up). Rejected for the reasons above; defer to a future PRD if symmetry between premade and order bookkeeping becomes valuable.
- **Add an audit-only column** to `order_lines` capturing "consumed from Batch X at qty N" — redundant with the existing audit log + `order_line.stockItemId` FK; the trace already has everything it needs.

## Consequences

- Pitfall #8 is structurally eliminated for the premade path (no Batch decrement) but remains a possibility for the order path (Batch decrement still occurs). The mitigation is the per-row `getEffectiveStock(qty)` helper plus the new `getFlowerTypeTotals` aggregation, both with regression fixtures encoding the prior failure modes.
- Cancel-with-return continues to use `stockRepo.atomicAdjust` to credit Batch quantity back. The flow is unchanged.
- Per-Batch consumer trace UI (modal on Florist, inline on Dashboard) is part of the new Stock list slice. Backend work is minimal: the existing `/stock/:id/usage` endpoint already returns the data; only the sibling-aggregation behavior changes from display-name substring matching to Variety identity matching.
- "Unaccounted" stems (Batch arrived with 50, only 47 traced) can be surfaced as a write-off candidate in the new UI; today this requires manual audit-log inspection.
- A future "Order reservation" PRD remains a clean change if the symmetry argument wins out: it would touch order_line + Batch + write-off + cancel-with-return, but Y-model code paths will be in place to absorb the change.
