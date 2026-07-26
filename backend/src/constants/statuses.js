// Centralized status constants for all workflow states.
// Matches Airtable field values exactly (case-sensitive).
//
// NOTE: bundled into FRONTEND builds (apps/delivery/src/pages/DeliveryListPage.jsx,
// apps/dashboard/src/components/DayToDayTab.jsx import it directly). Keep this file
// dependency-free: no imports, no env reads, pure const exports — anything else
// breaks the Vercel app builds with no local signal.

// ── Order statuses ──
// Flow: New → Ready → Out for Delivery → Delivered (delivery)
//       New → Ready → Picked Up (pickup)
// "In Progress" is legacy — kept for transition exits only.
export const ORDER_STATUS = {
  NEW:              'New',
  IN_PROGRESS:      'In Progress',
  IN_PREPARATION:   'In Preparation',
  READY:            'Ready',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED:        'Delivered',
  PICKED_UP:        'Picked Up',
  CANCELLED:        'Cancelled',
};

// Terminal statuses — no further transitions allowed (except Cancelled → New).
export const TERMINAL_STATUSES = [
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.PICKED_UP,
  ORDER_STATUS.CANCELLED,
];

// ── Delivery statuses ──
export const DELIVERY_STATUS = {
  PENDING:          'Pending',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED:        'Delivered',
  CANCELLED:        'Cancelled',
};

// Terminal delivery statuses — the driver no longer needs schedule updates.
// Mirrors TERMINAL_STATUSES for orders, but Delivery has no "Picked Up"
// equivalent and Pending/Out for Delivery both count as "still in play" for
// this purpose (issue #545 — a delivery en route can still have its time
// window corrected and the driver should hear about it).
export const DELIVERY_TERMINAL_STATUSES = [
  DELIVERY_STATUS.DELIVERED,
  DELIVERY_STATUS.CANCELLED,
];

// ── Payment statuses ──
export const PAYMENT_STATUS = {
  PAID:    'Paid',
  UNPAID:  'Unpaid',
  PARTIAL: 'Partial',
};

export const VALID_PAYMENT_STATUSES = Object.values(PAYMENT_STATUS);

// ── Purchase Order (Stock Order) statuses ──
// Flow: Draft → Sent → Shopping → Reviewing → Evaluating → Complete
export const PO_STATUS = {
  DRAFT:      'Draft',
  SENT:       'Sent',
  SHOPPING:   'Shopping',
  REVIEWING:  'Reviewing',
  EVALUATING: 'Evaluating',
  EVAL_ERROR: 'Eval Error',
  COMPLETE:   'Complete',
};

export const VALID_PO_STATUSES = Object.values(PO_STATUS);

// ── PO Line statuses ──
export const PO_LINE_STATUS = {
  PENDING:   'Pending',
  PROCESSED: 'Processed',
};

// ── Stock loss reasons ──
export const LOSS_REASON = {
  WILTED:         'Wilted',
  DAMAGED:        'Damaged',
  ARRIVED_BROKEN: 'Arrived Broken',
  OVERSTOCK:      'Overstock',
  OTHER:          'Other',
};

export const VALID_LOSS_REASONS = Object.values(LOSS_REASON);

// ── Delivery results ──
export const DELIVERY_RESULT = {
  SUCCESS:       'Success',
  NOT_HOME:      'Not Home',
  WRONG_ADDRESS: 'Wrong Address',
  REFUSED:       'Refused',
  INCOMPLETE:    'Incomplete',
};

export const VALID_DELIVERY_RESULTS = Object.values(DELIVERY_RESULT);
