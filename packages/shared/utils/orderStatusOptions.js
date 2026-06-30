// Order status options — single source of truth for "which status may this
// user switch this order to right now". Mirrors the backend authority in
// orderRepo.transitionStatus exactly, so the UI never offers a pill the
// backend would reject (and never hides one it would accept):
//
//   - owner  → any → any (god-mode). Every status except the current one.
//   - others → the forward state machine ∪ statuses the order PREVIOUSLY held
//              (the "revert / undo" set, read from GET /orders/:id/status-history).
//
// Before this util the forward map was copy-pasted into OrderCard.jsx and
// OrderDetailPage.jsx (florist) with no backward moves at all — a florist who
// marked an order Delivered by mistake had no way back. Keep this in lock-step
// with backend/src/repos/orderRepo.js (ALLOWED_TRANSITIONS + ALL_ORDER_STATUSES).

export const ALL_ORDER_STATUSES = [
  'New',
  'Ready',
  'Out for Delivery',
  'Delivered',
  'Picked Up',
  'Cancelled',
];

// Forward (happy-path) transitions. The florist app never triggers "Out for
// Delivery" itself — that's the driver's job — so it is intentionally absent
// from Ready's forward set here even though the backend permits it.
const FORWARD_TRANSITIONS = {
  'New':              ['Ready', 'Cancelled'],
  'In Progress':      ['Ready', 'Cancelled'],
  'In Preparation':   ['Ready', 'Cancelled'],
  'Ready':            ['Delivered', 'Picked Up', 'Cancelled'],
  'Out for Delivery': ['Delivered', 'Cancelled'],
  'Delivered':        [],
  'Picked Up':        [],
  'Cancelled':        ['New'],
};

/**
 * Whether a status may be offered given the order's fulfillment type.
 *
 * A delivery order can only terminate as 'Delivered'; a pickup order only as
 * 'Picked Up'. These two terminals are mutually exclusive by fulfillment type
 * — a domain truth, not a permission — so the mismatched one is hidden for
 * EVERY role, owner god-mode included (the owner who taps "Picked Up" on a
 * delivery would otherwise leave the order in a contradictory terminal state).
 * CR-31.
 *
 * @param {string}  status      one of ALL_ORDER_STATUSES
 * @param {boolean} [isDelivery] true = delivery order, false = pickup.
 *        undefined/null → don't filter (unknown fulfillment never over-filters).
 * @returns {boolean}
 */
export function isStatusAllowedForFulfillment(status, isDelivery) {
  if (isDelivery == null) return true;
  if (isDelivery === true) return status !== 'Picked Up';
  return status !== 'Delivered';
}

/**
 * Compute the status options a user may move an order to.
 *
 * @param {Object}   params
 * @param {string}   params.role               'owner' | 'florist' | 'driver'
 * @param {string}   params.currentStatus      the order's current status
 * @param {string[]} [params.previousStatuses] statuses the order has previously
 *        held (from GET /orders/:id/status-history). Ignored for owners.
 * @param {boolean}  [params.isDelivery]        true = delivery order, false =
 *        pickup. Strips the mismatched terminal (CR-31). Omit → no filtering.
 * @returns {{ forward: string[], revert: string[], all: string[] }}
 *   forward — happy-path next steps (owners: every other status)
 *   revert  — previously-held statuses NOT already in forward (the undo set)
 *   all     — forward followed by revert, de-duplicated, current excluded
 */
export function getStatusOptions({ role, currentStatus, previousStatuses = [], isDelivery }) {
  const keep = s => isStatusAllowedForFulfillment(s, isDelivery);

  if (role === 'owner') {
    const all = ALL_ORDER_STATUSES.filter(s => s !== currentStatus && keep(s));
    return { forward: all, revert: [], all };
  }

  const forward = (FORWARD_TRANSITIONS[currentStatus] || []).filter(
    s => s !== currentStatus && keep(s),
  );
  const seen = new Set([currentStatus, ...forward]);
  const revert = [];
  for (const s of previousStatuses) {
    if (!seen.has(s) && keep(s)) {
      seen.add(s);
      revert.push(s);
    }
  }
  return { forward, revert, all: [...forward, ...revert] };
}
