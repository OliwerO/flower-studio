// Order business logic — extracted from routes/orders.js.
// Routes handle HTTP (req/res), this module handles domain logic.

import * as db from './airtable.js';
import { TABLES } from '../config/airtable.js';
import { broadcast } from './notifications.js';
import { notifyNewOrder } from './telegram.js';
import { listByIds } from '../utils/batchQuery.js';
import { ORDER_STATUS, DELIVERY_STATUS } from '../constants/statuses.js';

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

  const allStock = await db.list(TABLES.STOCK, {
    filterByFormula: '{Active} = TRUE()',
    fields: ['Display Name'],
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
 * Create order + lines + delivery atomically with rollback on failure.
 * @param {Object} params - validated order data from the route
 * @param {Object} config - { getConfig, getDriverOfDay, generateOrderId }
 * @param {Object} [opts] - internal options
 * @param {boolean} [opts.skipStockDeduction] - do not deduct stock (used when matching a premade bouquet whose stock was deducted at creation time)
 * @returns {{ order, orderLines, delivery }}
 */
export async function createOrder(params, config, opts = {}) {
  const {
    customer, customerRequest, source, communicationMethod, deliveryType,
    orderLines, delivery, notes, paymentStatus, paymentMethod, priceOverride,
    requiredBy, cardText, deliveryTime, createdBy, isOwner,
    payment1Amount, payment1Method,
  } = params;
  const { getConfig, getDriverOfDay, generateOrderId } = config;
  const { skipStockDeduction = false } = opts;

  // Rollback tracking
  let order = null;
  const createdLineIds = [];
  const stockAdjustments = [];
  let createdDelivery = null;

  try {
    const appOrderId = await generateOrderId();

    // 1. Create parent order
    order = await db.create(TABLES.ORDERS, {
      Customer:             [customer],
      'Customer Request':   customerRequest,
      Source:               source || null,
      'Delivery Type':      deliveryType,
      'Order Date':         new Date().toISOString().split('T')[0],
      'Required By':        requiredBy || delivery?.date || null,
      'Notes Original':     notes || '',
      'Greeting Card Text': cardText || delivery?.cardText || '',
      'Delivery Time':      deliveryTime || delivery?.time || '',
      'Payment Status':     paymentStatus,
      'Payment Method':     paymentMethod || null,
      ...(payment1Amount != null ? { 'Payment 1 Amount': Number(payment1Amount) } : {}),
      ...(payment1Method ? { 'Payment 1 Method': payment1Method } : {}),
      'Delivery Fee':       deliveryType === 'Delivery' ? (delivery?.fee ?? getConfig('defaultDeliveryFee')) : 0,
      'Price Override':     priceOverride || null,
      'App Order ID':       appOrderId,
      Status:               ORDER_STATUS.NEW,
      'Created By':         createdBy,
    });

    // 2a. Auto-match unlinked lines to stock
    await autoMatchStock(orderLines);

    // 2a-bis. Reject the whole order if any line is still orphaned.
    // Orphan lines (stockItemId=null) silently break stock deduction, demand
    // signals, and PO generation. Better to fail loudly here so the caller
    // creates the missing Stock record first (POST /api/stock).
    const orphans = orderLines.filter(l => !l.stockItemId);
    if (orphans.length > 0) {
      const names = orphans.map(o => o.flowerName || '(unnamed)').join(', ');
      const err = new Error(
        `Order line(s) without a Stock Item are not allowed: ${names}. ` +
        `Create the flower in Stock first.`
      );
      err.statusCode = 400;
      throw err;
    }

    // 2b. Create order line records (price snapshotting)
    const createdLines = [];
    for (const line of orderLines) {
      const created = await db.create(TABLES.ORDER_LINES, {
        Order:                 [order.id],
        ...(line.stockItemId ? { 'Stock Item': [line.stockItemId] } : {}),
        'Flower Name':         line.flowerName,
        Quantity:              line.quantity,
        'Cost Price Per Unit': line.costPricePerUnit || 0,
        'Sell Price Per Unit': line.sellPricePerUnit || 0,
      });
      createdLines.push(created);
      createdLineIds.push(created.id);
    }

    // 2c. Owner price override — if the owner touched cost/sell per line for a
    // flower that's currently out of stock (see Step2Bouquet gate on the UI
    // side), write the new prices back to the Stock row + cascade to Premade
    // Bouquet Lines. Run before deduction so the "out of stock" check reflects
    // what the UI showed the owner, not the post-deduction value.
    // Only owners trigger this; florists' line prices are snapshot-only.
    if (isOwner) {
      const stockUpdates = []; // [{ stockId, patch }]
      for (const line of orderLines) {
        if (!line.stockItemId) continue;
        const stockRow = await db.getById(TABLES.STOCK, line.stockItemId).catch(() => null);
        if (!stockRow) continue;
        // Gate: only apply when the flower is currently out of stock. Matches
        // the UI affordance in Step2Bouquet — in-stock items were priced at
        // what was actually paid, so no override is meaningful.
        if (Number(stockRow['Current Quantity']) > 0) continue;
        const stockCost = Number(stockRow['Current Cost Price']) || 0;
        const stockSell = Number(stockRow['Current Sell Price']) || 0;
        const lineCost  = Number(line.costPricePerUnit) || 0;
        const lineSell  = Number(line.sellPricePerUnit) || 0;
        const patch = {};
        if (lineCost && lineCost !== stockCost) patch['Current Cost Price'] = lineCost;
        if (lineSell && lineSell !== stockSell) patch['Current Sell Price'] = lineSell;
        if (Object.keys(patch).length > 0) {
          stockUpdates.push({ stockId: line.stockItemId, patch });
        }
      }
      if (stockUpdates.length > 0) {
        for (const { stockId, patch } of stockUpdates) {
          await db.update(TABLES.STOCK, stockId, patch);
        }
        // Cascade to Premade Bouquet Lines. Same pattern as PATCH /stock:id —
        // fetch all lines once and filter in memory by Stock Item link
        // (filterByFormula on linked records returns display names, not IDs).
        if (TABLES.PREMADE_BOUQUET_LINES) {
          const allPremadeLines = await db.list(TABLES.PREMADE_BOUQUET_LINES, {
            fields: ['Stock Item'],
            maxRecords: 500,
          });
          const stockToPatch = new Map(stockUpdates.map(u => [u.stockId, u.patch]));
          for (const pbl of allPremadeLines) {
            const linkedStockId = Array.isArray(pbl['Stock Item']) ? pbl['Stock Item'][0] : null;
            const stockPatch = linkedStockId ? stockToPatch.get(linkedStockId) : null;
            if (!stockPatch) continue;
            const linePatch = {};
            if ('Current Cost Price' in stockPatch) linePatch['Cost Price Per Unit'] = stockPatch['Current Cost Price'];
            if ('Current Sell Price' in stockPatch) linePatch['Sell Price Per Unit'] = stockPatch['Current Sell Price'];
            await db.update(TABLES.PREMADE_BOUQUET_LINES, pbl.id, linePatch);
          }
        }
      }
    }

    // 3. Deduct stock (serialized through stockQueue).
    // Skipped when matching a premade bouquet — stock was already deducted when
    // the florist composed the premade, so the order just inherits the existing hold.
    if (!skipStockDeduction) {
      for (const line of orderLines) {
        if (line.stockItemId && !line.stockDeferred) {
          await db.atomicStockAdjust(line.stockItemId, -line.quantity);
          stockAdjustments.push({ stockId: line.stockItemId, delta: -line.quantity });
        }
      }
    }

    // 4. Create delivery record if needed
    if (deliveryType === 'Delivery' && delivery) {
      createdDelivery = await db.create(TABLES.DELIVERIES, {
        'Linked Order':    [order.id],
        'Delivery Address': delivery.address || '',
        'Recipient Name':   delivery.recipientName || '',
        'Recipient Phone':  delivery.recipientPhone || '',
        'Delivery Date':    delivery.date || null,
        'Delivery Time':    delivery.time || '',
        'Assigned Driver':  delivery.driver || getDriverOfDay() || null,
        'Delivery Fee':     delivery.fee ?? getConfig('defaultDeliveryFee'),
        'Delivery Method':  'Driver',
        'Driver Payout':    getConfig('driverCostPerDelivery') || 0,
        Status:             DELIVERY_STATUS.PENDING,
      });
    }

    // 5. Update customer record (non-blocking)
    const customerPatch = {};
    if (communicationMethod) customerPatch['Communication method'] = communicationMethod;
    if (source) customerPatch['Order Source'] = source;
    if (Object.keys(customerPatch).length > 0) {
      db.update(TABLES.CUSTOMERS, customer, customerPatch)
        .catch(err => console.error('[ORDER] Failed to update customer fields:', err.message));
    }

    // 6. Notifications (non-blocking)
    broadcast({
      type: 'new_order',
      orderId: order.id,
      customerName: '',
      source: source || 'In-store',
      request: customerRequest || '',
    });
    notifyNewOrder({
      source: source || 'In-store',
      customerName: '',
      request: customerRequest,
      deliveryType,
      price: priceOverride || null,
    }).catch(err => console.error('[TELEGRAM] Notification error:', err.message));

    return { order, orderLines: createdLines, delivery: createdDelivery };
  } catch (err) {
    // Rollback: reverse stock, delete created records
    console.error('[ORDER] Creation failed, rolling back:', err.message);
    const rollbackErrors = [];

    for (const adj of stockAdjustments) {
      try { await db.atomicStockAdjust(adj.stockId, -adj.delta); }
      catch (e) { rollbackErrors.push(`stock ${adj.stockId}: ${e.message}`); }
    }
    for (const lineId of createdLineIds) {
      try { await db.deleteRecord(TABLES.ORDER_LINES, lineId); }
      catch (e) { rollbackErrors.push(`line ${lineId}: ${e.message}`); }
    }
    if (order) {
      try { await db.deleteRecord(TABLES.ORDERS, order.id); }
      catch (e) { rollbackErrors.push(`order ${order.id}: ${e.message}`); }
    }
    if (rollbackErrors.length > 0) {
      console.error('[ORDER] Rollback errors:', rollbackErrors);
    }

    throw err; // re-throw so route can respond with 500
  }
}

/**
 * Validate and execute a status transition.
 * Handles timestamps, order→delivery cascade, and broadcast.
 * @returns {Object} updated order record
 */
export async function transitionStatus(orderId, newStatus, otherFields = {}) {
  const current = await db.getById(TABLES.ORDERS, orderId);
  const currentStatus = current.Status || ORDER_STATUS.NEW;
  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];

  if (newStatus !== currentStatus && !allowed.includes(newStatus)) {
    const err = new Error(
      `Cannot move from "${currentStatus}" to "${newStatus}". Allowed: ${allowed.join(', ') || 'none (terminal)'}`
    );
    err.statusCode = 400;
    throw err;
  }

  // Prep timestamps
  const timestamps = {};
  if (newStatus === ORDER_STATUS.READY) {
    timestamps['Prep Ready At'] = new Date().toISOString();
  }

  const order = await db.update(TABLES.ORDERS, orderId, {
    ...otherFields,
    Status: newStatus,
    ...timestamps,
  });

  // Cascade to delivery
  if ([ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.DELIVERED].includes(newStatus)) {
    const deliveryId = order['Deliveries']?.[0];
    if (deliveryId) {
      const deliveryPatch = { Status: newStatus };
      if (newStatus === ORDER_STATUS.DELIVERED) {
        deliveryPatch['Delivered At'] = new Date().toISOString();
      }
      await db.update(TABLES.DELIVERIES, deliveryId, deliveryPatch).catch(() => {});
    }
  }

  // Broadcast
  if (newStatus === ORDER_STATUS.READY) {
    broadcast({
      type: 'order_ready',
      orderId: order.id,
      customerRequest: order['Customer Request'] || '',
    });
  }

  return order;
}

/**
 * Cancel an order and return all stock to inventory.
 * @returns {{ order, returnedItems }}
 */
export async function cancelWithStockReturn(orderId) {
  const order = await db.getById(TABLES.ORDERS, orderId);
  const currentStatus = order.Status || ORDER_STATUS.NEW;

  if (currentStatus === ORDER_STATUS.CANCELLED) {
    const err = new Error('Order is already cancelled.');
    err.statusCode = 400;
    throw err;
  }

  const lineIds = order['Order Lines'] || [];
  const returnedItems = [];

  if (lineIds.length > 0) {
    const lines = await listByIds(TABLES.ORDER_LINES, lineIds);
    for (const line of lines) {
      const stockId = line['Stock Item']?.[0];
      const qty = Number(line.Quantity || 0);
      if (stockId && qty > 0) {
        const { newQty } = await db.atomicStockAdjust(stockId, qty);
        returnedItems.push({
          stockId,
          flowerName: line['Flower Name'] || '?',
          quantityReturned: qty,
          newStockQty: newQty,
        });
      }
    }
  }

  await db.update(TABLES.ORDERS, orderId, { Status: ORDER_STATUS.CANCELLED });

  return { message: 'Order cancelled and stock returned.', returnedItems };
}

/**
 * Edit bouquet lines — handle removals (return/writeoff), new lines, qty changes.
 * Auto-reverts status from Ready → New if owner edits.
 * @returns {{ updated: true, createdLines }}
 */
export async function editBouquetLines(orderId, { lines = [], removedLines = [] }, isOwner) {
  const order = await db.getById(TABLES.ORDERS, orderId);
  // Non-owner roles can only edit bouquets while the order is still being
  // prepared. Owner can edit in any status — this is the last thing that
  // still required opening Airtable directly (e.g. recording a late
  // substitution on a Delivered order or fixing a Cancelled order's record
  // before reopening it). Removing this gate is what unblocks the
  // Airtable → Postgres migration.
  const editableStatuses = [ORDER_STATUS.NEW, ORDER_STATUS.READY];
  if (!isOwner && !editableStatuses.includes(order.Status)) {
    const err = new Error(`Cannot edit bouquet in "${order.Status}" status.`);
    err.statusCode = 400;
    throw err;
  }

  // 1. Handle removed lines
  for (const rem of removedLines) {
    if (rem.stockItemId && rem.quantity > 0) {
      if (rem.action === 'return') {
        await db.atomicStockAdjust(rem.stockItemId, rem.quantity);
      } else if (rem.action === 'writeoff') {
        await db.create(TABLES.STOCK_LOSS_LOG, {
          'Stock Item': [rem.stockItemId],
          Quantity: rem.quantity,
          Reason: rem.reason || 'Bouquet edit',
          Date: new Date().toISOString().split('T')[0],
        }).catch(e => console.error('[STOCK-LOSS] Write-off log error:', e.message));
      }
    }
    if (rem.lineId) {
      await db.deleteRecord(TABLES.ORDER_LINES, rem.lineId).catch(() => {});
    }
  }

  // Track explicit stock actions to avoid double-counting
  const explicitStockIds = new Set(
    removedLines.filter(r => !r.lineId && r.stockItemId).map(r => r.stockItemId)
  );

  // 2a. Auto-match new unlinked lines
  const newUnmatched = lines.filter(l => !l.id && !l.stockItemId && l.flowerName);
  if (newUnmatched.length > 0) {
    await autoMatchStock(newUnmatched);
  }

  // 2a-bis. Reject orphan new lines (see createOrder for rationale).
  // Existing lines (line.id) are exempt — they were created before this guard.
  const orphans = lines.filter(l => !l.id && !l.stockItemId);
  if (orphans.length > 0) {
    const names = orphans.map(o => o.flowerName || '(unnamed)').join(', ');
    const err = new Error(
      `Order line(s) without a Stock Item are not allowed: ${names}. ` +
      `Create the flower in Stock first.`
    );
    err.statusCode = 400;
    throw err;
  }

  // 2b. Process new/updated lines
  const createdLines = [];
  for (const line of lines) {
    if (line.id) {
      // Existing line — update quantity
      if (line._originalQty !== null && line._originalQty !== undefined && line.quantity !== line._originalQty) {
        const delta = line._originalQty - line.quantity;
        if (line.stockItemId && !line.stockDeferred && delta !== 0 && !explicitStockIds.has(line.stockItemId)) {
          await db.atomicStockAdjust(line.stockItemId, delta);
        }
        await db.update(TABLES.ORDER_LINES, line.id, { Quantity: line.quantity });
      }
    } else {
      // New line — create + deduct stock
      const created = await db.create(TABLES.ORDER_LINES, {
        Order: [orderId],
        ...(line.stockItemId ? { 'Stock Item': [line.stockItemId] } : {}),
        'Flower Name': line.flowerName,
        Quantity: line.quantity,
        'Cost Price Per Unit': line.costPricePerUnit || 0,
        'Sell Price Per Unit': line.sellPricePerUnit || 0,
      });
      createdLines.push(created);
      if (line.stockItemId && !line.stockDeferred) {
        await db.atomicStockAdjust(line.stockItemId, -line.quantity);
      }
    }
  }

  // 3. Auto-revert if owner edits while Ready
  if (isOwner && order.Status === ORDER_STATUS.READY) {
    await db.update(TABLES.ORDERS, orderId, { Status: ORDER_STATUS.NEW });
  }

  return { updated: true, createdLines };
}
