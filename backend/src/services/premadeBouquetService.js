// Premade bouquet business logic. Phase 7: persistence via premadeBouquetRepo.
//
// A premade bouquet is a composition the florist builds BEFORE any order exists.
// Stock is deducted at creation time. The bouquet can later be:
//   1. Matched to a client — Order created from its lines, premade record deleted.
//   2. Returned to stock — flowers go back to inventory, premade record deleted.

import * as premadeBouquetRepo from '../repos/premadeBouquetRepo.js';
import * as stockRepo from '../repos/stockRepo.js';
import { broadcast } from './notifications.js';
import { autoMatchStock, createOrder } from './orderService.js';

export async function getPremadeBouquet(id) {
  const bouquet = await premadeBouquetRepo.getById(id);
  const lines = await premadeBouquetRepo.getLinesByBouquetId(bouquet._pgId);
  bouquet.lines = lines;
  bouquet.Lines = lines.map(l => l.id);
  bouquet['Computed Sell Total'] = lines.reduce(
    (s, l) => s + Number(l['Sell Price Per Unit'] || 0) * Number(l.Quantity || 0), 0);
  bouquet['Computed Cost Total'] = lines.reduce(
    (s, l) => s + Number(l['Cost Price Per Unit'] || 0) * Number(l.Quantity || 0), 0);
  bouquet['Final Price'] = bouquet['Price Override'] || bouquet['Computed Sell Total'];
  return bouquet;
}

export async function listPremadeBouquets() {
  const bouquets = await premadeBouquetRepo.list();
  if (bouquets.length === 0) return [];

  // Bulk fetch all lines via individual queries (small N — premades are 0–20 rows in practice)
  for (const bouquet of bouquets) {
    const lines = await premadeBouquetRepo.getLinesByBouquetId(bouquet._pgId);
    bouquet.lines = lines;
    bouquet.Lines = lines.map(l => l.id);
    bouquet['Computed Sell Total'] = lines.reduce(
      (s, l) => s + Number(l['Sell Price Per Unit'] || 0) * Number(l.Quantity || 0), 0);
    bouquet['Computed Cost Total'] = lines.reduce(
      (s, l) => s + Number(l['Cost Price Per Unit'] || 0) * Number(l.Quantity || 0), 0);
    bouquet['Final Price'] = bouquet['Price Override'] || bouquet['Computed Sell Total'];
    bouquet['Bouquet Summary'] = lines
      .map(l => `${Number(l.Quantity || 0)}× ${l['Flower Name'] || '?'}`)
      .join(', ');
  }
  return bouquets;
}

export async function createPremadeBouquet(params) {
  const { name, lines, priceOverride, notes, createdBy } = params;

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
    if (typeof lines[i].quantity !== 'number' || lines[i].quantity <= 0) {
      const err = new Error(`lines[${i}].quantity must be a positive number.`);
      err.statusCode = 400;
      throw err;
    }
  }

  let bouquet = null;
  const createdLineIds = [];
  const stockAdjustments = [];

  try {
    bouquet = await premadeBouquetRepo.create({
      Name:             name.trim(),
      'Created By':     createdBy || '',
      'Price Override': priceOverride || null,
      Notes:            notes || '',
    });

    await autoMatchStock(lines);

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

    for (const line of lines) {
      const created = await premadeBouquetRepo.createLine({
        'Premade Bouquets':    [bouquet._pgId],
        'Stock Item':          [line.stockItemId],
        'Flower Name':         line.flowerName,
        Quantity:              line.quantity,
        'Cost Price Per Unit': line.costPricePerUnit || 0,
        'Sell Price Per Unit': line.sellPricePerUnit || 0,
      });
      createdLineIds.push(created._pgId);
    }

    for (const line of lines) {
      if (line.stockItemId) {
        await stockRepo.adjustQuantity(line.stockItemId, -line.quantity);
        stockAdjustments.push({ stockId: line.stockItemId, delta: -line.quantity });
      }
    }

    broadcast({ type: 'premade_bouquet_created', bouquetId: bouquet.id, name: bouquet.Name });
    return await getPremadeBouquet(bouquet.id);
  } catch (err) {
    console.error('[PREMADE] Creation failed, rolling back:', err.message);
    const rollbackErrors = [];

    for (const adj of stockAdjustments) {
      try { await stockRepo.adjustQuantity(adj.stockId, -adj.delta); }
      catch (e) { rollbackErrors.push(`stock ${adj.stockId}: ${e.message}`); }
    }
    for (const lineId of createdLineIds) {
      try { await premadeBouquetRepo.deleteLineById(lineId); }
      catch (e) { rollbackErrors.push(`line ${lineId}: ${e.message}`); }
    }
    if (bouquet) {
      try { await premadeBouquetRepo.deleteById(bouquet._pgId); }
      catch (e) { rollbackErrors.push(`bouquet ${bouquet._pgId}: ${e.message}`); }
    }
    if (rollbackErrors.length > 0) console.error('[PREMADE] Rollback errors:', rollbackErrors);
    throw err;
  }
}

export async function updatePremadeBouquet(id, patch) {
  const fields = {};
  if (patch.name !== undefined)          fields.Name             = patch.name;
  if (patch.priceOverride !== undefined) fields['Price Override'] = patch.priceOverride || null;
  if (patch.notes !== undefined)         fields.Notes            = patch.notes;
  await premadeBouquetRepo.update(id, fields);
  return await getPremadeBouquet(id);
}

export async function editPremadeBouquetLines(id, { lines = [], removedLines = [] }) {
  const bouquet = await premadeBouquetRepo.getById(id);

  for (const rem of removedLines) {
    if (rem.stockItemId && rem.quantity > 0) {
      await stockRepo.adjustQuantity(rem.stockItemId, rem.quantity);
    }
    if (rem.lineId) {
      await premadeBouquetRepo.deleteLineById(rem.lineId).catch(err =>
        console.error(`[PREMADE] Failed to delete removed line ${rem.lineId}:`, err.message),
      );
    }
  }

  const newUnmatched = lines.filter(l => !l.id && !l.stockItemId && l.flowerName);
  if (newUnmatched.length > 0) await autoMatchStock(newUnmatched);

  const orphans = lines.filter(l => !l.id && !l.stockItemId);
  if (orphans.length > 0) {
    const names = orphans.map(o => o.flowerName || '(unnamed)').join(', ');
    const err = new Error(
      `Bouquet line(s) without a Stock Item are not allowed: ${names}. ` +
      `Create the flower in Stock first.`,
    );
    err.statusCode = 400;
    throw err;
  }

  const createdLines = [];
  for (const line of lines) {
    if (line.id) {
      if (line._originalQty != null && line.quantity !== line._originalQty) {
        const delta = line._originalQty - line.quantity;
        if (line.stockItemId && delta !== 0) {
          await stockRepo.adjustQuantity(line.stockItemId, delta);
        }
        await premadeBouquetRepo.updateLine(line.id, { Quantity: line.quantity });
      }
    } else {
      const created = await premadeBouquetRepo.createLine({
        'Premade Bouquets':    [bouquet._pgId],
        ...(line.stockItemId ? { 'Stock Item': [line.stockItemId] } : {}),
        'Flower Name':         line.flowerName,
        Quantity:              line.quantity,
        'Cost Price Per Unit': line.costPricePerUnit || 0,
        'Sell Price Per Unit': line.sellPricePerUnit || 0,
      });
      createdLines.push(created);
      if (line.stockItemId) {
        await stockRepo.adjustQuantity(line.stockItemId, -line.quantity);
      }
    }
  }

  return { updated: true, createdLines };
}

export async function returnPremadeBouquetToStock(id) {
  const bouquet = await premadeBouquetRepo.getById(id);
  const lines = await premadeBouquetRepo.getLinesByBouquetId(bouquet._pgId);
  const returnedItems = [];

  for (const line of lines) {
    const stockId = line['Stock Item']?.[0];
    const qty = Number(line.Quantity || 0);
    if (stockId && qty > 0) {
      try {
        const { newQty } = await stockRepo.adjustQuantity(stockId, qty);
        returnedItems.push({
          stockId,
          flowerName:       line['Flower Name'] || '?',
          quantityReturned: qty,
          newStockQty:      newQty,
        });
      } catch (err) {
        if (err.statusCode === 404) {
          console.warn(`[PREMADE] Stock item ${stockId} not found during return — skipping quantity restore for "${line['Flower Name'] || '?'}"`);
        } else {
          throw err;
        }
      }
    }
  }

  // CASCADE deletes lines when the bouquet is deleted
  await premadeBouquetRepo.deleteById(bouquet._pgId);

  broadcast({ type: 'premade_bouquet_returned', bouquetId: id, name: bouquet.Name || '' });
  return { message: 'Premade bouquet returned to stock.', returnedItems };
}

export async function matchPremadeBouquetToOrder(id, orderData, config) {
  const premade = await getPremadeBouquet(id);
  if (!premade.lines || premade.lines.length === 0) {
    const err = new Error('Premade bouquet has no lines — cannot match to order.');
    err.statusCode = 400;
    throw err;
  }

  const orderLines = premade.lines.map(l => ({
    stockItemId:      l['Stock Item']?.[0] || null,
    flowerName:       l['Flower Name'] || '',
    quantity:         Number(l.Quantity || 0),
    costPricePerUnit: Number(l['Cost Price Per Unit'] || 0),
    sellPricePerUnit: Number(l['Sell Price Per Unit'] || 0),
  }));

  const priceOverride = orderData.priceOverride != null
    ? orderData.priceOverride
    : (premade['Price Override'] || null);

  const result = await createOrder(
    {
      ...orderData,
      orderLines,
      priceOverride,
      notes: orderData.notes || premade.Notes || '',
    },
    config,
    { skipStockDeduction: true },
  );

  try {
    await premadeBouquetRepo.deleteById(premade._pgId);  // CASCADE removes lines
  } catch (cleanupErr) {
    console.error('[PREMADE] Cleanup after match failed:', cleanupErr.message);
  }

  broadcast({ type: 'premade_bouquet_matched', bouquetId: id, orderId: result.order?.id || null });
  return { ...result, premadeBouquetId: id };
}
