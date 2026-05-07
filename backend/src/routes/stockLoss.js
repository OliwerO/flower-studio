// Stock Loss routes — log waste events (wilted, damaged, overstock, etc.).
// Like a defect register on the factory floor: track what was scrapped and why.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import * as stockRepo from '../repos/stockRepo.js';
import { actorFromReq } from '../utils/actor.js';
import { TABLES } from '../config/airtable.js';
import { VALID_LOSS_REASONS } from '../constants/statuses.js';

const router = Router();
router.use(authorize('orders')); // florists + owner can log waste

const VALID_REASONS = VALID_LOSS_REASONS;

// GET /api/stock-loss?from=2026-01-01&to=2026-03-31
// Enriches each entry with flower name + supplier from the linked Stock record.
router.get('/', async (req, res, next) => {
  try {
    if (!TABLES.STOCK_LOSS_LOG) return res.json([]);

    const filters = [];
    if (req.query.from) filters.push(`NOT(IS_BEFORE({Date}, '${req.query.from}'))`);
    if (req.query.to) filters.push(`NOT(IS_AFTER({Date}, '${req.query.to}'))`);

    const records = await db.list(TABLES.STOCK_LOSS_LOG, {
      filterByFormula: filters.length ? `AND(${filters.join(',')})` : '',
      sort: [{ field: 'Date', direction: 'desc' }],
    });

    // Collect unique stock item IDs to batch-fetch names + suppliers
    const stockIds = [...new Set(records.flatMap(r => r['Stock Item'] || []))];
    const stockMap = {};
    for (let i = 0; i < stockIds.length; i += 100) {
      const batch = stockIds.slice(i, i + 100);
      const items = await db.list(TABLES.STOCK, {
        filterByFormula: `OR(${batch.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
        fields: ['Display Name', 'Purchase Name', 'Supplier', 'Current Cost Price', 'Last Restocked'],
      });
      for (const item of items) stockMap[item.id] = item;
    }

    // Enrich each loss entry
    const enriched = records.map(r => {
      const stockId = r['Stock Item']?.[0];
      const stock = stockMap[stockId];
      return {
        ...r,
        flowerName: stock?.['Display Name'] || stock?.['Purchase Name'] || '—',
        supplier: stock?.Supplier || '—',
        costPrice: stock?.['Current Cost Price'] || 0,
        lastRestocked: stock?.['Last Restocked'] || null,
      };
    });

    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

// POST /api/stock-loss — log a waste event
// Body: { date, stockItemId, quantity, reason, notes }
router.post('/', async (req, res, next) => {
  try {
    if (!TABLES.STOCK_LOSS_LOG) {
      return res.status(400).json({ error: 'Stock Loss Log table not configured' });
    }
    const { date, stockItemId, quantity, reason, notes } = req.body;
    if (!quantity || !reason) {
      return res.status(400).json({ error: 'quantity and reason are required' });
    }
    if (!VALID_REASONS.includes(reason)) {
      return res.status(400).json({ error: `reason must be one of: ${VALID_REASONS.join(', ')}` });
    }

    const fields = {
      Date: date || new Date().toISOString().split('T')[0],
      Quantity: Number(quantity),
      Reason: reason,
      Notes: notes || '',
    };
    if (stockItemId) fields['Stock Item'] = [stockItemId];

    const record = await db.create(TABLES.STOCK_LOSS_LOG, fields);

    // Deduct from stock if linked. Route through stockRepo so the adjustment
    // lands in Postgres when STOCK_BACKEND=shadow|postgres — direct
    // db.atomicStockAdjust only mutates Airtable and silently desyncs PG.
    if (stockItemId) {
      await stockRepo.adjustQuantity(stockItemId, -Number(quantity), { actor: actorFromReq(req) });
    }

    // Enrich response so the mobile UI can optimistically render without a
    // second GET. Mirrors the GET handler's enrichment shape.
    let enriched = record;
    if (stockItemId) {
      try {
        const stock = await db.getById(TABLES.STOCK, stockItemId);
        enriched = {
          ...record,
          flowerName: stock?.['Display Name'] || stock?.['Purchase Name'] || '—',
          supplier: stock?.Supplier || '—',
          costPrice: stock?.['Current Cost Price'] || 0,
          lastRestocked: stock?.['Last Restocked'] || null,
        };
      } catch {
        // Enrichment is best-effort; raw record is still valid.
      }
    }

    res.status(201).json(enriched);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/stock-loss/:id — edit a waste entry, adjusting stock if quantity changed
router.patch('/:id', async (req, res, next) => {
  try {
    if (!TABLES.STOCK_LOSS_LOG) {
      return res.status(400).json({ error: 'Stock Loss Log table not configured' });
    }
    const { quantity, reason, notes, date } = req.body;

    const current = await db.getById(TABLES.STOCK_LOSS_LOG, req.params.id);
    const oldQty = Number(current.Quantity || 0);
    const stockItemId = current['Stock Item']?.[0];

    const fields = {};
    if (quantity != null) fields.Quantity = Number(quantity);
    if (reason != null) {
      if (!VALID_REASONS.includes(reason)) {
        return res.status(400).json({ error: `reason must be one of: ${VALID_REASONS.join(', ')}` });
      }
      fields.Reason = reason;
    }
    if (notes != null) fields.Notes = notes;
    if (date != null) fields.Date = date;

    const newQty = fields.Quantity != null ? fields.Quantity : oldQty;
    const delta = oldQty - newQty; // positive = reduced loss → restore stock

    if (delta !== 0 && stockItemId) {
      await stockRepo.adjustQuantity(stockItemId, delta, { actor: actorFromReq(req) });
      // Adjust Dead/Unsold Stems counter — route through stockRepo so the
      // update lands in Postgres (STOCK_BACKEND=postgres) rather than the
      // frozen Airtable snapshot.
      const stockItem = await stockRepo.getById(stockItemId);
      const currentDead = Number(stockItem['Dead/Unsold Stems'] || 0);
      await stockRepo.update(stockItemId, {
        'Dead/Unsold Stems': Math.max(0, currentDead - delta),
      }, { actor: actorFromReq(req) });
    }

    const updated = await db.update(TABLES.STOCK_LOSS_LOG, req.params.id, fields);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/stock-loss/:id — delete a waste entry and restore stock
router.delete('/:id', async (req, res, next) => {
  try {
    if (!TABLES.STOCK_LOSS_LOG) {
      return res.status(400).json({ error: 'Stock Loss Log table not configured' });
    }

    const current = await db.getById(TABLES.STOCK_LOSS_LOG, req.params.id);
    const qty = Number(current.Quantity || 0);
    const stockItemId = current['Stock Item']?.[0];

    if (stockItemId && qty > 0) {
      await stockRepo.adjustQuantity(stockItemId, +qty, { actor: actorFromReq(req) });
      const stockItem = await stockRepo.getById(stockItemId);
      const currentDead = Number(stockItem['Dead/Unsold Stems'] || 0);
      await stockRepo.update(stockItemId, {
        'Dead/Unsold Stems': Math.max(0, currentDead - qty),
      }, { actor: actorFromReq(req) });
    }

    await db.deleteRecord(TABLES.STOCK_LOSS_LOG, req.params.id);
    res.json({ id: req.params.id, deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
