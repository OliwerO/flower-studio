// Order business logic — extracted from routes/orders.js.
// Routes handle HTTP (req/res), this module handles domain logic.

import * as stockRepo from '../repos/stockRepo.js';
import * as orderRepo from '../repos/orderRepo.js';
import * as customerRepo from '../repos/customerRepo.js';
import { broadcast } from './notifications.js';
import { notifyNewOrder, notifyDeliveryComplete } from './telegram.js';
import { notifyFloristNewOrder } from './floristNotifyService.js';
import { ORDER_STATUS } from '../constants/statuses.js';

// ── Side-effect helpers ──
//
// Side effects (customer record update, SSE broadcast, Telegram notification)
// run after a successful order operation. orderRepo handles persistence
// in a PG transaction; these fire after the transaction commits.

function runPostCreateSideEffects({ order }, params) {
  const { customer, source, customerRequest, communicationMethod, deliveryType, priceOverride } = params;

  // Update customer record with communication method / source (non-blocking).
  const customerPatch = {};
  if (communicationMethod) customerPatch['Communication method'] = communicationMethod;
  if (source) customerPatch['Order Source'] = source;
  if (Object.keys(customerPatch).length > 0) {
    customerRepo.update(customer, customerPatch)
      .catch(err => console.error('[ORDER] Failed to update customer fields:', err.message));
  }

  // SSE broadcast
  broadcast({
    type: 'new_order',
    orderId: order.id,
    customerName: '',
    source: source || 'In-store',
    request: customerRequest || '',
  });

  // Telegram notification (fire-and-forget — don't stretch HTTP response)
  notifyNewOrder({
    source: source || 'In-store',
    customerName: '',
    request: customerRequest,
    deliveryType,
    price: priceOverride || null,
  }).catch(err => console.error('[TELEGRAM] Notification error:', err.message));

  notifyFloristNewOrder({ order, deliveryType, source: source || 'In-store' })
    .catch(err => console.error('[FLORIST_NOTIFY] error:', err.message));
}

function runPostTransitionSideEffects(order, newStatus, orderId) {
  if (newStatus === ORDER_STATUS.READY) {
    broadcast({
      type: 'order_ready',
      orderId: order.id,
      customerRequest: order['Customer Request'] || '',
    });
  }
  if (newStatus === ORDER_STATUS.DELIVERED) {
    sendDeliveryCompleteAlert(orderId).catch(err =>
      console.error('[TELEGRAM] delivery-complete alert failed:', err.message),
    );
  }
}

// ── Status transition state machine ──
// Exported so routes + tests can reference it.
export const ALLOWED_TRANSITIONS = {
  [ORDER_STATUS.NEW]:              [ORDER_STATUS.READY, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.IN_PROGRESS]:      [ORDER_STATUS.READY, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.READY]:            [ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.DELIVERED, ORDER_STATUS.PICKED_UP, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.DELIVERED]:        [],
  [ORDER_STATUS.PICKED_UP]:        [],
  [ORDER_STATUS.CANCELLED]:        [ORDER_STATUS.NEW],
};

/**
 * Auto-match flower names to stock item IDs by Display Name (case-insensitive).
 * Mutates lines in place — sets stockItemId on matches.
 * @returns {number} count of matched lines
 */
export async function autoMatchStock(lines) {
  const unmatched = lines.filter(l => !l.stockItemId && l.flowerName);
  if (unmatched.length === 0) return 0;

  const allStock = await stockRepo.list({
    filterByFormula: '{Active} = TRUE()',
    fields: ['Display Name'],
    pg: { active: true, includeEmpty: true },
  });
  const byName = new Map(allStock.map(s => [(s['Display Name'] || '').toLowerCase(), s]));

  let matched = 0;
  for (const line of unmatched) {
    const found = byName.get((line.flowerName || '').toLowerCase());
    if (found) {
      line.stockItemId = found.id;
      matched++;
    }
  }
  return matched;
}

/**
 * Create order + lines + delivery atomically.
 * Delegates to orderRepo (single PG transaction). Side effects fire after success.
 * @param {Object} params - validated order data from the route
 * @param {Object} config - { getConfig, getDriverOfDay, generateOrderId }
 * @param {Object} [opts] - internal options
 * @param {boolean} [opts.skipStockDeduction] - do not deduct stock (used when matching a premade bouquet whose stock was deducted at creation time)
 * @returns {{ order, orderLines, delivery }}
 */
export async function createOrder(params, config, opts = {}) {
  const result = await orderRepo.createOrder(params, config, opts);
  runPostCreateSideEffects(result, params);
  return result;
}

/**
 * Validate and execute a status transition.
 * Handles timestamps, order→delivery cascade, and broadcast.
 * Delegates to orderRepo (PG transaction). Side effects fire after success.
 * @returns {Object} updated order record
 */
export async function transitionStatus(orderId, newStatus, otherFields = {}) {
  const order = await orderRepo.transitionStatus(orderId, newStatus, otherFields);
  runPostTransitionSideEffects(order, newStatus, orderId);
  return order;
}

/**
 * Gather the context needed for the owner's "delivered" Telegram alert
 * (order, customer, delivery, bouquet summary) and hand it to the pure
 * formatter in telegram.js. Safe to call fire-and-forget — any failure
 * here is logged, never thrown, because the delivery itself has already
 * been recorded successfully by the time we reach this function.
 */
export async function sendDeliveryCompleteAlert(orderId) {
  try {
    const order = await orderRepo.getById(orderId);
    const customerId = order.Customer?.[0];
    const deliveryId = order.Deliveries?.[0];
    const lineIds = order['Order Lines'] || [];

    const [customer, delivery, lineRecords] = await Promise.all([
      customerId
        ? customerRepo.findMany([customerId]).then(r => r[0] ?? null).catch(() => null)
        : Promise.resolve(null),
      deliveryId
        ? orderRepo.getDeliveryById(deliveryId).catch(() => null)
        : Promise.resolve(null),
      lineIds.length > 0
        ? orderRepo.getLinesByIds(lineIds).catch(() => [])
        : Promise.resolve([]),
    ]);

    const bouquetSummary = lineRecords
      .map(l => `${Number(l.Quantity || 0)}× ${l['Flower Name'] || '?'}`)
      .filter(s => s && !s.startsWith('0×'))
      .join(', ');

    await notifyDeliveryComplete({
      customerName: customer?.Name || customer?.Nickname || '',
      appOrderId: order['App Order ID'] || '',
      bouquetSummary,
      recipientName: delivery?.['Recipient Name'] || '',
      // Slot may be stored on either the order or the delivery — prefer
      // the delivery's value because the delivery cascade keeps that in
      // sync with any later edits.
      plannedSlot: delivery?.['Delivery Time'] || order['Delivery Time'] || '',
      deliveredAtIso: delivery?.['Delivered At'] || new Date().toISOString(),
      driver: delivery?.['Assigned Driver'] || '',
    });
  } catch (err) {
    console.error('[TELEGRAM] sendDeliveryCompleteAlert failed:', err.message);
  }
}

/**
 * Cancel an order and return all stock to inventory.
 * Delegates to orderRepo (PG transaction).
 * @returns {{ order, returnedItems }}
 */
export async function cancelWithStockReturn(orderId) {
  return await orderRepo.cancelWithStockReturn(orderId);
}

/**
 * Hard-delete an order and every record tied to it — lines and linked delivery.
 * Returns stock for non-terminal orders. Delegates to orderRepo (PG transaction).
 *
 * @param {string} orderId
 * @returns {{ deleted: true, orderId, returnedItems, deletedLineCount, deletedDeliveryCount }}
 */
export async function deleteOrder(orderId) {
  return await orderRepo.deleteOrder(orderId);
}

/**
 * Edit bouquet lines — handle removals (return/writeoff), new lines, qty changes.
 * Auto-reverts status from Ready → New if owner edits.
 * Delegates to orderRepo (PG transaction).
 * @returns {{ updated: true, createdLines }}
 */
export async function editBouquetLines(orderId, { lines = [], removedLines = [] }, isOwner) {
  return await orderRepo.editBouquetLines(orderId, { lines, removedLines }, isOwner);
}

/**
 * After a Stock Order evaluation creates Substitutes, find which open orders
 * (delivery date in the future, non-terminal) have lines pointing at the
 * original Stock Item — those orders need owner reconciliation.
 *
 * @param {Array} substitutionsMade - [{ originalStockId, originalFlowerName, substituteStockId, receivedQty }]
 * @returns {Array} - same shape with `affectedOrders: [{ orderId, appOrderId, customerName, requiredBy, qty }]` populated
 */
export async function findOrdersNeedingSubstitution(substitutionsMade) {
  if (!Array.isArray(substitutionsMade) || substitutionsMade.length === 0) return [];

  const today = new Date().toISOString().split('T')[0];
  const openOrders = await orderRepo.list({
    pg: {
      excludeStatuses: [ORDER_STATUS.DELIVERED, ORDER_STATUS.PICKED_UP, ORDER_STATUS.CANCELLED],
      requiredByFrom:  today,
      limit:           500,
    },
  });

  if (!openOrders.length) {
    return substitutionsMade.map(s => ({ ...s, affectedOrders: [] }));
  }

  // Pull lines for these orders (UUIDs only — _pgId is the canonical FK)
  const orderUuids = openOrders.map(o => o._pgId).filter(Boolean);
  const allLines = await orderRepo.getLinesForOrders(orderUuids);

  // Pull customer names
  const custIds = [...new Set(openOrders.map(o => o.Customer?.[0]).filter(Boolean))];
  const customers = custIds.length ? await customerRepo.findMany(custIds) : [];
  // orders.customer_id may be a recXXX (pre-cutover) or uuid (post-cutover).
  // findMany() returns customers with id (uuid) and airtableId (recXXX or null).
  // Key by both so the lookup matches whatever format was stored on orders.
  const custByEitherId = {};
  for (const c of customers) {
    if (c.id)         custByEitherId[c.id]         = c;
    if (c.airtableId) custByEitherId[c.airtableId] = c;
  }

  const orderInfo = {};
  for (const o of openOrders) {
    const cid = o.Customer?.[0];
    const cust = cid ? custByEitherId[cid] : null;
    orderInfo[o._pgId] = {
      appOrderId:   o['App Order ID'] || '',
      customerName: cust?.Name || cust?.Nickname || '',
      requiredBy:   o['Required By'] || null,
    };
  }

  return substitutionsMade.map(sub => {
    const affectedOrders = [];
    for (const line of allLines) {
      // stockItemId on order_lines is text — may hold recXXX or uuid.
      // sub.originalStockId comes from stockOrderRepo.lineToWire which uses
      // stock_airtable_id || stock_id, so the format matches whichever was
      // originally assigned to both sides.
      if (line.stockItemId !== sub.originalStockId) continue;
      const oi = orderInfo[line.orderId];
      if (!oi) continue;
      affectedOrders.push({
        orderId:      line.orderId,
        appOrderId:   oi.appOrderId,
        customerName: oi.customerName,
        requiredBy:   oi.requiredBy,
        qty:          Number(line.quantity || 0),
      });
    }
    return { ...sub, affectedOrders };
  });
}
