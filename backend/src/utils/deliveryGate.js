// The read-time Delivery-Type gate — see CLAUDE.md pitfall
// `cancelled-delivery-leak` (root cause of #554 and its follow-up).
//
// A Delivery → Pickup conversion (`orderRepo.updateOrder`) only sets the
// linked `deliveries` row's Status to Cancelled. The row is NOT soft-deleted
// (`deleted_at` stays NULL) and its fee/address/recipient/driver are
// deliberately left intact — blanking them was implemented and then reverted
// on code review 2026-07-25, because it made an accidental mis-tap
// unrecoverable. The fix therefore lives at every READ: the presence of a
// delivery sub-record proves nothing; only the order's CURRENT Delivery Type
// does.
//
// Every reader that pulls a fee, address, recipient, or driver off
// `order._delivery` / `order.Delivery Fee` must pass it through this gate
// first. Named (rather than inlined) so a future ungated reader is one grep
// away from being spotted.

/**
 * Is this order currently a Delivery (as opposed to a Pickup)?
 *
 * @param {{ 'Delivery Type'?: string } | null | undefined} order  Order in wire format
 * @returns {boolean}
 */
export function isDeliveryOrder(order) {
  return order?.['Delivery Type'] === 'Delivery';
}

/**
 * What the customer is charged for delivery on this order — the single
 * definition of that number for every read path (#644).
 *
 * Two rows can answer "what is the delivery fee": the `deliveries` row, and
 * the order's OWN redundant `Delivery Fee` column. Only the first is live.
 * The order column is written once at creation (`orderRepo.createOrder`) and
 * at Pickup → Delivery conversion, and NOTHING re-syncs it afterwards —
 * `PATCH /api/deliveries/:id` writes the delivery row alone. So the moment
 * the owner edits or clears the fee, the order column is stale.
 *
 * Four readers had this precedence inverted (`order fee || delivery fee`),
 * which is exactly what CLAUDE.md pitfall #2 warns against. The owner set a
 * 1000 zł order to free delivery, and the total stayed 1035 forever — the
 * list endpoint re-derived the fee from the delivery row and showed 1000
 * while the detail endpoint showed 1035 (#644, prod order 202608-002).
 *
 * A `deliveries` row present but with a NULL/0 fee means free delivery — it
 * must NOT fall through to the order's old value. Hence the fallback is on
 * "is there a delivery row at all", never on the fee being falsy.
 *
 * Driver Payout / Taxi Cost are the studio's COST of delivering (ADR-0019)
 * and never belong in this number.
 *
 * @param {object|null|undefined} order     Order in wire format
 * @param {object|null|undefined} delivery  Its linked delivery sub-record, if loaded
 * @returns {number}  Fee in PLN; 0 for a Pickup order or a cleared fee.
 */
export function resolveDeliveryFee(order, delivery) {
  if (!isDeliveryOrder(order)) return 0;
  if (delivery) return Number(delivery['Delivery Fee'] || 0);
  return Number(order?.['Delivery Fee'] || 0);
}
