// Premade bouquet business logic.
//
// A premade bouquet is a composition the florist builds BEFORE any order exists.
// Stock is deducted at creation time (the flowers are physically in the bouquet).
// Later the bouquet can either:
//   1. Be matched to a client — at which point a real Order is created from its
//      lines, the premade record is deleted, and stock is NOT re-deducted.
//   2. Be returned to stock — the flowers go back to inventory and the premade
//      record is deleted. No order is ever created.
//
// Design trade-off: we deliberately keep premade bouquets in a SEPARATE table
// (not as Orders with a flag) because:
//   - They have no customer, no delivery, no payment — all irrelevant until sold
//   - The "return to stock" flow must not leave an order record behind
//   - It's cleaner to archive/delete premades than to filter special statuses
//     from every order query across the whole app.

import * as db from './airtable.js';
import { TABLES } from '../config/airtable.js';
import { broadcast } from './notifications.js';
import { listByIds } from '../utils/batchQuery.js';
import { autoMatchStock, createOrder } from './orderService.js';

/**
 * Fetch a premade bouquet with its lines enriched.
 * @returns {Promise<Object>} bouquet with `lines` array attached
 */
export async function getPremadeBouquet(id) {
  const bouquet = await db.getById(TABLES.PREMADE_BOUQUETS, id);
  const lineIds = bouquet['Lines'] || [];
  const lines = lineIds.length > 0
    ? await listByIds(TABLES.PREMADE_BOUQUET_LINES, lineIds)
    : [];
  bouquet.lines = lines;
  bouquet['Computed Sell Total'] = lines.reduce(
    (s, l) => s + Number(l['Sell Price Per Unit'] || 0) * Number(l.Quantity || 0),
    0,
  );
  bouquet['Computed Cost Total'] = lines.reduce(
    (s, l) => s + Number(l['Cost Price Per Unit'] || 0) * Number(l.Quantity || 0),
    0,
  );
  bouquet['Final Price'] = bouquet['Price Override'] || bouquet['Computed Sell Total'];
  return bouquet;
}

/**
 * List all premade bouquets with enriched lines + computed totals.
 */
export async function listPremadeBouquets() {
  const bouquets = await db.list(TABLES.PREMADE_BOUQUETS, {
    sort: [{ field: 'Created At', direction: 'desc' }],
    maxRecords: 200,
  });
  if (bouquets.length === 0) return [];

  const allLineIds = bouquets.flatMap(b => b['Lines'] || []);
  const allLines = await listByIds(TABLES.PREMADE_BOUQUET_LINES, allLineIds);
  const linesByBouquet = {};
  for (const line of allLines) {
    const bid = line['Premade Bouquet']?.[0];
    if (!bid) continue;
    if (!linesByBouquet[bid]) linesByBouquet[bid] = [];
    linesByBouquet[bid].push(line);
  }

  for (const bouquet of bouquets) {
    const lines = linesByBouquet[bouquet.id] || [];
    bouquet.lines = lines;
    bouquet['Computed Sell Total'] = lines.reduce(
      (s, l) => s + Number(l['Sell Price Per Unit'] || 0) * Number(l.Quantity || 0),
      0,
    );
    bouquet['Computed Cost Total'] = lines.reduce(
      (s, l) => s + Number(l['Cost Price Per Unit'] || 0) * Number(l.Quantity || 0),
      0,
    );
    bouquet['Final Price'] = bouquet['Price Override'] || bouquet['Computed Sell Total'];
    bouquet['Bouquet Summary'] = lines
      .map(l => `${Number(l.Quantity || 0)}× ${l['Flower Name'] || '?'}`)
      .join(', ');
  }
  return bouquets;
}

/**
 * Create a premade bouquet + lines + deduct stock atomically with rollback.
 * @param {Object} params
 * @param {string} params.name
 * @param {Array}  params.lines - [{ flowerName, stockItemId?, quantity, costPricePerUnit, sellPricePerUnit }]
 * @param {number} [params.priceOverride]
 * @param {string} [params.notes]
 * @param {string} [params.createdBy]
 * @returns {Promise<{ bouquet, lines }>}
 */
export async function createPremadeBouquet(params) {
  const { name, lines, priceOverride, notes, createdBy } = params;

  // Validation
  if (!name || typeof name !== 'string' || !name.trim()) {
    const err = new Error('Premade bouquet name is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    const err = new Error('Premade bouquet must have at least one flower line.');
    err.statusCode = 400;
    throw err;
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (typeof line.quantity !== 'number' || line.quantity <= 0) {
      const err = new Error(`lines[${i}].quantity must be a positive number.`);
      err.statusCode = 400;
      throw err;
    }
  }

  // Rollback tracking
  let bouquet = null;
  const createdLineIds = [];
  const stockAdjustments = [];

  try {
    // 1. Create the parent record
    bouquet = await db.create(TABLES.PREMADE_BOUQUETS, {
      Name: name.trim(),
      'Created By': createdBy || null,
      'Price Override': priceOverride || null,
      Notes: notes || '',
    });

    // 2a. Auto-match unlinked lines to stock by Display Name
    await autoMatchStock(lines);

    // 2a-bis. Reject orphan lines — same rationale as orderService.createOrder().
    const orphans = lines.filter(l => !l.stockItemId);
    if (orphans.length > 0) {
      const names = orphans.map(o => o.flowerName || '(unnamed)').join(', ');
      const err = new Error(
        `Bouquet line(s) without a Stock Item are not allowed: ${names}. ` +
        `Create the flower in Stock first.`,
      );
      err.statusCode = 400;
      throw err;
    }

    // 2b. Create the line records (price snapshotting)
    for (const line of lines) {
      const created = await db.create(TABLES.PREMADE_BOUQUET_LINES, {
        'Premade Bouquet':     [bouquet.id],
        'Stock Item':          [line.stockItemId],
        'Flower Name':         line.flowerName,
        Quantity:              line.quantity,
        'Cost Price Per Unit': line.costPricePerUnit || 0,
        'Sell Price Per Unit': line.sellPricePerUnit || 0,
      });
      createdLineIds.push(created.id);
    }

    // 3. Deduct stock (serialized through stockQueue)
    for (const line of lines) {
      if (line.stockItemId) {
        await db.atomicStockAdjust(line.stockItemId, -line.quantity);
        stockAdjustments.push({ stockId: line.stockItemId, delta: -line.quantity });
      }
    }

    // 4. Broadcast
    broadcast({
      type: 'premade_bouquet_created',
      bouquetId: bouquet.id,
      name: bouquet.Name,
    });

    return await getPremadeBouquet(bouquet.id);
  } catch (err) {
    console.error('[PREMADE] Creation failed, rolling back:', err.message);
    const rollbackErrors = [];

    for (const adj of stockAdjustments) {
      try { await db.atomicStockAdjust(adj.stockId, -adj.delta); }
      catch (e) { rollbackErrors.push(`stock ${adj.stockId}: ${e.message}`); }
    }
    for (const lineId of createdLineIds) {
      try { await db.deleteRecord(TABLES.PREMADE_BOUQUET_LINES, lineId); }
      catch (e) { rollbackErrors.push(`line ${lineId}: ${e.message}`); }
    }
    if (bouquet) {
      try { await db.deleteRecord(TABLES.PREMADE_BOUQUETS, bouquet.id); }
      catch (e) { rollbackErrors.push(`bouquet ${bouquet.id}: ${e.message}`); }
    }
    if (rollbackErrors.length > 0) {
      console.error('[PREMADE] Rollback errors:', rollbackErrors);
    }
    throw err;
  }
}

/**
 * Update top-level fields (name, price override, notes). Does NOT edit lines.
 */
export async function updatePremadeBouquet(id, patch) {
  const fields = {};
  if (patch.name !== undefined) fields.Name = patch.name;
  if (patch.priceOverride !== undefined) fields['Price Override'] = patch.priceOverride || null;
  if (patch.notes !== undefined) fields.Notes = patch.notes;
  await db.update(TABLES.PREMADE_BOUQUETS, id, fields);
  return await getPremadeBouquet(id);
}

/**
 * Return all flowers in a premade bouquet to stock, then delete the records.
 * Mirrors cancelWithStockReturn() in orderService.js.
 * @returns {{ message, returnedItems }}
 */
export async function returnPremadeBouquetToStock(id) {
  const bouquet = await db.getById(TABLES.PREMADE_BOUQUETS, id);
  const lineIds = bouquet['Lines'] || [];
  const returnedItems = [];

  if (lineIds.length > 0) {
    const lines = await listByIds(TABLES.PREMADE_BOUQUET_LINES, lineIds);
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
      // Delete the line record
      await db.deleteRecord(TABLES.PREMADE_BOUQUET_LINES, line.id).catch(() => {});
    }
  }

  // Delete the bouquet record itself
  await db.deleteRecord(TABLES.PREMADE_BOUQUETS, id);

  broadcast({
    type: 'premade_bouquet_returned',
    bouquetId: id,
    name: bouquet.Name || '',
  });

  return { message: 'Premade bouquet returned to stock.', returnedItems };
}

/**
 * Match a premade bouquet to a customer — creates a real Order from the premade's
 * lines, deletes the premade, and does NOT re-deduct stock.
 *
 * @param {string} id - premade bouquet record ID
 * @param {Object} orderData - the fields a normal order needs (customer, deliveryType, delivery, etc.)
 * @param {Object} config - { getConfig, getDriverOfDay, generateOrderId }
 * @returns {Promise<{ order, orderLines, delivery, premadeBouquetId }>}
 */
export async function matchPremadeBouquetToOrder(id, orderData, config) {
  // 1. Load the premade + its lines
  const premade = await getPremadeBouquet(id);
  if (!premade.lines || premade.lines.length === 0) {
    const err = new Error('Premade bouquet has no lines — cannot match to order.');
    err.statusCode = 400;
    throw err;
  }

  // 2. Convert premade lines to order-line format expected by createOrder.
  //    Prices are taken from the premade snapshots so the customer pays exactly
  //    what the florist/owner saw when composing/advertising the bouquet.
  const orderLines = premade.lines.map(l => ({
    stockItemId: l['Stock Item']?.[0] || null,
    flowerName: l['Flower Name'] || '',
    quantity: Number(l.Quantity || 0),
    costPricePerUnit: Number(l['Cost Price Per Unit'] || 0),
    sellPricePerUnit: Number(l['Sell Price Per Unit'] || 0),
  }));

  // 3. If the premade had a Price Override and the caller didn't supply one,
  //    carry it over so the advertised price stays as the sale price.
  const priceOverride = orderData.priceOverride != null
    ? orderData.priceOverride
    : (premade['Price Override'] || null);

  // 4. Create the order with stock deduction SKIPPED — stock was already
  //    deducted when the premade was built.
  const result = await createOrder(
    {
      ...orderData,
      orderLines,
      priceOverride,
      // Preserve any notes the florist captured at composition time
      notes: orderData.notes || premade.Notes || '',
    },
    config,
    { skipStockDeduction: true },
  );

  // 5. Delete the premade records now that they've been "consumed" into the order.
  //    If this fails, we log but don't throw — the order is already created and
  //    the user shouldn't see a failure for a bookkeeping cleanup issue.
  try {
    for (const line of premade.lines) {
      await db.deleteRecord(TABLES.PREMADE_BOUQUET_LINES, line.id).catch(() => {});
    }
    await db.deleteRecord(TABLES.PREMADE_BOUQUETS, id);
  } catch (cleanupErr) {
    console.error('[PREMADE] Cleanup after match failed:', cleanupErr.message);
  }

  broadcast({
    type: 'premade_bouquet_matched',
    bouquetId: id,
    orderId: result.order?.id || null,
  });

  return { ...result, premadeBouquetId: id };
}
