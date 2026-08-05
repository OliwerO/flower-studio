// Client mirror of `backend/src/utils/deliveryGate.js` — what the customer is
// charged for delivery on an order (#644).
//
// An order carries the fee in two places: the nested `delivery` sub-record,
// and the order's own redundant `Delivery Fee` field. Only the first is live.
// The order-level copy is written once at creation and at Pickup → Delivery
// conversion; nothing re-syncs it, because every fee editor PATCHes the
// delivery record. So the moment the owner edits or clears the fee, the
// order-level copy is stale — and reading it FIRST is what made a 1000 zł
// order with free delivery keep showing 1035 zł (#644, prod order 202608-002).
//
// Two rules, both load-bearing:
//   1. A Pickup order owes no fee at all. A Delivery → Pickup conversion only
//      CANCELS the linked delivery row, so its fee is still sitting right
//      there (CLAUDE.md pitfall `cancelled-delivery-leak` / #554).
//   2. Inside a genuine Delivery order the delivery record wins — including
//      when its fee is null or 0. A present-but-empty fee means FREE
//      delivery; falling through to the order's old value on a falsy fee is
//      the same bug in a different costume.
//
// Driver Payout / Taxi Cost are the studio's COST of delivering (ADR-0019),
// never part of what the customer owes — they must never enter this number.

/**
 * @param {object|null|undefined} order  Order in wire format; may carry a
 *   nested `delivery` sub-record (`GET /orders/:id` does, list rows don't).
 * @param {object|null|undefined} [delivery]  Explicit delivery sub-record,
 *   for hosts that hold it separately. Defaults to `order.delivery`.
 * @returns {number} Fee in PLN; 0 for a Pickup order or a cleared fee.
 */
export function resolveDeliveryFee(order, delivery = order?.delivery) {
  if (order?.['Delivery Type'] !== 'Delivery') return 0;
  if (delivery) return Number(delivery['Delivery Fee'] || 0);
  return Number(order?.['Delivery Fee'] || 0);
}
