// Premade bouquet business logic. Phase 7: persistence via premadeBouquetRepo.
//
// A premade bouquet is a composition the florist builds BEFORE any order exists.
// Reservation model (issue #285): Batch quantity is NOT deducted at creation
// time. premade_bouquet_lines rows are the reservation ledger.
//   1. Matched to a client — Lines deleted first, then createOrder runs WITHOUT
//      skipStockDeduction so standard Batch deduction happens at sale time.
//   2. Dissolved — Lines deleted, Batch unchanged (no credit needed).
//
// premade_bouquet_lines are the sole ledger; the Batch can never be
// double-counted (pitfall #8).

import * as premadeBouquetRepo from '../repos/premadeBouquetRepo.js';
import * as stockRepo from '../repos/stockRepo.js';
import { broadcast } from './notifications.js';
import { autoMatchStock, createOrder } from './orderService.js';
import { db } from '../db/index.js';
import { premadeBouquets, premadeBouquetLines } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { recordAudit } from '../db/audit.js';
import { actorFromReq } from '../utils/actor.js';

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
  const { name, lines } = params;

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

  // Auto-match stock by flower name (read-only, runs before any writes).
  await autoMatchStock(lines);

  return await _createPremadeBouquetYModel(params);
}

// Validates free qty per line (SELECT FOR UPDATE in production), inserts
// the bouquet header + lines in a single transaction. Batch quantity is
// intentionally unchanged — premade_bouquet_lines are the reservation ledger.
async function _createPremadeBouquetYModel({ name, lines, priceOverride, notes, createdBy }) {
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

  const created = await db.transaction(async (tx) => {
    // Validate free qty for each line (production: locks Batch row per line).
    for (const line of lines) {
      await stockRepo.validateFreeQty(line.stockItemId, Number(line.quantity), tx);
    }
    // Insert bouquet header.
    const [bq] = await tx.insert(premadeBouquets).values({
      name:          name.trim(),
      createdBy:     createdBy || '',
      priceOverride: priceOverride != null ? String(priceOverride) : null,
      notes:         notes || '',
    }).returning();
    // Insert lines — NO Batch update; reservation lives in lines only.
    if (lines.length > 0) {
      await tx.insert(premadeBouquetLines).values(lines.map(l => ({
        bouquetId:        bq.id,
        stockId:          l.stockItemId,
        flowerName:       l.flowerName,
        quantity:         Number(l.quantity),
        costPricePerUnit: String(Number(l.costPricePerUnit) || 0),
        sellPricePerUnit: String(Number(l.sellPricePerUnit) || 0),
      })));
    }
    return bq;
  });

  broadcast({ type: 'premade_bouquet_created', bouquetId: created.id, name: created.name });
  return await getPremadeBouquet(created.id);
}

export async function updatePremadeBouquet(id, patch) {
  const fields = {};
  if (patch.name !== undefined)          fields.Name             = patch.name;
  if (patch.priceOverride !== undefined) fields['Price Override'] = patch.priceOverride || null;
  if (patch.notes !== undefined)         fields.Notes            = patch.notes;
  await premadeBouquetRepo.update(id, fields);
  return await getPremadeBouquet(id);
}

export async function editPremadeBouquetLines(id, payload) {
  return await _editPremadeBouquetLinesYModel(id, payload);
}

// ── Edit path (issue #330) ──
// Reservation ledger lives in premade_bouquet_lines; editing lines mutates
// the reservation only, NEVER Batch qty. validateFreeQty gates new lines and
// qty increases (delta only) so reservations stay coherent; decreases skip
// validation (they release reservation back to free qty).
async function _editPremadeBouquetLinesYModel(id, { lines = [], removedLines = [] }) {
  const bouquet = await premadeBouquetRepo.getById(id);

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

  // All inserts/updates run on the same tx so validateFreeQty's row-lock
  // (production PG) covers each line and the reservation row write atomically.
  // Bypass the repo here (repo methods use their own connection, which would
  // deadlock against this open tx in pglite).
  const createdLines = [];
  await db.transaction(async (tx) => {
    // Removed lines first — drop the reservation row inside the SAME tx so a
    // later validateFreeQty failure rolls the deletion back (C10). No credit to
    // Batch qty (nothing was deducted at build time under the reservation model).
    for (const rem of removedLines) {
      if (rem.lineId) {
        await tx.delete(premadeBouquetLines).where(eq(premadeBouquetLines.id, rem.lineId));
      }
    }

    for (const line of lines) {
      if (line.id) {
        if (line._originalQty != null && line.quantity !== line._originalQty) {
          const newQty = Number(line.quantity);
          const oldQty = Number(line._originalQty);
          if (line.stockItemId && newQty > oldQty) {
            await stockRepo.validateFreeQty(line.stockItemId, newQty - oldQty, tx);
          }
          await tx.update(premadeBouquetLines)
            .set({ quantity: newQty })
            .where(eq(premadeBouquetLines.id, line.id));
          // NO stockRepo.adjustQuantity — reservation ledger only.
        }
      } else {
        if (line.stockItemId) {
          await stockRepo.validateFreeQty(line.stockItemId, Number(line.quantity), tx);
        }
        const [created] = await tx.insert(premadeBouquetLines).values({
          bouquetId:        bouquet._pgId,
          stockId:          line.stockItemId || null,
          flowerName:       line.flowerName,
          quantity:         Number(line.quantity),
          costPricePerUnit: String(Number(line.costPricePerUnit) || 0),
          sellPricePerUnit: String(Number(line.sellPricePerUnit) || 0),
        }).returning();
        createdLines.push(created);
        // NO stockRepo.adjustQuantity — reservation ledger only.
      }
    }
  });

  return { updated: true, createdLines };
}

export async function returnPremadeBouquetToStock(id, { req } = {}) {
  return await _dissolvePremadeYModel(id, req);
}

// ── Dissolve path ──
// Deletes the bouquet header; CASCADE removes lines. Batch quantity
// is intentionally unchanged — no credit because nothing was deducted at build.
// One audit_log row per affected Batch records the freed reservation so
// /stock/:id/usage and /stock/varieties/:key/usage can surface the dissolve
// event downstream (owner ask 2026-05-31, F2).
async function _dissolvePremadeYModel(id, req) {
  const bouquet = await premadeBouquetRepo.getById(id);
  if (!bouquet) {
    const err = new Error(`Premade bouquet not found: ${id}`);
    err.statusCode = 404;
    throw err;
  }
  const lines = await premadeBouquetRepo.getLinesByBouquetId(bouquet._pgId);
  const actor = actorFromReq(req);
  await db.transaction(async (tx) => {
    for (const line of lines) {
      const stockId = line['Stock Item']?.[0] ?? line.stockItemId ?? null;
      const qty = Number(line.Quantity || line.quantity) || 0;
      if (!stockId || qty <= 0) continue;
      await recordAudit(tx, {
        entityType: 'stock',
        entityId:   stockId,
        action:     'premade_dissolved',
        before:     null,
        after:      {
          bouquet_id:   id,
          bouquet_name: bouquet.Name || '',
          qty,
        },
        ...actor,
      });
    }
    await tx.delete(premadeBouquetLines).where(eq(premadeBouquetLines.bouquetId, bouquet._pgId));
    await tx.delete(premadeBouquets).where(eq(premadeBouquets.id, bouquet._pgId));
  });
  broadcast({ type: 'premade_bouquet_returned', bouquetId: id, name: bouquet.Name || '' });
  return { message: 'Premade bouquet dissolved. Reservations cleared; Batch quantity unchanged.' };
}

export async function matchPremadeBouquetToOrder(id, orderData, config) {
  return await _matchPremadeYModel(id, orderData, config);
}

// ── Sale path ──
// Deletes lines FIRST (frees the reservation), then routes through standard
// createOrder WITHOUT skipStockDeduction so the Batch is decremented at
// sale time (exactly once, via the normal allocation path).
async function _matchPremadeYModel(id, orderData, config) {
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

  // Create the order FIRST (standard allocation — NO skipStockDeduction, Batch
  // decremented now). Only once the sale is safely persisted do we delete the
  // bouquet, which frees its reservation. If createOrder throws, the bouquet is
  // left intact — a failed sale must never destroy it (C2). Mirrors the legacy
  // sale-path ordering. The transient double-count (Batch decremented + premade
  // reservation still present until the delete) is the same window legacy has.
  const result = await createOrder(
    { ...orderData, orderLines, priceOverride, notes: orderData.notes || premade.Notes || '' },
    config,
  );

  try {
    await premadeBouquetRepo.deleteById(premade._pgId);  // CASCADE removes lines
  } catch (cleanupErr) {
    console.error('[PREMADE] Cleanup after match failed:', cleanupErr.message);
  }

  broadcast({ type: 'premade_bouquet_matched', bouquetId: id, orderId: result.order?.id || null });
  return { ...result, premadeBouquetId: id };
}

