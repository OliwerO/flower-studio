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
