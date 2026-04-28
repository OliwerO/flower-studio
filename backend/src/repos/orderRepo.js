// Order repository — the persistence boundary for Orders, Order Lines,
// and Deliveries (the trio that always migrates together).
//
// PHASE 4 PREP — this file is a SKELETON. The method signatures and
// JSDoc are intended to lock in the public API so the orderService
// rewrite can begin once the design is reviewed. The implementations
// throw a sentinel error; flipping ORDER_BACKEND off 'airtable' before
// the implementation lands will fail fast.
//
// See docs/migration/phase-4-orders-design.md for the full rationale,
// schema mapping, transaction boundary placement, and cutover sequencing.
//
// Why one repo instead of three (orderRepo / lineRepo / deliveryRepo):
// every interesting operation atomically touches at least two of the
// three tables. A separate per-table repo would just shuffle that
// coordination one layer up — the only thing it would coordinate is
// the transaction boundary. Owning all three together keeps the
// transaction boundary inside the repo where it belongs.
//
// Three modes selectable via ORDER_BACKEND (independent of STOCK_BACKEND):
//
//   'airtable' (default) → today's behaviour. orderService still talks
//                          to airtable.js directly; this repo is dormant.
//   'shadow'             → write Airtable first (source of truth), then
//                          mirror the order + lines + delivery to PG in
//                          one transaction (best-effort; failures land
//                          in parity_log). Reads from Airtable.
//   'postgres'           → write to PG only (one tx for order + lines +
//                          delivery + stock adjustments). Airtable
//                          becomes a frozen legacy snapshot for orders.

// Skeleton — only imports what the airtable-mode passthrough actually
// uses today. The implementation PR re-adds db / drizzle helpers /
// recordAudit / stockRepo / orders+lines+deliveries tables as they get
// wired in.
import * as airtable from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { db } from '../db/index.js';

// ── Backend mode ──
const VALID_MODES = new Set(['airtable', 'shadow', 'postgres']);
function readMode() {
  const m = (process.env.ORDER_BACKEND || 'airtable').toLowerCase();
  return VALID_MODES.has(m) ? m : 'airtable';
}
let MODE = readMode();
export function getBackendMode() { return MODE; }
export function _setMode(m) {
  if (!VALID_MODES.has(m)) throw new Error(`Invalid ORDER_BACKEND: ${m}`);
  MODE = m;
}
export function _resetMode() { MODE = readMode(); }

// ── PATCH allowlist ──
// Mirrors the field whitelist the routes apply today. Anything outside
// this set is silently dropped on create/update — same defence as
// stockRepo.STOCK_WRITE_ALLOWED.
export const ORDER_WRITE_ALLOWED = [
  'Customer', 'Customer Request', 'Source', 'Delivery Type',
  'Order Date', 'Required By', 'Delivery Time',
  'Notes Original', 'Florist Note', 'Greeting Card Text',
  'Payment Status', 'Payment Method', 'Payment 1 Amount', 'Payment 1 Method',
  'Delivery Fee', 'Price Override', 'App Order ID',
  'Status', 'Created By',
];

export const LINE_WRITE_ALLOWED = [
  'Order', 'Stock Item', 'Flower Name', 'Quantity',
  'Cost Price Per Unit', 'Sell Price Per Unit', 'Stock Deferred',
];

export const DELIVERY_WRITE_ALLOWED = [
  'Linked Order', 'Delivery Address', 'Recipient Name', 'Recipient Phone',
  'Delivery Date', 'Delivery Time', 'Assigned Driver', 'Delivery Fee',
  'Driver Instructions', 'Delivery Method', 'Driver Payout', 'Status',
];

// ── Wire-format ↔ PG-row mapping ──

/**
 * PG order row → Airtable-shaped response.
 * Frontend / route layer can't tell the source apart.
 */
export function pgOrderToResponse(row, lineIds = [], deliveryId = null) {
  if (!row) return null;
  return {
    id: row.airtableId || row.id,
    _pgId: row.id,
    Customer:             row.customerId ? [row.customerId] : [],
    'App Order ID':       row.appOrderId,
    Status:               row.status,
    'Delivery Type':      row.deliveryType,
    'Order Date':         row.orderDate,
    'Required By':        row.requiredBy ?? null,
    'Delivery Time':      row.deliveryTime ?? null,
    'Customer Request':   row.customerRequest ?? null,
    'Notes Original':     row.notesOriginal ?? null,
    'Florist Note':       row.floristNote ?? null,
    'Greeting Card Text': row.greetingCardText ?? null,
    Source:               row.source ?? null,
    'Communication method': row.communicationMethod ?? null,
    'Payment Status':     row.paymentStatus,
    'Payment Method':     row.paymentMethod ?? null,
    'Price Override':     row.priceOverride != null ? Number(row.priceOverride) : null,
    'Delivery Fee':       row.deliveryFee != null ? Number(row.deliveryFee) : null,
    'Created By':         row.createdBy ?? null,
    'Payment 1 Amount':   row.payment1Amount != null ? Number(row.payment1Amount) : null,
    'Payment 1 Method':   row.payment1Method ?? null,
    'Order Lines':        lineIds,
    Deliveries:           deliveryId ? [deliveryId] : [],
  };
}

export function pgLineToResponse(row) {
  if (!row) return null;
  return {
    id: row.airtableId || row.id,
    _pgId: row.id,
    Order:                row.orderId ? [row.orderId] : [],
    'Stock Item':         row.stockItemId ? [row.stockItemId] : [],
    'Flower Name':        row.flowerName,
    Quantity:             row.quantity,
    'Cost Price Per Unit': row.costPricePerUnit != null ? Number(row.costPricePerUnit) : null,
    'Sell Price Per Unit': row.sellPricePerUnit != null ? Number(row.sellPricePerUnit) : null,
    'Stock Deferred':     row.stockDeferred,
  };
}

export function pgDeliveryToResponse(row) {
  if (!row) return null;
  return {
    id: row.airtableId || row.id,
    _pgId: row.id,
    'Linked Order':        row.orderId ? [row.orderId] : [],
    'Delivery Address':    row.deliveryAddress ?? null,
    'Recipient Name':      row.recipientName ?? null,
    'Recipient Phone':     row.recipientPhone ?? null,
    'Delivery Date':       row.deliveryDate ?? null,
    'Delivery Time':       row.deliveryTime ?? null,
    'Assigned Driver':     row.assignedDriver ?? null,
    'Delivery Fee':        row.deliveryFee != null ? Number(row.deliveryFee) : null,
    'Driver Instructions': row.driverInstructions ?? null,
    'Delivery Method':     row.deliveryMethod ?? null,
    'Driver Payout':       row.driverPayout != null ? Number(row.driverPayout) : null,
    Status:                row.status,
  };
}

// ── Sentinel for stub methods ──
// Throwing instead of returning a placeholder ensures any accidental flip
// of ORDER_BACKEND off 'airtable' before the implementation ships fails
// loudly at the route layer rather than silently corrupting state.
function notImplemented(method) {
  const err = new Error(
    `orderRepo.${method}: Phase 4 implementation pending — see docs/migration/phase-4-orders-design.md`,
  );
  err.statusCode = 501;
  throw err;
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC API — signatures locked, implementations stubbed.
// Replaces the corresponding logic in services/orderService.js.
// ─────────────────────────────────────────────────────────────────────

/**
 * List orders with optional filters.
 *
 * @param {object} options
 * @param {string} [options.filterByFormula]  Airtable formula (airtable+shadow modes)
 * @param {Array}  [options.sort]
 * @param {object} [options.pg]               PG-mode filters
 * @param {string[]} [options.pg.statuses]    e.g. ['New', 'Ready']
 * @param {string} [options.pg.dateFrom]      orderDate >= dateFrom
 * @param {string} [options.pg.dateTo]
 * @param {string} [options.pg.customerId]
 * @returns {Promise<object[]>} Airtable-shaped order records
 */
export async function list(_options = {}) {
  if (MODE === 'airtable') return airtable.list(TABLES.ORDERS, _options);
  notImplemented('list');
}

/**
 * Fetch a single order by ID. Accepts either the recXXX (Airtable id)
 * or a PG uuid.
 */
export async function getById(_id) {
  if (MODE === 'airtable') return airtable.getById(TABLES.ORDERS, _id);
  notImplemented('getById');
}

/**
 * Atomic createOrder — replaces orderService.createOrder()'s 538-line
 * try/catch-with-manual-rollback. In postgres mode this becomes a single
 * `db.transaction(...)` that wraps:
 *   1. Insert order row
 *   2. Insert N order_line rows
 *   3. Adjust stock for each line (via stockRepo.adjustQuantity({ tx, ... }))
 *   4. If delivery type is 'Delivery', insert delivery row
 *
 * Any throw rolls back EVERYTHING — no manual unwinding needed.
 *
 * @param {object} params               Same shape as orderService.createOrder's first arg
 * @param {object} config               { getConfig, getDriverOfDay, generateOrderId }
 * @param {object} [opts]
 * @param {boolean} [opts.skipStockDeduction]  Premade-bouquet flow
 * @param {object}  [opts.actor]               actorFromReq(req)
 * @returns {{ order, orderLines, delivery }}
 */
export async function createOrder(_params, _config, _opts = {}) {
  // In airtable mode this is a no-op — orderService.createOrder() runs
  // its existing logic directly. We only divert when ORDER_BACKEND flips.
  if (MODE === 'airtable') {
    const err = new Error(
      'orderRepo.createOrder called in airtable mode — orderService should handle this directly. ' +
      'This call site likely needs to be re-checked.',
    );
    err.statusCode = 500;
    throw err;
  }
  notImplemented('createOrder');
}

/**
 * Validated status transition with order ↔ delivery cascade.
 * Replaces orderService.transitionStatus.
 */
export async function transitionStatus(_orderId, _newStatus, _otherFields = {}, _opts = {}) {
  if (MODE === 'airtable') {
    const err = new Error(
      'orderRepo.transitionStatus called in airtable mode — orderService.transitionStatus should be called directly.',
    );
    err.statusCode = 500;
    throw err;
  }
  notImplemented('transitionStatus');
}

/**
 * Cancel an order and return its line quantities to stock atomically.
 * Replaces orderService.cancelWithStockReturn.
 *
 * In postgres mode: one transaction wraps the order status update +
 * the N stock adjustments. Either everything cancels or nothing does.
 */
export async function cancelWithStockReturn(_orderId, _opts = {}) {
  if (MODE === 'airtable') {
    const err = new Error('orderRepo.cancelWithStockReturn called in airtable mode.');
    err.statusCode = 500;
    throw err;
  }
  notImplemented('cancelWithStockReturn');
}

/**
 * Hard-delete an order + its lines + its delivery. Returns stock if the
 * order was still holding inventory (status not in {Delivered, PickedUp,
 * Cancelled}). Replaces orderService.deleteOrder.
 *
 * In postgres mode the cascade is automatic via ON DELETE CASCADE on the
 * FKs — this method just returns stock first, then deletes the order
 * row, and the children disappear with it.
 */
export async function deleteOrder(_orderId, _opts = {}) {
  if (MODE === 'airtable') {
    const err = new Error('orderRepo.deleteOrder called in airtable mode.');
    err.statusCode = 500;
    throw err;
  }
  notImplemented('deleteOrder');
}

/**
 * Add / update / remove order lines on an existing order, atomically
 * adjusting stock for every changed quantity. Replaces
 * orderService.editBouquetLines.
 *
 * @param {string} orderId
 * @param {object} args
 * @param {object[]} [args.lines]
 * @param {object[]} [args.removedLines]
 * @param {boolean}  isOwner
 * @param {object}   [opts]
 * @param {object}   [opts.actor]
 */
export async function editBouquetLines(_orderId, _args, _isOwner, _opts = {}) {
  if (MODE === 'airtable') {
    const err = new Error('orderRepo.editBouquetLines called in airtable mode.');
    err.statusCode = 500;
    throw err;
  }
  notImplemented('editBouquetLines');
}

// ── Bulk parity check (Phase 4 cutover verification) ──
//
// Mirror of stockRepo.runParityCheck(). Pulls every active order + its
// lines + its delivery from both stores and compares. Drives the
// AdminTab's "Order parity" dashboard.
export async function runParityCheck() {
  if (!db) return { ran: false, reason: 'DATABASE_URL not configured' };
  notImplemented('runParityCheck');
}

// ── Internal exports for tests ──
export const _internal = {
  ORDER_WRITE_ALLOWED,
  LINE_WRITE_ALLOWED,
  DELIVERY_WRITE_ALLOWED,
  pgOrderToResponse,
  pgLineToResponse,
  pgDeliveryToResponse,
};
